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
  deduceCanonicalFullName,
  type VaultEvidenceHit,
  ISABELLA_IDENTITY,
  type GroupIdentityConfig,
} from '../src/retrieval/identity-aware.js';
import { assertGroundedResultEvent } from '@jericho/shared';
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
    ], 1, ISABELLA_IDENTITY);

    expect(result.retrievalCount).toBe(1);
    expect(result.resolved?.fullName).toBe('Isabella Handel');
    expect(result.resolved?.employment).toContain('MasterBlox');
    expect(result.resolved?.relationshipToCarlos).toBeUndefined();
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
    sourceId: 'src-canonical',
    rootId: 'prada-mind',
    authority: 'canonical',
  };

  const ambiguousHit: VaultEvidenceHit = {
    path: 'Sessions/Francisco-notes.md',
    title: 'Isabella mention',
    excerpt: 'Isabella was mentioned in passing during the Francisco session.',
    score: 0.42,
    sourceId: 'src-ambiguous',
    rootId: 'jarvis-memory',
    authority: 'supplemental',
  };

  const noRelationshipHit: VaultEvidenceHit = {
    path: 'Contacts/Isabella Handel.md',
    title: 'Isabella Handel',
    excerpt: 'Isabella Handel contact card. No relationship data.',
    score: 0.85,
    sourceId: 'src-contact',
    rootId: 'prada-mind',
    authority: 'canonical',
  };

  it('resolved with partial confidence when canonical evidence exists without Core-confirmed spouse', () => {
    const result = groupIdentityEvidence('Isabella', [canonicalHit, ambiguousHit], 1, ISABELLA_IDENTITY);
    const event = buildGroundedResultEvent(result, resultId, 'private_knowledge', { test: 'isabella' }, {
      hits: [canonicalHit, ambiguousHit],
      indexRevision: 'rev-test',
    });

    expect(event.schemaVersion).toBe(2);
    expect(event.phase).toBe('resolved');
    expect(event.confidence).toBe('partial');
    expect(event.canonicalIdentity).toBe('Isabella Handel');
    expect(event.fullName).toBe('Isabella Handel');
    expect(event.relationship).toBeUndefined();
    expect(event.employment).toContain('MasterBlox');
    expect(event.retrievalCount).toBe(1);
    expect(event.route).toBe('private_knowledge');
    expect(event.subject).toBe('Isabella');
    expect(event.guided?.test).toBe('isabella');
    expect(event.indexRevision).toBe('rev-test');
    expect(event.provenance[0]?.sourceId).toBeTruthy();
    expect(event.actions.openSourceIds?.length).toBeGreaterThan(0);
  });

  it('resolved with partial confidence when canonical but no relationship', () => {
    const result = groupIdentityEvidence('Isabella', [noRelationshipHit], 1, ISABELLA_IDENTITY);
    const event = buildGroundedResultEvent(result, resultId, 'private_knowledge', undefined, {
      hits: [noRelationshipHit],
    });

    expect(event.phase).toBe('resolved');
    expect(event.confidence).toBe('partial');
    expect(event.canonicalIdentity).toBe('Isabella Handel');
    expect(event.relationship).toBeUndefined();
  });

  it('ambiguous when only first-name evidence exists', () => {
    const result = groupIdentityEvidence('Isabella', [ambiguousHit], 1, ISABELLA_IDENTITY);
    const event = buildGroundedResultEvent(result, resultId, 'private_knowledge', undefined, {
      hits: [ambiguousHit],
    });

    expect(event.phase).toBe('ambiguous');
    expect(event.confidence).toBe('ambiguous');
    expect(event.canonicalIdentity).toBeUndefined();
    expect(event.fullName).toBeUndefined();
    expect(event.relationship).toBeUndefined();
  });

  it('unavailable when no evidence matches', () => {
    const result = groupIdentityEvidence('Isabella', [
      { path: 'Notes/unrelated.md', title: 'Unrelated', excerpt: 'No match here.', score: 0.1 },
    ], 1, ISABELLA_IDENTITY);
    const event = buildGroundedResultEvent(result, resultId);

    expect(event.phase).toBe('unavailable');
    expect(event.confidence).toBe('none');
    expect(event.provenance).toHaveLength(0);
  });

  it('bounded excerpts and relative paths', () => {
    const result = groupIdentityEvidence('Isabella', [canonicalHit], 1, ISABELLA_IDENTITY);
    const event = buildGroundedResultEvent(result, resultId, 'private_knowledge', undefined, {
      hits: [canonicalHit],
    });

    for (const item of event.provenance) {
      expect(item.excerpt.length).toBeLessThanOrEqual(480);
      expect(item.relativePath).not.toMatch(/^\//);
      expect(item.relativePath).not.toContain('..');
      expect(item.relativePath.length).toBeGreaterThan(0);
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(typeof item.title).toBe('string');
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.sourceId).toBeTruthy();
      expect(item.rootId).toBeTruthy();
      expect(['canonical', 'supplemental']).toContain(item.authority);
    }
  });

  it('openSourceIds and reorganizeSourceIds with one canonical openable note', () => {
    const result = groupIdentityEvidence('Isabella', [canonicalHit], 1, ISABELLA_IDENTITY);
    const event = buildGroundedResultEvent(result, resultId, 'private_knowledge', undefined, {
      hits: [canonicalHit],
    });

    expect(event.actions.openSourceIds).toEqual([canonicalHit.sourceId]);
    expect(event.actions.reorganizeSourceIds).toEqual([canonicalHit.sourceId]);
  });

  it('correctConflictIds action when ambiguous evidence exists', () => {
    const result = groupIdentityEvidence('Isabella', [canonicalHit, ambiguousHit], 1, ISABELLA_IDENTITY);
    const event = buildGroundedResultEvent(result, resultId, 'private_knowledge', undefined, {
      hits: [canonicalHit, ambiguousHit],
    });

    expect(event.actions.correctConflictIds?.length).toBeGreaterThan(0);
  });

  it('no correctConflictIds when only canonical evidence without spouse conflicts', () => {
    const cleanHit: VaultEvidenceHit = {
      ...noRelationshipHit,
      excerpt: 'Isabella Handel contact card. MasterBlox teammate.',
    };
    const result = groupIdentityEvidence('Isabella', [cleanHit], 1, ISABELLA_IDENTITY);
    const event = buildGroundedResultEvent(result, resultId, 'private_knowledge', undefined, {
      hits: [cleanHit],
    });

    expect(event.actions.correctConflictIds ?? []).toHaveLength(0);
  });

  it('resultId matches input', () => {
    const result = groupIdentityEvidence('Isabella', [canonicalHit], 1, ISABELLA_IDENTITY);
    const event = buildGroundedResultEvent(result, resultId);
    expect(event.resultId).toBe(resultId);
  });

  it('natural questions have same contract as guided (minus guided field)', () => {
    const result = groupIdentityEvidence('Isabella', [canonicalHit, ambiguousHit], 1, ISABELLA_IDENTITY);
    const guidedEvent = buildGroundedResultEvent(result, resultId, 'private_knowledge', { test: 'isabella' }, {
      hits: [canonicalHit, ambiguousHit],
    });
    const naturalEvent = buildGroundedResultEvent(result, resultId, 'private_knowledge', undefined, {
      hits: [canonicalHit, ambiguousHit],
    });

    expect(guidedEvent.guided?.test).toBe('isabella');
    expect(naturalEvent.guided).toBeUndefined();
    expect(guidedEvent.phase).toBe(naturalEvent.phase);
    expect(guidedEvent.confidence).toBe(naturalEvent.confidence);
    expect(guidedEvent.subject).toBe(naturalEvent.subject);
    expect(guidedEvent.fullName).toBe(naturalEvent.fullName);
    expect(guidedEvent.actions).toEqual(naturalEvent.actions);
    expect(guidedEvent.retrievalCount).toBe(naturalEvent.retrievalCount);
  });

  it('retrievalCount matches input', () => {
    const result = groupIdentityEvidence('Isabella', [canonicalHit], 1, ISABELLA_IDENTITY);
    const event = buildGroundedResultEvent(result, resultId);
    expect(event.retrievalCount).toBe(1);
  });

  it('resultId reused across phases produces same id', () => {
    const sharedId = resultId;
    const result = groupIdentityEvidence('Isabella', [canonicalHit], 1, ISABELLA_IDENTITY);
    const event = buildGroundedResultEvent(result, sharedId);
    expect(event.resultId).toBe(sharedId);
    expect(typeof sharedId).toBe('string');
  });
});

describe('assertGroundedResultEvent', () => {
  it('accepts valid events', () => {
    const hit = {
      path: 'People/Isabella Handel.md',
      title: 'Isabella Handel',
      excerpt: 'Works at MasterBlox.',
      score: 0.97,
      sourceId: 'src-1',
      rootId: 'prada-mind',
      authority: 'canonical' as const,
    };
    const result = groupIdentityEvidence('Isabella', [hit], 1, ISABELLA_IDENTITY);
    const event = buildGroundedResultEvent(result, randomUUID(), 'private_knowledge', undefined, { hits: [hit] });
    expect(() => assertGroundedResultEvent(event)).not.toThrow();
  });

  it('rejects malicious absolute paths', () => {
    const hit = { path: 'People/ok.md', title: 'ok', excerpt: 'ok.', score: 0.5, sourceId: 's', rootId: 'r', authority: 'canonical' as const };
    const result = groupIdentityEvidence('Isabella', [hit], 1, ISABELLA_IDENTITY);
    const event = buildGroundedResultEvent(result, randomUUID(), 'private_knowledge', undefined, { hits: [hit] });
    (event as unknown as Record<string, unknown>).provenance = [{
      sourceId: 's', rootId: 'r', authority: 'canonical', relativePath: '/etc/passwd', title: 'x', excerpt: 'x', score: 0.5,
    }];
    expect(() => assertGroundedResultEvent(event)).toThrow(/relativePath/);
  });

  it('rejects traversal paths', () => {
    const hit = { path: 'People/ok.md', title: 'ok', excerpt: 'ok.', score: 0.5, sourceId: 's', rootId: 'r', authority: 'canonical' as const };
    const result = groupIdentityEvidence('Isabella', [hit], 1, ISABELLA_IDENTITY);
    const event = buildGroundedResultEvent(result, randomUUID(), 'private_knowledge', undefined, { hits: [hit] });
    (event as unknown as Record<string, unknown>).provenance = [{
      sourceId: 's', rootId: 'r', authority: 'canonical', relativePath: '../../../.ssh/id_rsa', title: 'x', excerpt: 'x', score: 0.5,
    }];
    expect(() => assertGroundedResultEvent(event)).toThrow(/relativePath/);
  });

  it('rejects backslash paths', () => {
    const hit = { path: 'People/ok.md', title: 'ok', excerpt: 'ok.', score: 0.5, sourceId: 's', rootId: 'r', authority: 'canonical' as const };
    const result = groupIdentityEvidence('Isabella', [hit], 1, ISABELLA_IDENTITY);
    const event = buildGroundedResultEvent(result, randomUUID(), 'private_knowledge', undefined, { hits: [hit] });
    (event as unknown as Record<string, unknown>).provenance = [{
      sourceId: 's', rootId: 'r', authority: 'canonical', relativePath: 'People\\ok.md', title: 'x', excerpt: 'x', score: 0.5,
    }];
    expect(() => assertGroundedResultEvent(event)).toThrow(/relativePath/);
  });

  it('rejects score out of bounds', () => {
    const hit = { path: 'People/ok.md', title: 'ok', excerpt: 'ok.', score: 0.5, sourceId: 's', rootId: 'r', authority: 'canonical' as const };
    const result = groupIdentityEvidence('Isabella', [hit], 1, ISABELLA_IDENTITY);
    const event = buildGroundedResultEvent(result, randomUUID(), 'private_knowledge', undefined, { hits: [hit] });
    (event as unknown as Record<string, unknown>).provenance = [{
      sourceId: 's', rootId: 'r', authority: 'canonical', relativePath: 'People/ok.md', title: 'x', excerpt: 'x', score: 1.5,
    }];
    expect(() => assertGroundedResultEvent(event)).toThrow(/score/);
  });

  it('rejects negative score', () => {
    const hit = { path: 'People/ok.md', title: 'ok', excerpt: 'ok.', score: 0.5, sourceId: 's', rootId: 'r', authority: 'canonical' as const };
    const result = groupIdentityEvidence('Isabella', [hit], 1, ISABELLA_IDENTITY);
    const event = buildGroundedResultEvent(result, randomUUID(), 'private_knowledge', undefined, { hits: [hit] });
    (event as unknown as Record<string, unknown>).provenance = [{
      sourceId: 's', rootId: 'r', authority: 'canonical', relativePath: 'People/ok.md', title: 'x', excerpt: 'x', score: -0.1,
    }];
    expect(() => assertGroundedResultEvent(event)).toThrow(/score/);
  });

  it('rejects oversized provenance', () => {
    const hit = { path: 'People/ok.md', title: 'ok', excerpt: 'ok.', score: 0.5, sourceId: 's', rootId: 'r', authority: 'canonical' as const };
    const result = groupIdentityEvidence('Isabella', [hit], 1, ISABELLA_IDENTITY);
    const event = buildGroundedResultEvent(result, randomUUID(), 'private_knowledge', undefined, { hits: [hit] });
    const items = Array.from({ length: 51 }, () => ({
      sourceId: 's', rootId: 'r', authority: 'canonical', relativePath: 'People/ok.md', title: 'x', excerpt: 'x', score: 0.5,
    }));
    (event as unknown as Record<string, unknown>).provenance = items;
    expect(() => assertGroundedResultEvent(event)).toThrow(/provenance/);
  });

  it('rejects unknown action keys', () => {
    const hit = { path: 'People/ok.md', title: 'ok', excerpt: 'ok.', score: 0.5, sourceId: 's', rootId: 'r', authority: 'canonical' as const };
    const result = groupIdentityEvidence('Isabella', [hit], 1, ISABELLA_IDENTITY);
    const event = buildGroundedResultEvent(result, randomUUID(), 'private_knowledge', undefined, { hits: [hit] });
    (event as unknown as Record<string, unknown>).actions = { openSourceIds: ['s'], evil_action: true };
    expect(() => assertGroundedResultEvent(event)).toThrow(/actions/);
  });

  it('rejects oversized subject', () => {
    const hit = { path: 'People/ok.md', title: 'ok', excerpt: 'ok.', score: 0.5, sourceId: 's', rootId: 'r', authority: 'canonical' as const };
    const result = groupIdentityEvidence('Isabella', [hit], 1, ISABELLA_IDENTITY);
    const event = buildGroundedResultEvent(result, randomUUID(), 'private_knowledge', undefined, { hits: [hit] });
    (event as unknown as Record<string, unknown>).subject = 'x'.repeat(501);
    expect(() => assertGroundedResultEvent(event)).toThrow(/subject/);
  });

  it('rejects whitespace-only opaque IDs without rewriting accepted values', () => {
    const hit = {
      path: 'People/Isabella Handel.md',
      title: 'Isabella Handel',
      excerpt: 'Works at MasterBlox.',
      score: 0.97,
      sourceId: 'src-ok',
      rootId: 'prada-mind',
      authority: 'canonical' as const,
    };
    const result = groupIdentityEvidence('Isabella', [hit], 1, ISABELLA_IDENTITY);
    const event = buildGroundedResultEvent(result, randomUUID(), 'private_knowledge', undefined, { hits: [hit] });
    expect(event.provenance[0]?.sourceId).toBe('src-ok');
    const originalSubject = event.subject;
    const originalSourceId = event.provenance[0]!.sourceId;
    expect(() => assertGroundedResultEvent({ ...event, resultId: '   ' })).toThrow(/whitespace-only|resultId/);
    expect(() => assertGroundedResultEvent({
      ...event,
      provenance: [{ ...event.provenance[0]!, sourceId: '\t\n' }],
    })).toThrow(/whitespace-only|sourceId/);
    expect(() => assertGroundedResultEvent({
      ...event,
      actions: { openSourceIds: ['  '] },
    })).toThrow(/whitespace-only|openSourceIds/);
    expect(event.subject).toBe(originalSubject);
    expect(event.provenance[0]?.sourceId).toBe(originalSourceId);
  });

  it('rejects duplicate source, claim, conflict, and action opaque IDs', () => {
    const hit = {
      path: 'People/Isabella Handel.md',
      title: 'Isabella Handel',
      excerpt: 'Works at MasterBlox.',
      score: 0.97,
      sourceId: 'src-ok',
      rootId: 'prada-mind',
      authority: 'canonical' as const,
    };
    const result = groupIdentityEvidence('Isabella', [hit], 1, ISABELLA_IDENTITY);
    const event = buildGroundedResultEvent(result, randomUUID(), 'private_knowledge', undefined, { hits: [hit] });
    const baseProv = event.provenance[0]!;
    expect(baseProv.sourceId).toBe('src-ok');
    expect(() => assertGroundedResultEvent({
      ...event,
      provenance: [baseProv, { ...baseProv }],
    })).toThrow(/duplicate sourceId/);
    expect(() => assertGroundedResultEvent({
      ...event,
      claims: [
        { id: 'claim-a', text: 'One', supportSourceIds: ['src-ok'] },
        { id: 'claim-a', text: 'Two', supportSourceIds: ['src-ok'] },
      ],
    })).toThrow(/duplicate id/);
    expect(() => assertGroundedResultEvent({
      ...event,
      conflicts: [
        { id: 'c1', claim: 'A', reason: 'r', sourceIds: ['src-ok'] },
        { id: 'c1', claim: 'B', reason: 'r', sourceIds: ['src-ok'] },
      ],
    })).toThrow(/duplicate id/);
    expect(() => assertGroundedResultEvent({
      ...event,
      actions: { openSourceIds: ['src-ok', 'src-ok'] },
    })).toThrow(/duplicate id/);
    expect(() => assertGroundedResultEvent({
      ...event,
      claims: [{ id: 'claim-a', text: 'One', supportSourceIds: ['src-ok', 'src-ok'] }],
    })).toThrow(/duplicate id/);
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
    expect(result.resolved?.relationshipToCarlos).toBeUndefined();
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
    ], 1, ISABELLA_IDENTITY);

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
