import { describe, expect, it } from 'vitest';

import {
  conversationsFromHistory,
  mapHistoryTurns,
  parseChatHistoryPage,
} from '../src/chat-history';

const turn = (overrides: Record<string, unknown> = {}) => ({
  id: 'turn-1',
  conversationId: 'desktop',
  role: 'user',
  text: 'Prepare the Isabella brief',
  createdAt: '2026-09-11T20:00:00.000Z',
  ...overrides,
});

describe('chat history projection', () => {
  it('parses a Core history page and groups conversations by id', () => {
    const page = parseChatHistoryPage({
      schemaVersion: 1,
      turns: [
        turn(),
        turn({
          id: 'turn-2',
          role: 'assistant',
          text: 'Understood, sir.',
          createdAt: '2026-09-11T20:00:01.000Z',
        }),
        turn({
          id: 'turn-3',
          conversationId: 'brief-2',
          text: 'Queue the fleet review',
          createdAt: '2026-09-11T21:00:00.000Z',
        }),
      ],
    });
    expect(page?.turns).toHaveLength(3);
    const conversations = conversationsFromHistory(page!.turns);
    expect(conversations.map((item) => item.id)).toEqual(['brief-2', 'desktop']);
    expect(conversations[0]?.preview).toBe('Queue the fleet review');
    expect(mapHistoryTurns(page!.turns).map((item) => item.kind)).toEqual(['user', 'jericho', 'user']);
  });

  it('rejects malformed history instead of inventing turns', () => {
    expect(parseChatHistoryPage({ schemaVersion: 2, turns: [] })).toBeNull();
    expect(parseChatHistoryPage({ schemaVersion: 1, turns: [{ id: 'x' }] })).toBeNull();
  });
});
