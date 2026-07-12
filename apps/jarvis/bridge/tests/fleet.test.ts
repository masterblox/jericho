import { describe, expect, it, vi } from 'vitest';

import { PaperclipFleetClient } from '../src/fleet/paperclip-client.js';

const AGENTS = [
  {
    id: 'a-1', name: 'Angela', role: 'operations', status: 'idle',
    lastHeartbeatAt: '2026-07-12T00:00:00.000Z', adapterConfig: { apiKey: 'must-not-leak' },
  },
  { id: 42, name: 'Bogus' }, // malformed entries are dropped, not thrown
];

const ISSUES = [
  {
    id: 'i-1', identifier: 'MAS-511', title: 'Paperclip host recovery', status: 'in_progress',
    priority: 'high', assigneeAgentId: 'a-1',
    createdAt: '2026-07-01T00:00:00.000Z', completedAt: null,
  },
  { id: 'i-2', title: 'No identifier falls back to id', status: 'queued' },
];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}

function client(fetchImpl: typeof fetch, now: () => number) {
  return new PaperclipFleetClient({
    apiUrl: 'http://paperclip.local/',
    apiKey: 'jer_test',
    companyId: 'c-1',
    fetchImpl,
    now,
  });
}

describe('PaperclipFleetClient', () => {
  it('normalizes agents and issues to the narrow projection and caches the result', async () => {
    let clock = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      expect(url.startsWith('http://paperclip.local/api/companies/c-1/')).toBe(true);
      return url.includes('/agents') ? jsonResponse(AGENTS) : jsonResponse(ISSUES);
    }) as unknown as typeof fetch;
    const fleet = client(fetchImpl, () => clock);

    const snapshot = await fleet.snapshot();
    expect(snapshot).toEqual({
      available: true,
      agents: [{
        id: 'a-1', name: 'Angela', role: 'operations', status: 'idle',
        lastHeartbeatAt: '2026-07-12T00:00:00.000Z',
      }],
      issues: [
        {
          id: 'i-1', identifier: 'MAS-511', title: 'Paperclip host recovery',
          status: 'in_progress', priority: 'high', assigneeAgentId: 'a-1',
          createdAt: '2026-07-01T00:00:00.000Z', completedAt: null,
        },
        {
          id: 'i-2', identifier: 'i-2', title: 'No identifier falls back to id',
          status: 'queued', priority: null, assigneeAgentId: null,
          createdAt: null, completedAt: null,
        },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toContain('must-not-leak');

    clock = 10_000; // inside the 20s success TTL: served from cache
    await fleet.snapshot();
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(2);

    clock = 30_000; // past the TTL: refreshes
    await fleet.snapshot();
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(4);
  });

  it('fails closed on upstream errors and retries after the short failure TTL', async () => {
    let clock = 0;
    let healthy = false;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (!healthy) return new Response('{"error":"Unauthorized"}', { status: 401 });
      return String(input).includes('/agents') ? jsonResponse(AGENTS) : jsonResponse(ISSUES);
    }) as unknown as typeof fetch;
    const fleet = client(fetchImpl, () => clock);

    expect(await fleet.snapshot()).toEqual({ available: false, agents: [], issues: [] });

    clock = 2_000; // inside the 5s failure TTL: cached failure, no hammering
    await fleet.snapshot();
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(2);

    healthy = true;
    clock = 6_000; // past the failure TTL: recovers
    expect((await fleet.snapshot()).available).toBe(true);
  });
});
