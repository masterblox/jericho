import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  ConnectorHealthStatus,
  EntityType,
  RelationType,
  type JsonValue,
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

const execFileAsync = promisify(execFile);

export interface GitHubTransport {
  request(input: {
    path: string;
    query: Record<string, string | number>;
    signal: AbortSignal;
  }): Promise<{ status: number; data: JsonValue }>;
}

export interface GitHubConnectorOptions {
  repositories: string[];
  transport?: GitHubTransport;
}

export class GitHubConnector implements CaptureConnector {
  readonly descriptor;
  readonly #transport: GitHubTransport;

  constructor(private readonly options: GitHubConnectorOptions) {
    this.descriptor = {
      id: 'github', adapterVersion: 1, cursorSchemaVersion: 1,
      partitions: [...options.repositories], maxBatchSize: 100,
    };
    this.#transport = options.transport ?? new GhApiTransport();
  }

  async probe(signal: AbortSignal): Promise<ConnectorProbe> {
    if (!this.options.repositories.length) {
      return { status: ConnectorHealthStatus.Unavailable, details: { reason: 'no_repositories' } };
    }
    try {
      const response = await this.#transport.request({ path: 'user', query: {}, signal });
      if (response.status === 401) {
        return { status: ConnectorHealthStatus.Unauthorized, details: { mode: 'gh_api_read_only' } };
      }
      return response.status >= 200 && response.status < 300
        ? { status: ConnectorHealthStatus.Healthy, details: { mode: 'gh_api_read_only' } }
        : { status: ConnectorHealthStatus.Unavailable, details: { status: response.status } };
    } catch {
      return { status: ConnectorHealthStatus.Unavailable, details: { reason: 'probe_failed' } };
    }
  }

  async capture(request: ConnectorCaptureRequest): Promise<ConnectorCapturePage> {
    if (!this.options.repositories.includes(request.partition)) {
      throw new ConnectorUnavailableError(`GitHub repository ${request.partition} is unavailable`);
    }
    const page = request.cursor?.pageToken ? Number(request.cursor.pageToken) : 1;
    if (!Number.isSafeInteger(page) || page < 1) {
      throw new ConnectorUnavailableError('GitHub pagination cursor is invalid');
    }
    const perPage = Math.min(request.limit, 100);
    const response = await this.#transport.request({
      path: `repos/${request.partition}/pulls`,
      query: { state: 'all', per_page: perPage, page },
      signal: request.signal,
    });
    if (response.status === 401) throw new ConnectorUnauthorizedError('GitHub unauthorized');
    if (response.status < 200 || response.status >= 300 || !Array.isArray(response.data)) {
      throw new ConnectorUnavailableError(`GitHub returned ${response.status}`);
    }
    const captures = response.data.map((item) => normalizePullRequest(
      request.partition,
      item as Record<string, JsonValue>,
    ));
    const watermark = captures.reduce<string | undefined>((latest, capture) =>
      !latest || Date.parse(capture.event.occurredAt) > Date.parse(latest)
        ? capture.event.occurredAt
        : latest,
    request.cursor?.watermark);
    const hasMore = response.data.length === perPage;
    return {
      captures, failures: [],
      progress: {
        epoch: request.cursor?.epoch ?? 1,
        sequence: (request.cursor?.sequence ?? 0) + captures.length,
        ...(hasMore ? { pageToken: String(page + 1) } : {}),
        ...(watermark ? { watermark } : {}),
      },
      hasMore,
    };
  }
}

export class GhApiTransport implements GitHubTransport {
  async request(input: { path: string; query: Record<string, string | number>; signal: AbortSignal }) {
    const args = ['api', '--method', 'GET', input.path];
    for (const [key, value] of Object.entries(input.query)) args.push('-f', `${key}=${value}`);
    const result = await execFileAsync('gh', args, {
      encoding: 'utf8', signal: input.signal, maxBuffer: 2 * 1024 * 1024,
    });
    return { status: 200, data: JSON.parse(String(result.stdout)) as JsonValue };
  }
}

function normalizePullRequest(repository: string, value: Record<string, JsonValue>): NormalizedCapture {
  const id = String(value.id);
  const number = Number(value.number);
  const title = String(value.title);
  const updatedAt = String(value.updated_at);
  const user = value.user as Record<string, JsonValue> | undefined;
  const event = stableConnectorEvent({
    source: 'github', sourceEventId: `${repository}:pull:${id}:${updatedAt}`,
    type: 'github.pull_request.updated', occurredAt: updatedAt,
    payload: { repository, id, number, title, state: String(value.state) },
  });
  const identities: NormalizedCapture['identities'] = [
    {
      connectorId: 'github', namespace: 'repository', externalId: repository,
      entityType: EntityType.Repository, displayName: repository, attributes: {},
      observedAt: updatedAt, confidence: 1, evidenceEventId: event.id,
    },
    {
      connectorId: 'github', namespace: 'pull_request', externalId: id,
      entityType: EntityType.Artifact, displayName: `#${number} ${title}`, attributes: {},
      observedAt: updatedAt, confidence: 1, evidenceEventId: event.id,
    },
  ];
  if (user) identities.push({
    connectorId: 'github', namespace: 'user', externalId: String(user.id),
    entityType: EntityType.Person, displayName: String(user.login), attributes: {},
    observedAt: updatedAt, confidence: 1, evidenceEventId: event.id,
  });
  return {
    event, identities,
    relations: [{
      from: { connectorId: 'github', namespace: 'pull_request', externalId: id },
      to: { connectorId: 'github', namespace: 'repository', externalId: repository },
      type: RelationType.MemberOf, attributes: {}, observedAt: updatedAt,
      evidenceEventId: event.id,
    }],
  };
}
