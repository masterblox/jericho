import { randomUUID } from 'node:crypto';

import type { JerichoConfig } from './config.js';
import type { JerichoStore } from './core/store.js';
import { ConductorConnector } from './connectors/adapters/conductor.js';
import { GitConnector } from './connectors/adapters/git.js';
import { GitHubConnector } from './connectors/adapters/github.js';
import {
  LinearAdapter,
  type LinearIssue,
  type LinearTransport,
} from './connectors/adapters/linear.js';
import { ObsidianConnector } from './connectors/adapters/obsidian.js';
import {
  TelegramGatewayAdapter,
  type TelegramGatewayTransport,
  type TelegramGatewayUpdate,
} from './connectors/adapters/telegram-gateway.js';
import type { CaptureConnector, ConnectorDescriptor } from './connectors/contracts.js';
import { CaptureConnectorRegistry } from './connectors/registry.js';
import { ConnectorSupervisor } from './connectors/supervisor.js';

export interface ConnectorRuntime {
  registry: CaptureConnectorRegistry;
  supervisor: ConnectorSupervisor;
  descriptors: ConnectorDescriptor[];
  obsidianSearch?: ObsidianConnector;
}

export interface ConnectorRuntimeOptions {
  workerId?: string;
  fetch?: typeof globalThis.fetch;
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
    workerId: options.workerId ?? `jericho-${process.pid}-${randomUUID()}`,
    leaseMs: config.connectorLeaseMs,
    maxPages: config.connectorMaxPages,
  });
  return {
    registry,
    supervisor,
    descriptors: registry.list().map(({ descriptor }) => structuredClone(descriptor)),
    ...(obsidian ? { obsidianSearch: obsidian } : {}),
  };
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

  async queryIssues(input: Parameters<LinearTransport['queryIssues']>[0]) {
    const response = await this.fetchImplementation('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        authorization: input.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        query: `query JerichoIssues($first: Int!, $after: String, $filter: IssueFilter) {
          issues(first: $first, after: $after, filter: $filter, orderBy: updatedAt) {
            nodes {
              id identifier title updatedAt
              state { name }
              project { id name }
              assignee { id name }
            }
            pageInfo { hasNextPage endCursor }
          }
        }`,
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
      return { status: response.status, issues: [], pageInfo: { hasNextPage: false } };
    }
    const body = await response.json() as {
      data?: { issues?: { nodes?: LinearGraphqlIssue[]; pageInfo?: LinearPageInfo } };
      errors?: unknown[];
    };
    if (body.errors?.length || !body.data?.issues) {
      return { status: 502, issues: [], pageInfo: { hasNextPage: false } };
    }
    const connection = body.data.issues;
    return {
      status: response.status,
      issues: (connection.nodes ?? []).map(fromLinearGraphqlIssue),
      pageInfo: {
        hasNextPage: connection.pageInfo?.hasNextPage === true,
        ...(connection.pageInfo?.endCursor
          ? { endCursor: connection.pageInfo.endCursor }
          : {}),
      },
    };
  }
}

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

function gatewayUrl(base: string, pathname: string): URL {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}${pathname}`;
  url.search = '';
  url.hash = '';
  return url;
}
