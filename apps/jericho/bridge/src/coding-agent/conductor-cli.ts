import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
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
const COMMAND_TIMEOUT_MS = 30_000;
const MAX_COMMAND_OUTPUT_BYTES = 2 * 1024 * 1024;

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
  readonly #transcripts = new Map<string, { id: string; text: string }>();

  constructor(options: ConductorCliPortOptions = {}) {
    this.#executable = options.executable ?? 'conductor';
    this.#runner = options.runner ?? defaultRunner;
  }

  async authProbe(): Promise<ConductorAuthProbe> {
    const status = await this.#run(['auth', 'status']);
    if (!status.ok) return { authenticated: false };
    const whoami = await this.#run(['auth', 'whoami']);
    return { authenticated: whoami.ok && !looksUnauthenticated(whoami.stdout, whoami.stderr) };
  }

  async listProjects(): Promise<readonly ConductorProject[]> {
    const projects: ConductorProject[] = [];
    const limit = 100;
    for (let offset = 0; offset < 1_000; offset += limit) {
      const parsed = await this.#json([
        'projects', 'list', '--limit', String(limit), '--offset', String(offset),
      ]);
      const rows = asArray(parsed);
      projects.push(...rows.map((item) => ({
        id: requiredString(item.id),
        name: optionalString(item.name),
        repoUrl: optionalString(item.repoUrl ?? item.repo_url ?? item.gitRemote ?? item.git_remote),
      })));
      const response = isRecord(parsed) ? parsed : {};
      if (response.hasMore !== true && response.has_more !== true) break;
      if (rows.length === 0) throw new Error('conductor_projects_pagination_invalid');
    }
    return projects;
  }

  async createWorkspace(input: Parameters<CodingAgentPort['createWorkspace']>[0]): Promise<ConductorWorkspace> {
    const parsed = asRecord(await this.#json([
      'workspaces', 'create', '--project-id', input.projectId, '--name', input.name,
      '--agent', input.agent, '--model', input.model,
    ]));
    return {
      id: requiredString(parsed.workspaceId ?? parsed.workspace_id ?? parsed.id),
      name: input.name,
      sessionId: requiredString(parsed.sessionId ?? parsed.session_id),
      deepLink: optionalString(parsed.deepLink ?? parsed.deep_link),
    };
  }

  async sendMessage(sessionId: string, message: string): Promise<void> {
    await this.#command(['messages', 'create', '--session', boundedId(sessionId, 'session_id'), '--message', message]);
  }

  async getStatus(sessionId: string): Promise<ConductorSessionStatus> {
    const parsed = asRecord(await this.#json(['sessions', 'status', boundedId(sessionId, 'session_id')]));
    return requiredString(parsed.status).toLocaleLowerCase('en-US') as ConductorSessionStatus;
  }

  async readTranscript(sessionId: string, afterMessageId?: string): Promise<readonly ConductorMessage[]> {
    const id = boundedId(sessionId, 'session_id');
    const query = [
      'SELECT session_id, transcript, transcript_updated_at',
      'FROM session_transcripts_view',
      `WHERE session_id = '${id}'`,
      'LIMIT 1',
    ].join(' ');
    const parsed = asRecord(await this.#json(['sql', query]));
    const row = asArray(parsed.rows)[0];
    const transcript = optionalString(row?.transcript);
    if (!transcript) return [];

    const messageId = `transcript-${createHash('sha256').update(transcript).digest('hex')}`;
    if (afterMessageId === messageId) return [];
    this.#transcripts.set(id, { id: messageId, text: transcript });
    return [{ id: messageId, role: 'assistant', text: transcript }];
  }

  async cancel(sessionId: string): Promise<void> {
    await this.#command(['sessions', 'cancel', boundedId(sessionId, 'session_id')]);
  }

  async #command(args: string[]): Promise<void> {
    const result = await this.#run(args);
    if (!result.ok) throw new Error('conductor_cli_request_failed');
  }

  async #json(args: string[]): Promise<unknown> {
    const result = await this.#run(args);
    if (!result.ok) throw new Error('conductor_cli_request_failed');
    const parsed = parseJson(result.stdout);
    if (parsed === undefined) throw new Error('conductor_cli_invalid_json');
    return parsed;
  }

  async #run(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    const result = await this.#runner(this.#executable, ['--json', ...args]);
    return { ok: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
  }
}

async function defaultRunner(executable: string, args: readonly string[]) {
  try {
    const result = await execFileAsync(executable, [...args], {
      encoding: 'utf8',
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? '', exitCode: typeof failure.code === 'number' ? failure.code : 1 };
  }
}

function parseJson(stdout: string): unknown {
  try { return JSON.parse(stdout) as unknown; } catch { return undefined; }
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ['data', 'rows', 'items', 'projects']) {
    if (Array.isArray(value[key])) return value[key].filter(isRecord);
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('conductor_response_invalid_object');
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('conductor_response_missing_string');
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function boundedId(value: string, field: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(value)) throw new Error(`${field}_invalid`);
  return value;
}

function looksUnauthenticated(stdout: string, stderr: string): boolean {
  return /not authenticated|unauthenticated|no api key|unauthorized|401/i.test(`${stdout}\n${stderr}`);
}
