import { describe, expect, it, vi } from 'vitest';

import { HttpVaultGatewayClient } from '../src/vault/vault-gateway-client.js';

describe('HTTP vault gateway client', () => {
  it('authenticates exact bounded search, health, and index requests', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetchImplementation = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/health')) return Response.json({
        status: 'healthy', lastCommitAt: '2026-07-11T02:30:00.000Z', syncAgeMs: 1,
        lastIndexAt: '2026-07-11T02:00:00.000Z', indexSizeMb: 3.2,
        cachedQueries: 0, reason: 'ok',
      });
      if (url.endsWith('/search')) return Response.json({
        cached: false,
        results: [{ path: 'Today.md', title: 'Today', excerpt: 'Evidence', score: 2 }],
      });
      return Response.json({ lastIndexAt: '2026-07-11T03:00:00.000Z', indexSizeMb: 3.3 });
    });
    const client = new HttpVaultGatewayClient({
      gatewayUrl: 'https://vault.internal/base/', gatewayToken: 'secret-token',
      timeoutMs: 1_000, maxResponseBytes: 64 * 1024,
      fetch: fetchImplementation as typeof fetch,
    });
    const signal = new AbortController().signal;

    await expect(client.search('Carlos', 5, signal)).resolves.toMatchObject({ results: [{ path: 'Today.md' }] });
    await expect(client.health(signal)).resolves.toMatchObject({ status: 'healthy' });
    await expect(client.rebuildIndex(signal)).resolves.toMatchObject({ indexSizeMb: 3.3 });
    expect(requests.map(({ url, init }) => ({
      url, method: init.method, authorization: new Headers(init.headers).get('authorization'),
    }))).toEqual([
      { url: 'https://vault.internal/base/v1/jericho/vault/search', method: 'POST', authorization: 'Bearer secret-token' },
      { url: 'https://vault.internal/base/v1/jericho/vault/health', method: 'GET', authorization: 'Bearer secret-token' },
      { url: 'https://vault.internal/base/v1/jericho/vault/index', method: 'POST', authorization: 'Bearer secret-token' },
    ]);
  });

  it('rejects malformed and oversized responses without leaking the token', async () => {
    const client = new HttpVaultGatewayClient({
      gatewayUrl: 'https://vault.internal', gatewayToken: 'do-not-leak',
      timeoutMs: 1_000, maxResponseBytes: 50,
      fetch: vi.fn(async () => new Response('x'.repeat(51))) as typeof fetch,
    });

    await expect(client.search('query', 5, new AbortController().signal)).rejects.not.toThrow(/do-not-leak/);
  });
});
