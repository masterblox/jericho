import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import {
  ConnectorHealthStatus,
  EntityType,
  type NormalizedCapture,
} from '@jericho/shared';

import {
  ConnectorUnavailableError,
  type CaptureConnector,
  type ConnectorCapturePage,
  type ConnectorCaptureRequest,
  type ConnectorProbe,
} from '../contracts.js';
import { stableConnectorEvent } from '../normalization.js';

export interface ConductorConnectorOptions {
  roots: Array<{ id: string; path: string }>;
  maxDepth?: number;
}

interface WorktreeSnapshot {
  relativePath: string;
  head: string;
  observedAt: string;
  version: string;
}

interface ConductorCursorState {
  version: 2;
  baseline: WorktreeSnapshot[];
  snapshot?: WorktreeSnapshot[];
  offset?: number;
}

export class ConductorConnector implements CaptureConnector {
  readonly descriptor;
  readonly #maxDepth: number;

  constructor(private readonly options: ConductorConnectorOptions) {
    this.#maxDepth = options.maxDepth ?? 4;
    this.descriptor = {
      id: 'conductor', adapterVersion: 1, cursorSchemaVersion: 1,
      partitions: options.roots.map((item) => item.id), maxBatchSize: 500,
    };
  }

  async probe(_signal: AbortSignal): Promise<ConnectorProbe> {
    return this.options.roots.length
      ? { status: ConnectorHealthStatus.Healthy, details: { mode: 'configured_filesystem_only' } }
      : { status: ConnectorHealthStatus.Unavailable, details: { reason: 'no_roots' } };
  }

  async capture(request: ConnectorCaptureRequest): Promise<ConnectorCapturePage> {
    const configured = this.options.roots.find((item) => item.id === request.partition);
    if (!configured) throw new ConnectorUnavailableError(`Conductor root ${request.partition} is unavailable`);
    const root = realpathSync(configured.path);
    const state = decodeCursor(request.cursor?.pageToken);
    const snapshot = state.snapshot ?? findWorktrees(root, root, 0, this.#maxDepth)
      .map((path) => worktreeSnapshot(root, path));
    const baseline = new Map(state.baseline.map((item) => [item.relativePath, item.version]));
    const changed = snapshot.filter((item) => baseline.get(item.relativePath) !== item.version);
    const offset = state.snapshot ? state.offset ?? 0 : 0;
    const page = changed.slice(offset, offset + request.limit);
    const nextOffset = offset + page.length;
    const hasMore = nextOffset < changed.length;
    const nextState: ConductorCursorState = hasMore
      ? { version: 2, baseline: state.baseline, snapshot, offset: nextOffset }
      : { version: 2, baseline: snapshot };
    const captures = page.map((item) => worktreeCapture(configured.id, item));
    return {
      captures, failures: [],
      progress: {
        epoch: request.cursor?.epoch ?? 1,
        sequence: (request.cursor?.sequence ?? 0) + captures.length,
        pageToken: encodeCursor(nextState),
      },
      hasMore,
    };
  }
}

const SKIP_NAMES = new Set(['.conductor', '.obsidian', 'node_modules', 'state']);

function findWorktrees(root: string, directory: string, depth: number, maxDepth: number): string[] {
  if (depth > maxDepth) return [];
  const resolved = realpathSync(directory);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) return [];
  const gitPath = join(directory, '.git');
  try {
    if (lstatSync(gitPath)) return [directory];
  } catch { /* no .git marker */ }
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || SKIP_NAMES.has(entry.name)) continue;
    found.push(...findWorktrees(root, join(directory, entry.name), depth + 1, maxDepth));
  }
  return found;
}

function worktreeSnapshot(root: string, path: string): WorktreeSnapshot {
  const relativePath = relative(root, path).split(sep).join('/');
  let head = 'unknown';
  try {
    const marker = readFileSync(join(path, '.git', 'HEAD'), 'utf8').trim();
    head = marker;
  } catch { /* worktree .git files and incomplete fixtures */ }
  const observedAt = statSync(path).mtime.toISOString();
  const version = createHash('sha256').update(`${relativePath}\0${head}`).digest('hex');
  return { relativePath, head, observedAt, version };
}

function worktreeCapture(rootId: string, snapshot: WorktreeSnapshot): NormalizedCapture {
  const { relativePath, head, observedAt, version } = snapshot;
  const event = stableConnectorEvent({
    source: 'conductor', sourceEventId: `${rootId}:${relativePath}:${version}`,
    type: 'conductor.worktree.observed', occurredAt: observedAt,
    payload: { rootId, relativePath, head },
  });
  return {
    event,
    identities: [{
      connectorId: 'conductor', namespace: 'worktree', externalId: `${rootId}:${relativePath}`,
      entityType: EntityType.Repository, displayName: relativePath,
      attributes: { rootId }, observedAt, confidence: 1, evidenceEventId: event.id,
    }],
    relations: [],
  };
}

function encodeCursor(state: ConductorCursorState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64url');
}

function decodeCursor(value: string | undefined): ConductorCursorState {
  if (!value) return { version: 2, baseline: [] };
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { version: 2, baseline: [] };
    }
    const state = parsed as Partial<ConductorCursorState>;
    return state.version === 2 && Array.isArray(state.baseline)
      ? state as ConductorCursorState
      : { version: 2, baseline: [] };
  } catch {
    return { version: 2, baseline: [] };
  }
}
