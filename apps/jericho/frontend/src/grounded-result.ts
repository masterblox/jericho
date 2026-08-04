/**
 * Temporary frontend-local grounded-result wire parsing.
 *
 * The canonical `@jericho/shared` contract is still being repaired by another
 * worker. Keep this module isolated and replaceable — do not expand the local
 * protocol here; swap to shared imports once that SHA lands.
 */

/** DOM event published by JerichoRuntime for a bounded grounded-result payload. */
export const GROUNDED_RESULT_EVENT = 'jericho:grounded-result';

/** DOM event that asks the interface-sound engine to play a cinematic cue once. */
export const INTERFACE_SOUND_EVENT = 'jericho:interface-sound';

/** DOM event that toggles or sets the local interface-sound mute preference. */
export const INTERFACE_SOUND_TOGGLE_EVENT = 'jericho:interface-sound-toggle';

/** localStorage key for the interface-sound mute preference. */
export const INTERFACE_SOUND_MUTE_KEY = 'jericho.interfaceSound.muted.v1';

/** DOM event mirroring whether Jericho speech playback is currently active. */
export const SPEECH_PLAYING_EVENT = 'jericho:speech-playing';

export const INTERFACE_SOUND_CUES = [
  'retrieve',
  'summon',
  'satellite',
  'lock',
  'dismiss',
] as const;

export type InterfaceSoundCue = (typeof INTERFACE_SOUND_CUES)[number];

export const GROUNDED_RESULT_PHASES = [
  'retrieving',
  'resolved',
  'ambiguous',
  'unavailable',
] as const;

export type GroundedResultPhase = (typeof GROUNDED_RESULT_PHASES)[number];

export const GROUNDED_RESULT_ROUTES = [
  'private_knowledge',
  'core_operational',
  'general',
  'clarification',
] as const;

export type GroundedResultRoute = (typeof GROUNDED_RESULT_ROUTES)[number];

export const GROUNDED_RESULT_CONFIDENCES = [
  'strong',
  'partial',
  'ambiguous',
  'none',
] as const;

export type GroundedResultConfidence = (typeof GROUNDED_RESULT_CONFIDENCES)[number];

/** Allowlisted subject kinds carried by grounded-result envelopes. */
export const GROUNDED_SUBJECT_KINDS = [
  'person',
  'organization',
  'project',
  'decision',
  'note',
  'query',
] as const;

export type GroundedSubjectKind = (typeof GROUNDED_SUBJECT_KINDS)[number];

export const GROUNDED_ACTION_IDS = [
  'open_note',
  'reorganize_notes',
  'correct_identity',
] as const;

export type GroundedActionId = (typeof GROUNDED_ACTION_IDS)[number];

export interface GroundedResultProvenance {
  relativePath: string;
  title: string;
  excerpt: string;
  score: number;
}

export interface GroundedResultActions {
  open_note?: string;
  reorganize_notes?: boolean;
  correct_identity?: boolean;
}

/**
 * Bounded grounded-result envelope accepted from the voice bridge WebSocket
 * and re-published as `jericho:grounded-result`.
 */
export interface GroundedResultPayload {
  resultId: string;
  phase: GroundedResultPhase;
  route: GroundedResultRoute;
  subject: string;
  subjectKind?: GroundedSubjectKind;
  confidence: GroundedResultConfidence;
  canonicalIdentity?: string;
  fullName?: string;
  relationship?: string;
  employment?: string[];
  provenance: GroundedResultProvenance[];
  actions: GroundedResultActions;
  retrievalCount: number;
  guided?: { test: 'isabella' };
}

export interface InterfaceSoundDetail {
  resultId: string;
  cue: InterfaceSoundCue;
}

const MAX_ID = 128;
const MAX_SUBJECT = 256;
const MAX_LABEL = 256;
const MAX_EXCERPT = 480;
const MAX_PATH = 1_024;
const MAX_PROVENANCE = 16;
const MAX_EMPLOYMENT = 8;

export function isInterfaceSoundCue(value: unknown): value is InterfaceSoundCue {
  return typeof value === 'string' && (INTERFACE_SOUND_CUES as readonly string[]).includes(value);
}

/** True when a vault-relative path is safe to surface in the UI. */
export function isSafeRelativePath(value: string): boolean {
  if (!value || value.length > MAX_PATH) return false;
  if (value.includes('\\') || value.includes('\0')) return false;
  if (value.startsWith('/') || value.startsWith('~/')) return false;
  if (/^[a-zA-Z]:/.test(value)) return false;
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return false;
  return true;
}

/** Parse and bound an untrusted bridge `grounded_result` message body. */
export function parseGroundedResultMessage(raw: unknown): GroundedResultPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as Record<string, unknown>;
  const resultId = exactString(msg.resultId, MAX_ID);
  const phase = allowlisted(msg.phase, GROUNDED_RESULT_PHASES);
  const route = allowlisted(msg.route, GROUNDED_RESULT_ROUTES);
  const subject = clipString(msg.subject, MAX_SUBJECT);
  const confidence = allowlisted(msg.confidence, GROUNDED_RESULT_CONFIDENCES);
  if (!resultId || !phase || !route || !subject || !confidence) return null;
  if (typeof msg.retrievalCount !== 'number'
    || !Number.isInteger(msg.retrievalCount)
    || msg.retrievalCount < 0
    || msg.retrievalCount > 10_000) {
    return null;
  }

  const provenance = parseProvenanceList(msg.provenance);
  if (!provenance) return null;
  const actions = parseActions(msg.actions);
  if (!actions) return null;

  const payload: GroundedResultPayload = {
    resultId,
    phase,
    route,
    subject,
    confidence,
    provenance,
    actions,
    retrievalCount: msg.retrievalCount,
  };

  const subjectKind = allowlisted(msg.subjectKind, GROUNDED_SUBJECT_KINDS);
  if (msg.subjectKind !== undefined && !subjectKind) return null;
  if (subjectKind) payload.subjectKind = subjectKind;

  const canonicalIdentity = clipString(msg.canonicalIdentity, MAX_LABEL);
  if (msg.canonicalIdentity !== undefined && !canonicalIdentity) return null;
  if (canonicalIdentity) payload.canonicalIdentity = canonicalIdentity;

  const fullName = clipString(msg.fullName, MAX_LABEL);
  if (msg.fullName !== undefined && !fullName) return null;
  if (fullName) payload.fullName = fullName;

  const relationship = clipString(msg.relationship, MAX_LABEL);
  if (msg.relationship !== undefined && !relationship) return null;
  if (relationship) payload.relationship = relationship;

  const employment = parseEmployment(msg.employment);
  if (msg.employment !== undefined && !employment) return null;
  if (employment) payload.employment = employment;

  if (msg.guided !== undefined) {
    if (!msg.guided || typeof msg.guided !== 'object') return null;
    const guided = msg.guided as Record<string, unknown>;
    if (guided.test !== 'isabella') return null;
    payload.guided = { test: 'isabella' };
  }

  return payload;
}

export function parseInterfaceSoundDetail(raw: unknown): InterfaceSoundDetail | null {
  if (!raw || typeof raw !== 'object') return null;
  const detail = raw as Record<string, unknown>;
  const resultId = exactString(detail.resultId, MAX_ID);
  if (!resultId || !isInterfaceSoundCue(detail.cue)) return null;
  return { resultId, cue: detail.cue };
}

function parseProvenanceList(raw: unknown): GroundedResultProvenance[] | null {
  if (!Array.isArray(raw)) return null;
  const items: GroundedResultProvenance[] = [];
  for (const entry of raw.slice(0, MAX_PROVENANCE)) {
    if (!entry || typeof entry !== 'object') return null;
    const value = entry as Record<string, unknown>;
    const relativePath = exactString(value.relativePath, MAX_PATH);
    const title = clipString(value.title, MAX_LABEL);
    const excerpt = clipString(value.excerpt, MAX_EXCERPT);
    if (!relativePath || !title || !excerpt) return null;
    if (!isSafeRelativePath(relativePath)) return null;
    if (typeof value.score !== 'number'
      || !Number.isFinite(value.score)
      || value.score < 0
      || value.score > 1) {
      return null;
    }
    items.push({
      relativePath,
      title,
      excerpt,
      score: value.score,
    });
  }
  return items;
}

function parseActions(raw: unknown): GroundedResultActions | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (!(GROUNDED_ACTION_IDS as readonly string[]).includes(key)) return null;
  }
  const actions: GroundedResultActions = {};
  if ('open_note' in value) {
    const path = exactString(value.open_note, MAX_PATH);
    if (!path || !isSafeRelativePath(path)) return null;
    actions.open_note = path;
  }
  if ('reorganize_notes' in value) {
    if (typeof value.reorganize_notes !== 'boolean') return null;
    actions.reorganize_notes = value.reorganize_notes;
  }
  if ('correct_identity' in value) {
    if (typeof value.correct_identity !== 'boolean') return null;
    actions.correct_identity = value.correct_identity;
  }
  return actions;
}

function parseEmployment(raw: unknown): string[] | null {
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const items: string[] = [];
  for (const entry of raw.slice(0, MAX_EMPLOYMENT)) {
    const value = clipString(entry, MAX_LABEL);
    if (!value) return null;
    items.push(value);
  }
  return items;
}

function allowlisted<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? value as T
    : undefined;
}

/** Opaque IDs and paths: reject when overlength instead of truncating. */
function exactString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return undefined;
  return trimmed;
}

/** Human-facing labels may be clipped pending the shared contract. */
function clipString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}
