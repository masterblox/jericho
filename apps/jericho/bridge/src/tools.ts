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
import type { CodingAgentManagerPort } from './coding-agent/manager.js';
import type { WifiMappingExperienceLauncher } from './experiences/wifi-mapping/index.js';
import type { LocalOperator } from './local-control/local-operator.js';
import { translateAllToGeminiDeclarations, translateGeminiArguments } from './mcp/discovery.js';
import type { MCPRegistry } from './mcp/registry.js';

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
  {
    name: 'open_browser',
    description: 'Open a web URL on Carlos’s Mac. Use only when Carlos explicitly asks to open, launch, browse, or show a website. This cannot click, type, submit, or read the page.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'An http/https URL, or exactly about:blank' },
        browser: { type: 'string', enum: ['default', 'chrome', 'opera', 'safari'], description: 'Defaults to Chrome for a new window and the system browser otherwise' },
        newWindow: { type: 'boolean', description: 'Create and verify a new Chrome window; defaults to true' },
      },
      required: ['url'],
    },
  },
  {
    name: 'open_application',
    description: 'Launch or focus one supported local Mac application when Carlos explicitly asks.',
    parameters: {
      type: 'object',
      properties: {
        application: {
          type: 'string',
          enum: ['conductor', 'cursor', 'finder', 'obsidian', 'terminal', 'vscode'],
        },
      },
      required: ['application'],
    },
  },
  {
    name: 'computer_status',
    description: 'List display geometry and running applications with top-level window counts. Returns no screenshots, window titles, or contents.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'arrange_window',
    description: 'Focus and arrange the front window of a running application on a chosen display. Use only on explicit request.',
    parameters: {
      type: 'object',
      properties: {
        application: { type: 'string', description: 'Exact application name returned by computer_status' },
        display: { type: 'integer', description: 'Display index returned by computer_status; defaults to 0' },
        position: { type: 'string', enum: ['left', 'right', 'center', 'full'] },
      },
      required: ['application', 'position'],
    },
  },
  {
    name: 'inspect_repository',
    description: 'Read bounded status/history or search tracked text in one configured repository. This never writes or runs repository code.',
    parameters: {
      type: 'object',
      properties: {
        repository: { type: 'string', description: 'Configured repository id' },
        query: { type: 'string', description: 'Optional fixed-string search query; omit for branch/status/history' },
      },
      required: ['repository'],
    },
  },
  {
    name: 'open_repository',
    description: 'Open one configured repository in Finder, Terminal, Cursor, VS Code, or Conductor. This does not modify it.',
    parameters: {
      type: 'object',
      properties: {
        repository: { type: 'string', description: 'Configured repository id' },
        application: { type: 'string', enum: ['conductor', 'cursor', 'finder', 'terminal', 'vscode'] },
      },
      required: ['repository'],
    },
  },
  {
    name: 'create_coding_workspace',
    description: 'Start and monitor a new economical Codex task in a local Conductor workspace for an explicit coding request. Returns a task receipt immediately and reports success only after a full Git SHA is verified in the configured repository.',
    parameters: {
      type: 'object',
      properties: {
        repository: { type: 'string', description: 'Configured repository id' },
        task: { type: 'string', description: 'Self-contained task for the new workspace' },
      },
      required: ['repository', 'task'],
    },
  },
  {
    name: 'coding_agent_status',
    description: 'Check the current Conductor workspace, session, and verified Git completion receipt for a coding task previously started by Jericho.',
    parameters: {
      type: 'object',
      properties: { taskId: { type: 'string', description: 'Exact taskId returned by create_coding_workspace' } },
      required: ['taskId'],
    },
  },
  {
    name: 'steer_coding_agent',
    description: 'Send a bounded follow-up instruction to an active coding task only when Carlos explicitly asks to steer or clarify it.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Exact active coding taskId' },
        message: { type: 'string', description: 'Follow-up instruction, at most 4000 characters' },
      },
      required: ['taskId', 'message'],
    },
  },
  {
    name: 'cancel_coding_agent',
    description: 'Cancel an active Conductor coding task only when Carlos explicitly asks to stop it.',
    parameters: {
      type: 'object',
      properties: { taskId: { type: 'string', description: 'Exact active coding taskId' } },
      required: ['taskId'],
    },
  },
  {
    name: 'open_wifi_mapping',
    description: 'Open the clearly labelled simulated Wi-Fi mapping observatory in a fresh Chrome window and move it full-size to the secondary display. Use when Carlos asks for the Wi-Fi mapping tool or party trick.',
    parameters: { type: 'object', properties: {} },
  },
];

export function buildFunctionDeclarations(
  mcpRegistry?: Pick<MCPRegistry, 'allowedDescriptors'>,
): ToolDecl[] {
  return [
    ...FUNCTION_DECLARATIONS,
    ...translateAllToGeminiDeclarations(mcpRegistry?.allowedDescriptors() ?? []),
  ];
}

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
  codingAgent?: CodingAgentManagerPort;
  wifiMapping?: Pick<WifiMappingExperienceLauncher, 'openOnSecondaryDisplay'>;
  mcpRegistry?: Pick<MCPRegistry, 'descriptorForModelName' | 'executeCall'>;
  localOperator?: Pick<LocalOperator,
    | 'openBrowser'
    | 'openApplication'
    | 'computerStatus'
    | 'arrangeWindow'
    | 'inspectRepository'
    | 'openRepository'
    | 'createCodingWorkspace'
  >;
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
        case 'open_browser':
          return executeLocal(options.localOperator, () => options.localOperator!.openBrowser({
            url: args.url, browser: args.browser, newWindow: args.newWindow,
          }));
        case 'open_application':
          return executeLocal(options.localOperator, () => options.localOperator!.openApplication({
            application: args.application,
          }));
        case 'computer_status':
          return executeLocal(options.localOperator, () => options.localOperator!.computerStatus());
        case 'arrange_window':
          return executeLocal(options.localOperator, () => options.localOperator!.arrangeWindow({
            application: args.application, display: args.display, position: args.position,
          }));
        case 'inspect_repository':
          return executeLocal(options.localOperator, () => options.localOperator!.inspectRepository({
            repository: args.repository, query: args.query,
          }));
        case 'open_repository':
          return executeLocal(options.localOperator, () => options.localOperator!.openRepository({
            repository: args.repository, application: args.application,
          }));
        case 'create_coding_workspace':
          if (options.codingAgent) {
            return executeCodingAgent(() => options.codingAgent!.start({
              repository: args.repository,
              task: args.task,
            }));
          }
          return executeLocal(options.localOperator, () => options.localOperator!.createCodingWorkspace({
            repository: args.repository, task: args.task,
          }));
        case 'coding_agent_status':
          return executeCodingAgent(() => requiredCodingAgent(options.codingAgent).status(args.taskId));
        case 'steer_coding_agent':
          return executeCodingAgent(() => requiredCodingAgent(options.codingAgent).steer(args.taskId, args.message));
        case 'cancel_coding_agent':
          return executeCodingAgent(() => requiredCodingAgent(options.codingAgent).cancel(args.taskId));
        case 'open_wifi_mapping':
          return executeWifiMapping(options.wifiMapping);
        default:
          return executeMcp(options.mcpRegistry, name, args);
      }
    },
  };
}

async function executeCodingAgent(
  action: () => Promise<object>,
): Promise<Record<string, unknown>> {
  try {
    const receipt = await action() as Record<string, unknown>;
    const lifecycleStatus = receipt.lifecycleStatus;
    const failed = lifecycleStatus === 'conductor_auth_required'
      || lifecycleStatus === 'failed'
      || lifecycleStatus === 'timed_out'
      || lifecycleStatus === 'incomplete';
    return {
      available: !failed,
      ...(failed ? { status: lifecycleStatus === 'conductor_auth_required' ? 'blocked' : 'failed' } : {}),
      ...receipt,
      ...(failed && typeof receipt.errorCode === 'string' ? { error: receipt.errorCode } : {}),
    };
  } catch (error) {
    return {
      available: false,
      status: 'failed',
      error: codingAgentError(error),
    };
  }
}

function requiredCodingAgent(manager: CodingAgentManagerPort | undefined): CodingAgentManagerPort {
  if (!manager) throw new Error('coding_agent_unavailable');
  return manager;
}

function codingAgentError(error: unknown): string {
  const value = error instanceof Error ? error.message : '';
  const allowed = new Set([
    'coding_agent_capacity_reached', 'coding_agent_session_pending',
    'coding_agent_task_not_found', 'coding_agent_task_terminal',
    'coding_agent_unavailable', 'message_invalid', 'repository_invalid',
    'repository_not_configured', 'task_id_invalid', 'task_invalid',
  ]);
  return allowed.has(value) ? value : 'coding_agent_failed';
}

async function executeWifiMapping(
  launcher: ToolExecutorOptions['wifiMapping'],
): Promise<Record<string, unknown>> {
  if (!launcher) return { available: false, status: 'unavailable', error: 'wifi_mapping_unavailable' };
  try {
    const receipt = await launcher.openOnSecondaryDisplay();
    return {
      available: true,
      status: 'succeeded',
      experienceId: receipt.plan.experienceId,
      url: receipt.plan.url,
      simulation: receipt.start.descriptor.simulation,
      targetDisplay: receipt.plan.targetDisplay,
      browser: receipt.browser,
      placement: receipt.placement,
    };
  } catch (error) {
    const value = error instanceof Error ? error.message : '';
    const allowed = new Set([
      'accessibility_permission_required', 'automation_permission_required',
      'secondary_display_required', 'wifi_mapping_window_control_failed',
    ]);
    return {
      available: false,
      status: 'failed',
      error: allowed.has(value) ? value : 'wifi_mapping_failed',
    };
  }
}

async function executeMcp(
  registry: ToolExecutorOptions['mcpRegistry'],
  modelName: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const descriptor = registry?.descriptorForModelName(modelName);
  if (!registry || !descriptor) return { available: false, status: 'failed', error: 'unknown_tool' };
  try {
    const result = await registry.executeCall({
      id: randomUUID(),
      namespacedName: descriptor.namespacedName,
      args: translateGeminiArguments(descriptor.inputSchema, args),
    }, new AbortController().signal);
    return {
      available: true,
      ok: result.receipt.ok,
      serverName: result.receipt.serverName,
      toolName: result.receipt.toolName,
      latencyMs: result.receipt.latencyMs,
      outputBytes: result.receipt.outputBytes,
      truncated: result.receipt.truncated,
      ...(result.receipt.content === undefined ? {} : { content: result.receipt.content }),
      ...(result.receipt.error === undefined ? {} : {
        error: /^(?:cancelled|timeout after \d+ms)$/u.test(result.receipt.error)
          ? result.receipt.error
          : 'mcp_tool_error',
      }),
    };
  } catch {
    return { available: false, status: 'failed', error: 'mcp_tool_failed' };
  }
}

async function executeLocal(
  operator: ToolExecutorOptions['localOperator'],
  action: () => Promise<object>,
): Promise<Record<string, unknown>> {
  if (!operator) return { available: false, status: 'unavailable', error: 'local_operator_unavailable' };
  try {
    return { available: true, ...(await action()) };
  } catch (error) {
    return {
      available: false,
      status: 'failed',
      error: localActionError(error),
    };
  }
}

function localActionError(error: unknown): string {
  const value = error instanceof Error ? error.message : '';
  const allowed = new Set([
    'accessibility_permission_required', 'application_has_no_windows',
    'application_not_running', 'automation_permission_required', 'browser_invalid',
    'browser_new_window_unsupported', 'browser_window_not_created', 'display_not_found',
    'local_control_failed', 'local_control_requires_macos',
    'repository_not_configured', 'repository_not_directory',
    'url_must_be_http_or_https', 'window_arrangement_failed',
  ]);
  if (allowed.has(value) || /^[a-z][a-z0-9_]{1,80}_invalid$/u.test(value)) return value;
  return 'local_action_failed';
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
