import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConnectorHealthStatus } from '@jericho/shared';

import { loadConfig } from '../src/config.js';
import { JerichoStore } from '../src/core/store.js';
import type { LinearSurface } from '../src/connectors/adapters/linear.js';
import {
  ConnectorPollingScheduler,
  HttpWhatsAppGatewayTransport,
  MissionExecutionScheduler,
  ProductionRuntimeLifecycle,
  LinearGraphqlTransport,
  createMissionExecutionRuntime,
  createConnectorRuntime,
} from '../src/runtime.js';

const KEY = Buffer.alloc(32, 83);
const resources: Array<() => void> = [];

function writeHermesManifest(busRoot: string): void {
  writeFileSync(join(busRoot, 'jericho-operator-capabilities.json'), JSON.stringify({
    protocol_version: 1,
    operator_id: 'hermes-jericho-operator',
    operator_version: '1.0.0',
    generated_at: '2026-07-11T00:00:00.000Z',
    expires_at: '2026-07-11T00:10:00.000Z',
    capabilities: [
      'structured_artifacts',
      'independent_verification_evidence',
      'metered_cost_evidence',
      'bounded_stop',
      'idempotent_dispatch',
    ],
  }));
}

afterEach(() => {
  vi.useRealTimers();
  for (const dispose of resources.splice(0).reverse()) dispose();
});

describe('production connector polling lifecycle', () => {
  it('reconciles every partition immediately, isolates failures with backoff, prevents overlap, and stops cleanly', async () => {
    vi.useFakeTimers();
    let releaseSlow!: () => void;
    let slowCalls = 0;
    const sync = vi.fn(async (connectorId: string, partition: string, signal: AbortSignal) => {
      if (signal.aborted) throw new Error('aborted');
      if (connectorId === 'failing') throw new Error('offline');
      if (connectorId === 'slow' && ++slowCalls === 2) {
        await new Promise<void>((resolve) => { releaseSlow = resolve; });
      }
      return { connectorId, partition };
    });
    const scheduler = new ConnectorPollingScheduler({ sync }, [
      { id: 'healthy', partitions: ['one', 'two'] },
      { id: 'failing', partitions: ['primary'] },
      { id: 'slow', partitions: ['primary'] },
    ], { pollIntervalMs: 1_000, maxBackoffMs: 8_000 });

    await scheduler.start();
    expect(sync).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sync.mock.calls.filter(([id]) => id === 'healthy')).toHaveLength(4);
    expect(sync.mock.calls.filter(([id]) => id === 'failing')).toHaveLength(1);
    expect(sync.mock.calls.filter(([id]) => id === 'slow')).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(sync.mock.calls.filter(([id]) => id === 'slow')).toHaveLength(2);
    releaseSlow();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sync.mock.calls.filter(([id]) => id === 'slow')).toHaveLength(3);
    expect(sync.mock.calls.filter(([id]) => id === 'failing').length).toBeGreaterThan(1);

    await scheduler.stop();
    const callsAtStop = sync.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sync).toHaveBeenCalledTimes(callsAtStop);
  });
});

describe('connector runtime composition', () => {
  it('boots connector-only, registers deterministic descriptors, and runs configured local sources', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'jericho-runtime-vault-'));
    resources.push(() => rmSync(vault, { recursive: true, force: true }));
    writeFileSync(join(vault, 'Today.md'), '# Today\nShip Jericho.');
    const store = new JerichoStore({ path: ':memory:', key: KEY });
    resources.push(() => store.close());
    const config = loadConfig({
      JERICHO_API_TOKEN: 'runtime-token',
      JERICHO_OBSIDIAN_VAULT: vault,
      JERICHO_VAULT_GATEWAY_URL: 'https://vault.internal',
      JERICHO_VAULT_GATEWAY_TOKEN: 'vault-token',
    }, []);
    const processEvent = vi.fn(() => ({ status: 'understood' as const }));
    const vaultFetch = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/health')) return Response.json({
        status: 'healthy', lastCommitAt: '2026-07-11T00:00:00.000Z', syncAgeMs: 0,
        cachedQueries: 0, reason: 'ok',
      });
      if (path.endsWith('/search')) return Response.json({
        cached: false,
        results: [{ path: 'Today.md', title: 'Today', excerpt: 'Ship Jericho.', score: 1 }],
      });
      return Response.json({ lastIndexAt: '2026-07-11T03:00:00.000Z', indexSizeMb: 1 });
    });

    const runtime = createConnectorRuntime(config, store, {
      workerId: 'runtime-test',
      intake: { processEvent },
      fetch: vaultFetch as typeof fetch,
    });

    expect(runtime.descriptors.map((item) => item.id)).toEqual([
      'linear',
      'obsidian',
      'telegram',
      'whatsapp',
    ]);
    expect(runtime.actionAdapters.telegram.descriptor.id).toBe('telegram');
    expect(runtime.actionAdapters.whatsapp.descriptor.id).toBe('whatsapp');
    expect(runtime.vaultGateway).toBeDefined();
    await expect(runtime.supervisor.sync('telegram', 'primary')).resolves.toMatchObject({
      status: 'unavailable',
    });
    expect(store.listConnectorHealth()).toContainEqual(expect.objectContaining({
      connectorId: 'telegram',
      status: ConnectorHealthStatus.Unavailable,
    }));
    await expect(runtime.supervisor.sync('obsidian', 'vault')).resolves.toMatchObject({
      status: 'completed', captures: 1,
    });
    expect(await runtime.obsidianSearch?.search('ship', 5)).toContainEqual(expect.objectContaining({
      path: 'Today.md',
    }));
    expect(vaultFetch).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/v1/jericho/vault/search' }),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(store.listEvents({ limit: 10 })).toContainEqual(expect.objectContaining({
      type: 'obsidian.note.snapshot',
    }));
    expect(processEvent).toHaveBeenCalledWith(expect.stringMatching(/^obsidian[-:]/));
  });
});

describe('production WhatsApp gateway transport', () => {
  it('uses only the authenticated Hermes health, update, and message endpoints', async () => {
    const requests: Array<{ url: URL; init: RequestInit }> = [];
    const fetchImplementation = vi.fn(async (value: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(String(value));
      requests.push({ url, init });
      if (url.pathname.endsWith('/health')) return new Response(null, { status: 204 });
      if (url.pathname.endsWith('/updates')) {
        return Response.json({
          updates: [],
          nextPageToken: 'opaque-next',
          hasMore: true,
        });
      }
      return Response.json({ chatId: 'wa-chat-1', messageId: 'wa-message-1' });
    });
    const transport = new HttpWhatsAppGatewayTransport(fetchImplementation as typeof fetch);
    const signal = new AbortController().signal;

    await expect(transport.probe({
      gatewayUrl: 'https://hermes.internal/base', gatewayToken: 'wa-secret', signal,
    })).resolves.toEqual({ status: 204 });
    await expect(transport.fetchUpdates({
      gatewayUrl: 'https://hermes.internal/base', gatewayToken: 'wa-secret',
      partition: 'primary', epoch: 7, sequence: 42, pageToken: 'opaque-current',
      limit: 25, signal,
    })).resolves.toEqual({
      status: 200, updates: [], nextPageToken: 'opaque-next', hasMore: true,
    });
    await expect(transport.sendMessage({
      gatewayUrl: 'https://hermes.internal/base', gatewayToken: 'wa-secret',
      recipient: 'wa-chat-1', text: 'Approved exact text',
      idempotencyKey: 'approved-send-key', signal,
    })).resolves.toEqual({
      status: 200, chatId: 'wa-chat-1', messageId: 'wa-message-1',
    });

    expect(requests.map(({ url, init }) => ({
      path: `${url.pathname}${url.search}`,
      method: init.method,
      authorization: new Headers(init.headers).get('authorization'),
    }))).toEqual([{
      path: '/base/v1/jericho/whatsapp/health',
      method: 'GET',
      authorization: 'Bearer wa-secret',
    }, {
      path: '/base/v1/jericho/whatsapp/updates?partition=primary&limit=25&epoch=7&sequence=42&pageToken=opaque-current',
      method: 'GET',
      authorization: 'Bearer wa-secret',
    }, {
      path: '/base/v1/jericho/whatsapp/messages',
      method: 'POST',
      authorization: 'Bearer wa-secret',
    }]);
    expect(JSON.parse(String(requests[2].init.body))).toEqual({
      recipient: 'wa-chat-1',
      text: 'Approved exact text',
      idempotencyKey: 'approved-send-key',
    });
    expect(JSON.stringify(requests)).not.toContain('transcript');
  });
});

describe('production mission execution lifecycle', () => {
  it('starts immediately, never overlaps a runner, and aborts bounded work on stop', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const runNext = vi.fn(async (signal: AbortSignal) => {
      await new Promise<void>((resolve) => {
        release = resolve;
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      return { kind: signal.aborted ? 'cancelled' as const : 'idle' as const, reasons: [] };
    });
    const scheduler = new MissionExecutionScheduler({ runNext }, { pollIntervalMs: 100 });

    await scheduler.start();
    await Promise.resolve();
    expect(runNext).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runNext).toHaveBeenCalledTimes(1);

    release();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(99);
    expect(runNext).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(runNext).toHaveBeenCalledTimes(2);

    await scheduler.stop();
    expect((runNext.mock.calls[1][0] as AbortSignal).aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(runNext).toHaveBeenCalledTimes(2);
  });

  it('creates no executor without a complete explicit workspace and fails closed on a legacy bus', async () => {
    const store = new JerichoStore({ path: ':memory:', key: KEY });
    resources.push(() => store.close());
    expect(createMissionExecutionRuntime(loadConfig({ JERICHO_API_TOKEN: 'runtime-token' }, []), store))
      .toBeUndefined();

    const busRoot = mkdtempSync(join(tmpdir(), 'jericho-hermes-runtime-'));
    resources.push(() => rmSync(busRoot, { recursive: true, force: true }));
    const configured = loadConfig({
      JERICHO_API_TOKEN: 'runtime-token',
      JERICHO_HERMES_BUS_ROOT: busRoot,
      JERICHO_HERMES_REPO: 'jericho',
      JERICHO_HERMES_BRANCH: 'masterblox/approved',
      JERICHO_HERMES_POLL_INTERVAL_MS: '5',
      JERICHO_HERMES_MAX_WAIT_MS: '50',
    }, []);
    const runtime = createMissionExecutionRuntime(configured, store);

    expect(runtime).toBeUndefined();
    expect(store.listConnectorHealth()).toMatchObject([{
      connectorId: 'hermes-execution',
      status: ConnectorHealthStatus.Unavailable,
      details: { reason: 'missing_manifest', executable: false, protocolVersion: 1 },
    }]);
  });

  it('creates connector-action execution without requiring a Hermes code workspace', () => {
    const store = new JerichoStore({ path: ':memory:', key: KEY });
    resources.push(() => store.close());
    const config = loadConfig({ JERICHO_API_TOKEN: 'runtime-token' }, []);
    const connectors = createConnectorRuntime(config, store);

    const runtime = createMissionExecutionRuntime(config, store, {
      connectorActions: connectors.actionAdapters,
    });

    expect(runtime).toBeDefined();
  });

  it('creates a bounded executor only after a fresh Hermes v1 capability handshake', async () => {
    const store = new JerichoStore({ path: ':memory:', key: KEY });
    resources.push(() => store.close());
    const busRoot = mkdtempSync(join(tmpdir(), 'jericho-hermes-runtime-v1-'));
    resources.push(() => rmSync(busRoot, { recursive: true, force: true }));
    mkdirSync(join(busRoot, 'outbox'), { recursive: true });
    mkdirSync(join(busRoot, 'inbox'));
    writeHermesManifest(busRoot);
    const configured = loadConfig({
      JERICHO_API_TOKEN: 'runtime-token',
      JERICHO_HERMES_BUS_ROOT: busRoot,
      JERICHO_HERMES_REPO: 'jericho',
      JERICHO_HERMES_BRANCH: 'masterblox/approved',
      JERICHO_HERMES_POLL_INTERVAL_MS: '5',
      JERICHO_HERMES_MAX_WAIT_MS: '50',
    }, []);

    const runtime = createMissionExecutionRuntime(configured, store, {
      now: () => '2026-07-11T00:00:00.000Z',
    });

    expect(runtime).toBeDefined();
    expect(store.listConnectorHealth()).toMatchObject([{
      connectorId: 'hermes-execution',
      status: ConnectorHealthStatus.Healthy,
      details: { reason: 'compatible', executable: true, protocolVersion: 1 },
    }]);
    await runtime?.start();
    await runtime?.stop();
  });

  it('starts knowledge, execution, then capture and stops in reverse order', async () => {
    const calls: string[] = [];
    const port = (name: string) => ({
      start: vi.fn(async () => { calls.push(`start:${name}`); }),
      stop: vi.fn(async () => { calls.push(`stop:${name}`); }),
    });
    const knowledge = port('knowledge');
    const execution = port('execution');
    const connectors = port('connectors');
    const lifecycle = new ProductionRuntimeLifecycle({ knowledge, execution, connectors });

    await lifecycle.start();
    await lifecycle.stop();

    expect(calls).toEqual([
      'start:knowledge', 'start:execution', 'start:connectors',
      'stop:connectors', 'stop:execution', 'stop:knowledge',
    ]);
  });

  it('drains every runtime even when an earlier shutdown step fails', async () => {
    const calls: string[] = [];
    const knowledge = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => { calls.push('stop:knowledge'); }),
    };
    const execution = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => { calls.push('stop:execution'); }),
    };
    const connectors = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {
        calls.push('stop:connectors');
        throw new Error('connector stop failed');
      }),
    };
    const lifecycle = new ProductionRuntimeLifecycle({ knowledge, execution, connectors });
    await lifecycle.start();

    await expect(lifecycle.stop()).rejects.toThrow(/connector stop failed/);
    expect(calls).toEqual(['stop:connectors', 'stop:execution', 'stop:knowledge']);
  });
});

describe('production Linear read-only transport', () => {
  it('queries and maps every registered surface with stable filter/pagination variables', async () => {
    const fixtures: Record<LinearSurface, { root: string; value: Record<string, unknown> }> = {
      issues: { root: 'issues', value: {
        id: 'issue-1', identifier: 'JER-1', title: 'Issue', updatedAt: '2026-07-11T00:00:00.000Z',
        state: { name: 'Todo' },
      } },
      comments: { root: 'comments', value: {
        id: 'comment-1', body: 'Body', updatedAt: '2026-07-11T00:00:00.000Z',
      } },
      teams: { root: 'teams', value: {
        id: 'team-1', key: 'JER', name: 'Team', updatedAt: '2026-07-11T00:00:00.000Z',
      } },
      users: { root: 'users', value: {
        id: 'user-1', name: 'Carlos', email: 'c@example.test', updatedAt: '2026-07-11T00:00:00.000Z',
      } },
      projects: { root: 'projects', value: {
        id: 'project-1', name: 'Project', state: 'started', updatedAt: '2026-07-11T00:00:00.000Z',
      } },
      'workflow-states': { root: 'workflowStates', value: {
        id: 'state-1', name: 'Todo', type: 'unstarted', color: '#fff',
        updatedAt: '2026-07-11T00:00:00.000Z',
      } },
    };
    let active: LinearSurface = 'issues';
    const fetchImplementation = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
      const fixture = fixtures[active];
      expect(request.query).toContain(`${fixture.root}(`);
      expect(request.query).not.toMatch(/mutation/i);
      expect(request.variables).toMatchObject({
        first: 25,
        after: 'page-2',
        filter: { updatedAt: { gte: '2026-07-10T23:00:00.000Z' } },
      });
      return new Response(JSON.stringify({
        data: { [fixture.root]: {
          nodes: [fixture.value],
          pageInfo: { hasNextPage: true, endCursor: 'page-3' },
        } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const transport = new LinearGraphqlTransport(fetchImplementation as typeof fetch);

    for (const surface of Object.keys(fixtures) as LinearSurface[]) {
      active = surface;
      await expect(transport.query({
        apiKey: 'linear-key', surface, after: 'page-2',
        updatedAfter: '2026-07-10T23:00:00.000Z', limit: 25,
        signal: new AbortController().signal,
      })).resolves.toMatchObject({
        status: 200,
        records: [expect.objectContaining({ id: fixtures[surface].value.id })],
        pageInfo: { hasNextPage: true, endCursor: 'page-3' },
      });
    }
    expect(fetchImplementation).toHaveBeenCalledTimes(6);
  });
});
