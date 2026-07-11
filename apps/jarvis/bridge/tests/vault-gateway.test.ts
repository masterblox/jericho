import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  VaultGatewayService,
  createVaultGatewayServer,
  type VaultCommandRunner,
} from '../src/vault/vault-gateway.js';
import { loadVaultGatewayConfig } from '../src/vault/vault-gateway-main.js';

const TOKEN = 'vault-gateway-test-token';
const NOW = '2026-07-11T03:00:00.000Z';
const resources: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const dispose of resources.splice(0).reverse()) await dispose();
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jericho-vault-gateway-'));
  resources.push(() => rmSync(root, { recursive: true, force: true }));
  const vaultPath = join(root, 'brain');
  const intelPath = join(root, 'intel');
  const indexPath = join(root, 'index.json');
  mkdirSync(vaultPath);
  mkdirSync(intelPath);
  execFileSync('git', ['init', '-q', vaultPath]);
  execFileSync('git', ['-C', vaultPath, 'config', 'user.email', 'vault@example.test']);
  execFileSync('git', ['-C', vaultPath, 'config', 'user.name', 'Vault Test']);
  writeFileSync(join(vaultPath, 'Today.md'), '# Today\nShip Jericho.');
  execFileSync('git', ['-C', vaultPath, 'add', '.']);
  execFileSync('git', ['-C', vaultPath, 'commit', '-qm', 'vault sync'], {
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-07-11T02:30:00Z',
      GIT_COMMITTER_DATE: '2026-07-11T02:30:00Z',
    },
  });
  return { root, vaultPath, intelPath, indexPath };
}

function runner(): VaultCommandRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async run(argv) {
      calls.push([...argv]);
      if (argv[0] === 'git') return { stdout: '2026-07-11T02:30:00+00:00\n', stderr: '' };
      if (argv.includes('search')) {
        return {
          stdout: JSON.stringify({
            results: [{ path: 'Today.md', title: 'Today', excerpt: 'Ship Jericho.', score: 3.5 }],
          }),
          stderr: '',
        };
      }
      return { stdout: JSON.stringify({ index_size_mb: 12.4 }), stderr: '' };
    },
  };
}

function serviceFixture(commandRunner = runner()) {
  const paths = fixture();
  const service = new VaultGatewayService({
    vaultPath: paths.vaultPath,
    ragScriptPath: '/opt/data/scripts/vault-rag.py',
    cachePath: join(paths.intelPath, 'rag-cache.json'),
    indexPath: paths.indexPath,
    cacheTtlMs: 24 * 60 * 60 * 1_000,
    staleAfterMs: 60 * 60 * 1_000,
    maxOutputBytes: 64 * 1024,
    timeoutMs: 45_000,
    clock: () => NOW,
    commandRunner,
  });
  return { ...paths, service, commandRunner };
}

describe('vault gateway service', () => {
  it('caches normalized search results for 24 hours without re-running the script', async () => {
    const { service, commandRunner, intelPath } = serviceFixture();

    await expect(service.search('  Carlos   AI stack ', 5)).resolves.toEqual({
      cached: false,
      results: [{ path: 'Today.md', title: 'Today', excerpt: 'Ship Jericho.', score: 3.5 }],
    });
    await expect(service.search('Carlos AI stack', 5)).resolves.toMatchObject({ cached: true });

    expect(commandRunner.calls).toHaveLength(1);
    expect(commandRunner.calls[0]).toEqual([
      'python3', '/opt/data/scripts/vault-rag.py', 'search', 'Carlos AI stack', '-n', '5', '--json',
    ]);
    const cache = JSON.parse(readFileSync(join(intelPath, 'rag-cache.json'), 'utf8'));
    const key = createHash('sha256').update('Carlos AI stack\u00005').digest('hex');
    expect(cache).toMatchObject({
      version: 1,
      cached_queries: {
        [key]: { query: 'Carlos AI stack', limit: 5, results: 1 },
      },
    });
    expect(cache.cached_queries[key].items).toHaveLength(1);
  });

  it('reports Git commit freshness without exposing an absolute vault path', async () => {
    const { service, vaultPath } = serviceFixture();

    await expect(service.health()).resolves.toMatchObject({
      status: 'healthy',
      lastCommitAt: '2026-07-11T02:30:00.000Z',
      syncAgeMs: 30 * 60 * 1_000,
      reason: 'ok',
    });
    expect(JSON.stringify(await service.health())).not.toContain(vaultPath);
  });

  it('serializes rebuilds and invalidates cached queries only after success', async () => {
    let release!: () => void;
    const commandRunner: VaultCommandRunner & { calls: string[][] } = {
      calls: [],
      async run(argv) {
        this.calls.push([...argv]);
        if (argv[0] === 'git') return { stdout: '2026-07-11T02:30:00+00:00\n', stderr: '' };
        if (argv.includes('search')) {
          return { stdout: JSON.stringify({ results: [] }), stderr: '' };
        }
        await new Promise<void>((resolve) => { release = resolve; });
        return { stdout: JSON.stringify({ index_size_mb: 2.5 }), stderr: '' };
      },
    };
    const { service } = serviceFixture(commandRunner);
    await service.search('cached query', 3);

    const rebuild = service.rebuildIndex();
    await Promise.resolve();
    await expect(service.rebuildIndex()).rejects.toMatchObject({ code: 'index_in_progress' });
    release();
    await expect(rebuild).resolves.toMatchObject({ lastIndexAt: NOW, indexSizeMb: 2.5 });
    await service.search('cached query', 3);
    expect(commandRunner.calls.filter((argv) => argv.includes('search'))).toHaveLength(2);
  });

  it('keeps the prior cache when search output is malformed or oversized', async () => {
    const good = runner();
    const { service, intelPath } = serviceFixture(good);
    await service.search('good', 5);
    const before = readFileSync(join(intelPath, 'rag-cache.json'), 'utf8');
    good.run = vi.fn(async () => ({ stdout: 'x'.repeat(70 * 1024), stderr: '' }));

    await expect(service.search('bad', 5)).rejects.toThrow(/output/i);
    expect(readFileSync(join(intelPath, 'rag-cache.json'), 'utf8')).toBe(before);
  });

  it('expires query entries at 24 hours and recovers from a corrupt cache', async () => {
    const paths = fixture();
    const commandRunner = runner();
    let now = NOW;
    const options = {
      vaultPath: paths.vaultPath,
      ragScriptPath: '/opt/data/scripts/vault-rag.py',
      cachePath: join(paths.intelPath, 'rag-cache.json'),
      indexPath: paths.indexPath,
      cacheTtlMs: 24 * 60 * 60_000,
      staleAfterMs: 60 * 60_000,
      maxOutputBytes: 64 * 1024,
      timeoutMs: 45_000,
      clock: () => now,
      commandRunner,
    };
    const service = new VaultGatewayService(options);
    await service.search('expiry', 5);
    now = '2026-07-12T03:00:00.000Z';
    await expect(service.search('expiry', 5)).resolves.toMatchObject({ cached: false });
    expect(commandRunner.calls.filter((argv) => argv.includes('search'))).toHaveLength(2);

    writeFileSync(options.cachePath, '{corrupt');
    await expect(service.search('recovered', 5)).resolves.toMatchObject({ cached: false });
    expect(JSON.parse(readFileSync(options.cachePath, 'utf8'))).toMatchObject({ version: 1 });
  });

  it('retains both entries from concurrent uncached searches', async () => {
    const { service, intelPath } = serviceFixture();

    await Promise.all([service.search('first query', 5), service.search('second query', 5)]);

    const cache = JSON.parse(readFileSync(join(intelPath, 'rag-cache.json'), 'utf8'));
    expect(Object.values(cache.cached_queries).map((entry: any) => entry.query).sort())
      .toEqual(['first query', 'second query']);
  });
});

describe('vault gateway HTTP boundary', () => {
  it('requires bearer authentication and serves only the three fixed routes', async () => {
    const { service } = serviceFixture();
    const server = createVaultGatewayServer({ service, token: TOKEN, host: '127.0.0.1' });
    const address = await server.listen(0);
    resources.push(() => server.close());
    const base = `http://127.0.0.1:${address.port}`;

    expect((await fetch(`${base}/v1/jericho/vault/health`)).status).toBe(401);
    expect((await fetch(`${base}/anything`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })).status).toBe(404);
    const health = await fetch(`${base}/v1/jericho/vault/health`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(health.status).toBe(200);
  });

  it('refuses public bind addresses', () => {
    const { service } = serviceFixture();
    expect(() => createVaultGatewayServer({ service, token: TOKEN, host: '0.0.0.0' }))
      .toThrow(/private/i);
  });
});

describe('vault gateway deployment config', () => {
  it('loads fixed-path defaults and requires an explicit token', () => {
    expect(loadVaultGatewayConfig({ JERICHO_VAULT_GATEWAY_TOKEN: TOKEN })).toMatchObject({
      host: '127.0.0.1', port: 8790, token: TOKEN,
      vaultPath: '/opt/brain', ragScriptPath: '/opt/data/scripts/vault-rag.py',
      cachePath: '/opt/data/jericho/intel/rag-cache.json',
      indexPath: '/opt/data/vault-rag-index/bm25_index.json',
      cacheTtlMs: 24 * 60 * 60_000, staleAfterMs: 60 * 60_000,
    });
    expect(() => loadVaultGatewayConfig({})).toThrow(/TOKEN/);
    expect(() => loadVaultGatewayConfig({
      JERICHO_VAULT_GATEWAY_TOKEN: TOKEN,
      JERICHO_VAULT_GATEWAY_HOST: '0.0.0.0',
    })).toThrow(/private/i);
  });
});
