import { randomUUID } from 'node:crypto';

import type { JerichoConfig } from './config.js';
import type { JerichoStore } from './core/store.js';
import { ConductorConnector } from './connectors/adapters/conductor.js';
import { GitConnector } from './connectors/adapters/git.js';
import { GitHubConnector } from './connectors/adapters/github.js';
import {
  LinearAdapter,
  type LinearComment,
  type LinearIssue,
  type LinearProject,
  type LinearRecord,
  type LinearSurface,
  type LinearTeam,
  type LinearTransport,
  type LinearUser,
  type LinearWorkflowState,
} from './connectors/adapters/linear.js';
import { ObsidianConnector } from './connectors/adapters/obsidian.js';
import {
  TelegramGatewayAdapter,
  type TelegramGatewayTransport,
  type TelegramGatewayUpdate,
} from './connectors/adapters/telegram-gateway.js';
import type { CaptureConnector, ConnectorDescriptor } from './connectors/contracts.js';
import { CaptureConnectorRegistry } from './connectors/registry.js';
import {
  ConnectorSupervisor,
  type ConnectorIntakePort,
} from './connectors/supervisor.js';

export interface ConnectorRuntime {
  registry: CaptureConnectorRegistry;
  supervisor: ConnectorSupervisor;
  descriptors: ConnectorDescriptor[];
  obsidianSearch?: ObsidianConnector;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ConnectorRuntimeOptions {
  workerId?: string;
  fetch?: typeof globalThis.fetch;
  intake?: ConnectorIntakePort;
}

export function createConnectorRuntime(
  config: JerichoConfig,
  store: JerichoStore,
  options: ConnectorRuntimeOptions = {},
): ConnectorRuntime {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const connectors: CaptureConnector[] = [
    new TelegramGatewayAdapter({
      gatewayUrl: config.telegramGatewayUrl,
      gatewayToken: config.telegramGatewayToken,
      transport: new HttpTelegramGatewayTransport(fetchImplementation),
    }),
    new LinearAdapter({
      apiKey: config.linearApiKey,
      transport: new LinearGraphqlTransport(fetchImplementation),
    }),
  ];
  if (config.gitRepositories.length) {
    connectors.push(new GitConnector({
      repositories: config.gitRepositories,
      maxCommits: 100,
    }));
  }
  if (config.githubRepositories.length) {
    connectors.push(new GitHubConnector({ repositories: config.githubRepositories }));
  }
  if (config.conductorRoots.length) {
    connectors.push(new ConductorConnector({ roots: config.conductorRoots }));
  }
  const obsidian = config.obsidianVaultPath
    ? new ObsidianConnector({
        vaultPath: config.obsidianVaultPath,
        maxNotes: 500,
        maxNoteBytes: 2 * 1024 * 1024,
      })
    : undefined;
  if (obsidian) connectors.push(obsidian);

  const registry = new CaptureConnectorRegistry(connectors);
  const supervisor = new ConnectorSupervisor({
    store,
    registry,
    ...(options.intake ? { intake: options.intake } : {}),
    workerId: options.workerId ?? `jericho-${process.pid}-${randomUUID()}`,
    leaseMs: config.connectorLeaseMs,
    maxPages: config.connectorMaxPages,
  });
  const descriptors = registry.list().map(({ descriptor }) => structuredClone(descriptor));
  const scheduler = new ConnectorPollingScheduler(supervisor, descriptors, {
    pollIntervalMs: config.connectorPollIntervalMs,
    maxBackoffMs: Math.max(config.connectorPollIntervalMs, config.connectorPollIntervalMs * 8),
  });
  return {
    registry,
    supervisor,
    descriptors,
    ...(obsidian ? { obsidianSearch: obsidian } : {}),
    start: () => scheduler.start(),
    stop: () => scheduler.stop(),
  };
}

export interface PollingSyncPort {
  sync(connectorId: string, partition: string, signal: AbortSignal): Promise<unknown>;
}

export interface PollingDescriptor {
  id: string;
  partitions: readonly string[];
}

export interface ConnectorPollingSchedulerOptions {
  pollIntervalMs: number;
  maxBackoffMs: number;
}

interface PollingTarget {
  connectorId: string;
  partition: string;
  failures: number;
  timer?: ReturnType<typeof setTimeout>;
  inFlight?: Promise<void>;
}

export class ConnectorPollingScheduler {
  readonly #targets: PollingTarget[];
  #controller?: AbortController;
  #running = false;

  constructor(
    private readonly syncPort: PollingSyncPort,
    descriptors: readonly PollingDescriptor[],
    private readonly options: ConnectorPollingSchedulerOptions,
  ) {
    if (
      !Number.isInteger(options.pollIntervalMs) || options.pollIntervalMs < 1 ||
      !Number.isInteger(options.maxBackoffMs) ||
      options.maxBackoffMs < options.pollIntervalMs
    ) {
      throw new TypeError('Connector polling bounds are invalid');
    }
    this.#targets = descriptors.flatMap((descriptor) =>
      descriptor.partitions.map((partition) => ({
        connectorId: descriptor.id,
        partition,
        failures: 0,
      })),
    );
  }

  async start(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    this.#controller = new AbortController();
    await Promise.allSettled(this.#targets.map((target) => this.#run(target)));
  }

  async stop(): Promise<void> {
    if (!this.#running) return;
    this.#running = false;
    this.#controller?.abort();
    for (const target of this.#targets) {
      if (target.timer) clearTimeout(target.timer);
      target.timer = undefined;
    }
    await Promise.allSettled(
      this.#targets.flatMap((target) => target.inFlight ? [target.inFlight] : []),
    );
    this.#controller = undefined;
  }

  async #run(target: PollingTarget): Promise<void> {
    if (!this.#running || !this.#controller || target.inFlight) return;
    const signal = this.#controller.signal;
    const execution = (async () => {
      try {
        await this.syncPort.sync(target.connectorId, target.partition, signal);
        target.failures = 0;
      } catch {
        if (!signal.aborted) target.failures += 1;
      }
    })();
    target.inFlight = execution;
    await execution;
    target.inFlight = undefined;
    if (!this.#running || signal.aborted) return;
    const delay = Math.min(
      this.options.maxBackoffMs,
      this.options.pollIntervalMs * (2 ** target.failures),
    );
    target.timer = setTimeout(() => {
      target.timer = undefined;
      void this.#run(target);
    }, delay);
  }
}

export class HttpTelegramGatewayTransport implements TelegramGatewayTransport {
  constructor(private readonly fetchImplementation: typeof globalThis.fetch = globalThis.fetch) {}

  async fetchUpdates(input: Parameters<TelegramGatewayTransport['fetchUpdates']>[0]) {
    const url = gatewayUrl(input.gatewayUrl, '/v1/jericho/telegram/updates');
    url.searchParams.set('partition', input.partition);
    url.searchParams.set('limit', String(input.limit));
    if (input.epoch !== undefined) url.searchParams.set('epoch', String(input.epoch));
    if (input.sequence !== undefined) url.searchParams.set('sequence', String(input.sequence));
    if (input.pageToken) url.searchParams.set('pageToken', input.pageToken);
    const response = await this.fetchImplementation(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${input.gatewayToken}`, accept: 'application/json' },
      signal: input.signal,
    });
    if (!response.ok) return { status: response.status, updates: [], hasMore: false };
    const body = await response.json() as Record<string, unknown>;
    return {
      status: response.status,
      updates: Array.isArray(body.updates) ? body.updates as TelegramGatewayUpdate[] : [],
      ...(typeof body.nextPageToken === 'string' ? { nextPageToken: body.nextPageToken } : {}),
      hasMore: body.hasMore === true,
    };
  }

  async sendMessage(input: Parameters<TelegramGatewayTransport['sendMessage']>[0]) {
    const response = await this.fetchImplementation(
      gatewayUrl(input.gatewayUrl, '/v1/jericho/telegram/messages'),
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${input.gatewayToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          recipient: input.recipient,
          text: input.text,
          idempotencyKey: input.idempotencyKey,
        }),
        signal: input.signal,
      },
    );
    if (!response.ok) return { status: response.status };
    const body = await response.json() as Record<string, unknown>;
    return {
      status: response.status,
      ...(typeof body.chatId === 'string' ? { chatId: body.chatId } : {}),
      ...(typeof body.messageId === 'string' ? { messageId: body.messageId } : {}),
    };
  }
}

export class LinearGraphqlTransport implements LinearTransport {
  constructor(private readonly fetchImplementation: typeof globalThis.fetch = globalThis.fetch) {}

  async query(input: Parameters<NonNullable<LinearTransport['query']>>[0]) {
    const definition = LINEAR_SURFACE_QUERIES[input.surface];
    const response = await this.fetchImplementation('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        authorization: input.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        query: definition.query,
        variables: {
          first: Math.min(input.limit, 100),
          ...(input.after ? { after: input.after } : {}),
          ...(input.updatedAfter
            ? { filter: { updatedAt: { gte: input.updatedAfter } } }
            : {}),
        },
      }),
      signal: input.signal,
    });
    if (!response.ok) {
      return { status: response.status, records: [], pageInfo: { hasNextPage: false } };
    }
    const body = await response.json() as {
      data?: Record<string, { nodes?: Record<string, unknown>[]; pageInfo?: LinearPageInfo }>;
      errors?: unknown[];
    };
    const connection = body.data?.[definition.root];
    if (body.errors?.length || !connection) {
      return { status: 502, records: [], pageInfo: { hasNextPage: false } };
    }
    return {
      status: response.status,
      records: (connection.nodes ?? []).map((record) =>
        fromLinearGraphqlRecord(input.surface, record),
      ),
      pageInfo: {
        hasNextPage: connection.pageInfo?.hasNextPage === true,
        ...(connection.pageInfo?.endCursor
          ? { endCursor: connection.pageInfo.endCursor }
          : {}),
      },
    };
  }

  async queryIssues(input: Parameters<LinearTransport['queryIssues']>[0]) {
    const result = await this.query({ ...input, surface: 'issues' });
    return {
      status: result.status,
      issues: result.records as LinearIssue[],
      pageInfo: result.pageInfo,
    };
  }
}

const LINEAR_SURFACE_QUERIES: Record<LinearSurface, { root: string; query: string }> = {
  issues: {
    root: 'issues',
    query: `query JerichoIssues($first: Int!, $after: String, $filter: IssueFilter) {
      issues(first: $first, after: $after, filter: $filter, orderBy: updatedAt) {
        nodes { id identifier title updatedAt state { name } project { id name } assignee { id name } }
        pageInfo { hasNextPage endCursor }
      }
    }`,
  },
  comments: {
    root: 'comments',
    query: `query JerichoComments($first: Int!, $after: String, $filter: CommentFilter) {
      comments(first: $first, after: $after, filter: $filter, orderBy: updatedAt) {
        nodes { id body updatedAt issue { id identifier title } user { id name } }
        pageInfo { hasNextPage endCursor }
      }
    }`,
  },
  teams: {
    root: 'teams',
    query: `query JerichoTeams($first: Int!, $after: String, $filter: TeamFilter) {
      teams(first: $first, after: $after, filter: $filter, orderBy: updatedAt) {
        nodes { id key name updatedAt }
        pageInfo { hasNextPage endCursor }
      }
    }`,
  },
  users: {
    root: 'users',
    query: `query JerichoUsers($first: Int!, $after: String, $filter: UserFilter) {
      users(first: $first, after: $after, filter: $filter, orderBy: updatedAt) {
        nodes { id name email updatedAt }
        pageInfo { hasNextPage endCursor }
      }
    }`,
  },
  projects: {
    root: 'projects',
    query: `query JerichoProjects($first: Int!, $after: String, $filter: ProjectFilter) {
      projects(first: $first, after: $after, filter: $filter, orderBy: updatedAt) {
        nodes { id name state updatedAt }
        pageInfo { hasNextPage endCursor }
      }
    }`,
  },
  'workflow-states': {
    root: 'workflowStates',
    query: `query JerichoWorkflowStates($first: Int!, $after: String, $filter: WorkflowStateFilter) {
      workflowStates(first: $first, after: $after, filter: $filter, orderBy: updatedAt) {
        nodes { id name type color updatedAt team { id name } }
        pageInfo { hasNextPage endCursor }
      }
    }`,
  },
};

interface LinearGraphqlIssue {
  id: string;
  identifier: string;
  title: string;
  updatedAt: string;
  state?: { name?: string };
  project?: { id?: string; name?: string };
  assignee?: { id?: string; name?: string };
}

interface LinearPageInfo {
  hasNextPage?: boolean;
  endCursor?: string;
}

function fromLinearGraphqlIssue(issue: LinearGraphqlIssue): LinearIssue {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    state: issue.state?.name ?? 'Unknown',
    updatedAt: issue.updatedAt,
    ...(issue.project?.id && issue.project.name
      ? { project: { id: issue.project.id, name: issue.project.name } }
      : {}),
    ...(issue.assignee?.id && issue.assignee.name
      ? { assignee: { id: issue.assignee.id, name: issue.assignee.name } }
      : {}),
  };
}

function fromLinearGraphqlRecord(
  surface: LinearSurface,
  raw: Record<string, unknown>,
): LinearRecord {
  switch (surface) {
    case 'issues': return fromLinearGraphqlIssue(raw as unknown as LinearGraphqlIssue);
    case 'comments': return raw as unknown as LinearComment;
    case 'teams': return raw as unknown as LinearTeam;
    case 'users': return raw as unknown as LinearUser;
    case 'projects': {
      const state = raw.state;
      return {
        ...(raw as unknown as LinearProject),
        ...(typeof state === 'string'
          ? { state }
          : isRuntimeRecord(state) && typeof state.name === 'string'
            ? { state: state.name }
            : {}),
      };
    }
    case 'workflow-states': return raw as unknown as LinearWorkflowState;
  }
}

function isRuntimeRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function gatewayUrl(base: string, pathname: string): URL {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}${pathname}`;
  url.search = '';
  url.hash = '';
  return url;
}
