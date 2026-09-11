import { DEFAULT_CHAT_CONVERSATION_ID } from '@jericho/shared';

import type { ChatTurn } from './chat-session';

const MAX_ID = 128;
const MAX_TEXT = 8_192;
const MAX_TURNS = 200;
const PREVIEW_CHARS = 72;

/** Core history page accepted by the chat sidebar. Transcripts stay in Core. */
export interface CoreChatHistoryTurn {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

export interface CoreChatHistoryPage {
  schemaVersion: 1;
  turns: CoreChatHistoryTurn[];
  nextBefore?: string;
}

export interface ConversationListItem {
  id: string;
  preview: string;
  at: string;
  turnCount: number;
}

export { DEFAULT_CHAT_CONVERSATION_ID };

/** Parse GET /api/v1/chat/turns without throwing or logging turn text. */
export function parseChatHistoryPage(raw: unknown): CoreChatHistoryPage | null {
  if (!raw || typeof raw !== 'object') return null;
  const page = raw as Record<string, unknown>;
  if (page.schemaVersion !== 1 || !Array.isArray(page.turns)) return null;
  const turns: CoreChatHistoryTurn[] = [];
  for (const entry of page.turns.slice(0, MAX_TURNS)) {
    const turn = parseHistoryTurn(entry);
    if (!turn) return null;
    turns.push(turn);
  }
  const parsed: CoreChatHistoryPage = { schemaVersion: 1, turns };
  if (page.nextBefore !== undefined) {
    if (typeof page.nextBefore !== 'string' || !Number.isFinite(Date.parse(page.nextBefore))) return null;
    parsed.nextBefore = page.nextBefore;
  }
  return parsed;
}

export function conversationsFromHistory(
  turns: readonly CoreChatHistoryTurn[],
): ConversationListItem[] {
  const groups = new Map<string, ConversationListItem>();
  for (const turn of turns) {
    const existing = groups.get(turn.conversationId);
    const preview = turnPreview(turn);
    if (!existing) {
      groups.set(turn.conversationId, {
        id: turn.conversationId,
        preview,
        at: turn.createdAt,
        turnCount: 1,
      });
      continue;
    }
    existing.turnCount += 1;
    if (turn.createdAt >= existing.at) {
      existing.at = turn.createdAt;
      if (preview) existing.preview = preview;
    }
  }
  return [...groups.values()].sort((left, right) => (left.at < right.at ? 1 : -1));
}

export function mapHistoryTurns(turns: readonly CoreChatHistoryTurn[]): ChatTurn[] {
  const mapped: ChatTurn[] = [];
  for (const turn of turns) {
    if (!turn.text.trim()) continue;
    mapped.push({
      id: turn.id,
      kind: turn.role === 'user' ? 'user' : 'jericho',
      channel: 'text',
      text: turn.text,
      at: turn.createdAt,
    });
  }
  return mapped;
}

export async function fetchChatHistory(query: {
  conversationId?: string;
  limit?: number;
  signal?: AbortSignal;
} = {}): Promise<CoreChatHistoryPage | null> {
  const params = new URLSearchParams();
  params.set('limit', String(query.limit ?? 50));
  if (query.conversationId) params.set('conversationId', query.conversationId);
  const response = await fetch(`/api/v1/chat/turns?${params.toString()}`, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    signal: query.signal,
  });
  if (!response.ok) return null;
  return parseChatHistoryPage(await response.json());
}

function parseHistoryTurn(raw: unknown): CoreChatHistoryTurn | null {
  if (!raw || typeof raw !== 'object') return null;
  const turn = raw as Record<string, unknown>;
  const id = exactString(turn.id, MAX_ID);
  const conversationId = exactString(turn.conversationId, MAX_ID);
  const role = turn.role === 'user' || turn.role === 'assistant' ? turn.role : undefined;
  const text = typeof turn.text === 'string' ? turn.text.slice(0, MAX_TEXT) : undefined;
  const createdAt = typeof turn.createdAt === 'string' && Number.isFinite(Date.parse(turn.createdAt))
    ? turn.createdAt
    : undefined;
  if (!id || !conversationId || !role || text === undefined || !createdAt) return null;
  return { id, conversationId, role, text, createdAt };
}

function turnPreview(turn: CoreChatHistoryTurn): string {
  const trimmed = turn.text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return turn.conversationId;
  return trimmed.length > PREVIEW_CHARS ? `${trimmed.slice(0, PREVIEW_CHARS)}…` : trimmed;
}

function exactString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return undefined;
  return trimmed;
}
