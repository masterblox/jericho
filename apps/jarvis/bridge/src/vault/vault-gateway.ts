import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_QUERY_CHARS = 500;
const MAX_RESULTS = 50;
const MAX_BODY_BYTES = 16 * 1024;

export interface VaultSearchResult {
  path: string;
  title: string;
  excerpt: string;
  score: number;
}

export interface VaultCommandRunner {
  run(argv: readonly string[], options: {
    timeoutMs: number;
    maxOutputBytes: number;
  }): Promise<{ stdout: string; stderr: string }>;
}

interface CacheEntry {
  query: string;
  limit: number;
  timestamp: string;
  results: number;
  items: VaultSearchResult[];
}

interface RagCache {
  version: 1;
  last_index?: string;
  index_size_mb?: number;
  cached_queries: Record<string, CacheEntry>;
}

export interface VaultGatewayServiceOptions {
  vaultPath: string;
  ragScriptPath: string;
  cachePath: string;
  indexPath: string;
  cacheTtlMs: number;
  staleAfterMs: number;
  maxOutputBytes: number;
  timeoutMs: number;
  clock?: () => string;
  commandRunner?: VaultCommandRunner;
}

export class VaultGatewayError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'VaultGatewayError';
  }
}

export class VaultGatewayService {
  readonly #clock: () => string;
  readonly #runner: VaultCommandRunner;
  #rebuild?: Promise<{ lastIndexAt: string; indexSizeMb: number }>;
  #operationChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: VaultGatewayServiceOptions) {
    for (const [name, value] of Object.entries({
      cacheTtlMs: options.cacheTtlMs,
      staleAfterMs: options.staleAfterMs,
      maxOutputBytes: options.maxOutputBytes,
      timeoutMs: options.timeoutMs,
    })) {
      if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} is invalid`);
    }
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#runner = options.commandRunner ?? new ExecFileVaultCommandRunner();
  }

  async search(query: string, limit: number): Promise<{ cached: boolean; results: VaultSearchResult[] }> {
    return this.#exclusive(() => this.#search(query, limit));
  }

  async #search(query: string, limit: number): Promise<{ cached: boolean; results: VaultSearchResult[] }> {
    const normalized = normalizeQuery(query);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RESULTS) {
      throw new VaultGatewayError('invalid_search', 'Vault search limit is invalid');
    }
    const now = this.#now();
    const cache = this.#readCache(now);
    const key = queryKey(normalized, limit);
    const cached = cache.cached_queries[key];
    if (cached) return { cached: true, results: structuredClone(cached.items) };

    const result = await this.#runner.run([
      'python3', this.options.ragScriptPath, 'search', normalized, '-n', String(limit), '--json',
    ], { timeoutMs: this.options.timeoutMs, maxOutputBytes: this.options.maxOutputBytes });
    if (Buffer.byteLength(result.stdout, 'utf8') > this.options.maxOutputBytes) {
      throw new VaultGatewayError('output_too_large', 'Vault RAG output exceeded its bound');
    }
    const results = parseSearchOutput(result.stdout, limit);
    cache.cached_queries[key] = {
      query: normalized,
      limit,
      timestamp: now.toISOString(),
      results: results.length,
      items: results,
    };
    this.#writeCache(cache);
    return { cached: false, results: structuredClone(results) };
  }

  async health(): Promise<{
    status: 'healthy' | 'degraded' | 'unavailable';
    lastCommitAt?: string;
    syncAgeMs?: number;
    lastIndexAt?: string;
    indexSizeMb?: number;
    cachedQueries: number;
    reason: string;
  }> {
    const now = this.#now();
    const cache = this.#readCache(now);
    try {
      const result = await this.#runner.run([
        'git', '-C', this.options.vaultPath, 'log', '-1', '--format=%cI',
      ], { timeoutMs: this.options.timeoutMs, maxOutputBytes: 4 * 1024 });
      const lastCommit = timestamp(result.stdout.trim(), 'Vault commit timestamp');
      const syncAgeMs = Math.max(0, now.getTime() - lastCommit.getTime());
      return {
        status: syncAgeMs > this.options.staleAfterMs ? 'degraded' : 'healthy',
        lastCommitAt: lastCommit.toISOString(),
        syncAgeMs,
        ...(cache.last_index ? { lastIndexAt: cache.last_index } : {}),
        ...(cache.index_size_mb !== undefined ? { indexSizeMb: cache.index_size_mb } : {}),
        cachedQueries: Object.keys(cache.cached_queries).length,
        reason: syncAgeMs > this.options.staleAfterMs ? 'sync_stale' : 'ok',
      };
    } catch {
      return {
        status: 'unavailable',
        ...(cache.last_index ? { lastIndexAt: cache.last_index } : {}),
        ...(cache.index_size_mb !== undefined ? { indexSizeMb: cache.index_size_mb } : {}),
        cachedQueries: Object.keys(cache.cached_queries).length,
        reason: 'vault_git_unavailable',
      };
    }
  }

  rebuildIndex(): Promise<{ lastIndexAt: string; indexSizeMb: number }> {
    if (this.#rebuild) {
      return Promise.reject(new VaultGatewayError('index_in_progress', 'Vault index rebuild is already active'));
    }
    const execution = this.#exclusive(async () => {
      const result = await this.#runner.run([
        'python3', this.options.ragScriptPath, 'index', '--json',
      ], { timeoutMs: this.options.timeoutMs, maxOutputBytes: this.options.maxOutputBytes });
      if (Buffer.byteLength(result.stdout, 'utf8') > this.options.maxOutputBytes) {
        throw new VaultGatewayError('output_too_large', 'Vault index output exceeded its bound');
      }
      const parsed = jsonRecord(result.stdout, 'Vault index output');
      let indexSizeMb = numberField(parsed.index_size_mb, 'index_size_mb');
      if (!Number.isFinite(indexSizeMb)) {
        indexSizeMb = statSync(this.options.indexPath).size / (1024 * 1024);
      }
      const lastIndexAt = this.#now().toISOString();
      this.#writeCache({
        version: 1,
        last_index: lastIndexAt,
        index_size_mb: indexSizeMb,
        cached_queries: {},
      });
      return { lastIndexAt, indexSizeMb };
    });
    this.#rebuild = execution;
    return execution.finally(() => {
      if (this.#rebuild === execution) this.#rebuild = undefined;
    });
  }

  /**
   * Read a specific vault note by its relative path.
   * Returns the note content, title, and last modified timestamp.
   */
  async readNote(relativePath: string): Promise<{
    content: string;
    title: string;
    lastModified: string;
  } | null> {
    return this.#exclusive(() => this.#readNote(relativePath));
  }

  async #readNote(relativePath: string): Promise<{
    content: string;
    title: string;
    lastModified: string;
  } | null> {
    const normalized = relativePath.replace(/\\/gu, '/').replace(/^\/+/u, '');
    if (normalized.includes('..') || normalized.startsWith('.')) {
      throw new VaultGatewayError('invalid_path', 'Vault note path contains traversal');
    }
    const fullPath = join(this.options.vaultPath, normalized);
    try {
      const vaultReal = realpathSync(this.options.vaultPath);
      const fileReal = realpathSync(fullPath);
      if (!fileReal.startsWith(vaultReal)) {
        throw new VaultGatewayError('path_escape', 'Vault note path escapes the vault');
      }
      const content = readFileSync(fullPath, 'utf8');
      const titleMatch = /^#\s+(.+)$/u.exec(content);
      const title = titleMatch?.[1] ?? normalized.split('/').pop()?.replace(/\.md$/u, '') ?? normalized;
      const stat = statSync(fullPath);
      const lastModified = stat.mtime.toISOString();
      return { content, title, lastModified };
    } catch (cause) {
      if (cause instanceof VaultGatewayError) throw cause;
      return null;
    }
  }

  #now(): Date {
    return timestamp(this.#clock(), 'Vault gateway clock');
  }

  #readCache(now: Date): RagCache {
    let value: RagCache = { version: 1, cached_queries: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.options.cachePath, 'utf8')) as unknown;
      value = parseCache(parsed);
    } catch { /* corrupt or absent cache starts empty */ }
    const fresh = Object.fromEntries(Object.entries(value.cached_queries).filter(([, entry]) => {
      const age = now.getTime() - timestamp(entry.timestamp, 'Cache timestamp').getTime();
      return age >= 0 && age < this.options.cacheTtlMs;
    }));
    return { ...value, cached_queries: fresh };
  }

  #writeCache(cache: RagCache): void {
    mkdirSync(dirname(this.options.cachePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.options.cachePath}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(cache, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.options.cachePath);
  }

  async #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#operationChain;
    let release!: () => void;
    this.#operationChain = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export class ExecFileVaultCommandRunner implements VaultCommandRunner {
  async run(argv: readonly string[], options: { timeoutMs: number; maxOutputBytes: number }) {
    const [executable, ...args] = argv;
    if (!executable) throw new Error('Vault command executable is missing');
    try {
      const result = await execFileAsync(executable, args, {
        timeout: options.timeoutMs,
        maxBuffer: options.maxOutputBytes,
        encoding: 'utf8',
        windowsHide: true,
      });
      return { stdout: result.stdout, stderr: result.stderr };
    } catch (cause) {
      throw new VaultGatewayError('command_failed', 'Vault command failed', { cause });
    }
  }
}

export function createVaultGatewayServer(options: {
  service: VaultGatewayService;
  token: string;
  host: string;
}) {
  assertPrivateHost(options.host);
  if (!options.token.trim() || options.token.length > 512) throw new TypeError('Vault gateway token is invalid');
  const server = createServer((request, response) => {
    void route(request, response, options).catch((error) => sendError(response, error));
  });
  return {
    listen: (port: number) => new Promise<{ host: string; port: number }>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, options.host, () => {
        server.off('error', reject);
        const address = server.address();
        if (!address || typeof address === 'string') return reject(new Error('Vault gateway address unavailable'));
        resolve({ host: options.host, port: address.port });
      });
    }),
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  options: { service: VaultGatewayService; token: string },
): Promise<void> {
  if (!authorized(request.headers.authorization, options.token)) return sendJson(response, 401, { error: 'unauthorized' });
  const path = new URL(request.url ?? '/', 'http://vault.local').pathname;
  if (request.method === 'GET' && path === '/v1/jericho/vault/health') {
    return sendJson(response, 200, await options.service.health());
  }
  if (request.method === 'POST' && path === '/v1/jericho/vault/search') {
    const body = await readJson(request);
    return sendJson(response, 200, await options.service.search(String(body.query ?? ''), Number(body.limit)));
  }
  if (request.method === 'POST' && path === '/v1/jericho/vault/note') {
    const body = await readJson(request);
    const notePath = String(body.path ?? '');
    if (!notePath.trim()) return sendJson(response, 400, { error: 'path_required' });
    const note = await options.service.readNote(notePath);
    return sendJson(response, 200, note ?? { error: 'not_found' });
  }
  if (request.method === 'POST' && path === '/v1/jericho/vault/index') {
    return sendJson(response, 200, await options.service.rebuildIndex());
  }
  sendJson(response, 404, { error: 'not_found' });
}

function authorized(value: string | undefined, token: string): boolean {
  if (!value?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(value.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function assertPrivateHost(host: string): void {
  if (host === 'localhost') return;
  if (isIP(host) === 6) {
    if (host === '::1' || host.toLowerCase().startsWith('fc') || host.toLowerCase().startsWith('fd')) return;
    throw new TypeError('Vault gateway must bind to a private address');
  }
  if (isIP(host) !== 4) throw new TypeError('Vault gateway host must be a private IP literal or localhost');
  const octets = host.split('.').map(Number);
  const privateAddress = octets[0] === 127 || octets[0] === 10
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127);
  if (!privateAddress) throw new TypeError('Vault gateway must bind to a private address');
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new VaultGatewayError('body_too_large', 'Vault request body is too large');
    chunks.push(bytes);
  }
  return jsonRecord(Buffer.concat(chunks).toString('utf8'), 'Vault request body');
}

function sendError(response: ServerResponse, error: unknown): void {
  if (error instanceof VaultGatewayError) {
    const status = error.code === 'index_in_progress' ? 409
      : error.code.startsWith('invalid_') || error.code === 'body_too_large' ? 400
        : 502;
    return sendJson(response, status, { error: error.code });
  }
  sendJson(response, 500, { error: 'internal_error' });
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function normalizeQuery(query: string): string {
  const normalized = query.replace(/\s+/gu, ' ').trim();
  if (!normalized || normalized.length > MAX_QUERY_CHARS || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new VaultGatewayError('invalid_search', 'Vault search query is invalid');
  }
  return normalized;
}

function queryKey(query: string, limit: number): string {
  return createHash('sha256').update(`${query}\u0000${limit}`).digest('hex');
}

function parseSearchOutput(output: string, limit: number): VaultSearchResult[] {
  const record = jsonRecord(output, 'Vault search output');
  if (!Array.isArray(record.results) || record.results.length > limit) {
    throw new VaultGatewayError('invalid_output', 'Vault search output results are invalid');
  }
  return record.results.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new VaultGatewayError('invalid_output', 'Vault search result is invalid');
    }
    const item = value as Record<string, unknown>;
    const path = boundedString(item.path, 1_024, 'path');
    if (path.startsWith('/') || path.includes('..') || path.includes('\\')) {
      throw new VaultGatewayError('invalid_output', 'Vault search path is invalid');
    }
    return {
      path,
      title: boundedString(item.title, 500, 'title'),
      excerpt: boundedString(item.excerpt, 4_000, 'excerpt'),
      score: numberField(item.score, 'score'),
    };
  });
}

function parseCache(value: unknown): RagCache {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Cache is invalid');
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !record.cached_queries || typeof record.cached_queries !== 'object') {
    throw new Error('Cache is invalid');
  }
  const entries: Record<string, CacheEntry> = {};
  for (const [key, raw] of Object.entries(record.cached_queries as Record<string, unknown>)) {
    if (!/^[a-f0-9]{64}$/u.test(key) || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    if (!Array.isArray(item.items)) continue;
    entries[key] = {
      query: boundedString(item.query, MAX_QUERY_CHARS, 'query'),
      limit: numberField(item.limit, 'limit'),
      timestamp: timestamp(String(item.timestamp), 'Cache timestamp').toISOString(),
      results: numberField(item.results, 'results'),
      items: parseSearchOutput(JSON.stringify({ results: item.items }), MAX_RESULTS),
    };
  }
  return {
    version: 1,
    ...(typeof record.last_index === 'string' ? { last_index: timestamp(record.last_index, 'Index timestamp').toISOString() } : {}),
    ...(typeof record.index_size_mb === 'number' ? { index_size_mb: numberField(record.index_size_mb, 'index_size_mb') } : {}),
    cached_queries: entries,
  };
}

function jsonRecord(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new VaultGatewayError('invalid_output', `${label} is not JSON`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new VaultGatewayError('invalid_output', `${label} must be an object`);
  }
  return parsed as Record<string, unknown>;
}

function boundedString(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new VaultGatewayError('invalid_output', `Vault ${label} is invalid`);
  }
  return value;
}

function numberField(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new VaultGatewayError('invalid_output', `Vault ${label} is invalid`);
  }
  return value;
}

function timestamp(value: string, label: string): Date {
  const parsed = new Date(value);
  if (!value || !Number.isFinite(parsed.getTime())) throw new VaultGatewayError('invalid_output', `${label} is invalid`);
  return parsed;
}
