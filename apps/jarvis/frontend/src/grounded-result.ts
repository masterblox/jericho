/**
 * Temporary frontend-local grounded-result wire parsing.
 * Matches shared @jericho/shared GroundedResultEvent v2 at cf238176.
 * All over-limit fields are rejected, never truncated.
 */

export const GROUNDED_RESULT_EVENT = 'jericho:grounded-result';
export const INTERFACE_SOUND_EVENT = 'jericho:interface-sound';
export const INTERFACE_SOUND_TOGGLE_EVENT = 'jericho:interface-sound-toggle';
export const INTERFACE_SOUND_MUTE_KEY = 'jericho.interfaceSound.muted.v1';
export const SPEECH_PLAYING_EVENT = 'jericho:speech-playing';

export const INTERFACE_SOUND_CUES = ['retrieve','summon','satellite','lock','dismiss'] as const;
export type InterfaceSoundCue = (typeof INTERFACE_SOUND_CUES)[number];

export const GROUNDED_RESULT_PHASES = ['retrieving','resolved','ambiguous','unavailable'] as const;
export type GroundedResultPhase = (typeof GROUNDED_RESULT_PHASES)[number];

export const GROUNDED_RESULT_ROUTES = ['private_knowledge','core_operational','general','clarification'] as const;
export type GroundedResultRoute = (typeof GROUNDED_RESULT_ROUTES)[number];

export const GROUNDED_RESULT_CONFIDENCES = ['strong','partial','ambiguous','none'] as const;
export type GroundedResultConfidence = (typeof GROUNDED_RESULT_CONFIDENCES)[number];

export const MEMORY_ROOT_AUTHORITIES = ['canonical','supplemental'] as const;
export type MemoryRootAuthority = (typeof MEMORY_ROOT_AUTHORITIES)[number];

export interface GroundedResultProvenanceV2 {
  sourceId: string; rootId: string; authority: MemoryRootAuthority;
  relativePath: string; title: string; excerpt: string; score: number;
}
export interface GroundedResultClaim { id: string; text: string; supportSourceIds: string[]; }
export interface GroundedResultConflict { id: string; claim: string; reason: string; sourceIds: string[]; }
export interface GroundedResultActionsV2 {
  openSourceIds?: string[]; reorganizeSourceIds?: string[]; correctConflictIds?: string[];
}
export interface GroundedResultPayload {
  schemaVersion: 2; resultId: string; phase: GroundedResultPhase; route: GroundedResultRoute;
  subject: string; confidence: GroundedResultConfidence;
  canonicalIdentity?: string; fullName?: string; relationship?: string; employment?: string[];
  summary?: string; claims?: GroundedResultClaim[]; conflicts?: GroundedResultConflict[];
  indexRevision?: string;
  provenance: GroundedResultProvenanceV2[]; actions: GroundedResultActionsV2;
  retrievalCount: number; guided?: { test: 'isabella' };
}
export interface InterfaceSoundDetail { resultId: string; cue: InterfaceSoundCue; }
export interface GroundedParseError { field: string; message: string; value: unknown; }

const MAX_ID = 1_024;
const MAX_STR = 500;
const MAX_EXCERPT = 480;
const MAX_PATH = 1_024;
const MAX_PROVENANCE = 50;
const MAX_CLAIMS = 50;
const MAX_CONFLICTS = 50;
const MAX_ACTION_IDS = 50;
const MAX_EMPLOYMENT = 10;
const MAX_EMP_ITEM = 200;
const MAX_RETRIEVAL = 100;

export function isInterfaceSoundCue(v: unknown): v is InterfaceSoundCue {
  return typeof v === 'string' && (INTERFACE_SOUND_CUES as readonly string[]).includes(v);
}
export function isSafeRelativePath(value: string): boolean {
  if (!value || value.length > MAX_PATH || value.includes('\\') || value.includes('\0')) return false;
  if (value.startsWith('/') || value.startsWith('~/') || /^[a-zA-Z]:/.test(value)) return false;
  return !value.split('/').some((s) => !s || s === '.' || s === '..');
}
export function parseInterfaceSoundDetail(raw: unknown): InterfaceSoundDetail | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const resultId = exactString(d.resultId, MAX_ID);
  return resultId && isInterfaceSoundCue(d.cue) ? { resultId, cue: d.cue } : null;
}

export function parseGroundedResultMessage(raw: unknown): GroundedResultPayload | null {
  const r = parseGroundedResult(raw); return r.success ? r.payload : null;
}

export function parseGroundedResult(raw: unknown): { success: true; payload: GroundedResultPayload } | { success: false; errors: GroundedParseError[] } {
  const errors: GroundedParseError[] = [];
  if (!raw || typeof raw !== 'object') return { success: false, errors: [{ field: 'root', message: 'Expected non-null object', value: raw }] };
  const msg = raw as Record<string, unknown>;

  if (msg.schemaVersion !== 2) errors.push({ field: 'schemaVersion', message: 'Required: 2', value: msg.schemaVersion });

  const ALLOWED = new Set(['schemaVersion','resultId','phase','route','subject','confidence','canonicalIdentity','fullName','relationship','employment','summary','claims','conflicts','indexRevision','provenance','actions','retrievalCount','guided']);
  for (const k of Object.keys(msg)) { if (!ALLOWED.has(k)) errors.push({ field: k, message: 'Unknown field rejected', value: msg[k] }); }

  const resultId = exactString(msg.resultId, MAX_ID);
  if (!resultId) errors.push({ field: 'resultId', message: `Non-empty <= ${MAX_ID}`, value: msg.resultId });
  const phase = allowlisted(msg.phase, GROUNDED_RESULT_PHASES);
  if (!phase) errors.push({ field: 'phase', message: `One of ${GROUNDED_RESULT_PHASES}`, value: msg.phase });
  const route = allowlisted(msg.route, GROUNDED_RESULT_ROUTES);
  if (!route) errors.push({ field: 'route', message: `One of ${GROUNDED_RESULT_ROUTES}`, value: msg.route });
  // subject: exactString, NOT clipString — rejects over-limit
  const subject = exactString(msg.subject, MAX_STR);
  if (!subject) errors.push({ field: 'subject', message: `Non-empty string 1-${MAX_STR}`, value: msg.subject });
  const confidence = allowlisted(msg.confidence, GROUNDED_RESULT_CONFIDENCES);
  if (!confidence) errors.push({ field: 'confidence', message: `One of ${GROUNDED_RESULT_CONFIDENCES}`, value: msg.confidence });

  if (typeof msg.retrievalCount !== 'number' || !Number.isInteger(msg.retrievalCount) || msg.retrievalCount < 0 || msg.retrievalCount > MAX_RETRIEVAL)
    errors.push({ field: 'retrievalCount', message: `Integer 0-${MAX_RETRIEVAL}`, value: msg.retrievalCount });

  // optional strings: exactString rejects over-limit
  const opt = new Map<string, string>();
  for (const key of ['canonicalIdentity','fullName','relationship','summary','indexRevision']) {
    if (key in msg && msg[key] !== undefined) {
      const v = exactString(msg[key], MAX_STR);
      if (!v) errors.push({ field: key, message: `Optional string 1-${MAX_STR}`, value: msg[key] });
      else opt.set(key, v);
    }
  }

  // employment: exactString per item
  let employment: string[] | undefined;
  if ('employment' in msg && msg.employment !== undefined) {
    if (!Array.isArray(msg.employment)) errors.push({ field: 'employment', message: 'Must be array of strings', value: msg.employment });
    else {
      const emp = msg.employment as unknown[];
      if (emp.length > MAX_EMPLOYMENT) errors.push({ field: 'employment', message: `Max ${MAX_EMPLOYMENT} entries`, value: emp.length });
      else {
        employment = [];
        for (const item of emp) {
          const s = exactString(item, MAX_EMP_ITEM);
          if (!s) { errors.push({ field: `employment[${employment.length}]`, message: `Non-empty 1-${MAX_EMP_ITEM}`, value: item }); break; }
          employment.push(s);
        }
      }
    }
  }

  const claims = parseClaims(msg.claims); if (!claims.success) errors.push(...claims.errors);
  const conflicts = parseConflicts(msg.conflicts); if (!conflicts.success) errors.push(...conflicts.errors);
  const provenance = parseProvenanceV2(msg.provenance); if (!provenance.success) errors.push(...provenance.errors);
  const actions = parseActionsV2(msg.actions); if (!actions.success) errors.push(...actions.errors);

  if (errors.length > 0) return { success: false, errors };

  const p: GroundedResultPayload = {
    schemaVersion: 2, resultId: resultId!, phase: phase!, route: route!, subject: subject!, confidence: confidence!,
    provenance: (provenance as { success: true; payload: GroundedResultProvenanceV2[] }).payload,
    actions: (actions as { success: true; payload: GroundedResultActionsV2 }).payload,
    retrievalCount: msg.retrievalCount as number,
  };
  if (employment) p.employment = employment;
  for (const [k, v] of opt) (p as unknown as Record<string, unknown>)[k] = v;
  if (msg.claims !== undefined) p.claims = (claims as { success: true; payload: GroundedResultClaim[] }).payload;
  if (msg.conflicts !== undefined) p.conflicts = (conflicts as { success: true; payload: GroundedResultConflict[] }).payload;

  if (msg.guided !== undefined) {
    if (!msg.guided || typeof msg.guided !== 'object') { errors.push({ field: 'guided', message: '{test:"isabella"}', value: msg.guided }); return { success: false, errors }; }
    const g = msg.guided as Record<string, unknown>;
    if (g.test !== 'isabella') { errors.push({ field: 'guided.test', message: 'Must be isabella', value: g.test }); return { success: false, errors }; }
    if (Object.keys(g).some(k => k !== 'test')) { errors.push({ field: 'guided', message: 'Only test allowed', value: g }); return { success: false, errors }; }
    p.guided = { test: 'isabella' };
  }
  return { success: true, payload: p };
}

function parseClaims(raw: unknown): { success: true; payload: GroundedResultClaim[] } | { success: false; errors: GroundedParseError[] } {
  if (raw === undefined) return { success: true, payload: [] };
  if (!Array.isArray(raw) || isSparse(raw)) return { success: false, errors: [{ field: 'claims', message: 'Must be dense array', value: raw }] };
  if (raw.length > MAX_CLAIMS) return { success: false, errors: [{ field: 'claims', message: `Max ${MAX_CLAIMS}`, value: raw.length }] };
  const errors: GroundedParseError[] = [];
  const out: GroundedResultClaim[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') { errors.push({ field: `claims[${out.length}]`, message: 'Non-null object', value: entry }); break; }
    const c = entry as Record<string, unknown>;
    const id = exactString(c.id, MAX_ID);
    const text = exactString(c.text, MAX_STR);
    if (!id) errors.push({ field: `claims[${out.length}].id`, message: 'Required 1-1024', value: c.id });
    if (!text) errors.push({ field: `claims[${out.length}].text`, message: `Required 1-${MAX_STR}`, value: c.text });
    const srcRes = parseIdList(c.supportSourceIds, `claims[${out.length}].supportSourceIds`);
    if (!srcRes.success) errors.push(...srcRes.errors);
    if (id && text && srcRes.success) out.push({ id, text, supportSourceIds: srcRes.payload });
    if (errors.length) break;
  }
  return errors.length > 0 ? { success: false, errors } : { success: true, payload: out };
}

function parseConflicts(raw: unknown): { success: true; payload: GroundedResultConflict[] } | { success: false; errors: GroundedParseError[] } {
  if (raw === undefined) return { success: true, payload: [] };
  if (!Array.isArray(raw) || isSparse(raw)) return { success: false, errors: [{ field: 'conflicts', message: 'Must be dense array', value: raw }] };
  if (raw.length > MAX_CONFLICTS) return { success: false, errors: [{ field: 'conflicts', message: `Max ${MAX_CONFLICTS}`, value: raw.length }] };
  const errors: GroundedParseError[] = [];
  const out: GroundedResultConflict[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') { errors.push({ field: `conflicts[${out.length}]`, message: 'Non-null object', value: entry }); break; }
    const c = entry as Record<string, unknown>;
    const id = exactString(c.id, MAX_ID);
    const claim = exactString(c.claim, MAX_STR);
    const reason = exactString(c.reason, MAX_STR);
    if (!id) errors.push({ field: `conflicts[${out.length}].id`, message: 'Required 1-1024', value: c.id });
    if (!claim) errors.push({ field: `conflicts[${out.length}].claim`, message: `Required 1-${MAX_STR}`, value: c.claim });
    if (!reason) errors.push({ field: `conflicts[${out.length}].reason`, message: `Required 1-${MAX_STR}`, value: c.reason });
    const srcRes = parseIdList(c.sourceIds, `conflicts[${out.length}].sourceIds`);
    if (!srcRes.success) errors.push(...srcRes.errors);
    if (id && claim && reason && srcRes.success) out.push({ id, claim, reason, sourceIds: srcRes.payload });
    if (errors.length) break;
  }
  return errors.length > 0 ? { success: false, errors } : { success: true, payload: out };
}

function parseProvenanceV2(raw: unknown): { success: true; payload: GroundedResultProvenanceV2[] } | { success: false; errors: GroundedParseError[] } {
  if (!Array.isArray(raw) || isSparse(raw)) return { success: false, errors: [{ field: 'provenance', message: 'Must be dense array', value: raw }] };
  if (raw.length > MAX_PROVENANCE) return { success: false, errors: [{ field: 'provenance', message: `Max ${MAX_PROVENANCE}`, value: raw.length }] };
  const errors: GroundedParseError[] = [];
  const out: GroundedResultProvenanceV2[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') { errors.push({ field: `prov[${out.length}]`, message: 'Non-null object', value: entry }); break; }
    const v = entry as Record<string, unknown>;
    const sourceId = exactString(v.sourceId, MAX_ID);
    const rootId = exactString(v.rootId, MAX_ID);
    const authority = allowlisted(v.authority, MEMORY_ROOT_AUTHORITIES);
    const relativePath = exactString(v.relativePath, MAX_PATH);
    const title = exactString(v.title, MAX_STR);
    const excerpt = exactString(v.excerpt, MAX_EXCERPT);
    if (!sourceId) errors.push({ field: `prov[${out.length}].sourceId`, message: 'Required', value: v.sourceId });
    if (!rootId) errors.push({ field: `prov[${out.length}].rootId`, message: 'Required', value: v.rootId });
    if (!authority) errors.push({ field: `prov[${out.length}].authority`, message: 'canonical|supplemental', value: v.authority });
    if (!relativePath) errors.push({ field: `prov[${out.length}].relativePath`, message: 'Required safe path', value: v.relativePath });
    else if (!isSafeRelativePath(relativePath)) errors.push({ field: `prov[${out.length}].relativePath`, message: 'Unsafe', value: relativePath });
    if (!title) errors.push({ field: `prov[${out.length}].title`, message: `Required 1-${MAX_STR}`, value: v.title });
    if (!excerpt) errors.push({ field: `prov[${out.length}].excerpt`, message: `Required 1-${MAX_EXCERPT}`, value: v.excerpt });
    if (typeof v.score !== 'number' || !Number.isFinite(v.score) || v.score < 0 || v.score > 1)
      errors.push({ field: `prov[${out.length}].score`, message: '0-1', value: v.score });
    if (errors.length) break;
    out.push({ sourceId: sourceId!, rootId: rootId!, authority: authority as MemoryRootAuthority, relativePath: relativePath!, title: title!, excerpt: excerpt!, score: v.score as number });
  }
  return errors.length > 0 ? { success: false, errors } : { success: true, payload: out };
}

function parseActionsV2(raw: unknown): { success: true; payload: GroundedResultActionsV2 } | { success: false; errors: GroundedParseError[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { success: false, errors: [{ field: 'actions', message: 'Non-null non-array object', value: raw }] };
  const v = raw as Record<string, unknown>;
  const errors: GroundedParseError[] = [];
  const ak = new Set(['openSourceIds','reorganizeSourceIds','correctConflictIds']);
  for (const k of Object.keys(v)) { if (!ak.has(k)) errors.push({ field: `actions.${k}`, message: 'Unknown', value: k }); }
  if (errors.length > 0) return { success: false, errors };
  const a: GroundedResultActionsV2 = {};
  for (const key of ['openSourceIds','reorganizeSourceIds','correctConflictIds'] as const) {
    if (v[key] !== undefined) {
      const r = parseIdList(v[key], `actions.${key}`);
      if (!r.success) errors.push(...r.errors);
      else if (r.payload.length > 0) (a as Record<string, string[]>)[key] = r.payload;
    }
  }
  return errors.length > 0 ? { success: false, errors } : { success: true, payload: a };
}

function parseIdList(raw: unknown, field: string): { success: true; payload: string[] } | { success: false; errors: GroundedParseError[] } {
  if (raw === undefined) return { success: true, payload: [] };
  if (!Array.isArray(raw) || isSparse(raw)) return { success: false, errors: [{ field, message: 'Must be dense array', value: raw }] };
  if (raw.length > MAX_ACTION_IDS) return { success: false, errors: [{ field, message: `Max ${MAX_ACTION_IDS}`, value: raw.length }] };
  const errors: GroundedParseError[] = [];
  const out: string[] = [];
  for (const e of raw) {
    const s = exactString(e, MAX_ID);
    if (!s) { errors.push({ field: `${field}[${out.length}]`, message: `Non-empty 1-${MAX_ID}`, value: e }); break; }
    out.push(s);
  }
  return errors.length > 0 ? { success: false, errors } : { success: true, payload: out };
}

function allowlisted<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v as T : undefined;
}
function exactString(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t && t.length <= max ? t : undefined;
}
function isSparse(arr: unknown[]): boolean { return Object.keys(arr).length !== arr.length; }
