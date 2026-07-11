import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ConnectorCapability,
  ConnectorHealthStatus,
  SourceType,
  type NormalizedCapture,
} from '@jericho/shared';

import { JerichoStore } from '../src/core/store.js';
import {
  ConnectorUnauthorizedError,
  type CaptureConnector,
} from '../src/connectors/contracts.js';
import { CaptureConnectorRegistry } from '../src/connectors/registry.js';
import { ConnectorSupervisor } from '../src/connectors/supervisor.js';

const KEY = Buffer.alloc(32, 21);
const T0 = '2026-07-11T00:00:00.000Z';
const stores: JerichoStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('CaptureConnectorRegistry', () => {
  it('registers versioned connectors deterministically and rejects duplicate IDs', () => {
    const second = fakeConnector('zeta', []);
    const first = fakeConnector('alpha', []);
    const registry = new CaptureConnectorRegistry([second, first]);

    expect(registry.list().map((item) => item.descriptor.id)).toEqual(['alpha', 'zeta']);
    expect(registry.get('alpha')).toBe(first);
    expect(() => registry.register(fakeConnector('alpha', []))).toThrow(/duplicate|registered/i);
  });
});

describe('ConnectorSupervisor', () => {
  it('captures every page under one lease and atomically advances the durable cursor', async () => {
    const store = openStore();
    const connector = fakeConnector('fixture', [
      { captures: [capture('evt-1')], sequence: 1, pageToken: 'page-2', hasMore: true },
      { captures: [capture('evt-2')], sequence: 2, hasMore: false },
    ]);
    const supervisor = new ConnectorSupervisor({
      store,
      registry: new CaptureConnectorRegistry([connector]),
      workerId: 'supervisor-a',
      clock: () => T0,
      leaseMs: 30_000,
      maxPages: 10,
    });

    const result = await supervisor.sync('fixture', 'primary');

    expect(result).toMatchObject({ status: 'completed', pages: 2, captures: 2 });
    expect(store.getEvent('evt-1')).toBeDefined();
    expect(store.getEvent('evt-2')).toBeDefined();
    expect(store.getConnectorCursor('fixture', ConnectorCapability.Capture, 'primary')).toMatchObject({
      version: 2,
      sequence: 2,
    });
    expect(connector.capture).toHaveBeenNthCalledWith(2, expect.objectContaining({
      cursor: expect.objectContaining({ pageToken: 'page-2', version: 1 }),
    }));
    expect(store.listConnectorHealth()[0]).toMatchObject({
      connectorId: 'fixture',
      status: ConnectorHealthStatus.Healthy,
    });
  });

  it('accepts a terminal page that lands exactly on the configured page ceiling', async () => {
    const store = openStore();
    const connector = fakeConnector('fixture', [
      { captures: [capture('evt-at-ceiling')], sequence: 1, hasMore: false },
    ]);
    const supervisor = new ConnectorSupervisor({
      store,
      registry: new CaptureConnectorRegistry([connector]),
      workerId: 'supervisor-a',
      clock: () => T0,
      leaseMs: 30_000,
      maxPages: 1,
    });

    await expect(supervisor.sync('fixture', 'primary')).resolves.toMatchObject({
      status: 'completed',
      pages: 1,
      captures: 1,
    });
  });

  it('keeps the last committed page after a crash and resumes from its cursor', async () => {
    const store = openStore();
    let crash = true;
    const capturePage = vi.fn<CaptureConnector['capture']>().mockImplementation(async ({ cursor }) => {
      if (!cursor) return page([capture('evt-1')], 1, true, 'page-2');
      if (crash) throw new Error('simulated page crash');
      return page([capture('evt-2')], 2, false);
    });
    const connector = fakeConnector('fixture', []);
    connector.capture = capturePage;
    const supervisor = new ConnectorSupervisor({
      store, registry: new CaptureConnectorRegistry([connector]),
      workerId: 'supervisor-a', clock: () => T0, leaseMs: 30_000, maxPages: 10,
    });

    await expect(supervisor.sync('fixture', 'primary')).rejects.toThrow(/page crash/i);
    expect(store.getConnectorCursor('fixture', ConnectorCapability.Capture, 'primary')?.version).toBe(1);
    expect(store.getEvent('evt-1')).toBeDefined();
    expect(store.getEvent('evt-2')).toBeUndefined();

    crash = false;
    expect((await supervisor.sync('fixture', 'primary')).status).toBe('completed');
    expect(capturePage).toHaveBeenLastCalledWith(expect.objectContaining({
      cursor: expect.objectContaining({ pageToken: 'page-2', version: 1 }),
    }));
    expect(store.getEvent('evt-2')).toBeDefined();
  });

  it('isolates unauthorized transport failures, records health, and never advances the cursor', async () => {
    const store = openStore();
    const connector = fakeConnector('fixture', []);
    connector.capture = vi.fn<CaptureConnector['capture']>().mockRejectedValue(
      new ConnectorUnauthorizedError('fixture unauthorized'),
    );
    const supervisor = new ConnectorSupervisor({
      store, registry: new CaptureConnectorRegistry([connector]),
      workerId: 'supervisor-a', clock: () => T0, leaseMs: 30_000, maxPages: 10,
    });

    await expect(supervisor.sync('fixture', 'primary')).rejects.toThrow(/unauthorized/i);
    expect(store.getConnectorCursor('fixture', ConnectorCapability.Capture, 'primary')).toBeUndefined();
    expect(store.listConnectorHealth()[0]).toMatchObject({
      status: ConnectorHealthStatus.Unauthorized,
      capabilities: [expect.objectContaining({
        capability: ConnectorCapability.Capture,
        status: ConnectorHealthStatus.Unauthorized,
      })],
    });
  });

  it('prevents overlapping supervisors with the durable capability lease', async () => {
    const store = openStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const connector = fakeConnector('fixture', []);
    connector.capture = vi.fn<CaptureConnector['capture']>().mockImplementation(async () => {
      await gate;
      return page([], 1, false);
    });
    const registry = new CaptureConnectorRegistry([connector]);
    const first = new ConnectorSupervisor({
      store, registry, workerId: 'first', clock: () => T0, leaseMs: 30_000, maxPages: 10,
    });
    const second = new ConnectorSupervisor({
      store, registry, workerId: 'second', clock: () => T0, leaseMs: 30_000, maxPages: 10,
    });

    const running = first.sync('fixture', 'primary');
    await Promise.resolve();
    expect((await second.sync('fixture', 'primary')).status).toBe('busy');
    release();
    expect((await running).status).toBe('completed');
    expect(connector.capture).toHaveBeenCalledTimes(1);
  });
});

function openStore(): JerichoStore {
  const store = new JerichoStore({ path: ':memory:', key: KEY });
  stores.push(store);
  return store;
}

function fakeConnector(
  id: string,
  pages: Array<{ captures: NormalizedCapture[]; sequence: number; pageToken?: string; hasMore: boolean }>,
): CaptureConnector {
  let index = 0;
  return {
    descriptor: {
      id,
      adapterVersion: 1,
      cursorSchemaVersion: 1,
      partitions: ['primary'],
      maxBatchSize: 100,
    },
    probe: vi.fn<CaptureConnector['probe']>().mockResolvedValue({
      status: ConnectorHealthStatus.Healthy,
      details: {},
    }),
    capture: vi.fn<CaptureConnector['capture']>().mockImplementation(async () => {
      const value = pages[index++];
      if (!value) return page([], index, false);
      return page(value.captures, value.sequence, value.hasMore, value.pageToken);
    }),
  };
}

function page(
  captures: NormalizedCapture[],
  sequence: number,
  hasMore: boolean,
  pageToken?: string,
) {
  return {
    captures,
    failures: [],
    progress: { epoch: 1, sequence, ...(pageToken ? { pageToken } : {}) },
    hasMore,
  };
}

function capture(id: string): NormalizedCapture {
  return {
    event: {
      id,
      source: 'fixture',
      sourceType: SourceType.Connector,
      sourceEventId: id,
      type: 'fixture.event',
      occurredAt: T0,
      ingestedAt: T0,
      payload: { id },
      provenance: [{ source: 'fixture', sourceType: SourceType.Connector, sourceEventId: id, observedAt: T0 }],
    },
    identities: [],
    relations: [],
  };
}
