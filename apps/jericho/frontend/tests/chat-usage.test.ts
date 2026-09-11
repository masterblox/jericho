import { ConnectorHealthStatus, type CommandCenterSnapshot } from '@jericho/shared';
import { describe, expect, it } from 'vitest';

import { coreUsageMeter, formatUsdFromMicro } from '../src/chat-usage';
import { emptySnapshot } from './fixtures/command-center';

describe('coreUsageMeter', () => {
  it('formats Core mission spend and connector health without invented totals', () => {
    const snapshot = {
      ...emptySnapshot,
      missions: [{
        budget: {
          limits: { maxCostMicroUsd: 100_000_000, maxRuntimeMs: 1, maxConcurrency: 1, maxRetriesPerAssignment: 1 },
          plannedCostMicroUsd: 0,
          recordedEstimatedCostMicroUsd: 0,
          actualCostMicroUsd: 48_200_000,
          elapsedRuntimeMs: 0,
          activeAssignments: 0,
          assignmentAttempts: 0,
        },
      }],
      connectors: [
        { status: ConnectorHealthStatus.Healthy },
        { status: ConnectorHealthStatus.Unavailable },
      ],
    } as CommandCenterSnapshot;

    const meter = coreUsageMeter(snapshot, undefined);
    expect(meter.spentLabel).toBe('$48.20');
    expect(meter.capLabel).toBe('$100.00');
    expect(meter.ratio).toBeCloseTo(0.482);
    expect(meter.connectorLabel).toBe('1/2 connectors healthy');
    expect(formatUsdFromMicro(0)).toBe('$0.00');
  });

  it('falls back to health connectors when the snapshot has none', () => {
    const meter = coreUsageMeter(emptySnapshot, {
      ok: true,
      startup: { storage: 'persistent', database: '~/.jericho/jericho.db', initializedNewCore: false },
      connectors: [{ connectorId: 'obsidian', status: 'healthy' }],
      vault: { ready: true },
      voice: { status: 'available' },
    });
    expect(meter.connectorLabel).toBe('1/1 connectors healthy');
    expect(meter.spentLabel).toBe('$0.00');
  });
});
