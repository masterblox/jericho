import { randomUUID } from 'node:crypto';

import {
  ConnectorCapability,
  ConnectorHealthStatus,
  SourceType,
  type ConnectorHealth,
} from '@jericho/shared';

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
import {
  WhatsAppGatewayAdapter,
  type WhatsAppGatewayTransport,
  type WhatsAppGatewayUpdate,
} from './connectors/adapters/whatsapp-gateway.js';
import type { CaptureConnector, ConnectorDescriptor } from './connectors/contracts.js';
import { CaptureConnectorRegistry } from './connectors/registry.js';
import {
  ConnectorSupervisor,
  type ConnectorIntakePort,
} from './connectors/supervisor.js';
import {
  HermesFilesystemExecutor,
  HermesResultVerifier,
  inspectHermesProtocol,
} from './orchestration/hermes-filesystem-executor.js';
import {
  RoutedArtifactVerifier,
  RoutedAssignmentExecutor,
  type ConnectorActionAdapters,
} from './orchestration/connector-action-executor.js';
import { MissionRunner, type RunnerOutcome } from './orchestration/runner.js';
import {
  HttpVaultGatewayClient,
  type VaultGatewayPort,
} from './vault/vault-gateway-client.js';

export interface ConnectorRuntime {
  registry: CaptureConnectorRegistry;
  supervisor: ConnectorSupervisor;
  descriptors: ConnectorDescriptor[];
  actionAdapters: Readonly<{
    telegram: TelegramGatewayAdapter;
    whatsapp: WhatsAppGatewayAdapter;
  }>;
  obsidianSearch?: ObsidianConnector;
  vaultGateway?: VaultGatewayPort;
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
  const telegram = new TelegramGatewayAdapter({
    gatewayUrl: config.telegramGatewayUrl,
    gatewayToken: config.telegramGatewayToken,
    transport: new HttpTelegramGatewayTransport(fetchImplementation),
  });
  const whatsapp = new WhatsAppGatewayAdapter({
    gatewayUrl: config.whatsappGatewayUrl,
    gatewayToken: config.whatsappGatewayToken,
    transport: new HttpWhatsAppGatewayTransport(fetchImplementation),
  });
  const connectors: CaptureConnector[] = [
    telegram,
    whatsapp,
    new LinearAdapter({
      apiKey: config.linearApiKey,
      transport: new LinearGraphqlTransport(fetchImplementation),
    }),
  ];
  const vaultGateway = config.vaultGatewayUrl && config.vaultGatewayToken
    ? new HttpVaultGatewayClient({
        gatewayUrl: config.vaultGatewayUrl,
        gatewayToken: config.vaultGatewayToken,
        timeoutMs: config.vaultGatewayTimeoutMs,
        maxResponseBytes: 256 * 1024,
        fetch: fetchImplementation,
      })
    : undefined;
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
        staleAfterMs: config.vaultSyncStaleMs,
        ...(vaultGateway ? { gateway: vaultGateway } : {}),
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
    actionAdapters: Object.freeze({ telegram, whatsapp }),
    ...(obsidian ? { obsidianSearch: obsidian } : {}),
    ...(vaultGateway ? { vaultGateway } : {}),
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

export class HttpWhatsAppGatewayTransport implements WhatsAppGatewayTransport {
  constructor(private readonly fetchImplementation: typeof globalThis.fetch = globalThis.fetch) {}

  async probe(input: Parameters<WhatsAppGatewayTransport['probe']>[0]) {
    const response = await this.fetchImplementation(
      gatewayUrl(input.gatewayUrl, '/v1/jericho/whatsapp/health'),
      {
        method: 'GET',
        headers: { authorization: `Bearer ${input.gatewayToken}`, accept: 'application/json' },
        signal: input.signal,
      },
    );
    return { status: response.status };
  }

  async fetchUpdates(input: Parameters<WhatsAppGatewayTransport['fetchUpdates']>[0]) {
    const url = gatewayUrl(input.gatewayUrl, '/v1/jericho/whatsapp/updates');
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
      updates: Array.isArray(body.updates) ? body.updates as WhatsAppGatewayUpdate[] : [],
      ...(typeof body.nextPageToken === 'string' ? { nextPageToken: body.nextPageToken } : {}),
      hasMore: body.hasMore === true,
    };
  }

  async sendMessage(input: Parameters<WhatsAppGatewayTransport['sendMessage']>[0]) {
    const response = await this.fetchImplementation(
      gatewayUrl(input.gatewayUrl, '/v1/jericho/whatsapp/messages'),
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

export interface MissionExecutionPort {
  runNext(signal: AbortSignal): Promise<RunnerOutcome>;
}

export interface MissionExecutionSchedulerOptions {
  pollIntervalMs: number;
}

/** Runs at most one durable assignment at a time in this process. */
export class MissionExecutionScheduler {
  #running = false;
  #controller?: AbortController;
  #timer?: ReturnType<typeof setTimeout>;
  #inFlight?: Promise<void>;

  constructor(
    private readonly runner: MissionExecutionPort,
    private readonly options: MissionExecutionSchedulerOptions,
  ) {
    if (!Number.isInteger(options.pollIntervalMs) || options.pollIntervalMs < 1) {
      throw new TypeError('Mission execution polling interval is invalid');
    }
  }

  async start(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    this.#controller = new AbortController();
    this.#run();
  }

  async stop(): Promise<void> {
    if (!this.#running && !this.#inFlight) return;
    this.#running = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#controller?.abort();
    await this.#inFlight;
    this.#controller = undefined;
  }

  #run(): void {
    if (!this.#running || !this.#controller || this.#inFlight) return;
    const signal = this.#controller.signal;
    const execution = (async () => {
      try {
        await this.runner.runNext(signal);
      } catch {
        // The runner persists terminal/retry state; the scheduler must stay alive.
      }
    })();
    this.#inFlight = execution;
    void execution.finally(() => {
      if (this.#inFlight === execution) this.#inFlight = undefined;
      if (!this.#running || signal.aborted) return;
      this.#timer = setTimeout(() => {
        this.#timer = undefined;
        this.#run();
      }, this.options.pollIntervalMs);
    });
  }
}

export interface MissionExecutionRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface MissionExecutionRuntimeFactoryOptions {
  now?: () => string;
  connectorActions?: ConnectorActionAdapters;
}

export function createMissionExecutionRuntime(
  config: JerichoConfig,
  store: JerichoStore,
  options: MissionExecutionRuntimeFactoryOptions = {},
): MissionExecutionRuntime | undefined {
  const workspaceFields = [config.hermesBusRoot, config.hermesRepo, config.hermesBranch];
  const hasNoHermesWorkspace = workspaceFields.every((value) => value === undefined);
  if (!hasNoHermesWorkspace && workspaceFields.some((value) => value === undefined)) {
    throw new Error('Hermes execution requires an explicit bus root, repository, and branch');
  }
  const now = options.now ?? (() => new Date().toISOString());
  let hermesExecutor: HermesFilesystemExecutor | undefined;
  let hermesVerifier: HermesResultVerifier | undefined;
  if (!hasNoHermesWorkspace) {
    const compatibility = inspectHermesProtocol(config.hermesBusRoot!, now());
    recordHermesExecutionHealth(store, compatibility, now());
    if (compatibility.compatible) {
      hermesExecutor = new HermesFilesystemExecutor({
        busRoot: config.hermesBusRoot!,
        store,
        workspace: { repo: config.hermesRepo!, branch: config.hermesBranch! },
        pollIntervalMs: config.hermesPollIntervalMs,
        maxWaitMs: config.hermesMaxWaitMs,
        now,
      });
      hermesVerifier = new HermesResultVerifier(store);
    }
  }
  if (!options.connectorActions && !hermesExecutor) return undefined;
  const executor = new RoutedAssignmentExecutor(
    store,
    options.connectorActions ?? {},
    { ...(hermesExecutor ? { fallback: hermesExecutor } : {}), now },
  );
  const verifier = new RoutedArtifactVerifier(store, {
    ...(hermesVerifier ? { fallback: hermesVerifier } : {}),
  });
  const runner = new MissionRunner(store, executor, verifier, {
    workerId: `jericho-mission-${process.pid}-${randomUUID()}`,
    leaseMs: config.connectorLeaseMs,
    retryDelayMs: config.hermesPollIntervalMs,
  });
  return new MissionExecutionScheduler(runner, {
    pollIntervalMs: config.hermesPollIntervalMs,
  });
}

function recordHermesExecutionHealth(
  store: JerichoStore,
  compatibility: ReturnType<typeof inspectHermesProtocol>,
  checkedAt: string,
): ConnectorHealth {
  const status = compatibility.compatible
    ? ConnectorHealthStatus.Healthy
    : ConnectorHealthStatus.Unavailable;
  const details = {
    reason: compatibility.reason,
    executable: compatibility.compatible,
    protocolVersion: compatibility.protocolVersion ?? 1,
    ...(compatibility.operatorId ? { operatorId: compatibility.operatorId } : {}),
    ...(compatibility.operatorVersion ? { operatorVersion: compatibility.operatorVersion } : {}),
    ...(compatibility.capabilities ? { capabilities: compatibility.capabilities } : {}),
    ...(compatibility.expiresAt ? { handshakeExpiresAt: compatibility.expiresAt } : {}),
  };
  return store.upsertConnectorHealth({
    connectorId: 'hermes-execution',
    status,
    checkedAt,
    ...(compatibility.compatible
      ? { lastSuccessAt: checkedAt }
      : { lastFailureAt: checkedAt }),
    consecutiveFailures: compatibility.compatible ? 0 : 1,
    freshness: { observedAt: checkedAt },
    capabilities: [{
      capability: ConnectorCapability.Health,
      status,
      checkedAt,
      ...(compatibility.compatible
        ? { lastSuccessAt: checkedAt }
        : { lastFailureAt: checkedAt }),
      details,
    }],
    details,
    provenance: [{
      source: 'jericho:hermes-protocol',
      sourceType: SourceType.System,
      observedAt: checkedAt,
    }],
  });
}

interface LifecyclePort {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ProductionRuntimeLifecycleOptions {
  knowledge: LifecyclePort;
  execution?: LifecyclePort;
  connectors: LifecyclePort;
}

/** Starts dependencies in authority order and always drains them in reverse. */
export class ProductionRuntimeLifecycle implements LifecyclePort {
  #running = false;

  constructor(private readonly runtimes: ProductionRuntimeLifecycleOptions) {}

  async start(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      await this.runtimes.knowledge.start();
      await this.runtimes.execution?.start();
      await this.runtimes.connectors.start();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.#running) return;
    this.#running = false;
    let firstFailure: unknown;
    for (const runtime of [
      this.runtimes.connectors,
      this.runtimes.execution,
      this.runtimes.knowledge,
    ]) {
      if (!runtime) continue;
      try {
        await runtime.stop();
      } catch (error) {
        firstFailure ??= error;
      }
    }
    if (firstFailure !== undefined) throw firstFailure;
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
