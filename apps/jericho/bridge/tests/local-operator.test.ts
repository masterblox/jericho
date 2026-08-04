import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalOperator } from '../src/local-control/local-operator.js';

const T0 = '2026-08-04T00:00:00.000Z';
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('bounded macOS local operator', () => {
  it('opens only allowlisted browsers with validated web URLs and no shell', async () => {
    const runner = vi.fn(async (_file: string, _args: readonly string[]) => ({
      stdout: JSON.stringify({ application: 'Google Chrome', windowCountAfter: 2 }),
      stderr: '', exitCode: 0,
    }));
    const operator = createOperator(runner);

    await expect(operator.openBrowser({
      url: 'https://example.com/work', newWindow: true,
    })).resolves.toMatchObject({
      action: 'open_browser', status: 'succeeded',
      evidence: { browser: 'chrome', newWindow: true, origin: 'https://example.com', windowCountAfter: 2 },
    });
    expect(runner.mock.calls[0][0]).toBe('/usr/bin/osascript');
    expect(runner.mock.calls[0][1].slice(0, 2)).toEqual(['-l', 'JavaScript']);
    expect(JSON.parse(runner.mock.calls[0][1][3])).toEqual({
      action: 'open_browser_window', application: 'Google Chrome', url: 'https://example.com/work',
    });

    await expect(operator.openBrowser({ url: 'file:///Users/carlos/private' }))
      .rejects.toThrow('url_must_be_http_or_https');
    await expect(operator.openBrowser({ url: 'https://user:secret@example.com' }))
      .rejects.toThrow('url_must_be_http_or_https');
    await expect(operator.openBrowser({ url: 'https://example.com', browser: 'safari', newWindow: true }))
      .rejects.toThrow('browser_new_window_unsupported');
    expect(runner).toHaveBeenCalledTimes(1);

    const denied = createOperator(vi.fn(async () => {
      throw new Error('Not authorized to send Apple events to Google Chrome. (-1743)');
    }));
    await expect(denied.openBrowser({ url: 'about:blank' }))
      .rejects.toThrow('automation_permission_required');
  });

  it('returns sanitized display and application inventory and arranges a selected window', async () => {
    const runner = vi.fn(async (file: string, args: readonly string[]) => {
      expect(file).toBe('/usr/bin/osascript');
      const request = JSON.parse(args.at(-1) ?? '{}');
      if (request.action === 'list_displays') {
        return { stdout: JSON.stringify({ displays: [
          { index: 0, x: 0, y: 0, width: 1512, height: 949 },
          { index: 1, x: -1050, y: 0, width: 1050, height: 1680 },
        ] }), stderr: '', exitCode: 0 };
      }
      if (request.action === 'list_windows') {
        return { stdout: JSON.stringify({ applications: [
          { application: 'Safari', windowCount: 2, title: 'must not escape' },
        ] }), stderr: '', exitCode: 0 };
      }
      return { stdout: JSON.stringify({ bounds: {
        x: -1050, y: 0, width: 521, height: 1680,
      } }), stderr: '', exitCode: 0 };
    });
    const operator = createOperator(runner);

    const status = await operator.computerStatus();
    expect(status.evidence).toEqual({
      displays: [
        { index: 0, x: 0, y: 0, width: 1512, height: 949 },
        { index: 1, x: -1050, y: 0, width: 1050, height: 1680 },
      ],
      applications: [{ application: 'Safari', windowCount: 2 }],
    });
    expect(JSON.stringify(status)).not.toContain('must not escape');

    await expect(operator.arrangeWindow({ application: 'Safari', display: 1, position: 'left' }))
      .resolves.toMatchObject({
        summary: 'Moved Safari to left on display 1.',
        evidence: { application: 'Safari', display: 1, position: 'left' },
      });
  });

  it('inspects only configured repositories with hardened, bounded Git reads', async () => {
    const repositoryPath = temporaryRepository();
    const runner = vi.fn(async (file: string, args: readonly string[]) => {
      expect(file).toBe('git');
      expect(args).toContain('--no-optional-locks');
      expect(args).toContain(realpathSync(repositoryPath));
      if (args.includes('status')) {
        return { stdout: '# branch.head main\n1 .M N... 100644 100644 100644 a b src/app.ts\n', stderr: '', exitCode: 0 };
      }
      if (args.includes('log')) {
        return { stdout: 'abc123\x1fShip local operator\n', stderr: '', exitCode: 0 };
      }
      return { stdout: 'src/app.ts:42:open_browser handler\n', stderr: '', exitCode: 0 };
    });
    const operator = createOperator(runner, [{ id: 'jericho', path: repositoryPath }]);

    await expect(operator.inspectRepository({ repository: 'jericho' })).resolves.toMatchObject({
      evidence: {
        repository: 'jericho', branch: 'main', dirty: true,
        recentCommits: [{ sha: 'abc123', subject: 'Ship local operator' }],
      },
    });
    await expect(operator.inspectRepository({ repository: 'jericho', query: 'open_browser' }))
      .resolves.toMatchObject({
        evidence: {
          repository: 'jericho', query: 'open_browser', count: 1,
          matches: [{ path: 'src/app.ts', line: 42, excerpt: 'open_browser handler' }],
        },
      });
    await expect(operator.inspectRepository({ repository: 'not-allowed' }))
      .rejects.toThrow('repository_not_configured');
  });

  it('creates an explicit Conductor workspace through a bounded deep link', async () => {
    const repositoryPath = temporaryRepository();
    const runner = vi.fn(async (_file: string, _args: readonly string[]) => ({
      stdout: '', stderr: '', exitCode: 0,
    }));
    const operator = createOperator(runner, [{ id: 'jericho', path: repositoryPath }]);

    const result = await operator.createCodingWorkspace({
      repository: 'jericho', task: 'Fix the operator feedback strip and run its tests.',
    });

    const deepLink = runner.mock.calls[0][1][0];
    expect(runner.mock.calls[0][0]).toBe('/usr/bin/open');
    expect(deepLink).toMatch(/^conductor:\/\/prompt=/u);
    expect(deepLink).toContain(`path=${encodeURIComponent(realpathSync(repositoryPath))}`);
    expect(decodeURIComponent(deepLink)).toContain('Fix the operator feedback strip');
    expect(result).toMatchObject({
      action: 'create_coding_workspace', status: 'succeeded',
      evidence: { repository: 'jericho', taskLength: 50 },
    });
    expect(JSON.stringify(result)).not.toContain(realpathSync(repositoryPath));
  });
});

function createOperator(runner: any, repositories: Array<{ id: string; path: string }> = []) {
  return new LocalOperator({
    repositories, runner, platform: 'darwin', clock: () => T0, idFactory: () => 'local-1',
  });
}

function temporaryRepository(): string {
  const path = mkdtempSync(join(tmpdir(), 'jericho-local-operator-'));
  temporaryDirectories.push(path);
  return path;
}
