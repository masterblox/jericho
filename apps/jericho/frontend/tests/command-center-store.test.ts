import { describe, expect, it, vi } from 'vitest';

import { CommandCenterStore } from '../src/command-center-store';
import { emptySnapshot, snapshot } from './fixtures/command-center';

describe('CommandCenterStore', () => {
  it('applies snapshots and contiguous patches in revision order and rejects stale writes', () => {
    const store = new CommandCenterStore();
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.replace(snapshot({ lastChangeSequence: 2 }))).toBe(true);
    expect(store.applyPatch({
      sequence: 3,
      patch: { today: { ...emptySnapshot.today, date: '2026-07-12' } },
    })).toBe('applied');
    expect(store.getSnapshot()).toMatchObject({
      status: 'ready',
      snapshot: { lastChangeSequence: 3, today: { date: '2026-07-12' } },
    });

    expect(store.applyPatch({ sequence: 2, patch: { approvals: [] } })).toBe('stale');
    expect(store.replace(snapshot({ lastChangeSequence: 1 }))).toBe(false);
    expect(store.getSnapshot().snapshot?.lastChangeSequence).toBe(3);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('marks revision gaps for refetch and preserves last verified data while disconnected', () => {
    const store = new CommandCenterStore();
    store.replace(snapshot({ lastChangeSequence: 4 }));

    expect(store.applyPatch({ sequence: 7, patch: { communications: [] } })).toBe('gap');
    expect(store.getSnapshot()).toMatchObject({
      status: 'loading', needsRefetch: true,
      snapshot: { lastChangeSequence: 4 },
    });
    store.disconnected('live stream unavailable');
    expect(store.getSnapshot()).toMatchObject({
      status: 'disconnected', error: 'live stream unavailable',
      snapshot: { lastChangeSequence: 4 },
    });
    store.unavailable('Core unavailable');
    expect(store.getSnapshot()).toMatchObject({
      status: 'unavailable', error: 'Core unavailable',
      snapshot: { lastChangeSequence: 4 },
    });
  });
});
