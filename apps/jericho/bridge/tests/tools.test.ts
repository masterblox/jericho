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
import { createToolExecutor, FUNCTION_DECLARATIONS } from '../src/tools.js';

const KEY = Buffer.alloc(32, 62);
const T0 = '2026-07-11T00:00:00.000Z';
const stores: JerichoStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('truth-backed voice tools', () => {
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
