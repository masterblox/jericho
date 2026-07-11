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

export type LinearSurface = 'issues' | 'comments' | 'teams' | 'users' | 'projects' | 'workflow-states';

export interface LinearComment {
  id: string;
  body: string;
  updatedAt: string;
  issue?: { id: string; identifier: string; title: string };
  user?: { id: string; name: string };
}

export interface LinearTeam {
  id: string;
  key: string;
  name: string;
  updatedAt: string;
}

export interface LinearUser {
  id: string;
  name: string;
  email?: string;
  updatedAt: string;
}

export interface LinearProject {
  id: string;
  name: string;
  state?: string;
  updatedAt: string;
}

export interface LinearWorkflowState {
  id: string;
  name: string;
  type: string;
  color?: string;
  updatedAt: string;
  team?: { id: string; name: string };
}

export type LinearRecord =
  | LinearIssue
  | LinearComment
  | LinearTeam
  | LinearUser
  | LinearProject
  | LinearWorkflowState;

export interface LinearTransport {
  query?(input: {
    apiKey: string;
    surface: LinearSurface;
    after?: string;
    updatedAfter?: string;
    limit: number;
    signal: AbortSignal;
  }): Promise<{
    status: number;
    records: LinearRecord[];
    pageInfo: { hasNextPage: boolean; endCursor?: string };
  }>;
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

interface LinearTraversalState {
  version: 2;
  surface: LinearSurface;
  after?: string;
  baselineWatermark?: string;
  overlapFrom?: string;
  maxSeenWatermark?: string;
}

export class LinearAdapter implements CaptureConnector {
  readonly descriptor = {
    id: 'linear', adapterVersion: 1, cursorSchemaVersion: 1,
    partitions: ['issues', 'comments', 'teams', 'users', 'projects', 'workflow-states'],
    maxBatchSize: 100,
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
    const surface = request.partition === 'primary' ? 'issues' : request.partition as LinearSurface;
    if (!this.descriptor.partitions.includes(surface)) {
      throw new ConnectorUnavailableError(`Linear surface ${request.partition} is unavailable`);
    }
    const decoded = decodeTraversal(request.cursor?.pageToken);
    if (decoded && decoded.surface !== surface) {
      throw new ConnectorUnavailableError('Linear traversal surface does not match its partition');
    }
    const baselineWatermark = decoded?.baselineWatermark ?? request.cursor?.watermark;
    const overlapFrom = decoded?.overlapFrom ?? (baselineWatermark
      ? new Date(Date.parse(baselineWatermark) - this.#overlapMs).toISOString()
      : undefined);
    const after = decoded?.after ?? (request.cursor?.pageToken && !decoded
      ? request.cursor.pageToken
      : undefined);
    const queryInput = {
      apiKey: this.options.apiKey,
      ...(after ? { after } : {}),
      ...(overlapFrom ? { updatedAfter: overlapFrom } : {}),
      limit: request.limit,
      signal: request.signal,
    };
    const response = this.options.transport.query
      ? await this.options.transport.query({ ...queryInput, surface })
      : await this.options.transport.queryIssues(queryInput).then((result) => ({
          status: result.status,
          records: result.issues as LinearRecord[],
          pageInfo: result.pageInfo,
        }));
    if (response.status === 401) throw new ConnectorUnauthorizedError('Linear unauthorized');
    if (response.status < 200 || response.status >= 300) {
      throw new ConnectorUnavailableError(`Linear returned ${response.status}`);
    }
    const captures = response.records.map((record) => normalizeLinearRecord(surface, record));
    const maxSeenWatermark = response.records.reduce<string | undefined>(
      (latest, record) => !latest || Date.parse(record.updatedAt) > Date.parse(latest) ? record.updatedAt : latest,
      decoded?.maxSeenWatermark,
    );
    if (response.pageInfo.hasNextPage && !response.pageInfo.endCursor) {
      throw new ConnectorUnavailableError('Linear returned an incomplete pagination cursor');
    }
    const pageToken = response.pageInfo.hasNextPage
      ? encodeTraversal({
          version: 2,
          surface,
          after: response.pageInfo.endCursor!,
          ...(baselineWatermark ? { baselineWatermark } : {}),
          ...(overlapFrom ? { overlapFrom } : {}),
          ...(maxSeenWatermark ? { maxSeenWatermark } : {}),
        })
      : undefined;
    const watermark = response.pageInfo.hasNextPage
      ? baselineWatermark
      : latestTimestamp(baselineWatermark, maxSeenWatermark);
    return {
      captures,
      failures: [],
      progress: {
        epoch: request.cursor?.epoch ?? 1,
        sequence: (request.cursor?.sequence ?? 0) + response.records.length,
        ...(pageToken ? { pageToken } : {}),
        ...(watermark ? { watermark } : {}),
        ...(overlapFrom ? { overlapFrom } : {}),
      },
      hasMore: response.pageInfo.hasNextPage,
    };
  }
}

function encodeTraversal(state: LinearTraversalState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64url');
}

function decodeTraversal(value: string | undefined): LinearTraversalState | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const state = parsed as Partial<LinearTraversalState>;
    return state.version === 2 && typeof state.surface === 'string' && typeof state.after === 'string'
      ? state as LinearTraversalState
      : undefined;
  } catch {
    return undefined;
  }
}

function latestTimestamp(first: string | undefined, second: string | undefined): string | undefined {
  if (!first) return second;
  if (!second) return first;
  return Date.parse(first) >= Date.parse(second) ? first : second;
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

function normalizeLinearRecord(surface: LinearSurface, record: LinearRecord): NormalizedCapture {
  switch (surface) {
    case 'issues': return normalizeLinearIssue(record as LinearIssue);
    case 'comments': return normalizeLinearComment(record as LinearComment);
    case 'teams': return normalizeLinearTeam(record as LinearTeam);
    case 'users': return normalizeLinearUser(record as LinearUser);
    case 'projects': return normalizeLinearProject(record as LinearProject);
    case 'workflow-states': return normalizeLinearWorkflowState(record as LinearWorkflowState);
  }
}

function normalizeLinearComment(comment: LinearComment): NormalizedCapture {
  const event = linearEvent('comment', comment.id, comment.updatedAt, {
    id: comment.id, body: comment.body,
    ...(comment.issue ? { issueId: comment.issue.id } : {}),
  });
  const identities: NormalizedCapture['identities'] = [linearIdentity(
    'comment', comment.id, EntityType.Document,
    comment.issue ? `Comment on ${comment.issue.identifier}` : `Comment ${comment.id}`,
    comment.updatedAt, event.id, {},
  )];
  const relations: NormalizedCapture['relations'] = [];
  if (comment.issue) {
    identities.push(linearIdentity(
      'issue', comment.issue.id, EntityType.Task, comment.issue.title,
      comment.updatedAt, event.id, { identifier: comment.issue.identifier },
    ));
    relations.push(linearRelation('comment', comment.id, 'issue', comment.issue.id, comment.updatedAt, event.id));
  }
  if (comment.user) {
    identities.push(linearIdentity(
      'user', comment.user.id, EntityType.Person, comment.user.name,
      comment.updatedAt, event.id, {},
    ));
    relations.push(linearRelation('comment', comment.id, 'user', comment.user.id, comment.updatedAt, event.id));
  }
  return { event, identities, relations };
}

function normalizeLinearTeam(team: LinearTeam): NormalizedCapture {
  return singleLinearCapture(
    'team', team.id, team.updatedAt, EntityType.Organization, team.name,
    { id: team.id, key: team.key, name: team.name }, { key: team.key },
  );
}

function normalizeLinearUser(user: LinearUser): NormalizedCapture {
  return singleLinearCapture(
    'user', user.id, user.updatedAt, EntityType.Person, user.name,
    { id: user.id, name: user.name, ...(user.email ? { email: user.email } : {}) },
    user.email ? { email: user.email } : {},
  );
}

function normalizeLinearProject(project: LinearProject): NormalizedCapture {
  return singleLinearCapture(
    'project', project.id, project.updatedAt, EntityType.Project, project.name,
    { id: project.id, name: project.name, ...(project.state ? { state: project.state } : {}) },
    project.state ? { state: project.state } : {},
  );
}

function normalizeLinearWorkflowState(state: LinearWorkflowState): NormalizedCapture {
  const event = linearEvent('workflow_state', state.id, state.updatedAt, {
    id: state.id, name: state.name, type: state.type,
  });
  const identities: NormalizedCapture['identities'] = [linearIdentity(
    'workflow_state', state.id, EntityType.Other, state.name,
    state.updatedAt, event.id, { type: state.type, ...(state.color ? { color: state.color } : {}) },
  )];
  const relations: NormalizedCapture['relations'] = [];
  if (state.team) {
    identities.push(linearIdentity(
      'team', state.team.id, EntityType.Organization, state.team.name,
      state.updatedAt, event.id, {},
    ));
    relations.push(linearRelation('workflow_state', state.id, 'team', state.team.id, state.updatedAt, event.id));
  }
  return { event, identities, relations };
}

function singleLinearCapture(
  kind: string,
  id: string,
  updatedAt: string,
  entityType: EntityType,
  displayName: string,
  payload: Record<string, string>,
  attributes: Record<string, string>,
): NormalizedCapture {
  const event = linearEvent(kind, id, updatedAt, payload);
  return {
    event,
    identities: [linearIdentity(kind, id, entityType, displayName, updatedAt, event.id, attributes)],
    relations: [],
  };
}

function linearEvent(kind: string, id: string, updatedAt: string, payload: Record<string, string>) {
  return stableConnectorEvent({
    source: 'linear', sourceEventId: `${kind}:${id}:${updatedAt}`,
    type: `linear.${kind}.updated`, occurredAt: updatedAt, payload,
  });
}

function linearIdentity(
  namespace: string,
  externalId: string,
  entityType: EntityType,
  displayName: string,
  observedAt: string,
  evidenceEventId: string,
  attributes: Record<string, string>,
): NormalizedCapture['identities'][number] {
  return {
    connectorId: 'linear', namespace, externalId, entityType, displayName,
    attributes, observedAt, confidence: 1, evidenceEventId,
  };
}

function linearRelation(
  fromNamespace: string,
  fromId: string,
  toNamespace: string,
  toId: string,
  observedAt: string,
  evidenceEventId: string,
): NormalizedCapture['relations'][number] {
  return {
    from: { connectorId: 'linear', namespace: fromNamespace, externalId: fromId },
    to: { connectorId: 'linear', namespace: toNamespace, externalId: toId },
    type: RelationType.RelatedTo, attributes: {}, observedAt, evidenceEventId,
  };
}
