import { describe, expect, it, vi } from 'vitest';

import { VaultMaintenanceScheduler } from '../src/retention/vault-maintenance.js';

describe('vault maintenance scheduler', () => {
  it('rebuilds once when a healthy newer commit appears inside the UTC window', async () => {
    const rebuildIndex = vi.fn(async () => ({
      lastIndexAt: '2026-07-11T03:00:00.000Z', indexSizeMb: 3,
    }));
    const scheduler = new VaultMaintenanceScheduler({
      gateway: {
        search: async () => ({ cached: false, results: [] }),
        health: async () => ({
          status: 'healthy', lastCommitAt: '2026-07-11T02:30:00.000Z',
          syncAgeMs: 30 * 60_000, lastIndexAt: '2026-07-10T03:00:00.000Z',
          indexSizeMb: 2, cachedQueries: 1, reason: 'ok',
        }),
        rebuildIndex,
      },
      intervalMs: 10 * 60_000,
      windowStartUtcHour: 1,
      windowEndUtcHour: 5,
      clock: () => '2026-07-11T03:00:00.000Z',
    });

    await expect(scheduler.runOnce()).resolves.toEqual({ status: 'rebuilt' });
    expect(rebuildIndex).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['outside_window', '2026-07-11T06:00:00.000Z', 'healthy', '2026-07-11T02:30:00.000Z', '2026-07-10T03:00:00.000Z'],
    ['sync_unhealthy', '2026-07-11T03:00:00.000Z', 'degraded', '2026-07-11T00:00:00.000Z', '2026-07-10T03:00:00.000Z'],
    ['index_current', '2026-07-11T03:00:00.000Z', 'healthy', '2026-07-11T02:30:00.000Z', '2026-07-11T02:45:00.000Z'],
  ] as const)('skips %s without rebuilding', async (status, now, healthStatus, commit, index) => {
    const rebuildIndex = vi.fn();
    const scheduler = new VaultMaintenanceScheduler({
      gateway: {
        search: async () => ({ cached: false, results: [] }),
        health: async () => ({
          status: healthStatus, lastCommitAt: commit, syncAgeMs: 0,
          lastIndexAt: index, indexSizeMb: 2, cachedQueries: 0,
          reason: healthStatus === 'healthy' ? 'ok' : 'sync_stale',
        }),
        rebuildIndex,
      },
      intervalMs: 600_000, windowStartUtcHour: 1, windowEndUtcHour: 5,
      clock: () => now,
    });

    await expect(scheduler.runOnce()).resolves.toEqual({ status });
    expect(rebuildIndex).not.toHaveBeenCalled();
  });

  it('does not overlap runs and aborts/awaits in-flight work on stop', async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    const health = vi.fn(async (signal: AbortSignal) => {
      observedSignal = signal;
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      throw signal.reason;
    });
    const scheduler = new VaultMaintenanceScheduler({
      gateway: { search: async () => ({ cached: false, results: [] }), health, rebuildIndex: vi.fn() },
      intervalMs: 600_000, windowStartUtcHour: 1, windowEndUtcHour: 5,
      clock: () => '2026-07-11T03:00:00.000Z',
    });

    const start = scheduler.start();
    await Promise.resolve();
    expect(health).toHaveBeenCalledTimes(1);
    const stop = scheduler.stop();
    await stop;
    await start;
    expect(observedSignal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(health).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('treats an unavailable gateway as non-fatal maintenance health', async () => {
    const scheduler = new VaultMaintenanceScheduler({
      gateway: {
        search: async () => ({ cached: false, results: [] }),
        health: async () => { throw new Error('gateway offline'); },
        rebuildIndex: vi.fn(),
      },
      intervalMs: 600_000, windowStartUtcHour: 1, windowEndUtcHour: 5,
      clock: () => '2026-07-11T03:00:00.000Z',
    });

    await expect(scheduler.runOnce()).resolves.toEqual({ status: 'sync_unhealthy' });
  });
});
