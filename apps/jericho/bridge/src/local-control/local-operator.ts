import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { connectorSubprocessEnvironment, hardenedGitArguments } from '../connectors/adapters/git.js';

const execFileAsync = promisify(execFile);
const CONTROL_SCRIPT = fileURLToPath(new URL('./macos-control.jxa', import.meta.url));
const COMMAND_TIMEOUT_MS = 10_000;
const MAX_COMMAND_OUTPUT = 256 * 1024;
const MAX_SEARCH_RESULTS = 12;

const BROWSERS = {
  default: undefined,
  chrome: 'Google Chrome',
  opera: 'Opera',
  safari: 'Safari',
} as const;

const OPEN_APPLICATIONS: Record<string, string> = {
  conductor: 'Conductor',
  cursor: 'Cursor',
  finder: 'Finder',
  obsidian: 'Obsidian',
  terminal: 'Terminal',
  vscode: 'Visual Studio Code',
};

export type BrowserChoice = keyof typeof BROWSERS;
export type RepositoryApplication = 'conductor' | 'cursor' | 'finder' | 'terminal' | 'vscode';
export type WindowPosition = 'left' | 'right' | 'center' | 'full';

export interface NamedRepository {
  id: string;
  path: string;
}

export interface LocalActionReceipt {
  receiptId: string;
  action: string;
  status: 'succeeded' | 'unavailable' | 'failed';
  occurredAt: string;
  summary: string;
  evidence: Record<string, unknown>;
}

export type LocalCommandRunner = (
  file: string,
  args: readonly string[],
  options?: { purpose?: 'local' | 'git'; allowExitCodeOne?: boolean },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export interface LocalOperatorOptions {
  repositories: NamedRepository[];
  runner?: LocalCommandRunner;
  platform?: NodeJS.Platform;
  clock?: () => string;
  idFactory?: () => string;
}

/**
 * Executes a deliberately small set of reversible local actions. The model
 * never supplies a command, script, executable path, or absolute repository path.
 */
export class LocalOperator {
  readonly #runner: LocalCommandRunner;
  readonly #platform: NodeJS.Platform;
  readonly #clock: () => string;
  readonly #idFactory: () => string;
  readonly #repositories: NamedRepository[];

  constructor(options: LocalOperatorOptions) {
    this.#runner = options.runner ?? defaultRunner;
    this.#platform = options.platform ?? process.platform;
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#idFactory = options.idFactory ?? (() => `local-${randomUUID()}`);
    this.#repositories = options.repositories.map(repository => ({
      id: boundedIdentifier(repository.id, 'repository'),
      path: repository.path,
    }));
  }

  async openBrowser(input: {
    url: unknown;
    browser?: unknown;
    newWindow?: unknown;
  }): Promise<LocalActionReceipt> {
    this.#requireMac();
    const url = safeBrowserUrl(input.url);
    const newWindow = optionalBoolean(input.newWindow, true);
    const browser = enumValue(
      input.browser ?? (newWindow ? 'chrome' : 'default'), Object.keys(BROWSERS), 'browser',
    ) as BrowserChoice;
    const application = BROWSERS[browser];
    let windowCountAfter: number | undefined;
    if (newWindow) {
      if (browser !== 'chrome' || !application) throw new Error('browser_new_window_unsupported');
      const result = await this.#runControl({
        action: 'open_browser_window', application, url,
      });
      windowCountAfter = boundedInteger(result.windowCountAfter, 'window_count', 1, 1_000);
    } else {
      const args: string[] = [];
      if (application) args.push('-a', application);
      args.push(url);
      await this.#runner('/usr/bin/open', args);
    }
    return this.#receipt('open_browser', 'succeeded', `Opened ${safeUrlLabel(url)}${newWindow ? ' in a new window' : ''}.`, {
      browser,
      newWindow,
      origin: browserOrigin(url),
      ...(windowCountAfter ? { windowCountAfter } : {}),
    });
  }

  async openApplication(input: { application: unknown }): Promise<LocalActionReceipt> {
    this.#requireMac();
    const key = enumValue(input.application, Object.keys(OPEN_APPLICATIONS), 'application');
    const application = OPEN_APPLICATIONS[key];
    await this.#runner('/usr/bin/open', ['-a', application]);
    return this.#receipt('open_application', 'succeeded', `Opened ${application}.`, { application });
  }

  async computerStatus(): Promise<LocalActionReceipt> {
    this.#requireMac();
    const [displayResult, windowResult] = await Promise.all([
      this.#runControl({ action: 'list_displays' }),
      this.#runControl({ action: 'list_windows' }),
    ]);
    const displays = displayArray(displayResult.displays);
    const applications = applicationArray(windowResult.applications);
    return this.#receipt('computer_status', 'succeeded', `Found ${displays.length} displays and ${applications.length} applications with windows.`, {
      displays,
      applications,
    });
  }

  async arrangeWindow(input: {
    application: unknown;
    display?: unknown;
    position: unknown;
  }): Promise<LocalActionReceipt> {
    this.#requireMac();
    const application = boundedText(input.application, 'application', 120);
    const display = boundedInteger(input.display ?? 0, 'display', 0, 15);
    const position = enumValue(input.position, ['left', 'right', 'center', 'full'], 'position') as WindowPosition;
    const result = await this.#runControl({
      action: 'arrange_window', application, display, position,
    });
    return this.#receipt('arrange_window', 'succeeded', `Moved ${application} to ${position} on display ${display}.`, {
      application,
      display,
      position,
      bounds: safeBounds(result.bounds),
    });
  }

  async inspectRepository(input: {
    repository: unknown;
    query?: unknown;
  }): Promise<LocalActionReceipt> {
    const repository = this.#repository(input.repository);
    const query = optionalText(input.query, 'query', 200);
    if (!query) {
      const [status, log] = await Promise.all([
        this.#git(repository.path, ['status', '--porcelain=v2', '--branch']),
        this.#git(repository.path, ['log', '-n5', '--format=%h%x1f%s']),
      ]);
      const statusLines = status.stdout.split('\n').filter(Boolean);
      const branch = statusLines.find(line => line.startsWith('# branch.head '))?.slice(14) ?? 'detached';
      const dirty = statusLines.some(line => !line.startsWith('# '));
      const recentCommits = log.stdout.split('\n').filter(Boolean).slice(0, 5).map(line => {
        const [sha, subject = ''] = line.split('\x1f');
        return { sha, subject: boundedOutput(subject, 240) };
      });
      return this.#receipt('inspect_repository', 'succeeded', `${repository.id} is on ${branch}${dirty ? ' with local changes' : ' and clean'}.`, {
        repository: repository.id,
        branch,
        dirty,
        recentCommits,
      });
    }
    const result = await this.#git(repository.path, [
      'grep', '-n', '-I', '-F', '-e', query, '--', '.',
    ], true);
    const matches = result.stdout.split('\n').filter(Boolean).slice(0, MAX_SEARCH_RESULTS).map(line => {
      const [path = '', lineNumber = '', ...content] = line.split(':');
      return {
        path: safeRelativePath(path),
        line: Number(lineNumber) || undefined,
        excerpt: boundedOutput(content.join(':'), 500),
      };
    });
    return this.#receipt('inspect_repository', 'succeeded', `Found ${matches.length} bounded matches in ${repository.id}.`, {
      repository: repository.id,
      query,
      count: matches.length,
      matches,
    });
  }

  async openRepository(input: {
    repository: unknown;
    application?: unknown;
  }): Promise<LocalActionReceipt> {
    this.#requireMac();
    const repository = this.#repository(input.repository);
    const key = enumValue(input.application ?? 'finder', ['conductor', 'cursor', 'finder', 'terminal', 'vscode'], 'application') as RepositoryApplication;
    const application = OPEN_APPLICATIONS[key];
    await this.#runner('/usr/bin/open', ['-a', application, repository.path]);
    return this.#receipt('open_repository', 'succeeded', `Opened ${repository.id} in ${application}.`, {
      repository: repository.id,
      application,
    });
  }

  async createCodingWorkspace(input: {
    repository: unknown;
    task: unknown;
  }): Promise<LocalActionReceipt> {
    this.#requireMac();
    const repository = this.#repository(input.repository);
    const task = boundedText(input.task, 'task', 4_000);
    const deepLink = `conductor://prompt=${encodeURIComponent(task)}&path=${encodeURIComponent(repository.path)}`;
    await this.#runner('/usr/bin/open', [deepLink]);
    return this.#receipt('create_coding_workspace', 'succeeded', `Opened a new Conductor workspace request for ${repository.id}.`, {
      repository: repository.id,
      taskLength: task.length,
    });
  }

  #repository(value: unknown): NamedRepository {
    const id = boundedIdentifier(value, 'repository');
    const configured = this.#repositories.find(item => item.id === id);
    if (!configured) throw new Error('repository_not_configured');
    const configuredPath = resolve(configured.path);
    try {
      const canonical = realpathSync(configuredPath);
      if (!statSync(canonical).isDirectory()) throw new Error('repository_not_directory');
      return { id: configured.id, path: canonical };
    } catch (error) {
      if (error instanceof Error && error.message === 'repository_not_directory') throw error;
      throw new Error('repository_not_directory');
    }
  }

  async #git(path: string, args: string[], allowExitCodeOne = false) {
    return this.#runner('git', hardenedGitArguments(['-C', path, ...args]), {
      purpose: 'git', allowExitCodeOne,
    });
  }

  async #runControl(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      const result = await this.#runner('/usr/bin/osascript', [
        '-l', 'JavaScript', CONTROL_SCRIPT, JSON.stringify(request),
      ]);
      const parsed = JSON.parse(result.stdout) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_control_response');
      return parsed as Record<string, unknown>;
    } catch (error) {
      const message = String(error);
      if (/not authorized to send apple events|1743/iu.test(message)) {
        throw new Error('automation_permission_required');
      }
      if (/assistive access|accessibility|1002/iu.test(message)) {
        throw new Error('accessibility_permission_required');
      }
      if (/application_not_running/u.test(message)) throw new Error('application_not_running');
      if (/application_has_no_windows/u.test(message)) throw new Error('application_has_no_windows');
      if (/browser_new_window_unsupported/u.test(message)) throw new Error('browser_new_window_unsupported');
      if (/browser_window_not_created/u.test(message)) throw new Error('browser_window_not_created');
      if (/display_not_found/u.test(message)) throw new Error('display_not_found');
      if (/window_arrangement_failed/u.test(message)) throw new Error('window_arrangement_failed');
      throw new Error('local_control_failed');
    }
  }

  #receipt(
    action: string,
    status: LocalActionReceipt['status'],
    summary: string,
    evidence: Record<string, unknown>,
  ): LocalActionReceipt {
    return {
      receiptId: this.#idFactory(), action, status,
      occurredAt: this.#clock(), summary, evidence,
    };
  }

  #requireMac(): void {
    if (this.#platform !== 'darwin') throw new Error('local_control_requires_macos');
  }
}

async function defaultRunner(
  file: string,
  args: readonly string[],
  options: { purpose?: 'local' | 'git'; allowExitCodeOne?: boolean } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync(file, [...args], {
      encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS, maxBuffer: MAX_COMMAND_OUTPUT,
      env: options.purpose === 'git'
        ? connectorSubprocessEnvironment('git')
        : { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
    });
    return { stdout: String(result.stdout), stderr: String(result.stderr), exitCode: 0 };
  } catch (error) {
    const failure = error as Error & { code?: number | string; stdout?: string; stderr?: string };
    if (options.allowExitCodeOne && failure.code === 1) {
      return { stdout: String(failure.stdout ?? ''), stderr: '', exitCode: 1 };
    }
    throw error;
  }
}

function safeBrowserUrl(value: unknown): string {
  const input = boundedText(value, 'url', 2_048);
  if (input === 'about:blank') return input;
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error('url_must_be_http_or_https');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('url_must_be_http_or_https');
  }
  return parsed.toString();
}

function browserOrigin(url: string): string {
  return url === 'about:blank' ? 'about:blank' : new URL(url).origin;
}

function safeUrlLabel(url: string): string {
  if (url === 'about:blank') return 'a blank browser';
  return new URL(url).hostname;
}

function boundedIdentifier(value: unknown, field: string): string {
  const id = boundedText(value, field, 80);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(id)) throw new Error(`${field}_invalid`);
  return id;
}

function boundedText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`${field}_required`);
  const text = value.trim();
  if (!text || text.length > maximum || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new Error(`${field}_invalid`);
  }
  return text;
}

function optionalText(value: unknown, field: string, maximum: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return boundedText(value, field, maximum);
}

function enumValue(value: unknown, choices: readonly string[], field: string): string {
  if (typeof value !== 'string' || !choices.includes(value)) throw new Error(`${field}_invalid`);
  return value;
}

function optionalBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error('new_window_invalid');
  return value;
}

function boundedInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${field}_invalid`);
  }
  return value as number;
}

function boundedOutput(value: string, maximum: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, maximum);
}

function safeRelativePath(value: string): string {
  const normalized = value.split('\\').join('/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some(segment => segment === '..')) {
    throw new Error('repository_result_path_invalid');
  }
  return normalized.slice(0, 1_024);
}

function displayArray(value: unknown): Array<Record<string, number>> {
  if (!Array.isArray(value) || value.length > 16) throw new Error('invalid_display_response');
  return value.map(item => {
    if (!item || typeof item !== 'object') throw new Error('invalid_display_response');
    const row = item as Record<string, unknown>;
    return {
      index: boundedInteger(row.index, 'display_index', 0, 15),
      x: finiteNumber(row.x, 'display_x'), y: finiteNumber(row.y, 'display_y'),
      width: positiveNumber(row.width, 'display_width'),
      height: positiveNumber(row.height, 'display_height'),
    };
  });
}

function applicationArray(value: unknown): Array<{ application: string; windowCount: number }> {
  if (!Array.isArray(value) || value.length > 128) throw new Error('invalid_window_response');
  return value.map(item => {
    if (!item || typeof item !== 'object') throw new Error('invalid_window_response');
    const row = item as Record<string, unknown>;
    return {
      application: boundedText(row.application, 'application', 120),
      windowCount: boundedInteger(row.windowCount, 'window_count', 1, 1_000),
    };
  });
}

function safeBounds(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_bounds_response');
  const row = value as Record<string, unknown>;
  return {
    x: finiteNumber(row.x, 'bounds_x'), y: finiteNumber(row.y, 'bounds_y'),
    width: positiveNumber(row.width, 'bounds_width'),
    height: positiveNumber(row.height, 'bounds_height'),
  };
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field}_invalid`);
  return value;
}

function positiveNumber(value: unknown, field: string): number {
  const number = finiteNumber(value, field);
  if (number <= 0) throw new Error(`${field}_invalid`);
  return number;
}
