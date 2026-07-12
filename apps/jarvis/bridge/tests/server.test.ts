import { afterEach, describe, expect, it, vi } from 'vitest';
import { request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ConnectorCapability,
  ConnectorHealthStatus,
  EntityType,
  LifecycleStatus,
  MutationClass,
  RiskLevel,
  SourceType,
  type EventEnvelope,
  type NormalizedCapture,
} from '@jericho/shared';

import { loadApiToken, loadConfig } from '../src/config.js';
import { JerichoStore } from '../src/core/store.js';
import { IntakeProcessor } from '../src/orchestration/intake.js';
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
      JERICHO_WHATSAPP_GATEWAY_URL: 'https://hermes.internal/whatsapp',
      JERICHO_WHATSAPP_GATEWAY_TOKEN: 'whatsapp-gateway-token',
      JERICHO_HERMES_BUS_ROOT: '/runtime/hermes-bus',
      JERICHO_HERMES_REPO: 'jericho',
      JERICHO_HERMES_BRANCH: 'masterblox/approved',
      JERICHO_HERMES_POLL_INTERVAL_MS: '125',
      JERICHO_HERMES_MAX_WAIT_MS: '120000',
      JERICHO_MISSION_REPOSITORY_GRANTS: '[{"repository":"jericho","writablePaths":["apps/jarvis"],"mutationClasses":["reversible"]}]',
      JERICHO_REFLECTION_INTERVAL_MS: '3600000',
      LINEAR_API_KEY: 'linear-token',
      JERICHO_GIT_REPOSITORIES: '[{"id":"jericho","path":"/repos/jericho"}]',
      JERICHO_GITHUB_REPOSITORIES: 'masterblox/jericho, masterblox/hermes',
      JERICHO_CONDUCTOR_ROOTS: '[{"id":"workspaces","path":"/workspaces"}]',
      JERICHO_OBSIDIAN_VAULT: '/vault',
      JERICHO_VAULT_GATEWAY_URL: 'https://vault.internal',
      JERICHO_VAULT_GATEWAY_TOKEN: 'vault-token',
      JERICHO_VAULT_GATEWAY_TIMEOUT_MS: '12000',
      JERICHO_VAULT_CACHE_TTL_MS: '86400000',
      JERICHO_VAULT_MAINTENANCE_INTERVAL_MS: '600000',
      JERICHO_VAULT_SYNC_STALE_MS: '3600000',
      JERICHO_VAULT_REBUILD_WINDOW_START_UTC: '1',
      JERICHO_VAULT_REBUILD_WINDOW_END_UTC: '5',
      JERICHO_ALLOWED_ORIGINS: 'http://localhost:5173',
      JERICHO_CONNECTOR_POLL_INTERVAL_MS: '15000',
      JERICHO_VOICE_ACTIVE_TURN_MS: '45000',
    }, ['--port', '0'])).toMatchObject({
      port: 0,
      geminiApiKey: undefined,
      telegramGatewayUrl: 'https://hermes.internal',
      telegramGatewayToken: 'gateway-token',
      whatsappGatewayUrl: 'https://hermes.internal/whatsapp',
      whatsappGatewayToken: 'whatsapp-gateway-token',
      hermesBusRoot: '/runtime/hermes-bus',
      hermesRepo: 'jericho',
      hermesBranch: 'masterblox/approved',
      hermesPollIntervalMs: 125,
      hermesMaxWaitMs: 120_000,
      missionRepositoryGrants: [{
        repository: 'jericho',
        writablePaths: ['apps/jarvis'],
        mutationClasses: [MutationClass.Reversible],
      }],
      reflectionIntervalMs: 3_600_000,
      linearApiKey: 'linear-token',
      gitRepositories: [{ id: 'jericho', path: '/repos/jericho' }],
      githubRepositories: ['masterblox/jericho', 'masterblox/hermes'],
      conductorRoots: [{ id: 'workspaces', path: '/workspaces' }],
      obsidianVaultPath: '/vault',
      vaultGatewayUrl: 'https://vault.internal',
      vaultGatewayToken: 'vault-token',
      vaultGatewayTimeoutMs: 12_000,
      vaultCacheTtlMs: 86_400_000,
      vaultMaintenanceIntervalMs: 600_000,
      vaultSyncStaleMs: 3_600_000,
      vaultRebuildWindowStartUtc: 1,
      vaultRebuildWindowEndUtc: 5,
      allowedOrigins: ['http://localhost:5173'],
      connectorPollIntervalMs: 15_000,
      voiceActiveTurnMs: 45_000,
    });
    expect(loadConfig({ JERICHO_API_TOKEN: TOKEN, CONDUCTOR_PORT: '4100', PORT: '4200' }, [])).toMatchObject({ port: 4100 });
    expect(loadConfig({ JERICHO_API_TOKEN: TOKEN, PORT: '4200' }, [])).toMatchObject({ port: 4200 });
    const defaults = loadConfig({ JERICHO_API_TOKEN: TOKEN }, []);
    expect(defaults).toMatchObject({
      port: 8787,
      host: '127.0.0.1',
      voiceActiveTurnMs: 30_000,
      hermesPollIntervalMs: 250,
      hermesMaxWaitMs: 15 * 60_000,
      reflectionIntervalMs: 6 * 60 * 60_000,
      vaultGatewayTimeoutMs: 45_000,
      vaultCacheTtlMs: 24 * 60 * 60_000,
      vaultMaintenanceIntervalMs: 10 * 60_000,
      vaultSyncStaleMs: 60 * 60_000,
      vaultRebuildWindowStartUtc: 1,
      vaultRebuildWindowEndUtc: 5,
    });
    expect(defaults.systemInstruction).toContain('client and server voice gates');
    expect(defaults.systemInstruction).not.toMatch(
      /stay completely silent unless|unless Carlos says|say(?:s)? “?JARVIS/i,
    );
    expect(() => loadConfig({
      JERICHO_API_TOKEN: TOKEN,
      JERICHO_GIT_REPOSITORIES: '{"jericho":"/repos/jericho"}',
    }, [])).toThrow(/JERICHO_GIT_REPOSITORIES/);
    expect(() => loadConfig({
      JERICHO_API_TOKEN: TOKEN,
      JERICHO_MISSION_REPOSITORY_GRANTS: '[{"repository":"jericho","writablePaths":[],"mutationClasses":["root_access"]}]',
    }, [])).toThrow(/JERICHO_MISSION_REPOSITORY_GRANTS/);
    expect(() => loadConfig({
      JERICHO_API_TOKEN: TOKEN,
      JERICHO_VAULT_GATEWAY_URL: 'https://vault.internal',
    }, [])).toThrow(/VAULT_GATEWAY_URL.*TOKEN.*together/i);
    expect(() => loadConfig({
      JERICHO_API_TOKEN: TOKEN,
      JERICHO_VAULT_REBUILD_WINDOW_START_UTC: '5',
      JERICHO_VAULT_REBUILD_WINDOW_END_UTC: '5',
    }, [])).toThrow(/window/i);
  });

  it('fails closed when only part of the Hermes execution workspace is configured', () => {
    expect(() => loadConfig({
      JERICHO_API_TOKEN: TOKEN,
      JERICHO_HERMES_BUS_ROOT: '/runtime/hermes-bus',
      JERICHO_HERMES_REPO: 'jericho',
    }, [])).toThrow(/JERICHO_HERMES_(?:BUS_ROOT|REPO|BRANCH).*together/i);

    expect(() => loadConfig({
      JERICHO_API_TOKEN: TOKEN,
      JERICHO_HERMES_BRANCH: 'masterblox/approved',
    }, [])).toThrow(/JERICHO_HERMES_(?:BUS_ROOT|REPO|BRANCH).*together/i);

    expect(() => loadConfig({
      JERICHO_API_TOKEN: TOKEN,
      JERICHO_HERMES_BUS_ROOT: '/runtime/hermes-bus',
      JERICHO_HERMES_REPO: 'jericho',
      JERICHO_HERMES_BRANCH: 'masterblox/approved',
      JERICHO_HERMES_POLL_INTERVAL_MS: '100',
      JERICHO_HERMES_MAX_WAIT_MS: '99',
    }, [])).toThrow(/JERICHO_HERMES_MAX_WAIT_MS.*POLL_INTERVAL/i);
  });
});

describe('production Core composition', () => {
  it('boots with legacy Hermes execution disabled and exposes fail-closed health', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jericho-production-main-'));
    directories.push(root);
    const home = join(root, 'home');
    const vault = join(root, 'vault');
    const busRoot = join(root, 'hermes-bus');
    mkdirSync(home, { recursive: true });
    mkdirSync(vault, { recursive: true });
    const bridgeRoot = new URL('..', import.meta.url);
    const cli = new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url);
    const entrypoint = new URL('../src/server.ts', import.meta.url);
    const child = spawn(process.execPath, [cli.pathname, entrypoint.pathname], {
      cwd: bridgeRoot.pathname,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HOME: home,
        JERICHO_API_TOKEN: TOKEN,
        JERICHO_MASTER_KEY: Buffer.alloc(32, 17).toString('base64'),
        CONDUCTOR_PORT: '0',
        GEMINI_API_KEY: '',
        JERICHO_TELEGRAM_GATEWAY_URL: '',
        JERICHO_TELEGRAM_GATEWAY_TOKEN: '',
        JERICHO_WHATSAPP_GATEWAY_URL: '',
        JERICHO_WHATSAPP_GATEWAY_TOKEN: '',
        LINEAR_API_KEY: '',
        JERICHO_GIT_REPOSITORIES: '[]',
        JERICHO_GITHUB_REPOSITORIES: '',
        JERICHO_CONDUCTOR_ROOTS: '[]',
        JERICHO_OBSIDIAN_VAULT: vault,
        JERICHO_HERMES_BUS_ROOT: busRoot,
        JERICHO_HERMES_REPO: 'jericho',
        JERICHO_HERMES_BRANCH: 'masterblox/approved',
        JERICHO_HERMES_POLL_INTERVAL_MS: '10',
        JERICHO_HERMES_MAX_WAIT_MS: '100',
        JERICHO_REFLECTION_INTERVAL_MS: '60000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const closeChild = async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) resolve();
        else child.once('exit', () => resolve());
      });
    };
    servers.push({ close: closeChild });

    const listeningUrl = await childListeningUrl(child);
    const reflected = await fetch(`${listeningUrl}/api/v1/reflection/run`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(reflected.status).toBe(200);
    expect(await reflected.json()).toEqual({ proposals: [] });
    const health = await fetch(`${listeningUrl}/api/v1/health`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(health.status).toBe(200);
    const healthBody = await health.json() as { ok: boolean; connectors: unknown[] };
    expect(healthBody.ok).toBe(true);
    expect(healthBody.connectors).toEqual(expect.arrayContaining([expect.objectContaining({
        connectorId: 'hermes-execution',
        status: ConnectorHealthStatus.Unavailable,
        details: { reason: 'missing_manifest', executable: false, protocolVersion: 1 },
      })]));
    expect(existsSync(join(busRoot, 'outbox'))).toBe(false);
    expect(existsSync(join(busRoot, 'inbox'))).toBe(false);
    await closeChild();
    expect(child.exitCode).toBe(0);
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

  it('requires bearer bootstrap before issuing an HttpOnly strict browser session', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'jericho-browser-session-'));
    directories.push(directory);
    writeFileSync(join(directory, 'index.html'), '<main>Jericho browser</main>');
    const runtime = await startServer({ frontendDir: directory });

    const index = await fetch(`${runtime.url}/`);
    expect(index.headers.get('set-cookie')).toBeNull();
    expect(index.headers.get('cache-control')).toBe('no-store');
    expect(await index.text()).not.toContain(TOKEN);

    const unauthenticated = await fetch(`${runtime.url}/api/v1/session`, {
      method: 'POST',
    });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get('set-cookie')).toBeNull();

    const bootstrap = await api(runtime.url, '/api/v1/session', { method: 'POST' });
    expect(bootstrap.status).toBe(204);
    const cookie = bootstrap.headers.get('set-cookie');
    expect(cookie).toMatch(/^jericho_session=[^;]+; Path=\/; HttpOnly; SameSite=Strict$/);
    expect(await bootstrap.text()).toBe('');
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

  it('grants the operator bootstrap URL exactly once without exposing its secret', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'jericho-operator-bootstrap-'));
    directories.push(directory);
    writeFileSync(join(directory, 'index.html'), '<main>Jericho operator</main>');
    const runtime = await startServer({ frontendDir: directory });
    const bootstrap = new URL(runtime.bootstrapUrl);
    const nonce = bootstrap.pathname.split('/').at(-1)!;

    const index = await fetch(`${runtime.url}/`);
    expect(await index.text()).not.toContain(nonce);
    expect(index.headers.get('set-cookie')).toBeNull();
    const health = await api(runtime.url, '/api/v1/health');
    expect(await health.text()).not.toContain(nonce);

    const wrong = await fetch(`${runtime.url}/.jericho/bootstrap/not-the-secret`, {
      redirect: 'manual',
    });
    expect(wrong.status).toBe(404);
    expect(wrong.headers.get('set-cookie')).toBeNull();

    const granted = await fetch(runtime.bootstrapUrl, { redirect: 'manual' });
    expect(granted.status).toBe(303);
    expect(granted.headers.get('location')).toBe('/');
    expect(granted.headers.get('cache-control')).toBe('no-store');
    const cookie = granted.headers.get('set-cookie');
    expect(cookie).toMatch(/^jericho_session=[^;]+; Path=\/; HttpOnly; SameSite=Strict$/);
    expect(await granted.text()).not.toContain(nonce);

    const replay = await fetch(runtime.bootstrapUrl, { redirect: 'manual' });
    expect(replay.status).toBe(410);
    expect(replay.headers.get('set-cookie')).toBeNull();
    expect(await replay.text()).not.toContain(nonce);

    expect((await fetch(`${runtime.url}/api/v1/health`, {
      headers: { cookie: cookie!.split(';', 1)[0] },
    })).status).toBe(200);
  });

  it('refuses every non-loopback bind, including a listen-time override', async () => {
    const firstStore = new JerichoStore({ path: ':memory:', key: KEY });
    stores.push(firstStore);
    expect(() => createJerichoServer({
      store: firstStore,
      apiToken: TOKEN,
      host: '0.0.0.0',
    })).toThrow(/loopback/i);

    const secondStore = new JerichoStore({ path: ':memory:', key: KEY });
    stores.push(secondStore);
    const server = createJerichoServer({
      store: secondStore,
      apiToken: TOKEN,
      host: '127.0.0.1',
    });
    servers.push(server);
    await expect(server.listen(0, '::')).rejects.toThrow(/loopback/i);
  });

  it('serves command-center/connectors/captures/search and invokes connector sync through injected ports', async () => {
    const sync = vi.fn().mockResolvedValue({ status: 'completed', pages: 1, captures: 0, failures: 0 });
    const search = vi.fn().mockResolvedValue({
      cached: true,
      results: [{ path: 'Project.md', title: 'Project', excerpt: 'match', score: 2 }],
    });
    const runtime = await startServer({
      supervisor: { sync },
      connectorDescriptors: [{ id: 'fixture', partitions: ['primary'] }],
      vaultSearch: { search },
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
      available: true,
      cached: true,
      count: 1,
      results: [{ path: 'Project.md', title: 'Project', excerpt: 'match', score: 2 }],
    });
    expect(search).toHaveBeenCalledWith('project', 5, expect.any(AbortSignal));
    expect((await api(runtime.url, '/api/v1/obsidian/search?q=project&limit=11')).status).toBe(400);
  });

  it('serves the fleet snapshot through the injected port and fails closed without one', async () => {
    const fleetSnapshot = {
      available: true,
      agents: [{ id: 'a-1', name: 'Angela', role: 'operations', status: 'idle', lastHeartbeatAt: T0 }],
      issues: [{
        id: 'i-1', identifier: 'MAS-1', title: 'Recover host', status: 'in_progress',
        priority: 'high', assigneeAgentId: 'a-1', createdAt: T0, completedAt: null,
      }],
    };
    const withFleet = await startServer({ fleet: { snapshot: async () => fleetSnapshot } });
    expect(await apiJson(withFleet.url, '/api/v1/fleet')).toEqual(fleetSnapshot);
    expect((await fetch(`${withFleet.url}/api/v1/fleet`)).status).toBe(401);

    const withoutFleet = await startServer();
    const unavailable = await api(withoutFleet.url, '/api/v1/fleet');
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ available: false, agents: [], issues: [] });
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
      payload: {
        transcript: 'Build a multi-step project for Jericho',
        requiredCapabilities: ['code.repo'],
      },
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
    }, processing: {
      status: 'planned',
      intent: { route: 'project', confidence: expect.any(Number) },
      mission: { status: 'pending_approval' },
    } });
    expect(createdBody.processing.intent.confidence).toBeGreaterThanOrEqual(0.95);
    expect(runtime.store.listMissions()).toHaveLength(1);
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

  it('publishes verified retention paths and reflection proposals without exposing vault locations', async () => {
    const retention = {
      retainMission: vi.fn().mockReturnValue({
        absolutePath: '/private/vault/Jericho/Missions/mission.md',
        relativePath: 'Jericho/Missions/mission.md',
        status: 'created' as const,
      }),
    };
    const reflectionProposal = { id: 'reflection-1', status: 'pending_approval' };
    const reflection = { runOnce: vi.fn().mockReturnValue([reflectionProposal]) };
    const runtime = await startServer({ retention, reflection, clock: () => T0 });
    const capture = await api(runtime.url, '/api/v1/captures', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'spoken', sourceEventId: 'retain-project', occurredAt: T0,
        payload: { transcript: 'Build a multi-step project for Jericho' },
      }),
    });
    const missionId = (await capture.json() as any).processing.mission.id as string;

    const retained = await api(runtime.url, `/api/v1/missions/${encodeURIComponent(missionId)}/retain`, {
      method: 'POST',
    });
    expect(retained.status).toBe(200);
    const retainedBody = await retained.json();
    expect(retainedBody).toEqual({
      relativePath: 'Jericho/Missions/mission.md', status: 'created',
    });
    expect(JSON.stringify(retainedBody)).not.toContain('/private/vault');
    expect(retention.retainMission).toHaveBeenCalledWith(missionId);

    const reflected = await api(runtime.url, '/api/v1/reflection/run', { method: 'POST' });
    expect(reflected.status).toBe(200);
    expect(await reflected.json()).toEqual({ proposals: [reflectionProposal] });
    expect(reflection.runOnce).toHaveBeenCalledWith(T0);
  });

  it('binds mission cancellation and relationship proposals to current verified truth', async () => {
    const runtime = await startServer({ clock: () => T0 });
    const capture = await api(runtime.url, '/api/v1/captures', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'spoken', sourceEventId: 'bounded-controls', occurredAt: T0,
        payload: { transcript: 'Build a multi-step project for Jericho' },
      }),
    });
    const planned = (await capture.json() as any).processing.mission;
    for (const [id, eventId, name] of [
      ['relation-person', 'local-event-701', 'Paula'],
      ['relation-company', 'local-event-702', 'Acme'],
    ] as const) {
      runtime.store.appendEvent(localEvent(Number(eventId.split('-').at(-1))));
      runtime.store.upsertEntity({
        id,
        type: id === 'relation-person' ? EntityType.Person : EntityType.Organization,
        canonicalName: name,
        aliases: [], attributes: {}, status: LifecycleStatus.Active, risk: RiskLevel.Low,
        freshness: { observedAt: T0 },
        provenance: [{
          source: 'local:manual', sourceType: SourceType.User,
          sourceEventId: eventId, observedAt: T0,
        }],
        createdAt: T0, updatedAt: T0,
      });
    }
    const before = await apiJson(runtime.url, '/api/v1/command-center');
    const from = before.nucleus.nodes.find((node: any) => node.id === 'entity:relation-person');
    const to = before.nucleus.nodes.find((node: any) => node.id === 'entity:relation-company');
    expect(from).toBeTruthy();
    expect(to).toBeTruthy();

    const relation = await api(runtime.url, '/api/v1/relationship-proposals', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fromNodeId: from.id, toNodeId: to.id, relation: 'related_to',
      }),
    });
    expect(relation.status).toBe(201);
    const relationBody = await relation.json() as any;
    expect(relationBody.proposal).toMatchObject({
      kind: 'data_change', status: 'pending_approval',
      body: { fromNodeId: from.id, toNodeId: to.id, relation: 'related_to', verified: false },
    });
    expect(relationBody.snapshot.nucleus.edges).toEqual(before.nucleus.edges);

    const staleCancel = await api(runtime.url, `/api/v1/missions/${planned.id}/cancel`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planHash: 'f'.repeat(64), version: planned.version, reason: 'Stop this mission' }),
    });
    expect(staleCancel.status).toBe(409);

    const cancelled = await api(runtime.url, `/api/v1/missions/${planned.id}/cancel`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planHash: planned.planHash, version: planned.version, reason: 'Stop this mission' }),
    });
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({
      mission: { id: planned.id, status: 'cancelled', cancelRequestedAt: T0 },
      decision: {
        missionId: planned.id, planHash: planned.planHash, planVersion: planned.version,
        outcome: 'superseded', rationale: 'Stop this mission', decidedBy: 'carlos',
      },
    });
    expect(runtime.store.listDecisions(planned.id)).toHaveLength(1);
    expect(runtime.store.listMissionTasks(planned.id)).not.toContainEqual(
      expect.objectContaining({ status: 'queued' }),
    );
    expect(runtime.store.listMissionTasks(planned.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'cancelled', completedAt: T0 }),
      ]),
    );
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
  vaultSearch?: { search: ReturnType<typeof vi.fn> };
  fleet?: import('../src/fleet/paperclip-client.js').FleetPort;
  frontendDir?: string;
  clock?: () => string;
  retention?: { retainMission: ReturnType<typeof vi.fn> };
  reflection?: { runOnce: ReturnType<typeof vi.fn> };
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
  const intake = new IntakeProcessor({ store });
  const server = createJerichoServer({
    store,
    apiToken: TOKEN,
    host: '127.0.0.1',
    allowedOrigins: [],
    geminiApiKey: undefined,
    ssePollMs: 10,
    intake,
    ...overrides,
  });
  servers.push(server);
  const address = await server.listen(0);
  return {
    store,
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
    bootstrapUrl: address.bootstrapUrl,
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

function childListeningUrl(child: ReturnType<typeof spawn>): Promise<string> {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => {
      reject(new Error(`Jericho child did not listen in time: ${stderr}`));
    }, 5_000);
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.stdout?.on('data', (chunk) => {
      const match = String(chunk).match(/listening on (http:\/\/[^\s]+)/u);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[1]);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Jericho child exited before listening (${code ?? signal}): ${stderr}`));
    });
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
