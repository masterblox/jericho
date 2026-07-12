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
import { groupIdentityEvidence } from '../src/retrieval/identity-aware.js';
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
        excerpt: 'Isabella is Francisco’s wife and works elsewhere.',
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
