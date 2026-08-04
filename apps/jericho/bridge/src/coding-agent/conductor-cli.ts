import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type {
  CodingAgentPort,
  ConductorAuthProbe,
  ConductorMessage,
  ConductorProject,
  ConductorSessionStatus,
  ConductorWorkspace,
} from './contracts.js';

const execFileAsync = promisify(execFile);

export interface ConductorCliRunner {
  (executable: string, args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export interface ConductorCliPortOptions {
  executable?: string;
  runner?: ConductorCliRunner;
}

/** A JSON-only adapter for the supported Conductor CLI. Credentials stay in Conductor's Keychain. */
export class ConductorCliPort implements CodingAgentPort {
  readonly #executable: string;
  readonly #runner: ConductorCliRunner;

  constructor(options: ConductorCliPortOptions = {}) {
    this.#executable = options.executable ?? 'conductor';
    this.#runner = options.runner ?? defaultRunner;
  }

  async authProbe(): Promise<ConductorAuthProbe> {
    const status = await this.#run(['auth', 'status']);
    if (!status.ok) return { authenticated: false };
    const parsed = parseJson(status.stdout);
    const keychainEntry = parsed?.authenticated ?? parsed?.hasKey ?? parsed?.configured ?? parsed?.keychainEntry;
    if (keychainEntry === false) return { authenticated: false };
    const whoami = await this.#run(['auth', 'whoami']);
    return { authenticated: whoami.ok && !looksUnauthenticated(whoami.stdout, whoami.stderr) };
  }

  async listProjects(): Promise<readonly ConductorProject[]> {
    const parsed = await this.#json(['projects', 'list']);
    return asArray(parsed).map((item) => ({ id: requiredString(item.id), name: optionalString(item.name), repoUrl: optionalString(item.repoUrl ?? item.repo_url) }));
  }

  async createWorkspace(input: Parameters<CodingAgentPort['createWorkspace']>[0]): Promise<ConductorWorkspace> {
    const parsed = await this.#json([
      'workspaces', 'create', '--project-id', input.projectId, '--name', input.name,
      '--agent', input.agent, '--model', input.model,
    ]);
    return {
      id: requiredString(parsed.id), name: requiredString(parsed.name ?? input.name),
      sessionId: requiredString(parsed.sessionId ?? parsed.session_id),
      deepLink: optionalString(parsed.deepLink ?? parsed.deep_link),
    };
  }

  async sendMessage(sessionId: string, message: string): Promise<void> {
    await this.#json(['messages', 'create', '--session', sessionId, '--message', message]);
  }

  async getStatus(sessionId: string): Promise<ConductorSessionStatus> {
    const parsed = await this.#json(['sessions', 'status', sessionId]);
    return requiredString(parsed.status) as ConductorSessionStatus;
  }

  async readTranscript(sessionId: string, afterMessageId?: string): Promise<readonly ConductorMessage[]> {
    const args = ['sessions', 'messages', sessionId];
    if (afterMessageId) args.push('--after', afterMessageId);
    const parsed = await this.#json(args);
    return asArray(parsed).map((item) => ({
      id: requiredString(item.id), role: optionalString(item.role), text: optionalString(item.text ?? item.content),
      commitSha: optionalString(item.commitSha ?? item.commit_sha), prUrl: optionalString(item.prUrl ?? item.pr_url),
    }));
  }

  async cancel(sessionId: string): Promise<void> {
    await this.#json(['sessions', 'cancel', sessionId]);
  }

  async #json(args: string[]): Promise<Record<string, any>> {
    const result = await this.#run(args);
    if (!result.ok) throw new Error('conductor_cli_request_failed');
    return parseJson(result.stdout) ?? {};
  }

  async #run(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    const result = await this.#runner(this.#executable, ['--json', ...args]);
    return { ok: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
  }
}

async function defaultRunner(executable: string, args: readonly string[]) {
  try {
    const result = await execFileAsync(executable, [...args], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? '', exitCode: typeof failure.code === 'number' ? failure.code : 1 };
  }
}

function parseJson(stdout: string): Record<string, any> | undefined {
  try { return JSON.parse(stdout) as Record<string, any>; } catch { return undefined; }
}

function asArray(value: Record<string, any> | undefined): Record<string, any>[] {
  const data = value?.data ?? value;
  return Array.isArray(data) ? data : [];
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('conductor_response_missing_string');
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function looksUnauthenticated(stdout: string, stderr: string): boolean {
  return /not authenticated|unauthenticated|no api key|unauthorized|401/i.test(`${stdout}\n${stderr}`);
}
