// Read-only Paperclip fleet board client. Paperclip is the Hermes fleet's
// task/agent backend; this client only projects its roster and issues into
// the sphere. It never mutates, never logs the key, and fails closed to an
// unavailable snapshot on any upstream problem.

export interface FleetAgent {
  id: string;
  name: string;
  role: string;
  status: string;
  lastHeartbeatAt: string | null;
}

export interface FleetIssue {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority: string | null;
  assigneeAgentId: string | null;
  createdAt: string | null;
  completedAt: string | null;
}

export interface FleetSnapshot {
  available: boolean;
  agents: FleetAgent[];
  issues: FleetIssue[];
}

export interface FleetPort {
  snapshot(): Promise<FleetSnapshot>;
}

export interface PaperclipFleetClientOptions {
  apiUrl: string;
  apiKey: string;
  companyId: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  failureCacheTtlMs?: number;
  issueLimit?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const UNAVAILABLE: FleetSnapshot = Object.freeze({ available: false, agents: [], issues: [] });

export class PaperclipFleetClient implements FleetPort {
  readonly #apiUrl: string;
  readonly #apiKey: string;
  readonly #companyId: string;
  readonly #timeoutMs: number;
  readonly #cacheTtlMs: number;
  readonly #failureCacheTtlMs: number;
  readonly #issueLimit: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  #cached: FleetSnapshot | null = null;
  #cachedAt = Number.NEGATIVE_INFINITY;
  #inFlight: Promise<FleetSnapshot> | null = null;

  constructor(options: PaperclipFleetClientOptions) {
    this.#apiUrl = options.apiUrl.replace(/\/+$/, '');
    this.#apiKey = options.apiKey;
    this.#companyId = options.companyId;
    this.#timeoutMs = options.timeoutMs ?? 6_000;
    this.#cacheTtlMs = options.cacheTtlMs ?? 20_000;
    this.#failureCacheTtlMs = options.failureCacheTtlMs ?? 5_000;
    this.#issueLimit = options.issueLimit ?? 50;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  async snapshot(): Promise<FleetSnapshot> {
    const age = this.#now() - this.#cachedAt;
    if (this.#cached) {
      const ttl = this.#cached.available ? this.#cacheTtlMs : this.#failureCacheTtlMs;
      if (age < ttl) return this.#cached;
    }
    this.#inFlight ??= this.#refresh().finally(() => { this.#inFlight = null; });
    return this.#inFlight;
  }

  async #refresh(): Promise<FleetSnapshot> {
    let snapshot: FleetSnapshot;
    try {
      const [agents, issues] = await Promise.all([
        this.#get(`/api/companies/${this.#companyId}/agents`),
        this.#get(`/api/companies/${this.#companyId}/issues?limit=${this.#issueLimit}`),
      ]);
      snapshot = {
        available: true,
        agents: normalizeAgents(agents),
        issues: normalizeIssues(issues),
      };
    } catch (cause) {
      // Message only — the bearer key must never reach a log line.
      console.error(
        '[jericho] fleet snapshot failed:',
        cause instanceof Error ? cause.message : 'unknown error',
      );
      snapshot = UNAVAILABLE;
    }
    this.#cached = snapshot;
    this.#cachedAt = this.#now();
    return snapshot;
  }

  async #get(path: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(`${this.#apiUrl}${path}`, {
        headers: { authorization: `Bearer ${this.#apiKey}`, accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`paperclip responded ${response.status}`);
      return await response.json() as unknown;
    } finally {
      clearTimeout(timer);
    }
  }
}

function normalizeAgents(payload: unknown): FleetAgent[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string') return [];
    return [{
      id: entry.id,
      name: entry.name,
      role: typeof entry.role === 'string' ? entry.role : 'general',
      status: typeof entry.status === 'string' ? entry.status : 'unknown',
      lastHeartbeatAt: typeof entry.lastHeartbeatAt === 'string' ? entry.lastHeartbeatAt : null,
    }];
  });
}

function normalizeIssues(payload: unknown): FleetIssue[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.title !== 'string') return [];
    return [{
      id: entry.id,
      identifier: typeof entry.identifier === 'string' ? entry.identifier : entry.id,
      title: entry.title,
      status: typeof entry.status === 'string' ? entry.status : 'unknown',
      priority: typeof entry.priority === 'string' ? entry.priority : null,
      assigneeAgentId: typeof entry.assigneeAgentId === 'string' ? entry.assigneeAgentId : null,
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : null,
      completedAt: typeof entry.completedAt === 'string' ? entry.completedAt : null,
    }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
