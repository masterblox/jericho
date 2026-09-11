// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { ChatSessionStore } from '../src/chat-session';
import type { GroundedResultPayload } from '../src/grounded-result';

const grounded = (overrides: Partial<GroundedResultPayload> = {}): GroundedResultPayload => ({
  resultId: 'gr-1',
  phase: 'resolved',
  route: 'private_knowledge',
  subject: 'Isabella',
  confidence: 'strong',
  provenance: [],
  actions: {},
  retrievalCount: 1,
  ...overrides,
});

describe('ChatSessionStore', () => {
  it('keeps turns in memory and never writes transcripts to storage', () => {
    const store = new ChatSessionStore();
    store.appendUserText('Plan the fleet review');
    store.appendJerichoText('I will bound that as a mission.');
    expect(store.getSnapshot().turns).toHaveLength(2);
    expect(JSON.stringify(store.getSnapshot())).not.toMatch(/localStorage|sessionStorage/);
    expect(Object.keys(localStorage)).toHaveLength(0);
  });

  it('merges consecutive Jericho text parts and labels a voice wake without a transcript', () => {
    const store = new ChatSessionStore();
    store.appendVoiceWake();
    store.appendVoiceWake();
    store.appendJerichoText('Hello, ');
    store.appendJerichoText('sir.');
    const turns = store.getSnapshot().turns;
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ kind: 'user', channel: 'voice', text: 'Voice turn' });
    expect(turns[1]).toMatchObject({ kind: 'jericho', text: 'Hello, sir.' });
  });

  it('maps listening, thinking, and speaking from voice status, tools, and playback', () => {
    const store = new ChatSessionStore();
    store.setVoiceStatus('listening');
    expect(store.getSnapshot().agentState).toBe('listening');
    store.setTool({ name: 'arrange_window', state: 'running', message: 'Arranging window…' });
    expect(store.getSnapshot().agentState).toBe('thinking');
    store.setTool({ name: 'arrange_window', state: 'succeeded', message: 'Window arranged' });
    store.setSpeechPlaying(true);
    expect(store.getSnapshot().agentState).toBe('speaking');
    store.setSpeechPlaying(false);
    store.setVoiceStatus('standby');
    expect(store.getSnapshot().agentState).toBe('idle');
  });

  it('replaces an in-flight grounded result with the same resultId', () => {
    const store = new ChatSessionStore();
    store.appendGroundedResult(grounded({ phase: 'retrieving', confidence: 'none', retrievalCount: 0 }));
    store.appendGroundedResult(grounded({ phase: 'resolved' }));
    expect(store.getSnapshot().turns).toHaveLength(1);
    expect(store.getSnapshot().turns[0]).toMatchObject({
      kind: 'grounded',
      result: { resultId: 'gr-1', phase: 'resolved' },
    });
  });
});
