import {
  GUIDED_TEST_PHASES,
  type GuidedTestPhase,
  type IdentityAwareRetrievalResult,
} from '@jericho/shared';

export const GUIDED_TEST_DURATION_MS = 5 * 60_000;

export interface IsabellaGuidedSession {
  test: 'isabella';
  phase: GuidedTestPhase;
  expiresAt: number;
  retrievalCount: number;
  announcedPhases: Set<GuidedTestPhase>;
  evidence?: IdentityAwareRetrievalResult;
}

export function createIsabellaGuidedSession(now = Date.now()): IsabellaGuidedSession {
  return {
    test: 'isabella',
    phase: 'ready',
    expiresAt: now + GUIDED_TEST_DURATION_MS,
    retrievalCount: 0,
    announcedPhases: new Set(),
  };
}

export function refreshGuidedExpiry(session: IsabellaGuidedSession, now = Date.now()): void {
  session.expiresAt = now + GUIDED_TEST_DURATION_MS;
}

export function isGuidedExpired(session: IsabellaGuidedSession | undefined, now = Date.now()): boolean {
  return !session || session.expiresAt <= now;
}

export function phaseIndex(phase: GuidedTestPhase): number {
  return GUIDED_TEST_PHASES.indexOf(phase);
}

/** Completed phases cannot regress; only same or next-step transitions are allowed. */
export function canEnterPhase(session: IsabellaGuidedSession, next: GuidedTestPhase): boolean {
  const current = phaseIndex(session.phase);
  const target = phaseIndex(next);
  if (current < 0 || target < 0) return false;
  if (session.phase === 'complete') return next === 'complete';
  return target === current || target === current + 1;
}

export function advancePhase(
  session: IsabellaGuidedSession,
  next: GuidedTestPhase,
): GuidedTestPhase | undefined {
  if (!canEnterPhase(session, next)) return undefined;
  session.phase = next;
  return next;
}

export function markPhaseAnnounced(session: IsabellaGuidedSession, phase: GuidedTestPhase): boolean {
  if (session.announcedPhases.has(phase)) return false;
  session.announcedPhases.add(phase);
  return true;
}

export function guidedPhaseInstruction(
  phase: GuidedTestPhase,
  evidence?: IdentityAwareRetrievalResult,
): string {
  switch (phase) {
    case 'ready':
      return [
        'Guided test phase: ready.',
        'Say exactly once: “Guided test ready, sir.”',
        'Then wait silently for Carlos.',
        'Do not ask him to ask who Isabella is.',
        'Do not invent vault facts.',
        'Do not repeat this instruction.',
      ].join(' ');
    case 'retrieving':
      return [
        'Guided test phase: retrieving.',
        'Stop any speculative narration immediately and stay silent.',
        'Do not invent Isabella facts while retrieval runs.',
        'Do not ask Carlos to ask who Isabella is.',
      ].join(' ');
    case 'presenting':
      return [
        'Guided test phase: presenting.',
        'Narrate only the resolved evidence below once, briefly, addressing Carlos as sir.',
        'Group claims by full identity and provenance.',
        'Treat first-name-only matches as ambiguous and do not merge them into Isabella Handel.',
        'Do not ask Carlos to ask who Isabella is.',
        'Do not invent missing facts.',
        formatEvidenceForGemini(evidence),
      ].join(' ');
    case 'opening':
      return [
        'Guided test phase: opening.',
        'Say once that the Isabella Handel source note is open in Obsidian.',
        'Do not claim reorganization or review is complete.',
        'Do not repeat earlier instructions.',
      ].join(' ');
    case 'correcting_organizing':
      return [
        'Guided test phase: correcting/organizing.',
        'Say once that Carlos may drag the Isabella card to preview reorganization.',
        'Do not claim the preview passed or that Obsidian was written.',
        'Do not repeat earlier instructions.',
      ].join(' ');
    case 'reviewing':
      return [
        'Guided test phase: reviewing.',
        'Say once that the exact Core reorganization preview is ready for approve or reject.',
        'Do not claim Obsidian changed.',
        'Do not repeat earlier instructions.',
      ].join(' ');
    case 'complete':
      return [
        'Guided test phase: complete.',
        'Say once that the guided test is complete and Obsidian remains unchanged unless a separate write was confirmed.',
        'Do not restart the test or ask who Isabella is.',
      ].join(' ');
  }
}

function formatEvidenceForGemini(evidence?: IdentityAwareRetrievalResult): string {
  if (!evidence) return 'Evidence: none available.';
  const resolved = evidence.resolved;
  const lines: string[] = [];
  if (resolved) {
    lines.push(`Resolved identity: ${resolved.fullName}.`);
    if (resolved.relationshipToCarlos) {
      lines.push(`Relationship to Carlos: ${resolved.relationshipToCarlos}.`);
    }
    if (resolved.employment?.length) {
      lines.push(`Employment: ${resolved.employment.join(', ')}.`);
    }
    for (const item of resolved.provenance) {
      lines.push(`Provenance: ${item.relativePath} — ${item.excerpt}`);
    }
  } else {
    lines.push('Resolved identity: unavailable.');
  }
  if (evidence.excluded.length) {
    lines.push('Ambiguous first-name-only evidence (do not merge into Isabella Handel):');
    for (const group of evidence.excluded) {
      for (const item of group.provenance) {
        lines.push(`Excluded: ${item.relativePath} — ${item.excerpt}`);
      }
    }
  }
  return lines.join(' ');
}
