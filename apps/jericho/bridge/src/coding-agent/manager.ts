import { randomUUID } from 'node:crypto';

import {
  CodingAgentLifecycleError,
  type CodingAgentReceipt,
  type CodingAgentTask,
} from './contracts.js';
import type { CodingAgentLifecycle } from './lifecycle.js';
import type { LocalGitRepositoryPort } from './local-git.js';

const TERMINAL = new Set(['conductor_auth_required', 'succeeded', 'failed', 'timed_out', 'cancelled', 'incomplete']);

export interface CodingAgentRepository {
  id: string;
  path: string;
  projectId?: string;
  projectName?: string;
  repoUrl?: string;
}

export interface StartCodingAgentInput {
  repository: unknown;
  task: unknown;
}

export interface CodingAgentManagerPort {
  start(input: StartCodingAgentInput): Promise<CodingAgentReceipt>;
  status(taskId: unknown): Promise<CodingAgentReceipt>;
  steer(taskId: unknown, message: unknown): Promise<CodingAgentReceipt>;
  cancel(taskId: unknown): Promise<CodingAgentReceipt>;
  list(): Promise<CodingAgentReceipt[]>;
}

export interface CodingAgentManagerOptions {
  model?: string;
  maximumActive?: number;
  maximumRetained?: number;
  idFactory?: () => string;
}

interface ManagedTask {
  receipt: CodingAgentReceipt;
  startedAt: number;
  run: Promise<void>;
}

/** Non-blocking task monitor for Conductor sessions and Git-backed completion. */
export class CodingAgentManager implements CodingAgentManagerPort {
  readonly #repositories: ReadonlyMap<string, CodingAgentRepository>;
  readonly #lifecycle: CodingAgentLifecycle;
  readonly #git: Pick<LocalGitRepositoryPort, 'originUrl'>;
  readonly #model: string;
  readonly #maximumActive: number;
  readonly #maximumRetained: number;
  readonly #idFactory: () => string;
  readonly #tasks = new Map<string, ManagedTask>();

  constructor(
    lifecycle: CodingAgentLifecycle,
    git: Pick<LocalGitRepositoryPort, 'originUrl'>,
    repositories: readonly CodingAgentRepository[],
    options: CodingAgentManagerOptions = {},
  ) {
    const normalized = repositories.map((repository) => {
      const id = boundedIdentifier(repository.id, 'repository');
      if (!repository.path.trim()) throw new Error('repository_path_invalid');
      return [id, { ...repository, id }] as const;
    });
    if (new Set(normalized.map(([id]) => id)).size !== normalized.length) {
      throw new Error('duplicate_coding_repository');
    }
    this.#repositories = new Map(normalized);
    this.#lifecycle = lifecycle;
    this.#git = git;
    this.#model = boundedModel(options.model ?? 'gpt-5.3-codex-spark');
    this.#maximumActive = boundedInteger(options.maximumActive ?? 4, 1, 16, 'maximum_active');
    this.#maximumRetained = boundedInteger(options.maximumRetained ?? 128, 8, 1_024, 'maximum_retained');
    this.#idFactory = options.idFactory ?? (() => `coding-${randomUUID()}`);
  }

  async start(input: StartCodingAgentInput): Promise<CodingAgentReceipt> {
    const repositoryId = boundedIdentifier(input.repository, 'repository');
    const repository = this.#repositories.get(repositoryId);
    if (!repository) throw new Error('repository_not_configured');
    const prompt = boundedMessage(input.task, 'task', 12_000);
    if (this.#activeCount() >= this.#maximumActive) throw new Error('coding_agent_capacity_reached');
    const taskId = boundedIdentifier(this.#idFactory(), 'task_id', 128);
    if (this.#tasks.has(taskId)) throw new Error('coding_agent_task_id_collision');
    const repoUrl = repository.repoUrl ?? await this.#git.originUrl(repository.path);
    const task: CodingAgentTask = {
      taskId,
      repositoryPath: repository.path,
      project: {
        ...(repository.projectId ? { id: repository.projectId } : {}),
        name: repository.projectName ?? repository.id,
        ...(repoUrl ? { repoUrl } : {}),
      },
      workspaceName: workspaceName(repository.id, prompt),
      model: this.#model,
      prompt,
    };
    const initial: CodingAgentReceipt = { taskId, workspaceName: task.workspaceName, lifecycleStatus: 'queued' };
    const managed: ManagedTask = {
      receipt: initial,
      startedAt: Date.now(),
      run: Promise.resolve(),
    };
    this.#tasks.set(taskId, managed);
    managed.run = this.#run(managed, task);
    this.#prune();
    return structuredClone(initial);
  }

  async status(taskId: unknown): Promise<CodingAgentReceipt> {
    return structuredClone(this.#managed(taskId).receipt);
  }

  async steer(taskId: unknown, message: unknown): Promise<CodingAgentReceipt> {
    const managed = this.#managed(taskId);
    if (TERMINAL.has(managed.receipt.lifecycleStatus)) throw new Error('coding_agent_task_terminal');
    if (!managed.receipt.sessionId) throw new Error('coding_agent_session_pending');
    await this.#lifecycle.steer(
      managed.receipt.sessionId,
      boundedMessage(message, 'message', 4_000),
    );
    return structuredClone(managed.receipt);
  }

  async cancel(taskId: unknown): Promise<CodingAgentReceipt> {
    const managed = this.#managed(taskId);
    if (TERMINAL.has(managed.receipt.lifecycleStatus)) return structuredClone(managed.receipt);
    managed.receipt = await this.#lifecycle.cancel(managed.receipt);
    return structuredClone(managed.receipt);
  }

  async list(): Promise<CodingAgentReceipt[]> {
    return [...this.#tasks.values()]
      .sort((first, second) => second.startedAt - first.startedAt)
      .map((task) => structuredClone(task.receipt));
  }

  async #run(managed: ManagedTask, task: CodingAgentTask): Promise<void> {
    try {
      const final = await this.#lifecycle.run(task, (update) => {
        if (managed.receipt.lifecycleStatus !== 'cancelled') managed.receipt = update;
      });
      if (managed.receipt.lifecycleStatus !== 'cancelled') managed.receipt = final;
    } catch (error) {
      if (managed.receipt.lifecycleStatus === 'cancelled') return;
      managed.receipt = {
        ...managed.receipt,
        lifecycleStatus: 'failed',
        errorCode: codingAgentErrorCode(error),
      };
    }
  }

  #managed(taskId: unknown): ManagedTask {
    const id = boundedIdentifier(taskId, 'task_id', 128);
    const task = this.#tasks.get(id);
    if (!task) throw new Error('coding_agent_task_not_found');
    return task;
  }

  #activeCount(): number {
    return [...this.#tasks.values()].filter((task) => !TERMINAL.has(task.receipt.lifecycleStatus)).length;
  }

  #prune(): void {
    if (this.#tasks.size <= this.#maximumRetained) return;
    const completed = [...this.#tasks.entries()]
      .filter(([, task]) => TERMINAL.has(task.receipt.lifecycleStatus))
      .sort((first, second) => first[1].startedAt - second[1].startedAt);
    while (this.#tasks.size > this.#maximumRetained && completed.length) {
      const next = completed.shift();
      if (next) this.#tasks.delete(next[0]);
    }
  }
}

function codingAgentErrorCode(error: unknown): string {
  if (error instanceof CodingAgentLifecycleError) return error.code;
  const message = error instanceof Error ? error.message : '';
  const allowed = new Set([
    'conductor_cli_request_failed',
    'conductor_cli_invalid_json',
    'conductor_response_invalid_object',
    'conductor_response_missing_string',
    'project_not_found',
  ]);
  return allowed.has(message) ? message : 'coding_agent_failed';
}

function boundedIdentifier(value: unknown, field: string, maximum = 64): string {
  if (typeof value !== 'string') throw new Error(`${field}_invalid`);
  const normalized = value.trim();
  if (!new RegExp(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,${maximum - 1}}$`, 'u').test(normalized)) {
    throw new Error(`${field}_invalid`);
  }
  return normalized;
}

function boundedMessage(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`${field}_invalid`);
  const normalized = value.replace(/\r\n?/gu, '\n').trim();
  if (!normalized || normalized.length > maximum || /[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) {
    throw new Error(`${field}_invalid`);
  }
  return normalized;
}

function boundedModel(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(normalized)) throw new Error('coding_agent_model_invalid');
  return normalized;
}

function boundedInteger(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${field}_invalid`);
  return value;
}

function workspaceName(repository: string, task: string): string {
  const summary = task.split('\n', 1)[0]
    .replace(/[^\p{L}\p{N} ._:+-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 64)
    .trim();
  return `${repository}: ${summary || 'coding task'}`.slice(0, 80).trim();
}
