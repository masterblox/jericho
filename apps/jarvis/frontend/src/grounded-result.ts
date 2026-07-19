/**
 * Frontend grounded-result wire parsing.
 * Validation is owned by shared assertGroundedResultEvent — this module only
 * adapts the shared contract and applies presentation enrichment (trim).
 */

import {
  assertGroundedResultEvent,
  type GroundedResultEvent,
  type GroundedResultClaim,
  type GroundedResultConflict,
  type GroundedResultProvenance,
  type GroundedResultAction,
  type GroundedResultPhase,
  type KnowledgeRoute,
  type AnswerConfidence,
  type MemoryRootAuthority,
} from '@jericho/shared';

export type {
  GroundedResultEvent,
  GroundedResultClaim,
  GroundedResultConflict,
  GroundedResultProvenance,
  GroundedResultAction,
  GroundedResultPhase,
  MemoryRootAuthority,
};

/** Alias retained for existing frontend call sites. */
export type GroundedResultPayload = GroundedResultEvent;
export type GroundedResultRoute = KnowledgeRoute;
export type GroundedResultConfidence = AnswerConfidence;
export type GroundedResultProvenanceV2 = GroundedResultProvenance;
export type GroundedResultActionsV2 = GroundedResultAction;

export const GROUNDED_RESULT_EVENT = 'jericho:grounded-result';
export const INTERFACE_SOUND_EVENT = 'jericho:interface-sound';
export const INTERFACE_SOUND_TOGGLE_EVENT = 'jericho:interface-sound-toggle';
export const INTERFACE_SOUND_MUTE_KEY = 'jericho.interfaceSound.muted.v1';
export const SPEECH_PLAYING_EVENT = 'jericho:speech-playing';

export const INTERFACE_SOUND_CUES = ['retrieve', 'summon', 'satellite', 'lock', 'dismiss'] as const;
export type InterfaceSoundCue = (typeof INTERFACE_SOUND_CUES)[number];

export const GROUNDED_RESULT_PHASES = ['retrieving', 'resolved', 'ambiguous', 'unavailable'] as const;
export const GROUNDED_RESULT_ROUTES = ['private_knowledge', 'core_operational', 'general', 'clarification'] as const;
export const GROUNDED_RESULT_CONFIDENCES = ['strong', 'partial', 'ambiguous', 'none'] as const;
export const MEMORY_ROOT_AUTHORITIES = ['canonical', 'supplemental'] as const;

export interface InterfaceSoundDetail { resultId: string; cue: InterfaceSoundCue; }
export interface GroundedParseError { field: string; message: string; value: unknown; }

const MAX_PATH = 1_024;
const MAX_OPAQUE_ID = 1_024;

export function isInterfaceSoundCue(v: unknown): v is InterfaceSoundCue {
  return typeof v === 'string' && (INTERFACE_SOUND_CUES as readonly string[]).includes(v);
}

export function isSafeRelativePath(value: string): boolean {
  if (!value || value.length > MAX_PATH || value.includes('\\') || value.includes('\0')) return false;
  if (value.startsWith('/') || value.startsWith('~/') || /^[a-zA-Z]:/.test(value)) return false;
  return !value.split('/').some((s) => !s || s === '.' || s === '..');
}

/** Preserve opaque resultId exactly; reject empty, whitespace-only, and over-limit IDs. */
export function parseInterfaceSoundDetail(raw: unknown): InterfaceSoundDetail | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.resultId !== 'string') return null;
  const resultId = d.resultId;
  if (resultId.length === 0 || !resultId.trim() || resultId.length > MAX_OPAQUE_ID) return null;
  return isInterfaceSoundCue(d.cue) ? { resultId, cue: d.cue } : null;
}

/** Trim string fields for presentation; never invent or rewrite contract data.
 *  Opaque IDs (resultId, sourceId, rootId, claim/conflict IDs, support/source
 *  arrays, action arrays) are preserved exactly after shared validation. */
function enrichForPresentation(event: GroundedResultEvent): GroundedResultEvent {
  const trim = (v: string) => v.trim();
  const out: GroundedResultEvent = {
    ...event,
    subject: trim(event.subject),
    provenance: event.provenance.map((p) => ({
      ...p,
      relativePath: trim(p.relativePath),
      title: trim(p.title),
      excerpt: typeof p.excerpt === 'string' ? p.excerpt.trim() : p.excerpt,
    })),
    actions: { ...event.actions },
  };
  if (event.canonicalIdentity !== undefined) out.canonicalIdentity = trim(event.canonicalIdentity);
  if (event.fullName !== undefined) out.fullName = trim(event.fullName);
  if (event.relationship !== undefined) out.relationship = trim(event.relationship);
  if (event.summary !== undefined) out.summary = trim(event.summary);
  if (event.indexRevision !== undefined) out.indexRevision = trim(event.indexRevision);
  if (event.employment) out.employment = event.employment.map(trim);
  if (event.claims) {
    out.claims = event.claims.map((c) => ({
      ...c,
      text: trim(c.text),
    }));
  }
  if (event.conflicts) {
    out.conflicts = event.conflicts.map((c) => ({
      ...c,
      claim: trim(c.claim),
      reason: trim(c.reason),
    }));
  }
  if (event.guided) out.guided = { test: 'isabella' };
  return out;
}

export function parseGroundedResultMessage(raw: unknown): GroundedResultPayload | null {
  const r = parseGroundedResult(raw);
  return r.success ? r.payload : null;
}

export function parseGroundedResult(
  raw: unknown,
): { success: true; payload: GroundedResultPayload } | { success: false; errors: GroundedParseError[] } {
  try {
    assertGroundedResultEvent(raw);
    return { success: true, payload: enrichForPresentation(raw) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, errors: [{ field: 'root', message, value: raw }] };
  }
}
