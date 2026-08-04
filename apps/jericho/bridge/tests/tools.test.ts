import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AgentLane,
  ConnectorCapability,
  ConnectorHealthStatus,
  CostClass,
  EntityType,
  LifecycleStatus,
  MutationClass,
  RiskLevel,
  RouteType,
  SourceType,
} from '@jericho/shared';

import { JerichoStore } from '../src/core/store.js';
import { wifiMappingExperienceDescriptor } from '../src/experiences/wifi-mapping/index.js';
import { buildDescriptor } from '../src/mcp/index.js';
import { buildFunctionDeclarations, createToolExecutor, FUNCTION_DECLARATIONS } from '../src/tools.js';

const KEY = Buffer.alloc(32, 62);
const T0 = '2026-07-11T00:00:00.000Z';
const stores: JerichoStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('truth-backed voice tools', () => {
  it('exposes bounded computer and repository actions through the shared voice tool executor', async () => {
    const store = openStore();
    const localReceipt = {
      receiptId: 'local-1', action: 'open_browser', status: 'succeeded' as const,
      occurredAt: T0, summary: 'Opened example.com in a new window.',
      evidence: { browser: 'safari' },
    };
    const localOperator = {
      openBrowser: vi.fn(async () => localReceipt),
      openApplication: vi.fn(async () => localReceipt),
      computerStatus: vi.fn(async () => localReceipt),
      arrangeWindow: vi.fn(async () => localReceipt),
      inspectRepository: vi.fn(async () => localReceipt),
      openRepository: vi.fn(async () => localReceipt),
      createCodingWorkspace: vi.fn(async () => localReceipt),
    };
    const tools = createToolExecutor({ store, localOperator });

    expect(FUNCTION_DECLARATIONS.map(item => item.name)).toEqual(expect.arrayContaining([
      'open_browser', 'open_application', 'computer_status', 'arrange_window',
      'inspect_repository', 'open_repository', 'create_coding_workspace',
      'coding_agent_status', 'steer_coding_agent', 'cancel_coding_agent',
      'open_wifi_mapping',
    ]));
    await expect(tools.execute('open_browser', {
      url: 'https://example.com', browser: 'safari', newWindow: true,
    })).resolves.toEqual({ available: true, ...localReceipt });
    expect(localOperator.openBrowser).toHaveBeenCalledWith({
      url: 'https://example.com', browser: 'safari', newWindow: true,
    });

    const unavailable = createToolExecutor({ store });
    await expect(unavailable.execute('computer_status', {})).resolves.toEqual({
      available: false, status: 'unavailable', error: 'local_operator_unavailable',
    });
  });

  it('starts and monitors coding tasks through the real manager boundary when configured', async () => {
    const store = openStore();
    const codingAgent = {
      start: vi.fn(async () => ({ taskId: 'coding-1', lifecycleStatus: 'queued' as const })),
      status: vi.fn(async () => ({ taskId: 'coding-1', lifecycleStatus: 'working' as const, workspaceId: 'ws-1' })),
      steer: vi.fn(async () => ({ taskId: 'coding-1', lifecycleStatus: 'working' as const })),
      cancel: vi.fn(async () => ({ taskId: 'coding-1', lifecycleStatus: 'cancelled' as const })),
      list: vi.fn(async () => []),
    };
    const tools = createToolExecutor({ store, codingAgent });

    await expect(tools.execute('create_coding_workspace', {
      repository: 'jericho', task: 'Fix the wake flow.',
    })).resolves.toEqual({ available: true, taskId: 'coding-1', lifecycleStatus: 'queued' });
    await expect(tools.execute('coding_agent_status', { taskId: 'coding-1' }))
      .resolves.toMatchObject({ available: true, lifecycleStatus: 'working', workspaceId: 'ws-1' });
    await tools.execute('steer_coding_agent', { taskId: 'coding-1', message: 'Run the UX test.' });
    await tools.execute('cancel_coding_agent', { taskId: 'coding-1' });
    expect(codingAgent.start).toHaveBeenCalledWith({ repository: 'jericho', task: 'Fix the wake flow.' });
    expect(codingAgent.steer).toHaveBeenCalledWith('coding-1', 'Run the UX test.');
  });

  it('exposes and executes only allowlisted MCP model tools with restored argument names', async () => {
    const store = openStore();
    const descriptor = buildDescriptor('browser', 'open-tab', 'Create a browser tab', {
      type: 'object',
      properties: { 'target-url': { type: 'string' } },
      required: ['target-url'],
      additionalProperties: false,
    });
    const executeCall = vi.fn(async (call) => ({
      callId: call.id,
      namespacedName: call.namespacedName,
      receipt: {
        ok: true, content: [{ type: 'text', text: 'opened' }],
        serverName: 'browser', toolName: 'open-tab', latencyMs: 4,
        outputBytes: 35, truncated: false,
      },
    }));
    const mcpRegistry = {
      allowedDescriptors: () => [descriptor],
      descriptorForModelName: (name: string) => name === descriptor.modelName ? descriptor : undefined,
      executeCall,
    };
    const declarations = buildFunctionDeclarations(mcpRegistry);
    expect(declarations).toContainEqual(expect.objectContaining({ name: descriptor.modelName }));
    expect(JSON.stringify(declarations)).not.toMatch(/server\.mjs|api.?key|https?:\/\//iu);

    const tools = createToolExecutor({ store, mcpRegistry });
    await expect(tools.execute(descriptor.modelName, { target_url: 'https://example.com' }))
      .resolves.toMatchObject({
        available: true, ok: true, serverName: 'browser', toolName: 'open-tab',
      });
    expect(executeCall).toHaveBeenCalledWith(expect.objectContaining({
      namespacedName: 'mcp/browser/open-tab',
      args: { 'target-url': 'https://example.com' },
    }), expect.any(AbortSignal));
    await expect(tools.execute('mcp_not_allowlisted', {})).resolves.toEqual({
      available: false, status: 'failed', error: 'unknown_tool',
    });
  });

  it('projects the Wi-Fi launch receipt without leaking server handles or temporary provenance', async () => {
    const store = openStore();
    const wifiMapping = {
      openOnSecondaryDisplay: vi.fn(async () => ({
        start: {
          url: 'http://127.0.0.1:39004/observatory.html', ready: true as const,
          descriptor: wifiMappingExperienceDescriptor,
          server: { baseUrl: 'private', readyUrl: 'private', close: vi.fn() },
        },
        plan: {
          experienceId: 'wifi-mapping' as const,
          url: 'http://127.0.0.1:39004/observatory.html',
          targetDisplay: { id: '1', x: 100, y: 0, width: 1000, height: 800 },
          actions: [] as never,
        },
        browser: { application: 'Google Chrome' as const, windowCountAfter: 2 },
        placement: { application: 'Google Chrome' as const, displayId: '1', bounds: { x: 100, y: 0, width: 1000, height: 800 } },
      })),
    };
    const result = await createToolExecutor({ store, wifiMapping }).execute('open_wifi_mapping', {});
    expect(result).toMatchObject({
      available: true, status: 'succeeded', experienceId: 'wifi-mapping',
      targetDisplay: { id: '1' }, placement: { displayId: '1' },
    });
    expect(JSON.stringify(result)).not.toMatch(/server|private|\/tmp\//iu);
  });

  it('declares and executes bounded vault search without mutation authority', async () => {
    const store = openStore();
    const search = vi.fn(async () => ({
      cached: true,
      results: [{ path: 'People/Carlos.md', title: 'Carlos', excerpt: 'Private intelligence.', score: 4.2 }],
    }));
    const tools = createToolExecutor({
      store,
      vaultSearch: { search },
      clock: () => T0,
    });

    expect(FUNCTION_DECLARATIONS).toContainEqual(expect.objectContaining({
      name: 'search_vault',
      parameters: expect.objectContaining({ required: ['query'] }),
    }));
    await expect(tools.execute('search_vault', { query: '  Carlos   intelligence ', limit: 3 }))
      .resolves.toEqual({
        available: true, cached: true, count: 1,
        results: [{ path: 'People/Carlos.md', title: 'Carlos', excerpt: 'Private intelligence.', score: 4.2 }],
      });
    expect(search).toHaveBeenCalledWith('Carlos intelligence', 3, expect.any(AbortSignal));
    expect(store.listProposals()).toEqual([]);
    expect(store.listReceipts()).toEqual([]);
    expect(store.listDecisions()).toEqual([]);
  });

  it('bounds vault search and reports unavailable explicitly without leaking failures', async () => {
    const store = openStore();
    const unavailable = createToolExecutor({ store });
    await expect(unavailable.execute('search_vault', { query: 'evidence' })).resolves.toEqual({
      available: false, error: 'vault_search_unavailable', count: 0, results: [],
    });

    const failing = createToolExecutor({
      store,
      vaultSearch: { search: async () => { throw new Error('secret gateway token'); } },
    });
    await expect(failing.execute('search_vault', { query: 'evidence', limit: 11 }))
      .rejects.toThrow(/limit/i);
    await expect(failing.execute('search_vault', { query: 'evidence' })).resolves.toEqual({
      available: false, error: 'vault_search_unavailable', count: 0, results: [],
    });

    const privatePath = createToolExecutor({
      store,
      vaultSearch: { search: async () => ({
        cached: false,
        results: [{
          path: '/opt/brain/private.md', title: 'Private', excerpt: 'Do not leak.', score: 1,
          token: 'extra-field-is-never-projected',
        }],
      }) },
    });
    await expect(privatePath.execute('search_vault', { query: 'evidence' })).resolves.toEqual({
      available: false, error: 'vault_search_unavailable', count: 0, results: [],
    });
  });
  it('lists actual open task entities with freshness and evidence and no fixtures', async () => {
    const store = openStore();
    store.upsertEntity({
      id: 'task-real', type: EntityType.Task, canonicalName: 'Real Linear task', aliases: [],
      attributes: { identifier: 'JER-7', state: 'Todo', priority: 'high' },
      status: LifecycleStatus.Active, risk: RiskLevel.Low, confidence: 1,
      freshness: { observedAt: T0 },
      provenance: [{ source: 'linear', sourceType: SourceType.Connector, sourceEventId: 'linear-7', observedAt: T0 }],
      createdAt: T0, updatedAt: T0,
    });
    const tools = createToolExecutor({ store, clock: () => T0, idFactory: () => 'proposal-1' });

    const result = await tools.execute('list_open_tasks', {});

    expect(result).toEqual({
      count: 1,
      tasks: [{
        id: 'task-real', identifier: 'JER-7', title: 'Real Linear task',
        status: 'active', state: 'Todo', priority: 'high', freshness: T0,
        evidence: [{ source: 'linear', sourceEventId: 'linear-7', observedAt: T0 }],
      }],
    });
    expect(JSON.stringify(result)).not.toMatch(/P1-2|Telethon|dead crons/i);
  });

  it('draft_email creates a pending Proposal and performs no external action', async () => {
    const store = openStore();
    const tools = createToolExecutor({ store, clock: () => T0, idFactory: () => 'proposal-email' });

    const result = await tools.execute('draft_email', {
      to: 'Paula', topic: 'Jericho demo', tone: 'direct',
    });

    expect(result).toMatchObject({ proposalId: 'proposal-email', status: LifecycleStatus.PendingApproval });
    expect(store.getProposal('proposal-email')).toMatchObject({
      status: LifecycleStatus.PendingApproval,
      body: { to: 'Paula', topic: 'Jericho demo', tone: 'direct' },
    });
    expect(store.listReceipts()).toEqual([]);
  });

  it('fleet_status reports stored connector and capability health without promoting unavailable', async () => {
    const store = openStore();
    store.upsertConnectorHealth({
      connectorId: 'telegram', status: ConnectorHealthStatus.Unavailable,
      checkedAt: T0, lastFailureAt: T0, consecutiveFailures: 1,
      freshness: { observedAt: T0 },
      capabilities: [{
        capability: ConnectorCapability.Capture,
        status: ConnectorHealthStatus.Unavailable,
        checkedAt: T0, lastFailureAt: T0, details: { reason: 'missing config' },
      }],
      details: { reason: 'missing config' },
      provenance: [{ source: 'test', sourceType: SourceType.System, observedAt: T0 }],
    });
    store.registerAgentCapability({
      id: 'cap-dev', agentId: 'dev', lane: AgentLane.Dev, name: 'Code',
      status: LifecycleStatus.Active, routes: [RouteType.Agent], supportedActions: ['code.read'],
      tools: ['git'], modelPolicy: { allowedModels: ['local'], preferLocal: true, maxTokensPerAssignment: 1_000 },
      writableScope: {
        allowedTools: ['git'], allowedSystems: [], allowedRepositories: [], allowedChannels: [],
        allowedRecipients: [], allowedCredentialRefs: [], allowedDataScopes: [],
        allowedMutationClasses: [MutationClass.ReadOnly],
      },
      costClass: CostClass.Local, mayCreateAssignments: false, maximumRisk: RiskLevel.Low,
      metadata: {}, provenance: [{ source: 'test', sourceType: SourceType.System, observedAt: T0 }],
      createdAt: T0, updatedAt: T0,
    });
    const tools = createToolExecutor({ store, clock: () => T0 });

    const result = await tools.execute('fleet_status', {});

    expect(result).toMatchObject({
      connectors: [{ connectorId: 'telegram', status: ConnectorHealthStatus.Unavailable }],
      agents: [{ agentId: 'dev', lane: AgentLane.Dev, status: LifecycleStatus.Active }],
    });
  });
});

function openStore(): JerichoStore {
  const store = new JerichoStore({ path: ':memory:', key: KEY });
  stores.push(store);
  return store;
}
