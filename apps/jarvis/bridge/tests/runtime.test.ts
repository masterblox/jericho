import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConnectorHealthStatus } from '@jericho/shared';

import { loadConfig } from '../src/config.js';
import { JerichoStore } from '../src/core/store.js';
import type { LinearSurface } from '../src/connectors/adapters/linear.js';
import {
  ConnectorPollingScheduler,
  LinearGraphqlTransport,
  createConnectorRuntime,
} from '../src/runtime.js';

const KEY = Buffer.alloc(32, 83);
const resources: Array<() => void> = [];

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
    }, []);

    const runtime = createConnectorRuntime(config, store, { workerId: 'runtime-test' });

    expect(runtime.descriptors.map((item) => item.id)).toEqual([
      'linear',
      'obsidian',
      'telegram',
    ]);
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
    expect(store.listEvents({ limit: 10 })).toContainEqual(expect.objectContaining({
      type: 'obsidian.note.snapshot',
    }));
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
