import { createHash } from 'node:crypto';
import {
  createReadStream,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createInterface } from 'node:readline';
import { join, relative, sep } from 'node:path';
import { setImmediate as setImm } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import type { MemoryRootAuthority } from '@jericho/shared';

import type { MemoryRootConfig } from '../config.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES_PER_ROOT = 50_000;
const SKIP_DIR_NAMES = new Set([
  '.git',
  '.obsidian',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'vendor',
  'out',
  'target',
]);

const WORKER_PATH = fileURLToPath(new URL('./memory-index-worker.mjs', import.meta.url));

function shouldSkipDirectory(name: string): boolean {
  if (name.startsWith('.')) return true;
  if (SKIP_DIR_NAMES.has(name)) return true;
  if (name.startsWith('node_modules_')) return true;
  return false;
}

export interface MemoryIndexHit {
  sourceId: string;
  rootId: string;
  authority: MemoryRootAuthority;
  relativePath: string;
  title: string;
  excerpt: string;
  score: number;
  content: string;
}

export interface MemoryRootHealth {
  id: string;
  authority: MemoryRootAuthority;
  documentCount: number;
  revision: string;
  lastIndexedAt?: string;
  available: boolean;
}

export type MemoryIndexStatus = 'idle' | 'indexing' | 'error';

export interface MemoryIndexHealth {
  available: boolean;
  revision: string;
  status: MemoryIndexStatus;
  lastSuccessAt?: string;
  lastDurationMs?: number;
  lastError?: string;
  roots: MemoryRootHealth[];
}

interface IndexedDocument {
  sourceId: string;
  rootId: string;
  authority: MemoryRootAuthority;
  relativePath: string;
  title: string;
  content: string;
  tokens: string[];
  termFreq: Map<string, number>;
}

interface ImmutableSnapshot {
  revision: string;
  indexedAt: string;
  documents: IndexedDocument[];
  docFreq: Map<string, number>;
  avgDocLength: number;
  rootStats: Map<string, { documentCount: number; revision: string; lastIndexedAt: string }>;
}

interface WorkerDocument {
  sourceId: string;
  rootId: string;
  authority: MemoryRootAuthority;
  relativePath: string;
  title: string;
  content: string;
  tokens: string[];
  termFreqEntries: Array<[string, number]>;
}

interface WorkerSnapshot {
  revision: string;
  indexedAt: string;
  documents: WorkerDocument[];
  docFreqEntries: Array<[string, number]>;
  avgDocLength: number;
  rootStats: Array<{ id: string; documentCount: number; revision: string; lastIndexedAt: string }>;
}

export interface MemoryIndexOptions {
  roots: readonly MemoryRootConfig[];
  maxFileBytes?: number;
  maxFilesPerRoot?: number;
  clock?: () => string;
}

/**
 * Read-only multi-root Markdown BM25 index.
 * Snapshots are immutable; successful refreshes swap atomically.
 * Large refreshes run in a worker thread so the Core event loop stays responsive.
 */
export class MemoryIndex {
  readonly #roots: readonly MemoryRootConfig[];
  readonly #maxFileBytes: number;
  readonly #maxFilesPerRoot: number;
  readonly #clock: () => string;
  #snapshot: ImmutableSnapshot | undefined;
  #available = false;
  #status: MemoryIndexStatus = 'idle';
  #lastSuccessAt: string | undefined;
  #lastDurationMs: number | undefined;
  #lastError: string | undefined;
  #inflight: Promise<MemoryIndexHealth> | undefined;
  readonly #snapshotListeners = new Set<() => void>();

  constructor(options: MemoryIndexOptions) {
    this.#roots = options.roots;
    this.#maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES;
    this.#maxFilesPerRoot = options.maxFilesPerRoot ?? MAX_FILES_PER_ROOT;
    this.#clock = options.clock ?? (() => new Date().toISOString());
  }

  get available(): boolean {
    return this.#available && this.#snapshot !== undefined;
  }

  get revision(): string {
    return this.#snapshot?.revision ?? 'unindexed';
  }

  get status(): MemoryIndexStatus {
    return this.#status;
  }

  /** Notify after a successful atomic snapshot swap (for identity-cache invalidation). */
  onSnapshotSwapped(listener: () => void): () => void {
    this.#snapshotListeners.add(listener);
    return () => {
      this.#snapshotListeners.delete(listener);
    };
  }

  health(): MemoryIndexHealth {
    const roots: MemoryRootHealth[] = this.#roots.map((root) => {
      const stats = this.#snapshot?.rootStats.get(root.id);
      return {
        id: root.id,
        authority: root.authority,
        documentCount: stats?.documentCount ?? 0,
        revision: stats?.revision ?? 'unindexed',
        ...(stats?.lastIndexedAt ? { lastIndexedAt: stats.lastIndexedAt } : {}),
        available: this.available,
      };
    });
    return {
      available: this.available,
      revision: this.revision,
      status: this.#status,
      ...(this.#lastSuccessAt ? { lastSuccessAt: this.#lastSuccessAt } : {}),
      ...(this.#lastDurationMs !== undefined ? { lastDurationMs: this.#lastDurationMs } : {}),
      ...(this.#lastError ? { lastError: this.#lastError } : {}),
      roots,
    };
  }

  /**
   * Synchronous refresh for tests and tiny corpora.
   * Preserves the last valid snapshot on failure. Refuses to overlap an in-flight async refresh.
   */
  refresh(): MemoryIndexHealth {
    if (this.#inflight || this.#status === 'indexing') {
      return this.health();
    }
    if (this.#roots.length === 0) {
      this.#snapshot = undefined;
      this.#available = false;
      this.#status = 'idle';
      this.#lastError = undefined;
      return this.health();
    }
    const started = Date.now();
    this.#status = 'indexing';
    try {
      const snapshot = buildSnapshotLocal(
        this.#roots,
        this.#maxFileBytes,
        this.#maxFilesPerRoot,
        this.#clock(),
      );
      return this.#commitSnapshot(snapshot, started);
    } catch (error) {
      return this.#failRefresh(error, started);
    }
  }

  /**
   * Non-overlapping async refresh off the Node event loop via worker_threads.
   * Concurrent callers share the same in-flight promise. Failed builds keep the prior snapshot.
   */
  requestRefresh(): Promise<MemoryIndexHealth> {
    if (this.#inflight) return this.#inflight;
    if (this.#roots.length === 0) {
      this.#snapshot = undefined;
      this.#available = false;
      this.#status = 'idle';
      this.#lastError = undefined;
      return Promise.resolve(this.health());
    }
    const started = Date.now();
    this.#status = 'indexing';
    this.#lastError = undefined;
    this.#inflight = this.#buildInWorker(this.#clock())
      .then((snapshot) => this.#commitSnapshot(snapshot, started))
      .catch((error) => this.#failRefresh(error, started))
      .finally(() => {
        this.#inflight = undefined;
      });
    return this.#inflight;
  }

  search(query: string, limit = 8): MemoryIndexHit[] {
    if (!this.available || !this.#snapshot) {
      throw new Error('memory_index_unavailable');
    }
    const normalized = query.replace(/\s+/gu, ' ').trim();
    if (!normalized || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error('Memory index search bounds are invalid');
    }
    const terms = tokenize(normalized);
    if (!terms.length) return [];
    const scored = this.#snapshot.documents.map((document) => ({
      document,
      score: bm25Score(document, terms, this.#snapshot!.docFreq, this.#snapshot!.documents.length, this.#snapshot!.avgDocLength),
    }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) =>
        authorityRank(left.document.authority) - authorityRank(right.document.authority)
        || right.score - left.score
        || left.document.relativePath.localeCompare(right.document.relativePath));

    const maxScore = scored[0]?.score ?? 0;
    return scored.slice(0, limit).map(({ document, score }) => ({
      sourceId: document.sourceId,
      rootId: document.rootId,
      authority: document.authority,
      relativePath: document.relativePath,
      title: document.title,
      excerpt: excerptAround(document.content, terms),
      score: maxScore > 0 ? Math.min(1, score / maxScore) : 0,
      content: document.content,
    }));
  }

  #commitSnapshot(snapshot: ImmutableSnapshot, startedMs: number): MemoryIndexHealth {
    this.#snapshot = snapshot;
    this.#available = true;
    this.#status = 'idle';
    this.#lastSuccessAt = snapshot.indexedAt;
    this.#lastDurationMs = Math.max(0, Date.now() - startedMs);
    this.#lastError = undefined;
    for (const listener of this.#snapshotListeners) {
      try {
        listener();
      } catch {
        // Listener failures must not roll back a successful swap.
      }
    }
    return this.health();
  }

  #failRefresh(error: unknown, startedMs: number): MemoryIndexHealth {
    this.#status = 'error';
    this.#lastDurationMs = Math.max(0, Date.now() - startedMs);
    this.#lastError = error instanceof Error ? error.message : String(error);
    // Preserve the last valid immutable snapshot when one exists.
    return this.health();
  }

  #buildInWorker(indexedAt: string): Promise<ImmutableSnapshot> {
    const workerData = {
      roots: this.#roots.map((root) => ({
        id: root.id,
        path: root.path,
        authority: root.authority,
      })),
      maxFileBytes: this.#maxFileBytes,
      maxFilesPerRoot: this.#maxFilesPerRoot,
      indexedAt,
    };
    return new Promise((resolve, reject) => {
      let settled = false;
      const worker = new Worker(WORKER_PATH, { workerData });
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        worker.removeAllListeners();
        void worker.terminate();
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      worker.once('message', (message: { ok: true; snapshotPath: string } | { ok: false; error: string }) => {
        if (settled) return;
        settled = true;
        worker.removeAllListeners();
        void worker.terminate();
        if (!message.ok) {
          reject(new Error(message.error));
          return;
        }
        void hydrateSnapshotFromNdjson(message.snapshotPath).then(resolve, reject);
      });
      worker.once('error', fail);
      worker.once('exit', (code) => {
        if (!settled && code !== 0) fail(new Error(`memory_index_worker_exit_${code}`));
      });
    });
  }
}

const HYDRATE_YIELD_EVERY = 200;

async function hydrateSnapshotFromNdjson(snapshotPath: string): Promise<ImmutableSnapshot> {
  try {
    const documents: IndexedDocument[] = [];
    let revision = '';
    let indexedAt = '';
    let avgDocLength = 0;
    let docFreqEntries: Array<[string, number]> = [];
    const rootStats = new Map<string, { documentCount: number; revision: string; lastIndexedAt: string }>();
    let seen = 0;

    const rl = createInterface({
      input: createReadStream(snapshotPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as
        | {
          type: 'meta';
          revision: string;
          indexedAt: string;
          avgDocLength: number;
          rootStats: Array<{ id: string; documentCount: number; revision: string; lastIndexedAt: string }>;
          docFreqEntries: Array<[string, number]>;
        }
        | { type: 'doc'; document: WorkerDocument };
      if (row.type === 'meta') {
        revision = row.revision;
        indexedAt = row.indexedAt;
        avgDocLength = row.avgDocLength;
        docFreqEntries = row.docFreqEntries;
        for (const stats of row.rootStats) {
          rootStats.set(stats.id, {
            documentCount: stats.documentCount,
            revision: stats.revision,
            lastIndexedAt: stats.lastIndexedAt,
          });
        }
      } else if (row.type === 'doc') {
        const document = row.document;
        documents.push({
          sourceId: document.sourceId,
          rootId: document.rootId,
          authority: document.authority,
          relativePath: document.relativePath,
          title: document.title,
          content: document.content,
          tokens: document.tokens,
          termFreq: new Map(document.termFreqEntries),
        });
        seen += 1;
        if (seen % HYDRATE_YIELD_EVERY === 0) {
          await new Promise<void>((resolve) => setImm(resolve));
        }
      }
    }

    const docFreq = new Map<string, number>();
    for (let i = 0; i < docFreqEntries.length; i += 1) {
      const [term, count] = docFreqEntries[i]!;
      docFreq.set(term, count);
      if ((i + 1) % HYDRATE_YIELD_EVERY === 0) {
        await new Promise<void>((resolve) => setImm(resolve));
      }
    }

    if (!revision || !indexedAt) {
      throw new Error('memory_index_snapshot_meta_missing');
    }

    return Object.freeze({
      revision,
      indexedAt,
      documents: Object.freeze(documents) as IndexedDocument[],
      docFreq,
      avgDocLength,
      rootStats,
    }) as ImmutableSnapshot;
  } finally {
    try {
      rmSync(snapshotPath, { force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

function buildSnapshotLocal(
  roots: readonly MemoryRootConfig[],
  maxFileBytes: number,
  maxFilesPerRoot: number,
  indexedAt: string,
): ImmutableSnapshot {
  const documents: IndexedDocument[] = [];
  const rootStats = new Map<string, { documentCount: number; revision: string; lastIndexedAt: string }>();
  for (const root of roots) {
    const rootDocs = scanRoot(root, maxFileBytes, maxFilesPerRoot);
    const rootRevision = createHash('sha256')
      .update(rootDocs.map((doc) => `${root.id}:${root.authority}:${doc.relativePath}:${createHash('sha256').update(doc.content).digest('hex')}`).join('\n'))
      .digest('hex')
      .slice(0, 24);
    rootStats.set(root.id, {
      documentCount: rootDocs.length,
      revision: rootRevision,
      lastIndexedAt: indexedAt,
    });
    documents.push(...rootDocs);
  }
  const docFreq = new Map<string, number>();
  let totalLength = 0;
  for (const document of documents) {
    totalLength += document.tokens.length;
    const seen = new Set(document.tokens);
    for (const term of seen) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }
  const revision = createHash('sha256')
    .update([...rootStats.values()].map((stats) => stats.revision).join('|'))
    .digest('hex')
    .slice(0, 32);
  return Object.freeze({
    revision,
    indexedAt,
    documents: Object.freeze(documents) as IndexedDocument[],
    docFreq,
    avgDocLength: documents.length ? totalLength / documents.length : 0,
    rootStats,
  }) as ImmutableSnapshot;
}

function authorityRank(authority: MemoryRootAuthority): number {
  return authority === 'canonical' ? 0 : 1;
}

function scanRoot(
  root: MemoryRootConfig,
  maxFileBytes: number,
  maxFilesPerRoot: number,
): IndexedDocument[] {
  const realRoot = realpathSync(root.path);
  const files = markdownFiles(realRoot, realRoot, maxFilesPerRoot);
  const documents: IndexedDocument[] = [];
  for (const absolutePath of files) {
    const stat = statSync(absolutePath);
    if (stat.size > maxFileBytes) continue;
    const content = readFileSync(absolutePath, 'utf8');
    const relativePath = relative(realRoot, absolutePath).split(sep).join('/');
    const title = titleFromMarkdown(content, relativePath);
    const tokens = tokenize(`${title}\n${content}`);
    const termFreq = new Map<string, number>();
    for (const token of tokens) termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    const sourceId = createHash('sha256')
      .update(`${root.id}:${relativePath}`)
      .digest('hex')
      .slice(0, 24);
    documents.push({
      sourceId,
      rootId: root.id,
      authority: root.authority,
      relativePath,
      title,
      content,
      tokens,
      termFreq,
    });
  }
  return documents;
}

function markdownFiles(root: string, directory: string, maxFilesPerRoot: number, acc: string[] = []): string[] {
  if (acc.length > maxFilesPerRoot) {
    throw new Error(`Memory root exceeds ${maxFilesPerRoot} Markdown files`);
  }
  const resolved = realpathSync(directory);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) return acc;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (shouldSkipDirectory(entry.name)) continue;
    const absolutePath = join(directory, entry.name);
    if (entry.isSymbolicLink() || lstatSync(absolutePath).isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      markdownFiles(root, absolutePath, maxFilesPerRoot, acc);
      continue;
    }
    if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith('.md')) {
      acc.push(absolutePath);
      if (acc.length > maxFilesPerRoot) {
        throw new Error(`Memory root exceeds ${maxFilesPerRoot} Markdown files`);
      }
    }
  }
  return acc.sort();
}

function titleFromMarkdown(content: string, relativePath: string): string {
  const heading = /^#\s+(.+)$/mu.exec(content);
  if (heading?.[1]?.trim()) return heading[1].trim().slice(0, 500);
  if (content.startsWith('---\n')) {
    const end = content.indexOf('\n---\n', 4);
    if (end >= 0) {
      for (const line of content.slice(4, end).split('\n')) {
        const match = /^title:\s*(.+)$/iu.exec(line);
        if (match?.[1]) return match[1].trim().replace(/^['"]|['"]$/gu, '').slice(0, 500);
      }
    }
  }
  return relativePath.replace(/\.md$/iu, '');
}

function tokenize(text: string): string[] {
  return text
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/u)
    .filter((token) => token.length > 1);
}

function bm25Score(
  document: IndexedDocument,
  terms: readonly string[],
  docFreq: Map<string, number>,
  documentCount: number,
  avgDocLength: number,
): number {
  const k1 = 1.2;
  const b = 0.75;
  let score = 0;
  const uniqueTerms = [...new Set(terms)];
  for (const term of uniqueTerms) {
    const tf = document.termFreq.get(term) ?? 0;
    if (!tf) continue;
    const df = docFreq.get(term) ?? 0;
    const idf = Math.log(1 + (documentCount - df + 0.5) / (df + 0.5));
    const denom = tf + k1 * (1 - b + b * (document.tokens.length / Math.max(avgDocLength, 1)));
    score += idf * ((tf * (k1 + 1)) / denom);
  }
  return score;
}

function excerptAround(content: string, terms: readonly string[]): string {
  const lower = content.toLocaleLowerCase();
  let first = Number.POSITIVE_INFINITY;
  for (const term of terms) {
    const index = lower.indexOf(term);
    if (index >= 0) first = Math.min(first, index);
  }
  const start = Number.isFinite(first) ? Math.max(0, first - 120) : 0;
  return content.slice(start, start + 480).replace(/\s+/gu, ' ').trim();
}
