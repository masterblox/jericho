import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdentityReviewDisposition, RelationType } from '@jericho/shared';

import { CommandCenterStore } from '../src/command-center-store';
import { CoreClient, type EventSourcePort } from '../src/core-client';
import { snapshot } from './fixtures/command-center';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CoreClient', () => {
  it('loads the typed startup health payload from the authenticated Core', async () => {
    const payload = { ok: true, startup: { storage: 'persistent', database: '~/.jericho/jericho.db', initializedNewCore: false }, connectors: [], vault: { ready: true }, voice: { status: 'available' } };
    const fetchPort = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    const client = new CoreClient(new CommandCenterStore(), { fetch: fetchPort as typeof fetch });
    await expect(client.health()).resolves.toEqual(payload);
    expect(fetchPort).toHaveBeenCalledWith('/api/v1/health', expect.objectContaining({ credentials: 'same-origin' }));
  });
  it('preserves the browser receiver when using native same-origin fetch', async () => {
    const nativeLikeFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(new Response(JSON.stringify(snapshot()), { status: 200 }));
    });
    vi.stubGlobal('fetch', nativeLikeFetch);
    const store = new CommandCenterStore();
    const client = new CoreClient(store, { createEventSource: () => new FakeEventSource() });

    await client.start();
    expect(store.getSnapshot().status).toBe('ready');
    client.stop();
  });

  it('uses the same-origin session cookie, follows ordered SSE revisions, refetches gaps, and disconnects cleanly', async () => {
    const responses = [
      snapshot({ lastChangeSequence: 1 }),
      snapshot({ lastChangeSequence: 2 }),
      snapshot({ lastChangeSequence: 9 }),
    ];
    const fetchPort = vi.fn(async () => new Response(JSON.stringify(responses.shift()), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const source = new FakeEventSource();
    const store = new CommandCenterStore();
    const client = new CoreClient(store, {
      fetch: fetchPort as typeof fetch,
      createEventSource: () => source,
    });

    await client.start();
    expect(fetchPort).toHaveBeenNthCalledWith(1, '/api/v1/command-center', expect.objectContaining({
      credentials: 'same-origin', headers: { accept: 'application/json' },
    }));
    expect(JSON.stringify(fetchPort.mock.calls)).not.toContain('Authorization');
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', snapshot: { lastChangeSequence: 1 } });

    source.emit('change', { sequence: 2 });
    await vi.waitFor(() => expect(store.getSnapshot().snapshot?.lastChangeSequence).toBe(2));
    source.emit('gap', { latest: 9, refetch: '/api/v1/command-center' });
    await vi.waitFor(() => expect(store.getSnapshot().snapshot?.lastChangeSequence).toBe(9));
    expect(fetchPort).toHaveBeenCalledTimes(3);

    source.fail();
    expect(store.getSnapshot().status).toBe('disconnected');
    client.stop();
    expect(source.closed).toBe(true);
  });

  it('posts exact mission hash/version decisions without performing external actions', async () => {
    const fetchPort = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot({ lastChangeSequence: 1 })), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ decisionId: 'decision-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot({ lastChangeSequence: 2 })), { status: 200 }));
    const client = new CoreClient(new CommandCenterStore(), {
      fetch: fetchPort as typeof fetch,
      createEventSource: () => new FakeEventSource(),
    });
    await client.start();

    await client.decideMission({
      missionId: 'mission-1', planHash: 'a'.repeat(64), version: 3,
      outcome: 'approved', reason: 'Scope checked',
    });

    expect(fetchPort).toHaveBeenNthCalledWith(
      2,
      '/api/v1/missions/mission-1/decisions',
      expect.objectContaining({
        method: 'POST', credentials: 'same-origin',
        body: JSON.stringify({
          planHash: 'a'.repeat(64), version: 3,
          outcome: 'approved', reason: 'Scope checked',
        }),
      }),
    );
    expect(JSON.stringify(fetchPort.mock.calls[1])).not.toMatch(/send|deploy|execute/i);
  });

  it('uses bounded Core endpoints for cancellation, retention, and relationship proposals', async () => {
    const next = snapshot({ lastChangeSequence: 7 });
    const fetchPort = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ snapshot: next }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        relativePath: 'Jericho/Missions/mission-1.md', status: 'created',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot({ lastChangeSequence: 8 })), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ snapshot: next }), { status: 201 }));
    const store = new CommandCenterStore();
    const client = new CoreClient(store, { fetch: fetchPort as typeof fetch });

    await client.cancelMission({
      missionId: 'mission-1', planHash: 'a'.repeat(64), version: 2,
      reason: 'Both palms held to stop the selected mission',
    });
    expect(fetchPort).toHaveBeenNthCalledWith(1, '/api/v1/missions/mission-1/cancel', expect.objectContaining({
      method: 'POST', credentials: 'same-origin',
      body: JSON.stringify({
        planHash: 'a'.repeat(64), version: 2,
        reason: 'Both palms held to stop the selected mission',
      }),
    }));
    expect(store.getSnapshot().snapshot?.lastChangeSequence).toBe(7);

    await expect(client.retainMission('mission-1')).resolves.toEqual({
      relativePath: 'Jericho/Missions/mission-1.md', status: 'created',
    });
    expect(store.getSnapshot().snapshot?.lastChangeSequence).toBe(8);
    await client.proposeRelationship({
      fromNodeId: 'mission:1', toNodeId: 'agent:dev', relation: RelationType.AssignedTo,
    });
    expect(fetchPort).toHaveBeenNthCalledWith(4, '/api/v1/relationship-proposals', expect.objectContaining({
      method: 'POST', credentials: 'same-origin',
      body: JSON.stringify({
        fromNodeId: 'mission:1', toNodeId: 'agent:dev', relation: 'assigned_to',
      }),
    }));
  });

  it('searches Jarvis memory through the bounded same-origin Obsidian endpoint', async () => {
    const payload = {
      available: true, cached: false, count: 1,
      results: [{ path: 'People/Carlos.md', title: 'Carlos', excerpt: 'Owner context', score: 0.91 }],
    };
    const fetchPort = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));
    const client = new CoreClient(new CommandCenterStore(), { fetch: fetchPort as typeof fetch });

    await expect(client.searchVault('  Carlos strategy  ', 6)).resolves.toEqual(payload);
    expect(fetchPort).toHaveBeenCalledWith(
      '/api/v1/obsidian/search?q=Carlos+strategy&limit=6',
      { credentials: 'same-origin', headers: { accept: 'application/json' } },
    );
  });

  it('opens only a relative Obsidian note through the same-origin Core boundary', async () => {
    const fetchPort = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      relativePath: 'Projects/Fleet.md',
    }), { status: 200 }));
    const client = new CoreClient(new CommandCenterStore(), { fetch: fetchPort as typeof fetch });
    await expect(client.openVaultNote('Projects/Fleet.md')).resolves.toEqual({ relativePath: 'Projects/Fleet.md' });
    expect(fetchPort).toHaveBeenCalledWith('/api/v1/obsidian/open', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', body: JSON.stringify({ relativePath: 'Projects/Fleet.md' }),
    }));
  });

  it('posts exact review-intent and checkpoint bindings without authorizing connector work', async () => {
    const next = snapshot({ lastChangeSequence: 11 });
    const fetchPort = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ snapshot: next }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ snapshot: next }), { status: 200 }));
    const client = new CoreClient(new CommandCenterStore(), { fetch: fetchPort as typeof fetch });

    await client.decideReviewIntent({
      intentId: 'intent-review', intentHash: 'b'.repeat(64),
      disposition: 'reclassify_project', reason: 'Project scope needs a bounded plan',
    });
    await client.decideCheckpoint({
      proposalId: 'checkpoint-1', planHash: 'a'.repeat(64), version: 3,
      outcome: 'rejected', reason: 'Create a new immutable plan',
    });

    expect(fetchPort).toHaveBeenNthCalledWith(1, '/api/v1/review-intents/intent-review/decisions', expect.objectContaining({
      method: 'POST', credentials: 'same-origin',
      body: JSON.stringify({
        intentHash: 'b'.repeat(64), disposition: 'reclassify_project',
        reason: 'Project scope needs a bounded plan',
      }),
    }));
    expect(fetchPort).toHaveBeenNthCalledWith(2, '/api/v1/checkpoints/checkpoint-1/decisions', expect.objectContaining({
      method: 'POST', credentials: 'same-origin',
      body: JSON.stringify({
        planHash: 'a'.repeat(64), version: 3,
        outcome: 'rejected', reason: 'Create a new immutable plan',
      }),
    }));
    expect(JSON.stringify(fetchPort.mock.calls)).not.toMatch(/send_message|deploy|connector.*execute/i);
  });

  it('posts an exact generic proposal binding and only consumes the returned snapshot', async () => {
    const next = snapshot({ lastChangeSequence: 13 });
    const fetchPort = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ snapshot: next }), { status: 200 }),
    );
    const store = new CommandCenterStore();
    const client = new CoreClient(store, { fetch: fetchPort as typeof fetch });

    await client.decideProposal({
      proposalId: 'proposal-message',
      proposalHash: 'e'.repeat(64),
      version: 1,
      outcome: 'approved',
      reason: 'Approved draft status only; external execution still requires a bounded mission',
    });

    expect(fetchPort).toHaveBeenCalledWith(
      '/api/v1/proposals/proposal-message/decisions',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({
          proposalHash: 'e'.repeat(64),
          version: 1,
          outcome: 'approved',
          reason: 'Approved draft status only; external execution still requires a bounded mission',
        }),
      }),
    );
    expect(store.getSnapshot().snapshot?.lastChangeSequence).toBe(13);
    expect(JSON.stringify(fetchPort.mock.calls)).not.toMatch(/send_message|deploy|queue|execute/i);
  });

  it('posts an exact identity-review binding without exposing or sending a source identifier', async () => {
    const next = snapshot({ lastChangeSequence: 12 });
    const fetchPort = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ snapshot: next }), { status: 200 }),
    );
    const client = new CoreClient(new CommandCenterStore(), { fetch: fetchPort as typeof fetch });

    await client.decideIdentityReview({
      failureId: 'capture-failure-1',
      disposition: IdentityReviewDisposition.RelinkCandidate,
      reviewHash: 'c'.repeat(64),
      version: 1,
      targetEntityId: 'person-carlos',
      reason: 'Carlos selected the compatible canonical person',
    });

    expect(fetchPort).toHaveBeenCalledWith(
      '/api/v1/identity-reviews/capture-failure-1/decisions',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({
          disposition: 'relink_candidate',
          reviewHash: 'c'.repeat(64),
          version: 1,
          targetEntityId: 'person-carlos',
          reason: 'Carlos selected the compatible canonical person',
        }),
      }),
    );
    expect(JSON.stringify(fetchPort.mock.calls)).not.toMatch(/raw-private|externalId|send_message/i);
  });
});

class FakeEventSource implements EventSourcePort {
  readonly listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>();
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  close(): void { this.closed = true; }

  emit(type: string, value: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(value) } as MessageEvent<string>);
    }
  }

  fail(): void { this.onerror?.(new Event('error')); }
}
