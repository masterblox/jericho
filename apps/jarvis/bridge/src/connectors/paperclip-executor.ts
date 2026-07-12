import { createHash } from 'node:crypto';

import {
  LifecycleStatus,
  type Assignment,
  type MissionPlan,
  type MissionTask,
  type PaperclipReconciliation,
} from '@jericho/shared';

export interface PaperclipIssue {
  id: string;
  status: string;
  metadata: Record<string, unknown>;
}

export interface PaperclipPort {
  findByIdempotencyKey(key: string, signal: AbortSignal): Promise<PaperclipIssue | undefined>;
  createIssue(input: {
    title: string;
    description: string;
    idempotencyKey: string;
    metadata: Record<string, string | number>;
  }, signal: AbortSignal): Promise<PaperclipIssue>;
}

export interface HttpPaperclipPortOptions {
  url: string;
  apiKey: string;
  companyId: string;
  fetch?: typeof globalThis.fetch;
}

export class HttpPaperclipPort implements PaperclipPort {
  readonly #url: URL;
  readonly #fetch: typeof globalThis.fetch;

  constructor(private readonly options: HttpPaperclipPortOptions) {
    this.#url = new URL(options.url);
    if (!['http:', 'https:'].includes(this.#url.protocol) || !options.apiKey.trim() || !options.companyId.trim()) {
      throw new Error('Paperclip client configuration is invalid');
    }
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async findByIdempotencyKey(key: string, signal: AbortSignal): Promise<PaperclipIssue | undefined> {
    const url = new URL('/api/issues', this.#url);
    url.searchParams.set('companyId', this.options.companyId);
    url.searchParams.set('idempotencyKey', key);
    const response = await this.#fetch(url, { headers: this.headers(), signal });
    if (!response.ok) throw new Error(`Paperclip lookup failed (${response.status})`);
    const body = await response.json() as unknown;
    const items = Array.isArray(body) ? body : isRecord(body) && Array.isArray(body.issues) ? body.issues : [];
    return items.length ? paperclipIssue(items[0]) : undefined;
  }

  async createIssue(input: Parameters<PaperclipPort['createIssue']>[0], signal: AbortSignal): Promise<PaperclipIssue> {
    const response = await this.#fetch(new URL('/api/issues', this.#url), {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, companyId: this.options.companyId }),
      signal,
    });
    if (!response.ok) throw new Error(`Paperclip create failed (${response.status})`);
    return paperclipIssue(await response.json());
  }

  private headers(): Record<string, string> {
    return { 'x-api-key': this.options.apiKey, accept: 'application/json' };
  }
}

/** Reconciles an approved Core assignment to Paperclip without trusting queue completion. */
export class PaperclipExecutor {
  constructor(
    private readonly port: PaperclipPort,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  async reconcile(
    mission: MissionPlan,
    task: MissionTask,
    assignment: Assignment,
    signal = new AbortController().signal,
  ): Promise<PaperclipReconciliation> {
    if (mission.status !== LifecycleStatus.Approved && mission.status !== LifecycleStatus.Active) {
      throw new Error('Paperclip projection requires an approved mission');
    }
    if (task.missionId !== mission.id || assignment.missionId !== mission.id || assignment.missionTaskId !== task.id) {
      throw new Error('Paperclip assignment binding does not match');
    }
    const idempotencyKey = paperclipKey(mission, task, assignment);
    const observedAt = new Date(this.clock()).toISOString();
    try {
      const existing = await this.port.findByIdempotencyKey(idempotencyKey, signal);
      const issue = existing ?? await this.port.createIssue({
        title: task.title,
        description: `Bounded Jericho assignment ${assignment.id}`,
        idempotencyKey,
        metadata: {
          missionId: mission.id,
          missionTaskId: task.id,
          assignmentId: assignment.id,
          planHash: mission.planHash,
          planVersion: mission.version,
        },
      }, signal);
      return {
        id: `paperclip-${idempotencyKey}`,
        missionId: mission.id,
        missionTaskId: task.id,
        assignmentId: assignment.id,
        planHash: mission.planHash,
        idempotencyKey,
        status: paperclipStatus(issue.status),
        issueId: issue.id,
        observedStatus: issue.status,
        verifiedByCore: assignment.status === LifecycleStatus.Succeeded,
        lastObservedAt: observedAt,
      };
    } catch (error) {
      return {
        id: `paperclip-${idempotencyKey}`,
        missionId: mission.id,
        missionTaskId: task.id,
        assignmentId: assignment.id,
        planHash: mission.planHash,
        idempotencyKey,
        status: LifecycleStatus.Paused,
        verifiedByCore: false,
        lastObservedAt: observedAt,
        error: error instanceof Error ? error.message : 'paperclip_unavailable',
      };
    }
  }
}

export function paperclipKey(mission: MissionPlan, task: MissionTask, assignment: Assignment): string {
  return createHash('sha256')
    .update([mission.id, mission.planHash, task.id, assignment.id].join('\0'))
    .digest('hex');
}

function paperclipStatus(value: string): LifecycleStatus {
  switch (value.toLocaleLowerCase()) {
    case 'open': case 'queued': return LifecycleStatus.Queued;
    case 'active': case 'in_progress': return LifecycleStatus.Active;
    case 'blocked': case 'paused': return LifecycleStatus.Paused;
    case 'done': case 'completed': return LifecycleStatus.Active; // observation only; Core verification still required
    case 'cancelled': return LifecycleStatus.Cancelled;
    default: return LifecycleStatus.Queued;
  }
}

function paperclipIssue(value: unknown): PaperclipIssue {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.status !== 'string') {
    throw new Error('Paperclip returned an invalid issue');
  }
  return { id: value.id, status: value.status, metadata: isRecord(value.metadata) ? value.metadata : {} };
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
