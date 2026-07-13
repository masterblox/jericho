/** DOM event published by JarvisRuntime for a bounded grounded-result payload. */
export const GROUNDED_RESULT_EVENT = 'jericho:grounded-result';

/** DOM event that asks the interface-sound engine to play a cinematic cue once. */
export const INTERFACE_SOUND_EVENT = 'jericho:interface-sound';

/** DOM event that toggles or sets the local interface-sound mute preference. */
export const INTERFACE_SOUND_TOGGLE_EVENT = 'jericho:interface-sound-toggle';

/** localStorage key for the interface-sound mute preference. */
export const INTERFACE_SOUND_MUTE_KEY = 'jericho.interfaceSound.muted.v1';

/** DOM event mirroring whether Jarvis speech playback is currently active. */
export const SPEECH_PLAYING_EVENT = 'jericho:speech-playing';

export const INTERFACE_SOUND_CUES = [
  'retrieve',
  'summon',
  'satellite',
  'lock',
  'dismiss',
] as const;

export type InterfaceSoundCue = (typeof INTERFACE_SOUND_CUES)[number];

export interface GroundedSubject {
  kind: string;
  label: string;
  id?: string;
}

export interface GroundedEvidenceItem {
  id?: string;
  label: string;
  excerpt?: string;
  source?: string;
}

export interface GroundedProvenanceItem {
  label: string;
  source?: string;
  path?: string;
}

export interface GroundedAction {
  id: string;
  label: string;
}

/**
 * Bounded grounded-result envelope accepted from the voice bridge WebSocket
 * and re-published as `jericho:grounded-result`.
 */
export interface GroundedResultPayload {
  resultId: string;
  phase: string;
  subject?: GroundedSubject;
  confidence?: string;
  evidence?: GroundedEvidenceItem[];
  provenance?: GroundedProvenanceItem[];
  actions?: GroundedAction[];
}

export interface InterfaceSoundDetail {
  resultId: string;
  cue: InterfaceSoundCue;
}

const MAX_ID = 128;
const MAX_PHASE = 64;
const MAX_LABEL = 256;
const MAX_EXCERPT = 2_048;
const MAX_EVIDENCE = 16;
const MAX_PROVENANCE = 16;
const MAX_ACTIONS = 8;

export function isInterfaceSoundCue(value: unknown): value is InterfaceSoundCue {
  return typeof value === 'string' && (INTERFACE_SOUND_CUES as readonly string[]).includes(value);
}

/** Parse and bound an untrusted bridge `grounded_result` message body. */
export function parseGroundedResultMessage(raw: unknown): GroundedResultPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as Record<string, unknown>;
  const resultId = boundString(msg.resultId, MAX_ID);
  const phase = boundString(msg.phase, MAX_PHASE);
  if (!resultId || !phase) return null;

  const payload: GroundedResultPayload = { resultId, phase };
  const subject = parseSubject(msg.subject);
  if (subject) payload.subject = subject;
  const confidence = boundString(msg.confidence, MAX_LABEL);
  if (confidence) payload.confidence = confidence;
  const evidence = parseEvidenceList(msg.evidence);
  if (evidence) payload.evidence = evidence;
  const provenance = parseProvenanceList(msg.provenance);
  if (provenance) payload.provenance = provenance;
  const actions = parseActions(msg.actions);
  if (actions) payload.actions = actions;
  return payload;
}

export function parseInterfaceSoundDetail(raw: unknown): InterfaceSoundDetail | null {
  if (!raw || typeof raw !== 'object') return null;
  const detail = raw as Record<string, unknown>;
  const resultId = boundString(detail.resultId, MAX_ID);
  if (!resultId || !isInterfaceSoundCue(detail.cue)) return null;
  return { resultId, cue: detail.cue };
}

function parseSubject(raw: unknown): GroundedSubject | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const kind = boundString(value.kind, MAX_LABEL);
  const label = boundString(value.label, MAX_LABEL);
  if (!kind || !label) return undefined;
  const id = boundString(value.id, MAX_ID);
  return id ? { kind, label, id } : { kind, label };
}

function parseEvidenceList(raw: unknown): GroundedEvidenceItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const items: GroundedEvidenceItem[] = [];
  for (const entry of raw.slice(0, MAX_EVIDENCE)) {
    if (!entry || typeof entry !== 'object') continue;
    const value = entry as Record<string, unknown>;
    const label = boundString(value.label, MAX_LABEL);
    if (!label) continue;
    const item: GroundedEvidenceItem = { label };
    const id = boundString(value.id, MAX_ID);
    const excerpt = boundString(value.excerpt, MAX_EXCERPT);
    const source = boundString(value.source, MAX_LABEL);
    if (id) item.id = id;
    if (excerpt) item.excerpt = excerpt;
    if (source) item.source = source;
    items.push(item);
  }
  return items.length ? items : undefined;
}

function parseProvenanceList(raw: unknown): GroundedProvenanceItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const items: GroundedProvenanceItem[] = [];
  for (const entry of raw.slice(0, MAX_PROVENANCE)) {
    if (!entry || typeof entry !== 'object') continue;
    const value = entry as Record<string, unknown>;
    const label = boundString(value.label, MAX_LABEL);
    if (!label) continue;
    const item: GroundedProvenanceItem = { label };
    const source = boundString(value.source, MAX_LABEL);
    const path = boundString(value.path, MAX_EXCERPT);
    if (source) item.source = source;
    if (path) item.path = path;
    items.push(item);
  }
  return items.length ? items : undefined;
}

function parseActions(raw: unknown): GroundedAction[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const items: GroundedAction[] = [];
  for (const entry of raw.slice(0, MAX_ACTIONS)) {
    if (!entry || typeof entry !== 'object') continue;
    const value = entry as Record<string, unknown>;
    const id = boundString(value.id, MAX_ID);
    const label = boundString(value.label, MAX_LABEL);
    if (!id || !label) continue;
    items.push({ id, label });
  }
  return items.length ? items : undefined;
}

function boundString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}
