import { afterEach, describe, expect, it, vi } from 'vitest';
import { request as httpRequest } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ConnectorCapability,
  SourceType,
  type EventEnvelope,
  type NormalizedCapture,
} from '@jericho/shared';

import { loadApiToken, loadConfig } from '../src/config.js';
import { JerichoStore } from '../src/core/store.js';
import { createJerichoServer } from '../src/server.js';

const KEY = Buffer.alloc(32, 71);
const TOKEN = 'local-api-token';
const T0 = '2026-07-11T00:00:00.000Z';
const T1 = '2026-07-11T00:01:00.000Z';
const stores: JerichoStore[] = [];
const directories: string[] = [];
const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('runtime config', () => {
  it('boots without Gemini and honors CLI > CONDUCTOR_PORT > PORT > default including port zero', () => {
    expect(loadConfig({
      JERICHO_API_TOKEN: TOKEN,
      CONDUCTOR_PORT: '4100',
      PORT: '4200',
      JERICHO_TELEGRAM_GATEWAY_URL: 'https://hermes.internal',
      JERICHO_TELEGRAM_GATEWAY_TOKEN: 'gateway-token',
      LINEAR_API_KEY: 'linear-token',
      JERICHO_GIT_REPOSITORIES: '[{"id":"jericho","path":"/repos/jericho"}]',
      JERICHO_GITHUB_REPOSITORIES: 'masterblox/jericho, masterblox/hermes',
      JERICHO_CONDUCTOR_ROOTS: '[{"id":"workspaces","path":"/workspaces"}]',
      JERICHO_OBSIDIAN_VAULT: '/vault',
      JERICHO_ALLOWED_ORIGINS: 'http://localhost:5173',
      JERICHO_CONNECTOR_POLL_INTERVAL_MS: '15000',
    }, ['--port', '0'])).toMatchObject({
      port: 0,
      geminiApiKey: undefined,
      telegramGatewayUrl: 'https://hermes.internal',
      telegramGatewayToken: 'gateway-token',
      linearApiKey: 'linear-token',
      gitRepositories: [{ id: 'jericho', path: '/repos/jericho' }],
      githubRepositories: ['masterblox/jericho', 'masterblox/hermes'],
      conductorRoots: [{ id: 'workspaces', path: '/workspaces' }],
      obsidianVaultPath: '/vault',
      allowedOrigins: ['http://localhost:5173'],
      connectorPollIntervalMs: 15_000,
    });
    expect(loadConfig({ JERICHO_API_TOKEN: TOKEN, CONDUCTOR_PORT: '4100', PORT: '4200' }, [])).toMatchObject({ port: 4100 });
    expect(loadConfig({ JERICHO_API_TOKEN: TOKEN, PORT: '4200' }, [])).toMatchObject({ port: 4200 });
    expect(loadConfig({ JERICHO_API_TOKEN: TOKEN }, [])).toMatchObject({ port: 8787, host: '127.0.0.1' });
    expect(() => loadConfig({
      JERICHO_API_TOKEN: TOKEN,
      JERICHO_GIT_REPOSITORIES: '{"jericho":"/repos/jericho"}',
    }, [])).toThrow(/JERICHO_GIT_REPOSITORIES/);
  });
});

describe('local API credential', () => {
  it('prefers an explicit environment token without consulting Keychain', () => {
    const runSecurityCommand = vi.fn();

    expect(loadApiToken({
      environment: { JERICHO_API_TOKEN: TOKEN },
      platform: 'darwin',
      runSecurityCommand,
    })).toBe(TOKEN);
    expect(runSecurityCommand).not.toHaveBeenCalled();
  });

  it('generates a missing macOS Keychain token and passes it only over stdin', () => {
    const generated = Buffer.alloc(32, 89).toString('base64url');
    const calls: Array<{ args: readonly string[]; input?: string }> = [];
    let persisted: string | undefined;

    const token = loadApiToken({
      environment: {},
      platform: 'darwin',
      username: 'test-user',
      generateToken: () => generated,
      runSecurityCommand: (args, input) => {
        calls.push({ args, input });
        if (args[0] === 'find-generic-password') {
          if (!persisted) throw Object.assign(new Error('item not found'), { status: 44 });
          return `${persisted}\n`;
        }
        persisted = input?.trim();
        return '';
      },
    });

    expect(token).toBe(generated);
    expect(calls[1]).toEqual({
      args: [
        'add-generic-password',
        '-s',
        'jericho-core-api',
        '-a',
        'test-user',
        '-w',
      ],
      input: `${generated}\n`,
    });
    expect(calls[1].args).not.toContain(generated);
  });

  it('fails closed off macOS when no token is configured', () => {
    expect(() => loadApiToken({ environment: {}, platform: 'linux' }))
      .toThrow('Set JERICHO_API_TOKEN');
  });
});

describe('authenticated local Core HTTP/SSE server', () => {
  it('enforces bearer, Host, Origin, security headers, and reports optional voice unavailable', async () => {
    const runtime = await startServer();
    expect((await fetch(`${runtime.url}/api/v1/health`)).status).toBe(401);
    const evilOrigin = await fetch(`${runtime.url}/api/v1/health`, {
      headers: { authorization: `Bearer ${TOKEN}`, origin: 'https://evil.example' },
    });
    expect(evilOrigin.status).toBe(403);
    expect((await rawRequest(runtime.port, '/api/v1/health', {
      host: 'evil.example', authorization: `Bearer ${TOKEN}`,
    })).status).toBe(421);

    const response = await api(runtime.url, '/api/v1/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, voice: { status: 'unavailable' } });
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('issues a per-process HttpOnly strict session cookie for same-origin browser API and SSE use', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'jericho-browser-session-'));
    directories.push(directory);
    writeFileSync(join(directory, 'index.html'), '<main>Jericho browser</main>');
    const runtime = await startServer({ frontendDir: directory });

    const index = await fetch(`${runtime.url}/`);
    const cookie = index.headers.get('set-cookie');
    expect(cookie).toMatch(/^jericho_session=[^;]+; Path=\/; HttpOnly; SameSite=Strict$/);
    expect(index.headers.get('cache-control')).toBe('no-store');
    expect(await index.text()).not.toContain(TOKEN);
    const cookieHeader = cookie!.split(';', 1)[0];

    const health = await fetch(`${runtime.url}/api/v1/health`, {
      headers: { cookie: cookieHeader },
    });
    expect(health.status).toBe(200);
    expect((await fetch(`${runtime.url}/api/v1/command-center`, {
      headers: { cookie: cookieHeader },
    })).status).toBe(200);
    const eventController = new AbortController();
    const events = await fetch(`${runtime.url}/api/v1/events`, {
      headers: { cookie: cookieHeader },
      signal: eventController.signal,
    });
    expect(events.status).toBe(200);
    eventController.abort();
    expect((await fetch(`${runtime.url}/api/v1/health`, {
      headers: { cookie: cookieHeader, origin: 'https://evil.example' },
    })).status).toBe(403);
  });

  it('serves command-center/connectors/captures/search and invokes connector sync through injected ports', async () => {
    const sync = vi.fn().mockResolvedValue({ status: 'completed', pages: 1, captures: 0, failures: 0 });
    const search = vi.fn().mockResolvedValue([{ path: 'Project.md', title: 'Project', excerpt: 'match' }]);
    const runtime = await startServer({
      supervisor: { sync },
      connectorDescriptors: [{ id: 'fixture', partitions: ['primary'] }],
      obsidianSearch: { search },
    });

    expect((await apiJson(runtime.url, '/api/v1/command-center'))).toMatchObject({
      missions: [], proposals: [], connectors: [],
    });
    expect((await apiJson(runtime.url, '/api/v1/connectors'))).toMatchObject({
      connectors: [{ id: 'fixture', partitions: ['primary'] }],
    });
    const syncResponse = await api(runtime.url, '/api/v1/connectors/fixture/sync', {
      method: 'POST', body: JSON.stringify({ partition: 'primary' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(syncResponse.status).toBe(200);
    expect(sync).toHaveBeenCalledWith('fixture', 'primary', expect.any(AbortSignal));
    expect((await apiJson(runtime.url, '/api/v1/captures')).events).toEqual([]);
    expect(await apiJson(runtime.url, '/api/v1/obsidian/search?q=project&limit=5')).toEqual({
      results: [{ path: 'Project.md', title: 'Project', excerpt: 'match' }],
    });
  });

  it('streams resumable change-log events, signals cursor gaps, and delivers live captures', async () => {
    const runtime = await startServer();
    commitCapture(runtime.store, 'event-1', 0, 1);

    const resumed = await openSse(runtime.url, '0');
    const resumedBody = await readUntil(resumed.reader, 'event: change');
    expect(resumedBody).toMatch(/id: 1[\s\S]*event: change/);
    const deliveredIds = [...resumedBody.matchAll(/^id: (\d+)$/gm)].map((match) => match[1]);
    expect(new Set(deliveredIds).size).toBe(deliveredIds.length);
    resumed.abort();

    const gap = await openSse(runtime.url, '999');
    expect(await readUntil(gap.reader, 'event: gap')).toMatch(/event: gap[\s\S]*refetch/);
    gap.abort();

    const latest = runtime.store.listChangeLog({ afterSequence: 0 }).at(-1)!.sequence;
    const live = await openSse(runtime.url, String(latest));
    commitCapture(runtime.store, 'event-2', 1, 2);
    expect(await readUntil(live.reader, 'event: change')).toContain('event-2');
    live.abort();
  });

  it('accepts bounded local captures, strips caller authority, persists idempotently, and streams the change', async () => {
    let now = T0;
    const runtime = await startServer({ clock: () => now });
    const live = await openSse(runtime.url, '0');
    const body = {
      kind: 'spoken',
      sourceEventId: 'utterance-42',
      occurredAt: T0,
      payload: { transcript: 'Show today’s priorities' },
    };
    const created = await api(runtime.url, '/api/v1/captures', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json() as any;
    expect(createdBody).toMatchObject({ inserted: true, event: {
      source: 'local:spoken', sourceEventId: 'utterance-42',
      type: 'local.capture.spoken', payload: body.payload,
    } });
    expect(await readUntil(live.reader, 'event: change')).toContain(createdBody.event.id);
    live.abort();

    now = T1;
    const replay = await api(runtime.url, '/api/v1/captures', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ inserted: false, event: { id: createdBody.event.id } });
    expect(runtime.store.listChangeLog({ afterSequence: 0 })).toHaveLength(1);
    expect((await apiJson(runtime.url, '/api/v1/captures')).events).toContainEqual(
      expect.objectContaining({ id: createdBody.event.id }),
    );

    const authority = await api(runtime.url, '/api/v1/captures', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, sourceEventId: 'authority', status: 'approved' }),
    });
    expect(authority.status).toBe(400);
    expect(runtime.store.listEvents({ limit: 10 })).toHaveLength(1);
  });

  it('returns typed client errors instead of 500 for malformed, oversized, bounded, and unknown requests', async () => {
    const sync = vi.fn().mockResolvedValue({ status: 'completed' });
    const runtime = await startServer({
      supervisor: { sync },
      connectorDescriptors: [{ id: 'fixture', partitions: ['primary'] }],
    });
    expect((await api(runtime.url, '/api/v1/connectors/fixture/sync', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
    })).status).toBe(400);
    expect((await api(runtime.url, '/api/v1/connectors/fixture/sync', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(70_000) }),
    })).status).toBe(413);
    expect((await api(runtime.url, '/api/v1/captures?limit=wrong')).status).toBe(400);
    expect((await api(runtime.url, '/api/v1/connectors/missing/sync', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).status).toBe(404);
    expect((await api(runtime.url, '/api/v1/connectors/fixture/sync', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ partition: 'wrong' }),
    })).status).toBe(400);
    expect(sync).not.toHaveBeenCalled();
  });

  it('uses the true change-log tail beyond 10k entries without a false retention gap', async () => {
    const runtime = await startServer({ clock: () => T0 });
    for (let index = 1; index <= 10_002; index += 1) {
      runtime.store.commitLocalCapture(localEvent(index));
    }
    expect(runtime.store.getLatestChangeSequence()).toBe(10_002);
    expect(await apiJson(runtime.url, '/api/v1/command-center')).toMatchObject({
      lastChangeSequence: 10_002,
    });
    const tail = await openSse(runtime.url, '10001');
    const body = await readUntil(tail.reader, 'event: change');
    expect(body).toMatch(/id: 10002/);
    expect(body).not.toContain('event: gap');
    tail.abort();
  }, 30_000);

  it('serves an SPA without traversal outside frontend/dist', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'jericho-frontend-'));
    directories.push(directory);
    const frontend = join(directory, 'dist');
    mkdirSync(frontend);
    writeFileSync(join(frontend, 'index.html'), '<main>Jericho</main>');
    writeFileSync(join(directory, 'secret.txt'), 'outside-secret');
    symlinkSync(join(directory, 'secret.txt'), join(frontend, 'escaped.txt'));
    const runtime = await startServer({ frontendDir: frontend });

    expect(await (await fetch(`${runtime.url}/`)).text()).toContain('Jericho');
    const traversal = await fetch(`${runtime.url}/%2e%2e/secret.txt`);
    expect([400, 404]).toContain(traversal.status);
    expect(await traversal.text()).not.toContain('outside-secret');
    const symlink = await fetch(`${runtime.url}/escaped.txt`);
    expect([400, 404]).toContain(symlink.status);
    expect(await symlink.text()).not.toContain('outside-secret');
  });
});

interface StartOverrides {
  supervisor?: { sync: ReturnType<typeof vi.fn> };
  connectorDescriptors?: Array<{ id: string; partitions: string[] }>;
  obsidianSearch?: { search: ReturnType<typeof vi.fn> };
  frontendDir?: string;
  clock?: () => string;
}

function localEvent(index: number): EventEnvelope {
  return {
    id: `local-event-${index}`,
    source: 'local:manual',
    sourceType: SourceType.User,
    sourceEventId: `manual-${index}`,
    type: 'local.capture.manual',
    occurredAt: T0,
    ingestedAt: T0,
    payload: { index },
    provenance: [{
      source: 'local:manual', sourceType: SourceType.User,
      sourceEventId: `manual-${index}`, observedAt: T0,
    }],
  };
}

async function startServer(overrides: StartOverrides = {}) {
  const store = new JerichoStore({ path: ':memory:', key: KEY });
  stores.push(store);
  const server = createJerichoServer({
    store,
    apiToken: TOKEN,
    host: '127.0.0.1',
    allowedOrigins: [],
    geminiApiKey: undefined,
    ssePollMs: 10,
    ...overrides,
  });
  servers.push(server);
  const address = await server.listen(0);
  return {
    store,
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
  };
}

function api(url: string, path: string, init: RequestInit = {}) {
  return fetch(`${url}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(init.headers ?? {}),
    },
  });
}

async function apiJson(url: string, path: string) {
  return (await api(url, path)).json() as Promise<any>;
}

function rawRequest(port: number, path: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port, path, headers }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on('error', reject);
    request.end();
  });
}

async function openSse(url: string, lastEventId: string) {
  const controller = new AbortController();
  const response = await api(url, '/api/v1/events', {
    headers: { 'last-event-id': lastEventId },
    signal: controller.signal,
  });
  expect(response.status).toBe(200);
  return { reader: response.body!.getReader(), abort: () => controller.abort() };
}

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, marker: string): Promise<string> {
  const decoder = new TextDecoder();
  let value = '';
  const deadline = Date.now() + 2_000;
  while (!value.includes(marker) && Date.now() < deadline) {
    const chunk = await reader.read();
    if (chunk.done) break;
    value += decoder.decode(chunk.value, { stream: true });
  }
  return value;
}

function commitCapture(store: JerichoStore, eventId: string, expectedVersion: number, nextVersion: number): void {
  const now = new Date(Date.parse(T0) + nextVersion * 1_000).toISOString();
  const lease = store.acquireConnectorLease({
    connectorId: 'fixture', capability: ConnectorCapability.Capture,
    ownerId: `test-${eventId}`, now, leaseMs: 10_000,
  });
  const existingLease = lease ?? (() => { throw new Error('test lease unavailable'); })();
  const capture: NormalizedCapture = {
    event: {
      id: eventId, source: 'fixture', sourceType: SourceType.Connector,
      sourceEventId: eventId, type: 'fixture.event', occurredAt: now, ingestedAt: now,
      payload: { eventId },
      provenance: [{ source: 'fixture', sourceType: SourceType.Connector, sourceEventId: eventId, observedAt: now }],
    },
    identities: [], relations: [],
  };
  store.commitCaptureBatch({
    connectorId: 'fixture', capability: ConnectorCapability.Capture,
    partition: 'primary', expectedCursorVersion: expectedVersion,
    nextCursor: {
      connectorId: 'fixture', capability: ConnectorCapability.Capture,
      partition: 'primary', epoch: 1, sequence: nextVersion,
      version: nextVersion, updatedAt: now,
    },
    captures: [capture], leaseToken: existingLease.leaseToken, committedAt: now,
  });
  store.releaseConnectorLease(existingLease.id, existingLease.leaseToken);
}
