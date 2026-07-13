import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FALLBACK_VOICE,
  loadVoicePreset,
  resolvePresentationVoice,
  saveVoicePreset,
} from '../src/voice/voice-preference.js';
import {
  groupIdentityEvidence,
  buildGroundedResultEvent,
  validateGroundedResultEvent,
  isValidRelativePath,
  type VaultEvidenceHit,
  ISABELLA_IDENTITY,
  type GroupIdentityConfig,
} from '../src/retrieval/identity-aware.js';
import {
  advancePhase,
  canEnterPhase,
  createIsabellaGuidedSession,
  markPhaseAnnounced,
} from '../src/guided/isabella-session.js';

describe('voice preference persistence', () => {
  it('persists only the confirmed preset and falls back to Algieba when unset', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jericho-voice-'));
    const path = join(dir, 'presentation-voice.json');
    expect(resolvePresentationVoice({ preferencePath: path })).toBe(DEFAULT_FALLBACK_VOICE);
    saveVoicePreset(path, 'Orus', '2026-07-12T12:00:00.000Z');
    expect(loadVoicePreset(path)).toEqual({
      voice: 'Orus',
      confirmedAt: '2026-07-12T12:00:00.000Z',
    });
    expect(resolvePresentationVoice({ preferencePath: path, configuredVoice: 'Algieba' })).toBe('Orus');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      voice: 'Orus',
      confirmedAt: '2026-07-12T12:00:00.000Z',
    });
    expect(() => saveVoicePreset(path, 'NotAVoice', '2026-07-12T12:00:00.000Z')).toThrow(/unsupported_voice/);
  });
});

describe('identity-aware Isabella retrieval', () => {
  it('keeps first-name-only evidence ambiguous and resolves Isabella Handel with provenance', () => {
    const result = groupIdentityEvidence('Isabella', [
      {
        path: 'Prada Mind/05 - People & Partnerships/Team Members/Isabella Handel.md',
        title: 'Isabella Handel',
        excerpt: 'Isabella Handel works at MasterBlox and is married to Carlos Prada.',
        score: 0.97,
      },
      {
        path: 'Sessions/Francisco-notes.md',
        title: 'Francisco session',
        excerpt: 'Isabella is Francisco wife and works elsewhere.',
        score: 0.8,
      },
    ]);

    expect(result.retrievalCount).toBe(1);
    expect(result.resolved?.fullName).toBe('Isabella Handel');
    expect(result.resolved?.employment).toContain('MasterBlox');
    expect(result.resolved?.relationshipToCarlos).toMatch(/spouse|wife/i);
    expect(result.resolved?.provenance[0]?.relativePath).toContain('Isabella Handel.md');
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]?.ambiguous).toBe(true);
    expect(result.excluded[0]?.provenance[0]?.relativePath).toContain('Francisco');
  });
});

describe('grounded_result contract', () => {
  const resultId = randomUUID();

  const canonicalHit: VaultEvidenceHit = {
    path: 'Prada Mind/05 - People & Partnerships/Team Members/Isabella Handel.md',
    title: 'Isabella Handel',
    excerpt: 'Isabella Handel works at MasterBlox and is married to Carlos Prada.',
    score: 0.97,
  };

  const ambiguousHit: VaultEvidenceHit = {
    path: 'Sessions/Francisco-notes.md',
    title: 'Isabella mention',
    excerpt: 'Isabella was mentioned in passing during the Francisco session.',
    score: 0.42,
  };

  const noRelationshipHit: VaultEvidenceHit = {
    path: 'Contacts/Isabella Handel.md',
    title: 'Isabella Handel',
    excerpt: 'Isabella Handel contact card. No relationship data.',
    score: 0.85,
  };

  it('resolved with strong confidence when canonical + relationship evidence exists', () => {
    const result = groupIdentityEvidence('Isabella', [canonicalHit, ambiguousHit], 1);
    const event = buildGroundedResultEvent(result, resultId, 'private_knowledge', { test: 'isabella' });

    expect(event.phase).toBe('resolved');
    expect(event.confidence).toBe('strong');
    expect(event.canonicalIdentity).toBe('Isabella Handel');
    expect(event.fullName).toBe('Isabella Handel');
    expect(event.relationship).toMatch(/spouse|wife/i);
    expect(event.employment).toContain('MasterBlox');
    expect(event.retrievalCount).toBe(1);
    expect(event.route).toBe('private_knowledge');
    expect(event.subject).toBe('Isabella');
    expect(event.guided?.test).toBe('isabella');
  });

  it('resolved with partial confidence when canonical but no relationship', () => {
    const result = groupIdentityEvidence('Isabella', [noRelationshipHit], 1);
    const event = buildGroundedResultEvent(result, resultId);

    expect(event.phase).toBe('resolved');
    expect(event.confidence).toBe('partial');
    expect(event.canonicalIdentity).toBe('Isabella Handel');
    expect(event.relationship).toBeUndefined();
    expect(event.employment).toBeUndefined();
  });

  it('ambiguous when only first-name evidence exists', () => {
    const result = groupIdentityEvidence('Isabella', [ambiguousHit], 1);
    const event = buildGroundedResultEvent(result, resultId);

    expect(event.phase).toBe('ambiguous');
    expect(event.confidence).toBe('ambiguous');
    expect(event.canonicalIdentity).toBeUndefined();
    expect(event.fullName).toBeUndefined();
    expect(event.relationship).toBeUndefined();
  });

  it('unavailable when no evidence matches', () => {
    const result = groupIdentityEvidence('Isabella', [
      { path: 'Notes/unrelated.md', title: 'Unrelated', excerpt: 'No match here.', score: 0.1 },
    ], 1);
    const event = buildGroundedResultEvent(result, resultId);

    expect(event.phase).toBe('unavailable');
    expect(event.confidence).toBe('none');
    expect(event.provenance).toHaveLength(0);
  });

  it('bounded excerpts and relative paths', () => {
    const result = groupIdentityEvidence('Isabella', [canonicalHit], 1);
    const event = buildGroundedResultEvent(result, resultId);

    for (const item of event.provenance) {
      expect(item.excerpt.length).toBeLessThanOrEqual(480);
      expect(item.relativePath).not.toMatch(/^\//);
      expect(item.relativePath).not.toContain('..');
      expect(item.relativePath.length).toBeGreaterThan(0);
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(typeof item.title).toBe('string');
      expect(item.title.length).toBeGreaterThan(0);
    }
  });

  it('reorganize_notes with one canonical openable note', () => {
    const result = groupIdentityEvidence('Isabella', [canonicalHit], 1);
    const event = buildGroundedResultEvent(result, resultId);

    expect(event.actions.open_note).toBe(canonicalHit.path);
    expect(event.actions.reorganize_notes).toBe(true);
  });

  it('correct_identity action when ambiguous evidence exists', () => {
    const result = groupIdentityEvidence('Isabella', [canonicalHit, ambiguousHit], 1);
    const event = buildGroundedResultEvent(result, resultId);

    expect(event.actions.correct_identity).toBe(true);
  });

  it('no correct_identity when only canonical evidence', () => {
    const result = groupIdentityEvidence('Isabella', [canonicalHit], 1);
    const event = buildGroundedResultEvent(result, resultId);

    expect(event.actions.correct_identity).toBeUndefined();
  });

  it('resultId matches input', () => {
    const result = groupIdentityEvidence('Isabella', [canonicalHit], 1);
    const event = buildGroundedResultEvent(result, resultId);

    expect(event.resultId).toBe(resultId);
  });

  it('natural questions have same contract as guided (minus guided field)', () => {
    const result = groupIdentityEvidence('Isabella', [canonicalHit, ambiguousHit], 1);
    const guidedEvent = buildGroundedResultEvent(result, resultId, 'private_knowledge', { test: 'isabella' });
    const naturalEvent = buildGroundedResultEvent(result, resultId, 'private_knowledge');

    expect(guidedEvent.guided?.test).toBe('isabella');
    expect(naturalEvent.guided).toBeUndefined();

    expect(guidedEvent.phase).toBe(naturalEvent.phase);
    expect(guidedEvent.confidence).toBe(naturalEvent.confidence);
    expect(guidedEvent.subject).toBe(naturalEvent.subject);
    expect(guidedEvent.fullName).toBe(naturalEvent.fullName);
    expect(guidedEvent.relationship).toBe(naturalEvent.relationship);
    expect(guidedEvent.actions).toEqual(naturalEvent.actions);
    expect(guidedEvent.retrievalCount).toBe(naturalEvent.retrievalCount);
  });

  it('retrievalCount matches input', () => {
    const result = groupIdentityEvidence('Isabella', [canonicalHit], 1);
    const event = buildGroundedResultEvent(result, resultId);
    expect(event.retrievalCount).toBe(1);
  });

  it('resultId reused across phases produces same id', () => {
    const sharedId = resultId;
    const result = groupIdentityEvidence('Isabella', [canonicalHit], 1);
    const event = buildGroundedResultEvent(result, sharedId);
    expect(event.resultId).toBe(sharedId);
    expect(typeof sharedId).toBe('string');
  });
});

describe('validateGroundedResultEvent', () => {
  it('accepts valid events', () => {
    const result = groupIdentityEvidence('Isabella', [
      { path: 'People/Isabella Handel.md', title: 'Isabella Handel', excerpt: 'Works at MasterBlox.', score: 0.97 },
    ], 1);
    const event = buildGroundedResultEvent(result, randomUUID());
    expect(() => validateGroundedResultEvent(event)).not.toThrow();
  });

  it('rejects malicious absolute paths', () => {
    const result = groupIdentityEvidence('Isabella', [
      { path: 'People/ok.md', title: 'ok', excerpt: 'ok.', score: 0.5 },
    ], 1);
    const event = buildGroundedResultEvent(result, randomUUID());
    (event as unknown as Record<string, unknown>).provenance = [{ relativePath: '/etc/passwd', title: 'x', excerpt: 'x', score: 0.5 }];
    expect(() => validateGroundedResultEvent(event)).toThrow(/relativePath/);
  });

  it('rejects traversal paths', () => {
    const result = groupIdentityEvidence('Isabella', [
      { path: 'People/ok.md', title: 'ok', excerpt: 'ok.', score: 0.5 },
    ], 1);
    const event = buildGroundedResultEvent(result, randomUUID());
    (event as unknown as Record<string, unknown>).provenance = [{ relativePath: '../../../.ssh/id_rsa', title: 'x', excerpt: 'x', score: 0.5 }];
    expect(() => validateGroundedResultEvent(event)).toThrow(/relativePath/);
  });

  it('rejects backslash paths', () => {
    const result = groupIdentityEvidence('Isabella', [
      { path: 'People/ok.md', title: 'ok', excerpt: 'ok.', score: 0.5 },
    ], 1);
    const event = buildGroundedResultEvent(result, randomUUID());
    (event as unknown as Record<string, unknown>).provenance = [{ relativePath: 'People\\ok.md', title: 'x', excerpt: 'x', score: 0.5 }];
    expect(() => validateGroundedResultEvent(event)).toThrow(/relativePath/);
  });

  it('rejects score out of bounds', () => {
    const result = groupIdentityEvidence('Isabella', [
      { path: 'People/ok.md', title: 'ok', excerpt: 'ok.', score: 0.5 },
    ], 1);
    const event = buildGroundedResultEvent(result, randomUUID());
    (event as unknown as Record<string, unknown>).provenance = [{ relativePath: 'People/ok.md', title: 'x', excerpt: 'x', score: 1.5 }];
    expect(() => validateGroundedResultEvent(event)).toThrow(/score/);
  });

  it('rejects negative score', () => {
    const result = groupIdentityEvidence('Isabella', [
      { path: 'People/ok.md', title: 'ok', excerpt: 'ok.', score: 0.5 },
    ], 1);
    const event = buildGroundedResultEvent(result, randomUUID());
    (event as unknown as Record<string, unknown>).provenance = [{ relativePath: 'People/ok.md', title: 'x', excerpt: 'x', score: -0.1 }];
    expect(() => validateGroundedResultEvent(event)).toThrow(/score/);
  });

  it('rejects oversized provenance', () => {
    const result = groupIdentityEvidence('Isabella', [
      { path: 'People/ok.md', title: 'ok', excerpt: 'ok.', score: 0.5 },
    ], 1);
    const event = buildGroundedResultEvent(result, randomUUID());
    const items = Array.from({ length: 51 }, () => ({ relativePath: 'People/ok.md', title: 'x', excerpt: 'x', score: 0.5 }));
    (event as unknown as Record<string, unknown>).provenance = items;
    expect(() => validateGroundedResultEvent(event)).toThrow(/provenance/);
  });

  it('rejects unknown action keys', () => {
    const result = groupIdentityEvidence('Isabella', [
      { path: 'People/ok.md', title: 'ok', excerpt: 'ok.', score: 0.5 },
    ], 1);
    const event = buildGroundedResultEvent(result, randomUUID());
    (event as unknown as Record<string, unknown>).actions = { open_note: 'People/ok.md', evil_action: true };
    expect(() => validateGroundedResultEvent(event)).toThrow(/actions/);
  });

  it('rejects reorganize_notes without open_note', () => {
    const result = groupIdentityEvidence('Isabella', [
      { path: 'People/ok.md', title: 'ok', excerpt: 'ok.', score: 0.5 },
    ], 1);
    const event = buildGroundedResultEvent(result, randomUUID());
    (event as unknown as Record<string, unknown>).actions = { reorganize_notes: true };
    expect(() => validateGroundedResultEvent(event)).toThrow(/open_note/);
  });

  it('rejects oversized subject', () => {
    const result = groupIdentityEvidence('Isabella', [
      { path: 'People/ok.md', title: 'ok', excerpt: 'ok.', score: 0.5 },
    ], 1);
    const event = buildGroundedResultEvent(result, randomUUID());
    (event as unknown as Record<string, unknown>).subject = 'x'.repeat(501);
    expect(() => validateGroundedResultEvent(event)).toThrow(/subject/);
  });

  it('validates open_note path', () => {
    const result = groupIdentityEvidence('Isabella', [
      { path: 'People/ok.md', title: 'ok', excerpt: 'ok.', score: 0.5 },
    ], 1);
    const event = buildGroundedResultEvent(result, randomUUID());
    (event as unknown as Record<string, unknown>).actions = { open_note: '/absolute/path.md', reorganize_notes: true };
    expect(() => validateGroundedResultEvent(event)).toThrow(/open_note/);
  });
});

describe('generalized identity grouping', () => {
  it('groups by custom config for a different identity', () => {
    const config: GroupIdentityConfig = {
      canonicalFullName: 'Alice Smith',
      firstNamePattern: /alice/iu,
      canonicalPattern: /alice\s+smith/iu,
      relationshipPatterns: [/sister/iu],
      relationshipLabel: 'sister of Carlos',
    };

    const result = groupIdentityEvidence('Alice', [
      {
        path: 'People/Alice Smith.md',
        title: 'Alice Smith',
        excerpt: 'Alice Smith is sister of Carlos.',
        score: 0.95,
      },
      {
        path: 'Notes/misc.md',
        title: 'Alice note',
        excerpt: 'Alice was here for the meeting.',
        score: 0.6,
      },
    ], 1, config);

    expect(result.resolved?.fullName).toBe('Alice Smith');
    expect(result.resolved?.relationshipToCarlos).toBe('sister of Carlos');
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]?.ambiguous).toBe(true);
  });

  it('isabella identity config is backward compatible', () => {
    const result = groupIdentityEvidence('Isabella', [
      {
        path: 'Prada Mind/05 - People & Partnerships/Team Members/Isabella Handel.md',
        title: 'Isabella Handel',
        excerpt: 'Isabella Handel works at MasterBlox and is married to Carlos Prada.',
        score: 0.97,
      },
      {
        path: 'Sessions/Francisco-notes.md',
        title: 'Francisco session',
        excerpt: 'Isabella is Francisco wife and works elsewhere.',
        score: 0.8,
      },
    ], 1, ISABELLA_IDENTITY);

    expect(result.resolved?.fullName).toBe('Isabella Handel');
    expect(result.resolved?.employment).toContain('MasterBlox');
    expect(result.resolved?.relationshipToCarlos).toMatch(/spouse|wife/i);
    expect(result.excluded).toHaveLength(1);
  });

  it('ambiguous evidence never silently becomes canonical', () => {
    const result = groupIdentityEvidence('Isabella', [
      {
        path: 'Sessions/Francisco-notes.md',
        title: 'Francisco session',
        excerpt: 'Isabella is Francisco wife and works elsewhere.',
        score: 0.8,
      },
    ], 1);

    expect(result.resolved).toBeUndefined();
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]?.ambiguous).toBe(true);
    expect(result.excluded[0]?.canonical).toBe(false);

    const event = buildGroundedResultEvent(result, randomUUID());
    expect(event.phase).toBe('ambiguous');
    expect(event.canonicalIdentity).toBeUndefined();
  });

  it('carlos prada mention without wife/spouse/married does not infer relationship', () => {
    const result = groupIdentityEvidence('Isabella', [
      {
        path: 'Prada Mind/05 - People & Partnerships/Team Members/Isabella Handel.md',
        title: 'Isabella Handel',
        excerpt: 'Isabella Handel works with Carlos Prada at MasterBlox.',
        score: 0.97,
      },
    ], 1);

    expect(result.resolved?.fullName).toBe('Isabella Handel');
    expect(result.resolved?.relationshipToCarlos).toBeUndefined();
    expect(result.resolved?.employment).toContain('MasterBlox');
  });
});

describe('guided phase machine', () => {
  it('rejects regression and prevents replaying announced phase instructions', () => {
    const session = createIsabellaGuidedSession(1_000);
    expect(advancePhase(session, 'retrieving')).toBe('retrieving');
    expect(canEnterPhase(session, 'ready')).toBe(false);
    expect(advancePhase(session, 'ready')).toBeUndefined();
    expect(markPhaseAnnounced(session, 'retrieving')).toBe(true);
    expect(markPhaseAnnounced(session, 'retrieving')).toBe(false);
    expect(advancePhase(session, 'presenting')).toBe('presenting');
    expect(advancePhase(session, 'opening')).toBe('opening');
    expect(advancePhase(session, 'correcting_organizing')).toBe('correcting_organizing');
    expect(advancePhase(session, 'reviewing')).toBe('reviewing');
    expect(advancePhase(session, 'complete')).toBe('complete');
    expect(advancePhase(session, 'reviewing')).toBeUndefined();
  });
});
