import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, normalize, relative } from 'node:path';

import {
  EntityType,
  LifecycleStatus,
  ProposalKind,
  RiskLevel,
  RouteType,
  SourceType,
  type JsonObject,
} from '@jericho/shared';

import type { JerichoStore } from './core/store.js';

export interface ToolDecl {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const FUNCTION_DECLARATIONS: ToolDecl[] = [
  {
    name: 'list_open_tasks',
    description: 'List open tasks from Jericho truth with freshness and evidence.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'draft_email',
    description: 'Create a reviewable email draft proposal. This never sends.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient name' },
        topic: { type: 'string', description: 'What the email is about' },
        tone: { type: 'string', description: 'warm | formal | direct' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'fleet_status',
    description: 'Report actual connector and registered agent capability health.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'search_vault',
    description: 'Search verified Obsidian vault evidence through the bounded private RAG gateway.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Vault evidence query, at most 500 characters' },
        limit: { type: 'integer', description: 'Maximum results from 1 to 10' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_vault_note',
    description: 'Read a specific Obsidian vault note by its relative path. Returns the full markdown content of the note.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path within the vault (e.g. "Projects/MyProject.md")' },
      },
      required: ['path'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web for information not available in the vault. Use when you need external knowledge.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query, at most 500 characters' },
        num_results: { type: 'integer', description: 'Number of results to return (1-5, default 3)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_linear',
    description: 'Search Linear issues by title or description. Returns matching issues with status, priority, and assignee.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query to match against issue titles (at most 200 characters)' },
        limit: { type: 'integer', description: 'Maximum results from 1 to 20 (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_recent_messages',
    description: 'Read recent messages from Telegram or WhatsApp connectors. Returns the latest messages with sender and timestamp.',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Connector to read from: "telegram" or "whatsapp"' },
        limit: { type: 'integer', description: 'Maximum messages to return (1-20, default 10)' },
      },
      required: ['source'],
    },
  },
];

export interface VaultToolSearchPort {
  search(query: string, limit: number, signal: AbortSignal): Promise<{
    cached: boolean;
    results: Array<{ path: string; title: string; excerpt: string; score: number }>;
  }>;
}

export interface VaultToolReadPort {
  readNote(relativePath: string, signal: AbortSignal): Promise<{
    content: string;
    title: string;
    lastModified: string;
  } | null>;
}

export interface WebSearchPort {
  search(query: string, numResults: number, signal: AbortSignal): Promise<{
    results: Array<{ title: string; url: string; snippet: string }>;
  }>;
}

export interface LinearSearchPort {
  searchIssues(query: string, limit: number, signal: AbortSignal): Promise<{
    issues: Array<{
      identifier: string;
      title: string;
      state: string;
      priority?: string;
      assignee?: string;
      project?: string;
      url: string;
    }>;
  }>;
}

export interface MessageReadPort {
  readRecentMessages(source: string, limit: number, signal: AbortSignal): Promise<{
    messages: Array<{
      id: string;
      sender: string;
      text: string;
      timestamp: string;
    }>;
  }>;
}

export interface ToolExecutorOptions {
  store: JerichoStore;
  clock?: () => string;
  idFactory?: () => string;
  vaultSearch?: VaultToolSearchPort;
  vaultRead?: VaultToolReadPort;
  webSearch?: WebSearchPort;
  linearSearch?: LinearSearchPort;
  messageRead?: MessageReadPort;
}

export interface ToolExecutor {
  execute(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export function createToolExecutor(options: ToolExecutorOptions): ToolExecutor {
  const clock = options.clock ?? (() => new Date().toISOString());
  const idFactory = options.idFactory ?? (() => `proposal-${randomUUID()}`);
  return {
    execute: async (name, args) => {
      switch (name) {
        case 'list_open_tasks': {
          const tasks = options.store.listEntities({ type: EntityType.Task })
            .filter((entity) =>
              entity.status !== LifecycleStatus.Succeeded &&
              entity.status !== LifecycleStatus.Cancelled &&
              entity.status !== LifecycleStatus.Archived,
            )
            .map((entity) => ({
              id: entity.id,
              ...(typeof entity.attributes.identifier === 'string'
                ? { identifier: entity.attributes.identifier }
                : {}),
              title: entity.canonicalName,
              status: entity.status ?? LifecycleStatus.Draft,
              ...(typeof entity.attributes.state === 'string'
                ? { state: entity.attributes.state }
                : {}),
              ...(typeof entity.attributes.priority === 'string'
                ? { priority: entity.attributes.priority }
                : {}),
              freshness: entity.freshness.observedAt,
              evidence: entity.provenance.map((item) => ({
                source: item.source,
                ...(item.sourceEventId ? { sourceEventId: item.sourceEventId } : {}),
                observedAt: item.observedAt,
              })),
            }));
          return { count: tasks.length, tasks };
        }
        case 'draft_email': {
          const topic = requiredString(args.topic, 'topic');
          const to = optionalString(args.to) ?? 'recipient';
          const tone = optionalString(args.tone) ?? 'warm';
          const createdAt = clock();
          const proposal = options.store.saveProposal({
            id: idFactory(),
            version: 1,
            proposedByAgentId: 'jericho',
            kind: ProposalKind.Message,
            summary: `Email draft: ${topic}`,
            body: {
              to,
              topic,
              tone,
              subject: topic,
              draft: draftBody(to, topic, tone),
            } as JsonObject,
            status: LifecycleStatus.PendingApproval,
            route: RouteType.HumanApproval,
            risk: RiskLevel.Low,
            createdAt,
            provenance: [{
              source: 'jericho-tool:draft_email',
              sourceType: SourceType.Agent,
              observedAt: createdAt,
            }],
          });
          return {
            proposalId: proposal.id,
            status: proposal.status,
            summary: proposal.summary,
            draft: proposal.body.draft,
          };
        }
        case 'fleet_status': {
          const connectors = options.store.listConnectorHealth().map((health) => ({
            connectorId: health.connectorId,
            status: health.status,
            checkedAt: health.checkedAt,
            capabilities: health.capabilities,
          }));
          const agentsById = new Map<string, Record<string, unknown>>();
          for (const capability of options.store.listAgentCapabilities()) {
            const current = agentsById.get(capability.agentId);
            if (current) {
              (current.capabilities as string[]).push(capability.id);
              continue;
            }
            agentsById.set(capability.agentId, {
              agentId: capability.agentId,
              lane: capability.lane,
              status: capability.status,
              capabilities: [capability.id],
            });
          }
          return { connectors, agents: [...agentsById.values()] };
        }
        case 'search_vault': {
          return executeVaultSearch(options.vaultSearch, args);
        }
        case 'read_vault_note': {
          return executeVaultRead(options.vaultRead, args);
        }
        case 'web_search': {
          return executeWebSearch(options.webSearch, args);
        }
        case 'search_linear': {
          return executeLinearSearch(options.linearSearch, args);
        }
        case 'read_recent_messages': {
          return executeReadMessages(options.messageRead, args);
        }
        default:
          return { error: `unknown tool: ${name}` };
      }
    },
  };
}

export async function executeVaultSearch(
  port: VaultToolSearchPort | undefined,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const query = boundedQuery(args.query);
  const limit = boundedLimit(args.limit);
  if (!port) return vaultUnavailable();
  try {
    const response = await port.search(query, limit, new AbortController().signal);
    const results = response.results.slice(0, limit).map((result) => ({
      path: relativeVaultPath(result.path),
      title: boundedResultString(result.title, 500, 'title'),
      excerpt: boundedResultString(result.excerpt, 4_000, 'excerpt'),
      score: boundedScore(result.score),
    }));
    return {
      available: true,
      cached: response.cached,
      count: results.length,
      results,
    };
  } catch {
    return vaultUnavailable();
  }
}

function boundedQuery(value: unknown): string {
  const query = requiredString(value, 'query').replace(/\s+/gu, ' ');
  if (query.length > 500 || /[\u0000-\u001f\u007f]/u.test(query)) {
    throw new Error('query must be at most 500 printable characters');
  }
  return query;
}

function boundedLimit(value: unknown): number {
  if (value === undefined) return 5;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 10) {
    throw new Error('limit must be an integer from 1 to 10');
  }
  return value as number;
}

function relativeVaultPath(value: string): string {
  if (!value || value.length > 1_024 || value.startsWith('/') || value.includes('\\')
    || value.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Vault result path is invalid');
  }
  return value;
}

function boundedResultString(value: string, maximum: number, field: string): string {
  if (!value?.trim() || value.length > maximum) throw new Error(`Vault result ${field} is invalid`);
  return value;
}

function boundedScore(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('Vault result score is invalid');
  return value;
}

function vaultUnavailable(): Record<string, unknown> {
  return { available: false, error: 'vault_search_unavailable', count: 0, results: [] };
}

async function executeVaultRead(
  port: VaultToolReadPort | undefined,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const relativePath = boundedVaultPath(args.path);
  if (!port) return { available: false, error: 'vault_read_unavailable' };
  try {
    const result = await port.readNote(relativePath, new AbortController().signal);
    if (!result) return { available: true, found: false, path: relativePath };
    return {
      available: true,
      found: true,
      path: relativePath,
      title: boundedResultString(result.title, 500, 'title'),
      content: boundedResultString(result.content, 32_000, 'content'),
      lastModified: result.lastModified,
    };
  } catch {
    return { available: false, error: 'vault_read_unavailable' };
  }
}

function boundedVaultPath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('path is required');
  const normalized = normalize(value.trim());
  if (normalized.startsWith('/') || normalized.includes('..') || normalized.includes('\\')) {
    throw new Error('path must be a relative vault path without traversal');
  }
  return normalized;
}

async function executeWebSearch(
  port: WebSearchPort | undefined,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const query = boundedQuery(args.query);
  const numResults = args.num_results === undefined ? 3 : boundedNumResults(args.num_results);
  if (!port) return { available: false, error: 'web_search_unavailable' };
  try {
    const response = await port.search(query, numResults, new AbortController().signal);
    const results = response.results.slice(0, numResults).map((result) => ({
      title: boundedResultString(result.title, 500, 'title'),
      url: result.url,
      snippet: boundedResultString(result.snippet, 2_000, 'snippet'),
    }));
    return { available: true, count: results.length, results };
  } catch {
    return { available: false, error: 'web_search_unavailable' };
  }
}

function boundedNumResults(value: unknown): number {
  if (value === undefined) return 3;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 5) {
    throw new Error('num_results must be an integer from 1 to 5');
  }
  return value as number;
}

async function executeLinearSearch(
  port: LinearSearchPort | undefined,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const query = boundedLinearQuery(args.query);
  const limit = args.limit === undefined ? 10 : boundedLinearLimit(args.limit);
  if (!port) return { available: false, error: 'linear_search_unavailable' };
  try {
    const response = await port.searchIssues(query, limit, new AbortController().signal);
    const issues = response.issues.slice(0, limit).map((issue) => ({
      identifier: issue.identifier,
      title: boundedResultString(issue.title, 500, 'title'),
      state: issue.state,
      ...(issue.priority ? { priority: issue.priority } : {}),
      ...(issue.assignee ? { assignee: issue.assignee } : {}),
      ...(issue.project ? { project: issue.project } : {}),
      url: issue.url,
    }));
    return { available: true, count: issues.length, issues };
  } catch {
    return { available: false, error: 'linear_search_unavailable' };
  }
}

function boundedLinearQuery(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('query is required');
  const query = value.trim().replace(/\s+/gu, ' ');
  if (query.length > 200) throw new Error('query must be at most 200 characters');
  return query;
}

function boundedLinearLimit(value: unknown): number {
  if (value === undefined) return 10;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 20) {
    throw new Error('limit must be an integer from 1 to 20');
  }
  return value as number;
}

async function executeReadMessages(
  port: MessageReadPort | undefined,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const source = boundedMessageSource(args.source);
  const limit = args.limit === undefined ? 10 : boundedMessageLimit(args.limit);
  if (!port) return { available: false, error: 'message_read_unavailable' };
  try {
    const response = await port.readRecentMessages(source, limit, new AbortController().signal);
    const messages = response.messages.slice(0, limit).map((msg) => ({
      id: msg.id,
      sender: boundedResultString(msg.sender, 200, 'sender'),
      text: boundedResultString(msg.text, 4_000, 'text'),
      timestamp: msg.timestamp,
    }));
    return { available: true, source, count: messages.length, messages };
  } catch {
    return { available: false, error: 'message_read_unavailable' };
  }
}

function boundedMessageSource(value: unknown): string {
  if (typeof value !== 'string') throw new Error('source is required');
  const source = value.trim().toLowerCase();
  if (source !== 'telegram' && source !== 'whatsapp') {
    throw new Error('source must be "telegram" or "whatsapp"');
  }
  return source;
}

function boundedMessageLimit(value: unknown): number {
  if (value === undefined) return 10;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 20) {
    throw new Error('limit must be an integer from 1 to 20');
  }
  return value as number;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function draftBody(to: string, topic: string, tone: string): string {
  return `Hi ${to},\n\nFollowing up on ${topic}. Please let me know what works for you.\n\nTone: ${tone}`;
}
