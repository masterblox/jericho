import {
  ConnectorHealthStatus,
  EntityType,
  RelationType,
  type NormalizedCapture,
} from '@jericho/shared';

import {
  ConnectorUnauthorizedError,
  ConnectorUnavailableError,
  type CaptureConnector,
  type ConnectorCapturePage,
  type ConnectorCaptureRequest,
  type ConnectorProbe,
} from '../contracts.js';
import { stableConnectorEvent } from '../normalization.js';

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  state: string;
  updatedAt: string;
  project?: { id: string; name: string };
  assignee?: { id: string; name: string };
}

export interface LinearTransport {
  queryIssues(input: {
    apiKey: string;
    after?: string;
    updatedAfter?: string;
    limit: number;
    signal: AbortSignal;
  }): Promise<{
    status: number;
    issues: LinearIssue[];
    pageInfo: { hasNextPage: boolean; endCursor?: string };
  }>;
}

export interface LinearAdapterOptions {
  apiKey?: string;
  transport: LinearTransport;
  overlapMs?: number;
}

export class LinearAdapter implements CaptureConnector {
  readonly descriptor = {
    id: 'linear', adapterVersion: 1, cursorSchemaVersion: 1,
    partitions: ['primary'], maxBatchSize: 100,
  };
  readonly #overlapMs: number;

  constructor(private readonly options: LinearAdapterOptions) {
    this.#overlapMs = options.overlapMs ?? 300_000;
  }

  async probe(_signal: AbortSignal): Promise<ConnectorProbe> {
    if (this.options.apiKey) {
      return { status: ConnectorHealthStatus.Healthy, details: { mode: 'graphql_read_only' } };
    }
    return { status: ConnectorHealthStatus.Unavailable, details: { reason: 'missing_api_key' } };
  }

  async capture(request: ConnectorCaptureRequest): Promise<ConnectorCapturePage> {
    if (!this.options.apiKey) throw new ConnectorUnavailableError('Linear API key is unavailable');
    const updatedAfter = request.cursor?.watermark
      ? new Date(Date.parse(request.cursor.watermark) - this.#overlapMs).toISOString()
      : undefined;
    const response = await this.options.transport.queryIssues({
      apiKey: this.options.apiKey,
      ...(request.cursor?.pageToken ? { after: request.cursor.pageToken } : {}),
      ...(updatedAfter ? { updatedAfter } : {}),
      limit: request.limit,
      signal: request.signal,
    });
    if (response.status === 401) throw new ConnectorUnauthorizedError('Linear unauthorized');
    if (response.status < 200 || response.status >= 300) {
      throw new ConnectorUnavailableError(`Linear returned ${response.status}`);
    }
    const captures = response.issues.map(normalizeLinearIssue);
    const watermark = response.issues.reduce<string | undefined>(
      (latest, issue) => !latest || Date.parse(issue.updatedAt) > Date.parse(latest) ? issue.updatedAt : latest,
      request.cursor?.watermark,
    );
    return {
      captures,
      failures: [],
      progress: {
        epoch: request.cursor?.epoch ?? 1,
        sequence: (request.cursor?.sequence ?? 0) + response.issues.length,
        ...(response.pageInfo.endCursor ? { pageToken: response.pageInfo.endCursor } : {}),
        ...(watermark ? { watermark } : {}),
        ...(updatedAfter ? { overlapFrom: updatedAfter } : {}),
      },
      hasMore: response.pageInfo.hasNextPage,
    };
  }
}

function normalizeLinearIssue(issue: LinearIssue): NormalizedCapture {
  const sourceEventId = `${issue.id}:${issue.updatedAt}`;
  const event = stableConnectorEvent({
    source: 'linear', sourceEventId, type: 'linear.issue.updated',
    occurredAt: issue.updatedAt,
    payload: {
      id: issue.id, identifier: issue.identifier, title: issue.title,
      state: issue.state,
    },
  });
  const identities: NormalizedCapture['identities'] = [{
    connectorId: 'linear', namespace: 'issue', externalId: issue.id,
    entityType: EntityType.Task, displayName: issue.title,
    attributes: { identifier: issue.identifier, state: issue.state },
    observedAt: issue.updatedAt, confidence: 1, evidenceEventId: event.id,
  }];
  const relations: NormalizedCapture['relations'] = [];
  if (issue.project) {
    identities.push({
      connectorId: 'linear', namespace: 'project', externalId: issue.project.id,
      entityType: EntityType.Project, displayName: issue.project.name, attributes: {},
      observedAt: issue.updatedAt, confidence: 1, evidenceEventId: event.id,
    });
    relations.push({
      from: { connectorId: 'linear', namespace: 'issue', externalId: issue.id },
      to: { connectorId: 'linear', namespace: 'project', externalId: issue.project.id },
      type: RelationType.MemberOf, attributes: {}, observedAt: issue.updatedAt,
      evidenceEventId: event.id,
    });
  }
  if (issue.assignee) {
    identities.push({
      connectorId: 'linear', namespace: 'user', externalId: issue.assignee.id,
      entityType: EntityType.Person, displayName: issue.assignee.name, attributes: {},
      observedAt: issue.updatedAt, confidence: 1, evidenceEventId: event.id,
    });
    relations.push({
      from: { connectorId: 'linear', namespace: 'issue', externalId: issue.id },
      to: { connectorId: 'linear', namespace: 'user', externalId: issue.assignee.id },
      type: RelationType.AssignedTo, attributes: {}, observedAt: issue.updatedAt,
      evidenceEventId: event.id,
    });
  }
  return { event, identities, relations };
}
