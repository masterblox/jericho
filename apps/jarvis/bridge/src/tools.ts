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
];

export interface ToolExecutorOptions {
  store: JerichoStore;
  clock?: () => string;
  idFactory?: () => string;
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
        default:
          return { error: `unknown tool: ${name}` };
      }
    },
  };
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
