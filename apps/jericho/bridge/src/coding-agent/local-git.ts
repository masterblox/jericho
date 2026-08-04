import { execFile } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { promisify } from 'node:util';

import type { GitVerificationPort } from './contracts.js';

const execFileAsync = promisify(execFile);
const FULL_SHA = /^[0-9a-f]{40}$/iu;
const MAX_OUTPUT_BYTES = 64 * 1024;
const COMMAND_TIMEOUT_MS = 10_000;

export interface LocalGitRunner {
  (executable: string, args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export interface LocalGitRepositoryPortOptions {
  repositoryPaths: readonly string[];
  runner?: LocalGitRunner;
}

/** Git evidence adapter constrained to the configured repository roots. */
export class LocalGitRepositoryPort implements GitVerificationPort {
  readonly #repositories: ReadonlySet<string>;
  readonly #runner: LocalGitRunner;

  constructor(options: LocalGitRepositoryPortOptions) {
    const repositories = options.repositoryPaths.map((repositoryPath) => {
      const real = realpathSync(repositoryPath);
      if (!statSync(real).isDirectory()) throw new Error('repository_not_directory');
      return real;
    });
    this.#repositories = new Set(repositories);
    this.#runner = options.runner ?? defaultRunner;
  }

  async verifyCommit(input: { repositoryPath: string; commitSha: string }): Promise<boolean> {
    if (!FULL_SHA.test(input.commitSha)) return false;
    let repositoryPath: string;
    try {
      repositoryPath = this.#allowedPath(input.repositoryPath);
    } catch {
      return false;
    }
    const result = await this.#runner('/usr/bin/git', [
      '-C', repositoryPath, 'cat-file', '-e', `${input.commitSha.toLowerCase()}^{commit}`,
    ]);
    return result.exitCode === 0;
  }

  async originUrl(repositoryPath: string): Promise<string | undefined> {
    const allowedPath = this.#allowedPath(repositoryPath);
    const result = await this.#runner('/usr/bin/git', [
      '-C', allowedPath, 'config', '--get', 'remote.origin.url',
    ]);
    if (result.exitCode !== 0) return undefined;
    const value = result.stdout.trim();
    if (!value || value.length > 2_048 || /[\u0000-\u001f\u007f]/u.test(value)) return undefined;
    return value;
  }

  #allowedPath(repositoryPath: string): string {
    const real = realpathSync(repositoryPath);
    if (!this.#repositories.has(real)) throw new Error('repository_not_configured');
    return real;
  }
}

async function defaultRunner(executable: string, args: readonly string[]) {
  try {
    const result = await execFileAsync(executable, [...args], {
      encoding: 'utf8',
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
      exitCode: typeof failure.code === 'number' ? failure.code : 1,
    };
  }
}
