export interface VaultGatewaySearchResult {
  path: string;
  title: string;
  excerpt: string;
  score: number;
}

export interface VaultGatewayHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  lastCommitAt?: string;
  syncAgeMs?: number;
  lastIndexAt?: string;
  indexSizeMb?: number;
  cachedQueries: number;
  reason: string;
}

export interface VaultGatewayPort {
  search(query: string, limit: number, signal: AbortSignal): Promise<{
    cached: boolean;
    results: VaultGatewaySearchResult[];
  }>;
  health(signal: AbortSignal): Promise<VaultGatewayHealth>;
  rebuildIndex(signal: AbortSignal): Promise<{ lastIndexAt: string; indexSizeMb: number }>;
}

export interface HttpVaultGatewayClientOptions {
  gatewayUrl: string;
  gatewayToken: string;
  timeoutMs: number;
  maxResponseBytes: number;
  fetch?: typeof globalThis.fetch;
}

export class HttpVaultGatewayClient implements VaultGatewayPort {
  readonly #url: URL;
  readonly #fetch: typeof globalThis.fetch;

  constructor(private readonly options: HttpVaultGatewayClientOptions) {
    this.#url = new URL(options.gatewayUrl);
    if (this.#url.protocol !== 'https:' && !isLoopback(this.#url.hostname)) {
      throw new TypeError('Vault gateway URL must use HTTPS outside loopback');
    }
    if (!options.gatewayToken.trim() || options.gatewayToken.length > 512) {
      throw new TypeError('Vault gateway token is invalid');
    }
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1
      || !Number.isInteger(options.maxResponseBytes) || options.maxResponseBytes < 1) {
      throw new TypeError('Vault gateway bounds are invalid');
    }
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async search(query: string, limit: number, signal: AbortSignal) {
    const value = await this.#request('/v1/jericho/vault/search', 'POST', signal, { query, limit });
    if (typeof value.cached !== 'boolean' || !Array.isArray(value.results) || value.results.length > limit) {
      throw new Error('Vault gateway returned invalid search results');
    }
    const results = value.results.map(searchResult);
    return { cached: value.cached, results };
  }

  async health(signal: AbortSignal): Promise<VaultGatewayHealth> {
    const value = await this.#request('/v1/jericho/vault/health', 'GET', signal);
    if (value.status !== 'healthy' && value.status !== 'degraded' && value.status !== 'unavailable') {
      throw new Error('Vault gateway returned invalid health status');
    }
    const cachedQueries = boundedNumber(value.cachedQueries, 'cachedQueries');
    const reason = boundedString(value.reason, 100, 'reason');
    return {
      status: value.status,
      ...(value.lastCommitAt !== undefined ? { lastCommitAt: isoTimestamp(value.lastCommitAt, 'lastCommitAt') } : {}),
      ...(value.syncAgeMs !== undefined ? { syncAgeMs: boundedNumber(value.syncAgeMs, 'syncAgeMs') } : {}),
      ...(value.lastIndexAt !== undefined ? { lastIndexAt: isoTimestamp(value.lastIndexAt, 'lastIndexAt') } : {}),
      ...(value.indexSizeMb !== undefined ? { indexSizeMb: boundedNumber(value.indexSizeMb, 'indexSizeMb') } : {}),
      cachedQueries,
      reason,
    };
  }

  async rebuildIndex(signal: AbortSignal) {
    const value = await this.#request('/v1/jericho/vault/index', 'POST', signal, {});
    return {
      lastIndexAt: isoTimestamp(value.lastIndexAt, 'lastIndexAt'),
      indexSizeMb: boundedNumber(value.indexSizeMb, 'indexSizeMb'),
    };
  }

  async #request(
    path: string,
    method: 'GET' | 'POST',
    callerSignal: AbortSignal,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Vault gateway request timed out')), this.options.timeoutMs);
    timeout.unref?.();
    const signal = AbortSignal.any([callerSignal, controller.signal]);
    try {
      const response = await this.#fetch(new URL(path.replace(/^\//u, ''), ensureTrailingSlash(this.#url)), {
        method,
        signal,
        headers: {
          authorization: `Bearer ${this.options.gatewayToken}`,
          accept: 'application/json',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new Error(`Vault gateway request failed with status ${response.status}`);
      const text = await boundedResponseText(response, this.options.maxResponseBytes);
      let value: unknown;
      try { value = JSON.parse(text); } catch { throw new Error('Vault gateway returned malformed JSON'); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Vault gateway returned an invalid response');
      }
      return value as Record<string, unknown>;
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function boundedResponseText(response: Response, maximum: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maximum) throw new Error('Vault gateway response exceeded its bound');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(combined);
}

function searchResult(value: unknown): VaultGatewaySearchResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Vault search result is invalid');
  const record = value as Record<string, unknown>;
  const path = boundedString(record.path, 1_024, 'path');
  if (path.startsWith('/') || path.includes('..') || path.includes('\\')) throw new Error('Vault search path is invalid');
  return {
    path,
    title: boundedString(record.title, 500, 'title'),
    excerpt: boundedString(record.excerpt, 4_000, 'excerpt'),
    score: boundedNumber(record.score, 'score'),
  };
}

function boundedString(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(`Vault gateway ${label} is invalid`);
  }
  return value;
}

function boundedNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Vault gateway ${label} is invalid`);
  }
  return value;
}

function isoTimestamp(value: unknown, label: string): string {
  const parsed = typeof value === 'string' ? new Date(value) : new Date(Number.NaN);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Vault gateway ${label} is invalid`);
  return parsed.toISOString();
}

function ensureTrailingSlash(value: URL): URL {
  const copy = new URL(value);
  if (!copy.pathname.endsWith('/')) copy.pathname += '/';
  return copy;
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}
