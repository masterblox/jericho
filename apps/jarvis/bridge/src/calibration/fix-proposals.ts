import { createHash } from 'node:crypto';

import {
  LifecycleStatus,
  ProposalKind,
  RiskLevel,
  RouteType,
  SourceType,
  assertCalibrationFixProposalRequest,
  canonicalJson,
  type CalibrationFixProposalRequest,
  type CalibrationFixProposalResponse,
  type IsoTimestamp,
} from '@jericho/shared';

import type { JerichoStore } from '../core/store.js';

export interface CalibrationProposalsDeps {
  store: JerichoStore;
  clock: () => { nowMs: number; nowIso: IsoTimestamp };
}

export class CalibrationProposalStore {
  readonly #store: JerichoStore;
  readonly #clock: () => { nowMs: number; nowIso: IsoTimestamp };

  constructor(deps: CalibrationProposalsDeps) {
    this.#store = deps.store;
    this.#clock = deps.clock;
  }

  create(
    request: CalibrationFixProposalRequest,
    idempotencyKey: string,
  ): { statusCode: number; body: CalibrationFixProposalResponse } {
    if (!/^[a-f0-9]{64}$/.test(idempotencyKey)) {
      return { statusCode: 400, body: null as unknown as CalibrationFixProposalResponse };
    }

    const computed = createHash('sha256').update(canonicalJson(request)).digest('hex');
    if (!constantTimeEqual(idempotencyKey, computed)) {
      return { statusCode: 400, body: null as unknown as CalibrationFixProposalResponse };
    }

    const proposedId = this.proposalId(request);

    const existing = this.#store.getProposal(proposedId);
    if (existing) {
      if (existing.proposedByAgentId !== 'jericho-calibration' || existing.kind !== ProposalKind.DataChange) {
        return { statusCode: 409, body: null as unknown as CalibrationFixProposalResponse };
      }
      const storedDigest = extractDigest(existing);
      const requestDigest = createHash('sha256').update(canonicalJson(request)).digest('hex').slice(0, 32);
      if (storedDigest !== requestDigest) {
        return { statusCode: 409, body: null as unknown as CalibrationFixProposalResponse };
      }
      return {
        statusCode: 200,
        body: {
          proposalId: proposedId,
          status: 'pending_review',
          createdAt: existing.createdAt,
          replayed: true,
        },
      };
    }

    const { nowIso } = this.#clock();
    const requestDigest = createHash('sha256').update(canonicalJson(request)).digest('hex').slice(0, 32);
    const cloned = JSON.parse(JSON.stringify(request)) as CalibrationFixProposalRequest;
    this.#store.saveProposal({
      id: proposedId,
      version: 1,
      proposedByAgentId: 'jericho-calibration',
      kind: ProposalKind.DataChange,
      summary: `Calibration fix proposal — ${request.failureReason}`,
      body: {
        schemaVersion: request.schemaVersion,
        sessionId: request.sessionId,
        buildSha: request.buildSha,
        micDeviceHash: request.micDeviceHash ?? null,
        failedPhase: cloned.failedPhase,
        failureReason: cloned.failureReason,
        aggregateMetrics: cloned.aggregateMetrics,
        correlatedResultId: cloned.correlatedResultId ?? null,
        requestDigest,
      },
      status: LifecycleStatus.PendingApproval,
      route: RouteType.HumanApproval,
      risk: RiskLevel.Low,
      createdAt: nowIso,
      provenance: [{
        source: 'local:calibration',
        sourceType: SourceType.System,
        sourceEventId: `calibration-fix:${proposedId}`,
        observedAt: nowIso,
      }],
    });

    return {
      statusCode: 201,
      body: {
        proposalId: proposedId,
        status: 'pending_review',
        createdAt: nowIso,
        replayed: false,
      },
    };
  }

  getProposal(proposalId: string): CalibrationFixProposalResponse | null {
    const stored = this.#store.getProposal(proposalId);
    if (!stored) return null;
    if (stored.kind !== ProposalKind.DataChange) return null;
    if (stored.proposedByAgentId !== 'jericho-calibration') return null;
    return {
      proposalId: stored.id,
      status: 'pending_review',
      createdAt: stored.createdAt,
      replayed: false,
    };
  }

  proposalId(request: CalibrationFixProposalRequest): string {
    assertCalibrationFixProposalRequest(request);
    const canonical = canonicalJson(request);
    const hash = createHash('sha256').update(canonical).digest('hex');
    return `calibration-fix-${hash.slice(0, 32)}`;
  }
}

export const MAX_PROPOSAL_BODY_BYTES = 16 * 1024;

export function validateAndParseProposalBody(
  raw: string,
): { error?: string; statusCode: number; request?: CalibrationFixProposalRequest } {
  if (raw.length > MAX_PROPOSAL_BODY_BYTES) {
    return { error: 'body exceeds 16 KiB', statusCode: 413 };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'invalid JSON', statusCode: 400 };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'body must be an object', statusCode: 400 };
  }
  try {
    assertCalibrationFixProposalRequest(parsed);
  } catch (err) {
    return { error: (err as Error).message, statusCode: 400 };
  }
  return { statusCode: 0, request: parsed as CalibrationFixProposalRequest };
}

export function validateIdempotencyKey(
  headerValue: string | null,
  request: CalibrationFixProposalRequest,
): { valid: boolean; statusCode: number; message: string } {
  if (!headerValue) {
    return { valid: false, statusCode: 400, message: 'missing x-idempotency-key header' };
  }
  if (!/^[a-f0-9]{64}$/.test(headerValue)) {
    return { valid: false, statusCode: 400, message: 'idempotency key must be 64 lowercase hex' };
  }
  const computed = createHash('sha256').update(canonicalJson(request)).digest('hex');
  if (!constantTimeEqual(headerValue, computed)) {
    return { valid: false, statusCode: 400, message: 'idempotency key does not match request body' };
  }
  return { valid: true, statusCode: 0, message: '' };
}

function extractDigest(proposal: { body?: unknown }): string | undefined {
  const body = proposal.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const digest = (body as Record<string, unknown>).requestDigest;
  return typeof digest === 'string' ? digest : undefined;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
