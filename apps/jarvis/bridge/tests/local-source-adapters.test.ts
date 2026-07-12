import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CaptureFailureKind,
  ConnectorCapability,
  ConnectorHealthStatus,
  RouteType,
} from '@jericho/shared';

import { ConnectorUnauthorizedError } from '../src/connectors/contracts.js';
import {
  connectorSubprocessEnvironment,
  GitConnector,
  hardenedGitArguments,
  type GitCommandRunner,
} from '../src/connectors/adapters/git.js';
import {
  GitHubConnector,
  type GitHubTransport,
} from '../src/connectors/adapters/github.js';
import { ConductorConnector } from '../src/connectors/adapters/conductor.js';
import { ObsidianConnector } from '../src/connectors/adapters/obsidian.js';

const T0 = '2026-07-11T00:00:00.000Z';
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('GitConnector', () => {
  it('drops unrelated Jericho secrets and disables repository-controlled execution hooks', () => {
    const environment = {
      HOME: '/Users/carlos', GH_TOKEN: 'github-only',
      GEMINI_API_KEY: 'gemini-secret', JERICHO_MASTER_KEY: 'master-secret',
      JERICHO_TELEGRAM_GATEWAY_TOKEN: 'telegram-secret',
      LINEAR_API_KEY: 'linear-secret', NODE_OPTIONS: '--require=malicious',
    };

    expect(connectorSubprocessEnvironment('git', environment)).toEqual(expect.objectContaining({
      GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
    }));
    expect(connectorSubprocessEnvironment('git', environment)).not.toHaveProperty('HOME');
    expect(connectorSubprocessEnvironment('github', environment)).toMatchObject({
      HOME: '/Users/carlos', GH_TOKEN: 'github-only', GH_PAGER: 'cat',
    });
    const serialized = JSON.stringify({
      git: connectorSubprocessEnvironment('git', environment),
      github: connectorSubprocessEnvironment('github', environment),
    });
    expect(serialized).not.toMatch(/gemini-secret|master-secret|telegram-secret|linear-secret|NODE_OPTIONS/u);
    expect(hardenedGitArguments(['-C', '/repo', 'status'])).toEqual(expect.arrayContaining([
      'core.fsmonitor=false', 'core.hooksPath=/dev/null', 'credential.helper=',
    ]));
  });

  it('reads a temporary repository with execFile argument arrays and bounded commits', async () => {
    const repository = makeGitRepository();
    const calls: string[][] = [];
    const runner: GitCommandRunner = async (file, args, options) => {
      calls.push([file, ...args]);
      return {
        stdout: execFileSync(file, args, { cwd: options?.cwd, encoding: 'utf8' }),
        stderr: '',
      };
    };
    const adapter = new GitConnector({
      repositories: [{ id: 'jericho', path: repository }],
      maxCommits: 2,
      runner,
    });

    const page = await adapter.capture(request('jericho'));

    expect(page.captures.map((item) => item.event.type)).toEqual(expect.arrayContaining([
      'git.repository.snapshot',
      'git.commit',
    ]));
    expect(page.captures.filter((item) => item.event.type === 'git.commit').length).toBeLessThanOrEqual(2);
    expect(calls).toContainEqual(expect.arrayContaining(['git', '-C', repository, 'status', '--porcelain=v2', '--branch']));
    expect(calls.flat().join(' ')).not.toContain('sh -c');
  });

  it('surfaces a force-pushed/non-ancestor HEAD as Review', async () => {
    const repository = makeGitRepository();
    const adapter = new GitConnector({ repositories: [{ id: 'jericho', path: repository }], maxCommits: 5 });
    const first = await adapter.capture(request('jericho'));
    const previousHead = first.progress.pageToken!;

    execFileSync('git', ['checkout', '--orphan', 'rewritten'], { cwd: repository });
    execFileSync('git', ['rm', '-rf', '.'], { cwd: repository });
    writeFileSync(join(repository, 'rewritten.txt'), 'rewritten');
    execFileSync('git', ['add', 'rewritten.txt'], { cwd: repository });
    execFileSync('git', ['commit', '-m', 'rewrite'], { cwd: repository });

    const second = await adapter.capture(request('jericho', {
      connectorId: 'git', capability: ConnectorCapability.Capture,
      partition: 'jericho', epoch: 1, sequence: 1, pageToken: previousHead,
      version: 1, updatedAt: T0,
    }));

    expect(second.failures).toContainEqual(expect.objectContaining({
      kind: CaptureFailureKind.ContradictoryHistory,
      route: RouteType.HumanApproval,
      retryable: false,
    }));
  });
});

describe('GitHubConnector', () => {
  it('probes authentication through the configured transport and maps 401', async () => {
    const request = vi.fn<GitHubTransport['request']>().mockResolvedValue({ status: 401, data: {} });
    const adapter = new GitHubConnector({
      repositories: ['owner/jericho'], transport: { request },
    });

    await expect(adapter.probe(new AbortController().signal)).resolves.toMatchObject({
      status: 'unauthorized',
    });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ path: 'user', query: {} }));
  });

  it('uses an injected read-only transport and maps pull requests to repository relations', async () => {
    const transport: GitHubTransport = {
      request: vi.fn<GitHubTransport['request']>().mockResolvedValue({
        status: 200,
        data: [{
          id: 99, number: 7, title: 'Core API', state: 'open',
          updated_at: T0, user: { id: 1, login: 'carlos' },
        }],
      }),
    };
    const adapter = new GitHubConnector({ repositories: ['owner/jericho'], transport });

    const page = await adapter.capture(request('owner/jericho'));

    expect(transport.request).toHaveBeenCalledWith(expect.objectContaining({
      path: 'repos/owner/jericho/pulls',
      query: { state: 'all', per_page: 100, page: 1 },
    }));
    expect(page.captures[0]).toMatchObject({
      event: { type: 'github.pull_request.updated' },
      relations: [expect.objectContaining({})],
    });
    expect(JSON.stringify((transport.request as ReturnType<typeof vi.fn>).mock.calls)).not.toMatch(/POST|PATCH|mutation/i);
  });

  it('paginates pull requests with a durable numeric page cursor across restart', async () => {
    const pull = (id: number) => ({
      id, number: id, title: `PR ${id}`, state: 'open', updated_at: T0,
      user: { id: 1, login: 'carlos' },
    });
    const requestTransport = vi.fn<GitHubTransport['request']>()
      .mockResolvedValueOnce({ status: 200, data: [pull(1), pull(2)] })
      .mockResolvedValueOnce({ status: 200, data: [pull(3)] });
    const transport: GitHubTransport = { request: requestTransport };
    const firstAdapter = new GitHubConnector({ repositories: ['owner/jericho'], transport });

    const first = await firstAdapter.capture(request('owner/jericho', undefined, 2));
    const restarted = new GitHubConnector({ repositories: ['owner/jericho'], transport });
    const second = await restarted.capture(request(
      'owner/jericho', cursor('github', 'owner/jericho', first.progress), 2,
    ));

    expect(first).toMatchObject({ hasMore: true, progress: { pageToken: '2', sequence: 2 } });
    expect(second).toMatchObject({ hasMore: false, progress: { sequence: 3 } });
    expect(second.progress).not.toHaveProperty('pageToken');
    expect(requestTransport).toHaveBeenNthCalledWith(1, expect.objectContaining({
      query: { state: 'all', per_page: 2, page: 1 },
    }));
    expect(requestTransport).toHaveBeenNthCalledWith(2, expect.objectContaining({
      query: { state: 'all', per_page: 2, page: 2 },
    }));
    expect([...first.captures, ...second.captures].map((capture) => capture.event.sourceEventId)).toEqual([
      `owner/jericho:pull:1:${T0}`,
      `owner/jericho:pull:2:${T0}`,
      `owner/jericho:pull:3:${T0}`,
    ]);
  });

  it('maps GitHub 401 to Unauthorized', async () => {
    const transport: GitHubTransport = {
      request: vi.fn<GitHubTransport['request']>().mockResolvedValue({ status: 401, data: [] }),
    };
    const adapter = new GitHubConnector({ repositories: ['owner/jericho'], transport });
    await expect(adapter.capture(request('owner/jericho'))).rejects.toBeInstanceOf(ConnectorUnauthorizedError);
  });
});

describe('ConductorConnector', () => {
  it('scans configured filesystem worktrees only and ignores app DBs and secrets', async () => {
    const root = tempDirectory('conductor-scan-');
    mkdirSync(join(root, 'safe-worktree', '.git'), { recursive: true });
    writeFileSync(join(root, 'safe-worktree', '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(root, '.env'), 'TOKEN=super-secret');
    writeFileSync(join(root, 'private.db'), 'db-secret');
    writeFileSync(join(root, 'session.sqlite'), 'sqlite-secret');
    mkdirSync(join(root, '.conductor'), { recursive: true });
    writeFileSync(join(root, '.conductor', 'app.db'), 'app-private');
    const adapter = new ConductorConnector({ roots: [{ id: 'workspace', path: root }] });

    const page = await adapter.capture(request('workspace'));
    const serialized = JSON.stringify(page);

    expect(page.captures).toHaveLength(1);
    expect(page.captures[0].event.payload).toMatchObject({ relativePath: 'safe-worktree' });
    expect(serialized).not.toMatch(/super-secret|db-secret|sqlite-secret|app-private|private\.db|session\.sqlite|\.env/);
  });

  it('paginates a stable worktree snapshot across restart and defers mid-scan changes', async () => {
    const root = tempDirectory('conductor-pages-');
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      mkdirSync(join(root, name, '.git'), { recursive: true });
      writeFileSync(join(root, name, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    }
    const firstAdapter = new ConductorConnector({ roots: [{ id: 'workspace', path: root }] });

    const first = await firstAdapter.capture(request('workspace', undefined, 2));
    writeFileSync(join(root, 'e', '.git', 'HEAD'), 'ref: refs/heads/changed\n');
    const second = await firstAdapter.capture(request('workspace', cursor('conductor', 'workspace', first.progress), 2));
    const restarted = new ConductorConnector({ roots: [{ id: 'workspace', path: root }] });
    const third = await restarted.capture(request('workspace', cursor('conductor', 'workspace', second.progress), 2));

    expect([first.hasMore, second.hasMore, third.hasMore]).toEqual([true, true, false]);
    expect([first.progress.sequence, second.progress.sequence, third.progress.sequence]).toEqual([2, 4, 5]);
    expect([...first.captures, ...second.captures, ...third.captures].map((capture) =>
      (capture.event.payload as Record<string, unknown>).relativePath,
    )).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(third.captures[0].event.payload).toMatchObject({ head: 'ref: refs/heads/main' });

    const changed = await restarted.capture(request(
      'workspace', cursor('conductor', 'workspace', third.progress), 2,
    ));
    expect(changed.captures).toHaveLength(1);
    expect(changed.captures[0].event.payload).toMatchObject({
      relativePath: 'e', head: 'ref: refs/heads/changed',
    });
  });
});

describe('ObsidianConnector', () => {
  it('parses markdown metadata/tags/wikilinks, performs bounded search, and creates no plaintext index', async () => {
    const vault = tempDirectory('obsidian-vault-');
    writeFileSync(join(vault, 'Project.md'), [
      '---', 'title: Project Alpha', 'status: active', 'tags: [sales, important]', '---',
      '# Project', 'Discuss [[Client]] with #followup.',
    ].join('\n'));
    writeFileSync(join(vault, 'Client.md'), '# Client\nImportant account.');
    mkdirSync(join(vault, '.obsidian'));
    writeFileSync(join(vault, '.obsidian', 'workspace.json'), '{"private":true}');
    const search = vi.fn(async () => ({
      cached: false,
      results: [{ path: 'Client.md', title: 'Client', excerpt: 'Important account.', score: 2.1 }],
    }));
    const adapter = new ObsidianConnector({
      vaultPath: vault, maxNotes: 10, maxNoteBytes: 10_000,
      gateway: {
        search,
        health: async () => ({
          status: 'healthy' as const, lastCommitAt: T0, syncAgeMs: 0,
          cachedQueries: 0, reason: 'ok',
        }),
        rebuildIndex: async () => ({ lastIndexAt: T0, indexSizeMb: 1 }),
        readNote: async () => null,
      },
    });

    const page = await adapter.capture(request('vault'));
    const project = page.captures.find((item) =>
      (item.event.payload as Record<string, unknown>).path === 'Project.md',
    )!;
    expect(project.event.payload).toMatchObject({
      frontmatter: { title: 'Project Alpha', status: 'active', tags: ['sales', 'important'] },
      tags: expect.arrayContaining(['sales', 'important', 'followup']),
      wikilinks: ['Client'],
    });
    expect(project.event.freshness?.observedAt).toBeDefined();
    expect(await adapter.search('important', 1)).toHaveLength(1);
    expect(search).toHaveBeenCalledWith('important', 1, expect.any(AbortSignal));
    expect(readdirSync(vault).sort()).toEqual(['.obsidian', 'Client.md', 'Project.md']);
  });

  it('projects gateway sync freshness while keeping bounded local vault search available without it', async () => {
    const vault = tempDirectory('obsidian-health-');
    const degraded = new ObsidianConnector({
      vaultPath: vault, maxNotes: 10, maxNoteBytes: 10_000,
      gateway: {
        search: async () => ({ cached: false, results: [] }),
        health: async () => ({
          status: 'degraded' as const,
          lastCommitAt: '2026-07-11T00:00:00.000Z', syncAgeMs: 3_600_001,
          lastIndexAt: '2026-07-10T03:00:00.000Z', indexSizeMb: 12.4,
          cachedQueries: 2, reason: 'sync_stale',
        }),
        rebuildIndex: async () => ({ lastIndexAt: T0, indexSizeMb: 1 }),
        readNote: async () => null,
      },
    });
    await expect(degraded.probe(new AbortController().signal)).resolves.toEqual({
      status: ConnectorHealthStatus.Degraded,
      details: {
        mode: 'vault_rag_gateway', reason: 'sync_stale',
        lastCommitAt: '2026-07-11T00:00:00.000Z', syncAgeMs: 3_600_001,
        lastIndexAt: '2026-07-10T03:00:00.000Z', indexSizeMb: 12.4,
      },
    });

    const disabled = new ObsidianConnector({ vaultPath: vault, maxNotes: 10, maxNoteBytes: 10_000 });
    await expect(disabled.probe(new AbortController().signal)).resolves.toEqual({
      status: ConnectorHealthStatus.Unavailable,
      details: { mode: 'vault_rag_gateway', reason: 'gateway_not_configured' },
    });
    writeFileSync(join(vault, 'Local.md'), '# Local knowledge\nAnything Carlos needs.');
    await expect(disabled.search('anything', 5)).resolves.toEqual([{
      path: 'Local.md', title: 'Local', excerpt: '# Local knowledge Anything Carlos needs.',
    }]);
  });

  it('detects rename and delete from the durable manifest cursor', async () => {
    const vault = tempDirectory('obsidian-vault-');
    writeFileSync(join(vault, 'A.md'), '# Same content');
    writeFileSync(join(vault, 'B.md'), '# Delete me');
    const adapter = new ObsidianConnector({ vaultPath: vault, maxNotes: 10, maxNoteBytes: 10_000 });
    const first = await adapter.capture(request('vault'));
    renameSync(join(vault, 'A.md'), join(vault, 'Renamed.md'));
    unlinkSync(join(vault, 'B.md'));

    const second = await adapter.capture(request('vault', {
      connectorId: 'obsidian', capability: ConnectorCapability.Capture,
      partition: 'vault', epoch: 1, sequence: first.progress.sequence,
      pageToken: first.progress.pageToken, version: 1, updatedAt: T0,
    }));

    expect(second.captures.map((item) => item.event.type)).toEqual(expect.arrayContaining([
      'obsidian.note.renamed',
      'obsidian.note.deleted',
    ]));
  });

  it('paginates a stable vault snapshot across restart and defers mid-scan edits', async () => {
    const vault = tempDirectory('obsidian-pages-');
    for (const name of ['A', 'B', 'C', 'D', 'E']) {
      writeFileSync(join(vault, `${name}.md`), `# ${name}\noriginal ${name}`);
    }
    const firstAdapter = new ObsidianConnector({ vaultPath: vault, maxNotes: 10, maxNoteBytes: 10_000 });

    const first = await firstAdapter.capture(request('vault', undefined, 2));
    writeFileSync(join(vault, 'E.md'), '# E\nchanged while paging');
    const second = await firstAdapter.capture(request('vault', cursor('obsidian', 'vault', first.progress), 2));
    const restarted = new ObsidianConnector({ vaultPath: vault, maxNotes: 10, maxNoteBytes: 10_000 });
    const third = await restarted.capture(request('vault', cursor('obsidian', 'vault', second.progress), 2));

    expect([first.hasMore, second.hasMore, third.hasMore]).toEqual([true, true, false]);
    expect([first.progress.sequence, second.progress.sequence, third.progress.sequence]).toEqual([2, 4, 5]);
    const initialCaptures = [...first.captures, ...second.captures, ...third.captures];
    expect(initialCaptures.map((capture) =>
      (capture.event.payload as Record<string, unknown>).path,
    )).toEqual(['A.md', 'B.md', 'C.md', 'D.md', 'E.md']);
    expect(new Set(initialCaptures.map((capture) => capture.event.id))).toHaveLength(5);

    const changed = await restarted.capture(request('vault', cursor('obsidian', 'vault', third.progress), 2));
    expect(changed.captures).toHaveLength(1);
    expect(changed.captures[0].event.payload).toMatchObject({ path: 'E.md' });
    expect(changed.captures[0].event.id).not.toBe(third.captures[0].event.id);
  });
});

function request(partition: string, cursor?: unknown, limit = 100) {
  return {
    partition,
    ...(cursor ? { cursor } : {}),
    limit,
    observedAt: T0,
    signal: new AbortController().signal,
  } as never;
}

function cursor(
  connectorId: string,
  partition: string,
  progress: { epoch: number; sequence: number; pageToken?: string; watermark?: string; overlapFrom?: string },
) {
  return {
    connectorId, capability: ConnectorCapability.Capture, partition,
    ...progress, version: 1, updatedAt: T0,
  };
}

function tempDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function makeGitRepository(): string {
  const repository = tempDirectory('jericho-git-');
  execFileSync('git', ['init'], { cwd: repository });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repository });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repository });
  writeFileSync(join(repository, 'README.md'), 'first');
  execFileSync('git', ['add', 'README.md'], { cwd: repository });
  execFileSync('git', ['commit', '-m', 'first'], { cwd: repository });
  writeFileSync(join(repository, 'README.md'), 'second');
  execFileSync('git', ['add', 'README.md'], { cwd: repository });
  execFileSync('git', ['commit', '-m', 'second'], { cwd: repository });
  expect(readFileSync(join(repository, 'README.md'), 'utf8')).toBe('second');
  return repository;
}
