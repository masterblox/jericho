import { randomUUID } from 'node:crypto';

import {
  CaptureFailureKind,
  ConnectorCapability,
  ConnectorHealthStatus,
  LifecycleStatus,
  RiskLevel,
  RouteType,
  SourceType,
  type CaptureFailure,
  type ConnectorHealth,
} from '@jericho/shared';

import type { JerichoStore } from '../core/store.js';
import {
  ConnectorUnauthorizedError,
  ConnectorUnavailableError,
} from './contracts.js';
import type { CaptureConnectorRegistry } from './registry.js';

export interface ConnectorSupervisorOptions {
  store: JerichoStore;
  registry: CaptureConnectorRegistry;
  intake?: ConnectorIntakePort;
  workerId: string;
  clock?: () => string;
  leaseMs: number;
  maxPages: number;
}

export interface ConnectorIntakePort {
  processEvent(eventId: string): { status: 'understood' | 'review' | 'planned' | 'failed' };
}

export interface ConnectorSyncResult {
  status: 'completed' | 'busy' | 'unavailable';
  pages: number;
  captures: number;
  failures: number;
  processed: number;
  reviews: number;
  processingFailures: number;
}

export class ConnectorSupervisor {
  readonly #clock: () => string;

  constructor(private readonly options: ConnectorSupervisorOptions) {
    if (!Number.isInteger(options.leaseMs) || options.leaseMs < 1) {
      throw new Error('Connector supervisor lease duration is invalid');
    }
    if (!Number.isInteger(options.maxPages) || options.maxPages < 1) {
      throw new Error('Connector supervisor page limit is invalid');
    }
    this.#clock = options.clock ?? (() => new Date().toISOString());
  }

  async sync(
    connectorId: string,
    partition: string,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<ConnectorSyncResult> {
    const connector = this.options.registry.require(connectorId);
    if (!connector.descriptor.partitions.includes(partition)) {
      throw new Error(`Connector ${connectorId} does not own partition ${partition}`);
    }
    const startedAt = this.#clock();
    const lease = this.options.store.acquireConnectorLease({
      connectorId,
      capability: ConnectorCapability.Capture,
      ownerId: this.options.workerId,
      now: startedAt,
      leaseMs: this.options.leaseMs,
    });
    if (!lease) {
      return {
        status: 'busy', pages: 0, captures: 0, failures: 0,
        processed: 0, reviews: 0, processingFailures: 0,
      };
    }

    let pages = 0;
    let captures = 0;
    let failures = 0;
    let processed = 0;
    let reviews = 0;
    let processingFailures = 0;
    let hasMore = false;
    try {
      const probe = await connector.probe(signal);
      if (
        probe.status === ConnectorHealthStatus.Unavailable ||
        probe.status === ConnectorHealthStatus.Disabled
      ) {
        this.#recordHealth(connectorId, probe.status, probe.details, startedAt, false);
        return {
          status: 'unavailable', pages, captures, failures,
          processed, reviews, processingFailures,
        };
      }
      if (probe.status === ConnectorHealthStatus.Unauthorized) {
        throw new ConnectorUnauthorizedError(`${connectorId} is unauthorized`);
      }

      while (pages < this.options.maxPages) {
        if (signal.aborted) throw new Error('Connector synchronization aborted');
        const cursor = this.options.store.getConnectorCursor(
          connectorId,
          ConnectorCapability.Capture,
          partition,
        );
        const observedAt = this.#clock();
        const page = await connector.capture({
          partition,
          ...(cursor ? { cursor } : {}),
          limit: connector.descriptor.maxBatchSize,
          observedAt,
          signal,
        });
        const nextCursor = {
          connectorId,
          capability: ConnectorCapability.Capture,
          partition,
          epoch: page.progress.epoch,
          sequence: page.progress.sequence,
          ...(page.progress.pageToken ? { pageToken: page.progress.pageToken } : {}),
          ...(page.progress.watermark ? { watermark: page.progress.watermark } : {}),
          ...(page.progress.overlapFrom ? { overlapFrom: page.progress.overlapFrom } : {}),
          version: (cursor?.version ?? 0) + 1,
          updatedAt: observedAt,
        };
        const committed = this.options.store.commitCaptureBatch({
          connectorId,
          capability: ConnectorCapability.Capture,
          partition,
          expectedCursorVersion: cursor?.version ?? 0,
          nextCursor,
          captures: page.captures,
          failures: page.failures,
          leaseToken: lease.leaseToken,
          committedAt: observedAt,
        });
        if (this.options.intake) {
          for (const event of committed.events) {
            try {
              const projection = this.options.intake.processEvent(event.event.id);
              if (projection.status === 'failed') processingFailures += 1;
              else {
                processed += 1;
                if (projection.status === 'review') reviews += 1;
              }
            } catch {
              // The immutable connector commit and cursor are authoritative. A
              // downstream projection failure must never roll either back.
              processingFailures += 1;
            }
          }
        }
        pages += 1;
        captures += page.captures.length;
        failures += page.failures.length;
        hasMore = page.hasMore;
        if (!hasMore) break;
        this.options.store.renewConnectorLease(
          lease.id,
          lease.leaseToken,
          this.#clock(),
          this.options.leaseMs,
        );
      }
      if (hasMore && pages >= this.options.maxPages) {
        throw new Error(`Connector ${connectorId} exceeded its page limit`);
      }
      this.#recordHealth(connectorId, ConnectorHealthStatus.Healthy, {}, this.#clock(), true);
      return {
        status: 'completed', pages, captures, failures,
        processed, reviews, processingFailures,
      };
    } catch (error) {
      const status = error instanceof ConnectorUnauthorizedError
        ? ConnectorHealthStatus.Unauthorized
        : error instanceof ConnectorUnavailableError
          ? ConnectorHealthStatus.Unavailable
          : ConnectorHealthStatus.Degraded;
      const failure = captureFailure(connectorId, status, error, this.#clock());
      this.options.store.recordCaptureFailure(failure);
      this.#recordHealth(connectorId, status, { failureId: failure.id }, failure.occurredAt, false);
      throw error;
    } finally {
      this.options.store.releaseConnectorLease(lease.id, lease.leaseToken);
    }
  }

  #recordHealth(
    connectorId: string,
    status: ConnectorHealthStatus,
    details: ConnectorHealth['details'],
    checkedAt: string,
    success: boolean,
  ): void {
    const existing = this.options.store.listConnectorHealth().find(
      (health) => health.connectorId === connectorId,
    );
    this.options.store.upsertConnectorHealth({
      connectorId,
      status,
      checkedAt,
      ...(success ? { lastSuccessAt: checkedAt } : { lastFailureAt: checkedAt }),
      consecutiveFailures: success ? 0 : (existing?.consecutiveFailures ?? 0) + 1,
      freshness: { observedAt: checkedAt },
      capabilities: [{
        capability: ConnectorCapability.Capture,
        status,
        checkedAt,
        ...(success ? { lastSuccessAt: checkedAt } : { lastFailureAt: checkedAt }),
        details,
      }],
      details,
      provenance: [{
        source: 'connector-supervisor',
        sourceType: SourceType.System,
        observedAt: checkedAt,
      }],
    });
  }
}

function captureFailure(
  connectorId: string,
  status: ConnectorHealthStatus,
  error: unknown,
  occurredAt: string,
): CaptureFailure {
  return {
    id: `capture-failure-${randomUUID()}`,
    connectorId,
    capability: ConnectorCapability.Capture,
    kind: status === ConnectorHealthStatus.Unauthorized
      ? CaptureFailureKind.Authorization
      : status === ConnectorHealthStatus.Unavailable
        ? CaptureFailureKind.Transport
        : CaptureFailureKind.Transport,
    message: error instanceof Error ? error.message : String(error),
    retryable: status !== ConnectorHealthStatus.Unauthorized,
    status: LifecycleStatus.PendingApproval,
    route: RouteType.HumanApproval,
    risk: RiskLevel.Medium,
    details: {},
    occurredAt,
    provenance: [{
      source: connectorId,
      sourceType: SourceType.Connector,
      observedAt: occurredAt,
    }],
  };
}
