import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

export interface VerifiedMissionDecision {
  outcome: string;
  rationale: string;
  decidedBy: string;
  decidedAt: string;
  evidenceEventIds: string[];
}

export interface VerifiedMissionOutcome {
  taskId: string;
  status: string;
  completedAt: string;
  evidenceEventIds: string[];
}

export interface VerifiedMissionReceipt {
  action: string;
  destination: string;
  connectorId: string;
  status: string;
  verified: boolean;
  externalId?: string;
  evidenceEventIds: string[];
}

/** Deliberately excludes artifact and source payload bodies from rendering. */
export interface VerifiedMissionKnowledge {
  missionId: string;
  planHash: string;
  title: string;
  objective: string;
  completedAt: string;
  deliverables: string[];
  decisions: VerifiedMissionDecision[];
  outcomes: VerifiedMissionOutcome[];
  receipts: VerifiedMissionReceipt[];
  evidenceEventIds: string[];
  metadata?: Record<string, unknown>;
}

export interface ObsidianRetentionWriterOptions {
  vaultPath: string;
  relativeDirectory?: string;
}

export interface RetentionPath {
  absolutePath: string;
  relativePath: string;
}

export interface RetentionWriteResult extends RetentionPath {
  status: 'created' | 'updated' | 'unchanged';
}

const MANAGED_FIELD = 'jericho_managed: true';

/**
 * Writes only an intentionally small verified summary into a dedicated,
 * Jericho-managed vault namespace. Raw artifacts and payload metadata have no
 * rendering path, and symlinks cannot redirect writes outside the vault.
 */
export class ObsidianRetentionWriter {
  readonly #root: string;
  readonly #segments: string[];

  constructor(options: ObsidianRetentionWriterOptions) {
    if (!options.vaultPath.trim()) throw new Error('Obsidian vault path is required');
    this.#root = realpathSync(options.vaultPath);
    if (!lstatSync(this.#root).isDirectory()) throw new Error('Obsidian vault path is not a directory');
    const configured = options.relativeDirectory ?? 'Jericho/Missions';
    this.#segments = configured.split(/[\\/]+/u).filter(Boolean);
    if (!this.#segments.length || this.#segments.some((part) => part === '.' || part === '..')) {
      throw new Error('Obsidian retention directory is invalid');
    }
  }

  pathFor(missionId: string): RetentionPath {
    const id = requiredText(missionId, 'Mission ID');
    const slug = id
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9_-]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 72) || 'mission';
    const digest = createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 12);
    const absolutePath = join(this.#root, ...this.#segments, `${slug}-${digest}.md`);
    return {
      absolutePath,
      relativePath: relative(this.#root, absolutePath).split(sep).join('/'),
    };
  }

  write(knowledge: VerifiedMissionKnowledge): RetentionWriteResult {
    validateKnowledge(knowledge);
    const destination = this.pathFor(knowledge.missionId);
    const directory = this.#ensureManagedDirectory();
    assertInside(this.#root, destination.absolutePath);
    if (dirname(destination.absolutePath) !== directory) {
      throw new Error('Obsidian retention path escaped its managed directory');
    }
    const content = renderKnowledge(knowledge);
    let status: RetentionWriteResult['status'] = 'created';
    if (existsSync(destination.absolutePath)) {
      const stat = lstatSync(destination.absolutePath);
      if (stat.isSymbolicLink()) throw new Error('Obsidian retention destination is a symbolic link');
      if (!stat.isFile()) throw new Error('Obsidian retention destination is not a file');
      const current = readFileSync(destination.absolutePath, 'utf8');
      if (!isManagedMission(current, knowledge.missionId, knowledge.planHash)) {
        throw new Error(`${basename(destination.absolutePath)} is not managed by Jericho`);
      }
      if (current === content) return { ...destination, status: 'unchanged' };
      status = 'updated';
    }

    const temporary = join(directory, `.jericho-${process.pid}-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      renameSync(temporary, destination.absolutePath);
    } finally {
      rmSync(temporary, { force: true });
    }
    return { ...destination, status };
  }

  #ensureManagedDirectory(): string {
    let current = this.#root;
    for (const segment of this.#segments) {
      const next = join(current, segment);
      assertInside(this.#root, next);
      if (!existsSync(next)) mkdirSync(next, { mode: 0o700 });
      const stat = lstatSync(next);
      if (stat.isSymbolicLink()) throw new Error('Obsidian retention directory is a symbolic link');
      if (!stat.isDirectory()) throw new Error('Obsidian retention path is not a directory');
      const real = realpathSync(next);
      assertInside(this.#root, real);
      current = real;
    }
    return current;
  }
}

function validateKnowledge(value: VerifiedMissionKnowledge): void {
  for (const [field, candidate] of [
    ['Mission ID', value.missionId],
    ['Mission title', value.title],
    ['Mission objective', value.objective],
  ] as const) requiredText(candidate, field);
  if (!/^[a-f0-9]{64}$/u.test(value.planHash)) throw new Error('Mission plan hash is invalid');
  assertTimestamp(value.completedAt, 'Mission completion');
  if (!value.deliverables.length) throw new Error('Verified mission knowledge requires a deliverable');
  if (!value.outcomes.length || value.outcomes.some((outcome) =>
    outcome.status !== 'succeeded' || !outcome.evidenceEventIds.length
  )) {
    throw new Error('Verified mission knowledge requires every verified outcome and evidence');
  }
  if (value.receipts.some((receipt) =>
    receipt.status !== 'succeeded' || !receipt.verified || !receipt.externalId || !receipt.evidenceEventIds.length
  )) {
    throw new Error('Verified mission knowledge requires every verified receipt and destination evidence');
  }
  if (!value.evidenceEventIds.length) throw new Error('Verified mission knowledge requires evidence');
  for (const decision of value.decisions) {
    requiredText(decision.rationale, 'Decision rationale');
    requiredText(decision.decidedBy, 'Decision actor');
    assertTimestamp(decision.decidedAt, 'Decision time');
  }
}

function renderKnowledge(value: VerifiedMissionKnowledge): string {
  const lines = [
    '---',
    MANAGED_FIELD,
    `mission_id: ${yamlString(value.missionId)}`,
    `plan_hash: ${yamlString(value.planHash)}`,
    `completed_at: ${yamlString(value.completedAt)}`,
    'status: verified',
    '---',
    '',
    `# ${markdownText(value.title)}`,
    '',
    markdownText(value.objective),
    '',
    '## Deliverables',
    '',
    ...value.deliverables.map((item) => `- ${markdownText(item)}`),
    '',
    '## Decisions',
    '',
    ...(value.decisions.length
      ? value.decisions.map((decision) =>
        `- ${markdownText(decision.outcome)} by ${markdownText(decision.decidedBy)} — ${markdownText(decision.rationale)}`,
      )
      : ['- No retained decisions']),
    '',
    '## Verified outcomes',
    '',
    ...value.outcomes.map((outcome) =>
      `- ${markdownText(outcome.taskId)} — ${markdownText(outcome.status)} (${markdownText(outcome.completedAt)})`,
    ),
    '',
    '## Verified external receipts',
    '',
    ...(value.receipts.length
      ? value.receipts.map((receipt) =>
        `- ${markdownText(receipt.connectorId)}:${markdownText(receipt.action)} → ${markdownText(receipt.destination)} — ${markdownText(receipt.externalId!)}`,
      )
      : ['- No external action']),
    '',
    '## Evidence',
    '',
    ...[...new Set(value.evidenceEventIds)].map((eventId) => `- \`${inlineCode(eventId)}\``),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function isManagedMission(content: string, missionId: string, planHash: string): boolean {
  return content.includes(MANAGED_FIELD)
    && content.includes(`mission_id: ${yamlString(missionId)}`)
    && content.includes(`plan_hash: ${yamlString(planHash)}`);
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function assertTimestamp(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${field} timestamp is invalid`);
}

function markdownText(value: string): string {
  return requiredText(value, 'Knowledge text').replace(/\s+/gu, ' ');
}

function inlineCode(value: string): string {
  return markdownText(value).replace(/`/gu, '\\`');
}

function yamlString(value: string): string {
  return JSON.stringify(requiredText(value, 'YAML value'));
}

function assertInside(root: string, candidate: string): void {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error('Obsidian retention path is outside the vault');
  }
}
