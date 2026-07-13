import { randomUUID } from 'node:crypto';

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
    description: 'Required before answering questions about Carlos’s private people, relationships, companies, projects, decisions, or personal context. Returns verified bounded Obsidian evidence; never invent missing claims.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Vault evidence query, at most 500 characters' },
        limit: { type: 'integer', description: 'Maximum results from 1 to 10' },
      },
      required: ['query'],
    },
  },
];

export interface VaultToolSearchPort {
  search(query: string, limit: number, signal: AbortSignal): Promise<{
    cached: boolean;
    results: Array<{ path: string; title: string; excerpt: string; score: number }>;
  }>;
}

export interface ToolExecutorOptions {
  store: JerichoStore;
  clock?: () => string;
  idFactory?: () => string;
  vaultSearch?: VaultToolSearchPort;
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
