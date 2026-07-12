import { createHash } from 'node:crypto';

import {
  SourceType,
  type EventEnvelope,
  type JsonObject,
} from '@jericho/shared';

import type { JerichoStore } from '../core/store.js';

const SOURCE = 'jericho:conversation-memory-v1';
const MAX_TURNS_PER_SESSION = 10;
const MAX_TURN_CHARS = 4_096;

export interface ConversationTurn {
  role: 'user' | 'model';
  text: string;
  timestamp: string;
  turnId: string;
}

export interface ConversationSession {
  sessionId: string;
  turns: ConversationTurn[];
  createdAt: string;
  lastActiveAt: string;
}

export interface ConversationMemoryStore {
  listEvents(options?: { source?: string; limit?: number }): EventEnvelope[];
  appendEvent(event: EventEnvelope): unknown;
}

/**
 * Conversation memory: stores the last N turns per voice session in the
 * encrypted Core event store. Provides context injection for the next
 * session so the model can reference recent conversation history.
 *
 * Privacy: turns are stored with the same encryption and access controls
 * as all other Core events. No absolute paths or secrets are logged.
 */
export class ConversationMemory {
  constructor(
    private readonly store: ConversationMemoryStore,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  /**
   * Record a conversation turn (user speech or model response).
   */
  recordTurn(
    sessionId: string,
    role: 'user' | 'model',
    text: string,
    turnId: string,
  ): void {
    const sanitized = text.replace(/\s+/gu, ' ').trim();
    if (!sanitized || sanitized.length > MAX_TURN_CHARS) return;
    const timestamp = this.clock();
    const turn: ConversationTurn = { role, text: sanitized, timestamp, turnId };

    const existing = this.getSession(sessionId);
    const turns = existing ? [...existing.turns, turn] : [turn];
    // Keep only the last N turns to bound memory size.
    const trimmed = turns.slice(-MAX_TURNS_PER_SESSION);

    const session: ConversationSession = {
      sessionId,
      turns: trimmed,
      createdAt: existing?.createdAt ?? timestamp,
      lastActiveAt: timestamp,
    };

    const eventId = `conversation-session-${digest(sessionId)}`;
    this.store.appendEvent({
      id: eventId,
      source: SOURCE,
      sourceType: SourceType.System,
      sourceEventId: `session:${sessionId}`,
      type: 'jericho.conversation.session',
      occurredAt: timestamp,
      ingestedAt: timestamp,
      payload: { record: session as unknown as JsonObject },
      provenance: [{
        source: SOURCE,
        sourceType: SourceType.System,
        sourceEventId: `session:${sessionId}`,
        observedAt: timestamp,
      }],
    });
  }

  /**
   * Retrieve the most recent conversation session by ID.
   */
  getSession(sessionId: string): ConversationSession | undefined {
    const events = this.store.listEvents({ source: SOURCE, limit: 1_000 })
      .filter((event) => event.type === 'jericho.conversation.session');

    // Find the latest event for this session (idempotent upsert pattern).
    for (const event of events.reverse()) {
      const record = (event.payload as Record<string, unknown>)?.record;
      if (isSessionRecord(record) && record.sessionId === sessionId) {
        return record;
      }
    }
    return undefined;
  }

  /**
   * Get recent sessions (most recent first), up to the given limit.
   */
  listRecentSessions(limit: number = 5): ConversationSession[] {
    const events = this.store.listEvents({ source: SOURCE, limit: 1_000 })
      .filter((event) => event.type === 'jericho.conversation.session');

    const bySession = new Map<string, ConversationSession>();
    for (const event of events) {
      const record = (event.payload as Record<string, unknown>)?.record;
      if (isSessionRecord(record)) {
        // Keep the latest version per session.
        if (!bySession.has(record.sessionId)) {
          bySession.set(record.sessionId, record);
        }
      }
    }

    return [...bySession.values()]
      .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
      .slice(0, limit);
  }

  /**
   * Build a context string from recent conversations for injection
   * into the system instruction. Returns empty string if no history.
   */
  buildContextSummary(currentSessionId?: string): string {
    const sessions = this.listRecentSessions(3);
    if (!sessions.length) return '';

    const parts: string[] = [];
    for (const session of sessions) {
      // Skip the current session (it's already in context via live turns).
      if (currentSessionId && session.sessionId === currentSessionId) continue;

      const recentTurns = session.turns.slice(-6); // Last 3 exchanges
      if (!recentTurns.length) continue;

      const timeAgo = formatTimeAgo(session.lastActiveAt);
      parts.push(`[Conversation from ${timeAgo}]`);
      for (const turn of recentTurns) {
        const prefix = turn.role === 'user' ? 'Carlos' : 'JARVIS';
        parts.push(`${prefix}: ${turn.text}`);
      }
    }

    if (!parts.length) return '';
    return [
      'RECENT CONVERSATION CONTEXT:',
      'The following are excerpts from recent conversations for continuity.',
      'Use this to maintain context but do not reference these directly unless relevant.',
      '',
      ...parts,
    ].join('\n');
  }
}

function isSessionRecord(value: unknown): value is ConversationSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.sessionId === 'string' &&
    Array.isArray(record.turns) &&
    typeof record.createdAt === 'string' &&
    typeof record.lastActiveAt === 'string'
  );
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function formatTimeAgo(isoTimestamp: string): string {
  const now = Date.now();
  const then = Date.parse(isoTimestamp);
  if (!Number.isFinite(then)) return 'recently';

  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'moments ago';
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return 'over a week ago';
}
