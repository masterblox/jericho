import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';

import {
  ConnectorHealthStatus,
  EntityType,
  RelationType,
  type JsonObject,
  type NormalizedCapture,
} from '@jericho/shared';

import type {
  CaptureConnector,
  ConnectorCapturePage,
  ConnectorCaptureRequest,
  ConnectorProbe,
} from '../contracts.js';
import { stableConnectorEvent } from '../normalization.js';
import type { VaultGatewayPort } from '../../vault/vault-gateway-client.js';

export interface ObsidianConnectorOptions {
  vaultPath: string;
  maxNotes: number;
  maxNoteBytes: number;
  staleAfterMs?: number;
  gateway?: VaultGatewayPort;
}

interface NoteSnapshot {
  path: string;
  hash: string;
  modifiedAt: string;
  content: string;
}

interface NoteManifestEntry {
  hash: string;
  modifiedAt: string;
  frontmatter: JsonObject;
  tags: string[];
  wikilinks: string[];
  title: string;
}

type Manifest = Record<string, NoteManifestEntry>;

interface ObsidianCursorState {
  version: 2;
  baseline: Manifest;
  snapshot?: Manifest;
  offset?: number;
}

export class ObsidianConnector implements CaptureConnector {
  readonly descriptor = {
    id: 'obsidian', adapterVersion: 1, cursorSchemaVersion: 1,
    partitions: ['vault'], maxBatchSize: 500,
  };

  constructor(private readonly options: ObsidianConnectorOptions) {
    if (!Number.isInteger(options.maxNotes) || options.maxNotes < 1) throw new Error('Obsidian note bound is invalid');
    if (!Number.isInteger(options.maxNoteBytes) || options.maxNoteBytes < 1) throw new Error('Obsidian note size bound is invalid');
    if (options.staleAfterMs !== undefined
      && (!Number.isInteger(options.staleAfterMs) || options.staleAfterMs < 1)) {
      throw new Error('Obsidian sync freshness bound is invalid');
    }
  }

  async probe(signal: AbortSignal): Promise<ConnectorProbe> {
    if (!this.options.gateway) {
      return {
        status: ConnectorHealthStatus.Unavailable,
        details: { mode: 'vault_rag_gateway', reason: 'gateway_not_configured' },
      };
    }
    try {
      const health = await this.options.gateway.health(signal);
      const stale = health.syncAgeMs !== undefined
        && health.syncAgeMs > (this.options.staleAfterMs ?? 60 * 60_000);
      const status = health.status === 'healthy' && !stale ? ConnectorHealthStatus.Healthy
        : health.status === 'degraded' ? ConnectorHealthStatus.Degraded
          : health.status === 'unavailable' ? ConnectorHealthStatus.Unavailable
            : ConnectorHealthStatus.Degraded;
      return {
        status,
        details: {
          mode: 'vault_rag_gateway', reason: stale ? 'sync_stale' : health.reason,
          ...(health.lastCommitAt ? { lastCommitAt: health.lastCommitAt } : {}),
          ...(health.syncAgeMs !== undefined ? { syncAgeMs: health.syncAgeMs } : {}),
          ...(health.lastIndexAt ? { lastIndexAt: health.lastIndexAt } : {}),
          ...(health.indexSizeMb !== undefined ? { indexSizeMb: health.indexSizeMb } : {}),
        },
      };
    } catch {
      return {
        status: ConnectorHealthStatus.Unavailable,
        details: { mode: 'vault_rag_gateway', reason: 'gateway_unavailable' },
      };
    }
  }

  async capture(request: ConnectorCaptureRequest): Promise<ConnectorCapturePage> {
    const state = decodeCursor(request.cursor?.pageToken);
    const current = state.snapshot ?? manifest(this.scan());
    const offset = state.snapshot ? state.offset ?? 0 : 0;
    const captures = diffNotes(state.baseline, current);
    const page = captures.slice(offset, offset + request.limit);
    const nextOffset = offset + page.length;
    const hasMore = nextOffset < captures.length;
    const nextState: ObsidianCursorState = hasMore
      ? { version: 2, baseline: state.baseline, snapshot: current, offset: nextOffset }
      : { version: 2, baseline: current };
    return {
      captures: page,
      failures: [],
      progress: {
        epoch: request.cursor?.epoch ?? 1,
        sequence: (request.cursor?.sequence ?? 0) + page.length,
        pageToken: encodeCursor(nextState),
      },
      hasMore,
    };
  }

  async search(query: string, limit: number): Promise<Array<{ path: string; title: string; excerpt: string }>> {
    if (!query.trim() || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error('Obsidian search bounds are invalid');
    }
    if (!this.options.gateway) throw new Error('Obsidian vault RAG search is unavailable');
    const response = await this.options.gateway.search(query.trim(), limit, new AbortController().signal);
    return response.results.map(({ path, title, excerpt }) => ({ path, title, excerpt }));
  }

  private scan(): NoteSnapshot[] {
    const root = realpathSync(this.options.vaultPath);
    const paths = markdownFiles(root, root).slice(0, this.options.maxNotes);
    return paths.flatMap((path) => {
      const stat = statSync(path);
      if (stat.size > this.options.maxNoteBytes) return [];
      const content = readFileSync(path, 'utf8');
      return [{
        path: relative(root, path).split(sep).join('/'),
        hash: createHash('sha256').update(content).digest('hex'),
        modifiedAt: stat.mtime.toISOString(),
        content,
      }];
    });
  }
}

function manifest(notes: NoteSnapshot[]): Manifest {
  return Object.fromEntries(notes.map((note) => {
    const parsed = parseMarkdown(note.content);
    return [note.path, {
      hash: note.hash,
      modifiedAt: note.modifiedAt,
      frontmatter: parsed.frontmatter,
      tags: parsed.tags,
      wikilinks: parsed.wikilinks,
      title: typeof parsed.frontmatter.title === 'string'
        ? parsed.frontmatter.title
        : note.path.replace(/\.md$/i, ''),
    }];
  }));
}

function diffNotes(previous: Manifest, current: Manifest): NormalizedCapture[] {
  const captures: NormalizedCapture[] = [];
  const removed = Object.entries(previous).filter(([path]) => !current[path]);
  const added = Object.entries(current).filter(([path]) => !previous[path]);
  const renamedNew = new Set<string>();
  const renamedOld = new Set<string>();
  for (const [oldPath, oldValue] of removed) {
    const renamed = added.find(([path, note]) => note.hash === oldValue.hash && !renamedNew.has(path));
    if (!renamed) continue;
    captures.push(noteRenameCapture(oldPath, renamed[0], renamed[1]));
    renamedOld.add(oldPath);
    renamedNew.add(renamed[0]);
  }
  for (const [path, note] of Object.entries(current)) {
    if (renamedNew.has(path)) continue;
    if (!previous[path] || previous[path].hash !== note.hash) {
      captures.push(noteSnapshotCapture(path, note));
    }
  }
  for (const [path, value] of removed) {
    if (!renamedOld.has(path)) captures.push(noteDeleteCapture(path, value));
  }
  return captures;
}

function markdownFiles(root: string, directory: string): string[] {
  const resolved = realpathSync(directory);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name === '.obsidian' || entry.name === '.git') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(root, path));
    else if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith('.md') && !lstatSync(path).isSymbolicLink()) files.push(path);
  }
  return files.sort();
}

function noteSnapshotCapture(path: string, note: NoteManifestEntry): NormalizedCapture {
  const event = stableConnectorEvent({
    source: 'obsidian', sourceEventId: `${path}:${note.hash}`,
    type: 'obsidian.note.snapshot', occurredAt: note.modifiedAt,
    payload: {
      path, hash: note.hash, frontmatter: note.frontmatter,
      tags: note.tags, wikilinks: note.wikilinks,
    },
  });
  event.freshness = { observedAt: note.modifiedAt };
  const identities: NormalizedCapture['identities'] = [{
    connectorId: 'obsidian', namespace: 'note', externalId: path,
    entityType: EntityType.Note,
    displayName: note.title,
    attributes: { hash: note.hash }, observedAt: note.modifiedAt,
    confidence: 1, evidenceEventId: event.id,
  }];
  for (const link of note.wikilinks) identities.push({
    connectorId: 'obsidian', namespace: 'note_title', externalId: link,
    entityType: EntityType.Note, displayName: link, attributes: { referenced: true },
    observedAt: note.modifiedAt, confidence: 0.8, evidenceEventId: event.id,
  });
  const relations = note.wikilinks.map((link) => ({
    from: { connectorId: 'obsidian', namespace: 'note', externalId: path },
    to: { connectorId: 'obsidian', namespace: 'note_title', externalId: link },
    type: RelationType.RelatedTo,
    attributes: { kind: 'wikilink' },
    observedAt: note.modifiedAt,
    evidenceEventId: event.id,
  }));
  return { event, identities, relations };
}

function noteRenameCapture(oldPath: string, path: string, note: NoteManifestEntry): NormalizedCapture {
  const event = stableConnectorEvent({
    source: 'obsidian', sourceEventId: `rename:${oldPath}:${path}:${note.hash}`,
    type: 'obsidian.note.renamed', occurredAt: note.modifiedAt,
    payload: { fromPath: oldPath, path, hash: note.hash },
  });
  return {
    event,
    identities: [{
      connectorId: 'obsidian', namespace: 'note', externalId: path,
      entityType: EntityType.Note, displayName: note.title,
      attributes: { previousPath: oldPath, hash: note.hash }, observedAt: note.modifiedAt,
      confidence: 1, evidenceEventId: event.id,
    }],
    relations: [],
  };
}

function noteDeleteCapture(path: string, value: NoteManifestEntry): NormalizedCapture {
  return {
    event: stableConnectorEvent({
      source: 'obsidian', sourceEventId: `delete:${path}:${value.hash}`,
      type: 'obsidian.note.deleted', occurredAt: value.modifiedAt,
      payload: { path, hash: value.hash },
    }),
    identities: [],
    relations: [],
  };
}

function parseMarkdown(content: string): {
  frontmatter: JsonObject;
  tags: string[];
  wikilinks: string[];
} {
  const frontmatter: JsonObject = {};
  let body = content;
  if (content.startsWith('---\n')) {
    const end = content.indexOf('\n---\n', 4);
    if (end >= 0) {
      for (const line of content.slice(4, end).split('\n')) {
        const separator = line.indexOf(':');
        if (separator < 1) continue;
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        frontmatter[key] = parseFrontmatterValue(value);
      }
      body = content.slice(end + 5);
    }
  }
  const frontmatterTags = Array.isArray(frontmatter.tags)
    ? frontmatter.tags.filter((value): value is string => typeof value === 'string')
    : typeof frontmatter.tags === 'string' ? [frontmatter.tags] : [];
  const bodyWithoutHeadings = body.split('\n').filter((line) => !line.startsWith('# ')).join('\n');
  const inlineTags = [...bodyWithoutHeadings.matchAll(/(?:^|\s)#([\p{L}\d/_-]+)/gu)].map((match) => match[1]);
  const wikilinks = [...body.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map((match) => match[1].trim());
  return {
    frontmatter,
    tags: [...new Set([...frontmatterTags, ...inlineTags])],
    wikilinks: [...new Set(wikilinks)],
  };
}

function parseFrontmatterValue(value: string) {
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean);
  }
  if (value === 'true' || value === 'false') return value === 'true';
  const number = Number(value);
  if (value && Number.isFinite(number)) return number;
  return value.replace(/^['"]|['"]$/g, '');
}

function encodeCursor(state: ObsidianCursorState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64url');
}

function decodeCursor(value: string | undefined): ObsidianCursorState {
  if (!value) return { version: 2, baseline: {} };
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { version: 2, baseline: {} };
    }
    const record = parsed as Record<string, unknown>;
    if (record.version === 2 && record.baseline && typeof record.baseline === 'object') {
      return parsed as ObsidianCursorState;
    }
    return { version: 2, baseline: parsed as Manifest };
  } catch {
    return { version: 2, baseline: {} };
  }
}
