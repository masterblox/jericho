import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';

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

export interface MemoryIndexHealth {
  available: boolean;
  revision: string;
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

export interface MemoryIndexOptions {
  roots: readonly MemoryRootConfig[];
  maxFileBytes?: number;
  maxFilesPerRoot?: number;
  clock?: () => string;
}

/**
 * Read-only multi-root Markdown BM25 index.
 * Snapshots are immutable; refresh() replaces the active snapshot atomically.
 */
export class MemoryIndex {
  readonly #roots: readonly MemoryRootConfig[];
  readonly #maxFileBytes: number;
  readonly #maxFilesPerRoot: number;
  readonly #clock: () => string;
  #snapshot: ImmutableSnapshot | undefined;
  #available = false;

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
      roots,
    };
  }

  /** Build or rebuild an immutable BM25 snapshot from configured roots. */
  refresh(): MemoryIndexHealth {
    if (this.#roots.length === 0) {
      this.#snapshot = undefined;
      this.#available = false;
      return this.health();
    }
    try {
      const indexedAt = this.#clock();
      const documents: IndexedDocument[] = [];
      const rootStats = new Map<string, { documentCount: number; revision: string; lastIndexedAt: string }>();
      for (const root of this.#roots) {
        const rootDocs = scanRoot(root, this.#maxFileBytes, this.#maxFilesPerRoot);
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
      this.#snapshot = Object.freeze({
        revision,
        indexedAt,
        documents: Object.freeze(documents) as IndexedDocument[],
        docFreq,
        avgDocLength: documents.length ? totalLength / documents.length : 0,
        rootStats,
      }) as ImmutableSnapshot;
      this.#available = true;
    } catch {
      this.#snapshot = undefined;
      this.#available = false;
    }
    return this.health();
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
