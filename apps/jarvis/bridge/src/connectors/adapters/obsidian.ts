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

export interface ObsidianConnectorOptions {
  vaultPath: string;
  maxNotes: number;
  maxNoteBytes: number;
}

interface NoteSnapshot {
  path: string;
  hash: string;
  modifiedAt: string;
  content: string;
}

type Manifest = Record<string, { hash: string; modifiedAt: string }>;

export class ObsidianConnector implements CaptureConnector {
  readonly descriptor = {
    id: 'obsidian', adapterVersion: 1, cursorSchemaVersion: 1,
    partitions: ['vault'], maxBatchSize: 500,
  };

  constructor(private readonly options: ObsidianConnectorOptions) {
    if (!Number.isInteger(options.maxNotes) || options.maxNotes < 1) throw new Error('Obsidian note bound is invalid');
    if (!Number.isInteger(options.maxNoteBytes) || options.maxNoteBytes < 1) throw new Error('Obsidian note size bound is invalid');
  }

  async probe(_signal: AbortSignal): Promise<ConnectorProbe> {
    return { status: ConnectorHealthStatus.Healthy, details: { mode: 'markdown_read_only' } };
  }

  async capture(request: ConnectorCaptureRequest): Promise<ConnectorCapturePage> {
    const notes = this.scan();
    const previous = decodeManifest(request.cursor?.pageToken);
    const current: Manifest = Object.fromEntries(notes.map((note) => [note.path, {
      hash: note.hash, modifiedAt: note.modifiedAt,
    }]));
    const captures: NormalizedCapture[] = [];
    const removed = Object.entries(previous).filter(([path]) => !current[path]);
    const added = notes.filter((note) => !previous[note.path]);
    const renamedNew = new Set<string>();
    const renamedOld = new Set<string>();
    for (const [oldPath, oldValue] of removed) {
      const renamed = added.find((note) => note.hash === oldValue.hash && !renamedNew.has(note.path));
      if (!renamed) continue;
      captures.push(noteRenameCapture(oldPath, renamed));
      renamedOld.add(oldPath);
      renamedNew.add(renamed.path);
    }
    for (const note of notes) {
      if (renamedNew.has(note.path)) continue;
      if (!previous[note.path] || previous[note.path].hash !== note.hash) {
        captures.push(noteSnapshotCapture(note));
      }
    }
    for (const [path, value] of removed) {
      if (!renamedOld.has(path)) captures.push(noteDeleteCapture(path, value));
    }
    return {
      captures: captures.slice(0, request.limit),
      failures: [],
      progress: {
        epoch: request.cursor?.epoch ?? 1,
        sequence: (request.cursor?.sequence ?? 0) + captures.length,
        pageToken: encodeManifest(current),
      },
      hasMore: captures.length > request.limit,
    };
  }

  async search(query: string, limit: number): Promise<Array<{ path: string; title: string; excerpt: string }>> {
    if (!query.trim() || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error('Obsidian search bounds are invalid');
    }
    const needle = query.toLocaleLowerCase();
    const matches: Array<{ path: string; title: string; excerpt: string }> = [];
    for (const note of this.scan()) {
      const index = note.content.toLocaleLowerCase().indexOf(needle);
      if (index < 0) continue;
      const parsed = parseMarkdown(note.content);
      matches.push({
        path: note.path,
        title: typeof parsed.frontmatter.title === 'string'
          ? parsed.frontmatter.title
          : note.path.replace(/\.md$/i, ''),
        excerpt: note.content.slice(Math.max(0, index - 40), index + needle.length + 80),
      });
      if (matches.length >= limit) break;
    }
    return matches;
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

function noteSnapshotCapture(note: NoteSnapshot): NormalizedCapture {
  const parsed = parseMarkdown(note.content);
  const event = stableConnectorEvent({
    source: 'obsidian', sourceEventId: `${note.path}:${note.hash}`,
    type: 'obsidian.note.snapshot', occurredAt: note.modifiedAt,
    payload: {
      path: note.path, hash: note.hash, frontmatter: parsed.frontmatter,
      tags: parsed.tags, wikilinks: parsed.wikilinks,
    },
  });
  event.freshness = { observedAt: note.modifiedAt };
  const identities: NormalizedCapture['identities'] = [{
    connectorId: 'obsidian', namespace: 'note', externalId: note.path,
    entityType: EntityType.Note,
    displayName: typeof parsed.frontmatter.title === 'string'
      ? parsed.frontmatter.title
      : note.path.replace(/\.md$/i, ''),
    attributes: { hash: note.hash }, observedAt: note.modifiedAt,
    confidence: 1, evidenceEventId: event.id,
  }];
  for (const link of parsed.wikilinks) identities.push({
    connectorId: 'obsidian', namespace: 'note_title', externalId: link,
    entityType: EntityType.Note, displayName: link, attributes: { referenced: true },
    observedAt: note.modifiedAt, confidence: 0.8, evidenceEventId: event.id,
  });
  const relations = parsed.wikilinks.map((link) => ({
    from: { connectorId: 'obsidian', namespace: 'note', externalId: note.path },
    to: { connectorId: 'obsidian', namespace: 'note_title', externalId: link },
    type: RelationType.RelatedTo,
    attributes: { kind: 'wikilink' },
    observedAt: note.modifiedAt,
    evidenceEventId: event.id,
  }));
  return { event, identities, relations };
}

function noteRenameCapture(oldPath: string, note: NoteSnapshot): NormalizedCapture {
  const event = stableConnectorEvent({
    source: 'obsidian', sourceEventId: `rename:${oldPath}:${note.path}:${note.hash}`,
    type: 'obsidian.note.renamed', occurredAt: note.modifiedAt,
    payload: { fromPath: oldPath, path: note.path, hash: note.hash },
  });
  return {
    event,
    identities: [{
      connectorId: 'obsidian', namespace: 'note', externalId: note.path,
      entityType: EntityType.Note, displayName: note.path.replace(/\.md$/i, ''),
      attributes: { previousPath: oldPath, hash: note.hash }, observedAt: note.modifiedAt,
      confidence: 1, evidenceEventId: event.id,
    }],
    relations: [],
  };
}

function noteDeleteCapture(path: string, value: { hash: string; modifiedAt: string }): NormalizedCapture {
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

function encodeManifest(manifest: Manifest): string {
  return Buffer.from(JSON.stringify(manifest)).toString('base64url');
}

function decodeManifest(value: string | undefined): Manifest {
  if (!value) return {};
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Manifest : {};
  } catch {
    return {};
  }
}
