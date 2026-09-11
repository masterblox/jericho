import { createHash, randomUUID } from 'node:crypto';

import {
  assertChatTurn,
  assertGroundedResultEvent,
  CHAT_TURN_SCHEMA_VERSION,
  DEFAULT_CHAT_CONVERSATION_ID,
  SourceType,
  type ChatHistoryPage,
  type ChatTurn,
  type ChatTurnAccepted,
  type EventEnvelope,
  type GroundedResultEvent,
  type HubDispatchReceipt,
  type JsonValue,
} from '@jericho/shared';

import type { JerichoStore } from '../core/store.js';
import {
  buildGroundedResultEvent,
  groupIdentityEvidence,
  type VaultEvidenceHit,
} from '../retrieval/identity-aware.js';
import { executeVaultSearch, type VaultToolSearchPort } from '../tools.js';
import { classifyHubIntent } from './classifier.js';
import { acceptHubCommand } from './ingress.js';
import { planHubDispatch } from './router.js';

export const CHAT_CAPTURE_SOURCE = 'local:chat';
export const CHAT_CAPTURE_TYPE = 'local.capture.chat';
const MAX_CHAT_TEXT_BYTES = 32 * 1024;
const HISTORY_SCAN_LIMIT = 1_000;

export class ChatTurnRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ChatTurnRequestError';
  }
}

export type ChatLiveEvent =
  | { event: 'chat_turn'; data: ChatTurn }
  | { event: 'grounded_result'; data: GroundedResultEvent };

export interface ChatTurnProcessorOptions {
  store: JerichoStore;
  now?: () => string;
  vaultSearch?: VaultToolSearchPort;
  onLiveEvent?: (event: ChatLiveEvent) => void;
  idFactory?: () => string;
}

export interface ProcessChatTurnInput {
  text: unknown;
  conversationId?: unknown;
  idempotencyKey?: unknown;
  schemaVersion?: unknown;
}

/**
 * Desktop text-chat turn: hub ingress -> classify -> route -> reply.
 * Transcripts persist only as encrypted Core capture events.
 */
export async function processDesktopTextTurn(
  raw: Record<string, unknown>,
  options: ChatTurnProcessorOptions,
): Promise<ChatTurnAccepted & { groundedResult?: GroundedResultEvent }> {
  const input = parseChatTurnRequest(raw);
  const now = options.now ?? (() => new Date().toISOString());
  const createdAt = now();
  const commandId = options.idFactory?.() ?? randomUUID();

  const existing = readAccepted(options.store, input.conversationId, input.idempotencyKey);
  if (existing) return existing;

  const command = await acceptHubCommand({
    id: commandId,
    idempotencyKey: input.idempotencyKey,
    receivedAt: createdAt,
    source: 'desktop_text',
    body: input.text,
    transportId: 'desktop-chat',
  });
  const classification = classifyHubIntent(command.text);
  const plan = planHubDispatch(command.id, classification, command.text);
  const receipt: HubDispatchReceipt = {
    idempotencyKey: command.idempotencyKey,
    commandId: command.id,
    plan,
    replayed: false,
    updatedAt: createdAt,
  };

  const userTurn = chatTurn({
    schemaVersion: CHAT_TURN_SCHEMA_VERSION,
    id: turnId(input.conversationId, input.idempotencyKey, 'user'),
    conversationId: input.conversationId,
    role: 'user',
    state: 'answer',
    text: command.text,
    createdAt,
    commandId: command.id,
    idempotencyKey: command.idempotencyKey,
    source: 'desktop_text',
    intent: classification.intent,
    targetAgent: plan.targetAgent,
    dispatchStatus: plan.status,
  });
  persistTurn(options.store, userTurn);
  emit(options, { event: 'chat_turn', data: userTurn });

  const thinking = chatTurn({
    ...assistantShell(userTurn, createdAt),
    state: 'thinking',
    text: '',
  });
  emit(options, { event: 'chat_turn', data: thinking });

  const groundedResult = await maybeGround(command.text, classification.intent, options);
  if (groundedResult) {
    emit(options, { event: 'grounded_result', data: groundedResult });
  }

  const speaking = chatTurn({
    ...assistantShell(userTurn, createdAt),
    state: 'speaking',
    text: '',
  });
  emit(options, { event: 'chat_turn', data: speaking });

  const replyTurn = chatTurn({
    ...assistantShell(userTurn, createdAt),
    state: 'answer',
    text: composeReply(plan, groundedResult),
  });
  persistTurn(options.store, replyTurn, groundedResult);
  emit(options, { event: 'chat_turn', data: replyTurn });

  const accepted: ChatTurnAccepted & { groundedResult?: GroundedResultEvent } = {
    schemaVersion: CHAT_TURN_SCHEMA_VERSION,
    conversationId: input.conversationId,
    userTurn,
    replyTurn,
    receipt,
    replayed: false,
    ...(groundedResult ? { groundedResult } : {}),
  };
  return accepted;
}

export function listChatTurns(
  store: JerichoStore,
  query: { limit: number; before?: string; conversationId?: string },
): ChatHistoryPage {
  const records = store.listEvents({ source: CHAT_CAPTURE_SOURCE, limit: HISTORY_SCAN_LIMIT });
  const turns = records.flatMap((event) => {
    const turn = turnFromEvent(event);
    return turn ? [turn] : [];
  }).filter((turn) => {
    if (query.conversationId && turn.conversationId !== query.conversationId) return false;
    if (query.before && turn.createdAt >= query.before) return false;
    return turn.state === 'answer';
  });
  turns.sort((left, right) => {
    if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1;
    if (left.role !== right.role) return left.role === 'assistant' ? -1 : 1;
    return left.id < right.id ? 1 : -1;
  });
  const page = turns.slice(0, query.limit);
  const chronological = [...page].reverse();
  const exhausted = turns.length <= query.limit;
  return {
    schemaVersion: CHAT_TURN_SCHEMA_VERSION,
    turns: chronological,
    ...(!exhausted && chronological[0] ? { nextBefore: chronological[0].createdAt } : {}),
  };
}

function parseChatTurnRequest(raw: Record<string, unknown>): {
  text: string;
  conversationId: string;
  idempotencyKey: string;
} {
  const allowed = new Set(['text', 'conversationId', 'idempotencyKey', 'schemaVersion']);
  for (const field of Object.keys(raw)) {
    if (!allowed.has(field)) throw new ChatTurnRequestError('chat_field_not_allowed');
  }
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== CHAT_TURN_SCHEMA_VERSION) {
    throw new ChatTurnRequestError('invalid_schema_version');
  }
  if (typeof raw.text !== 'string' || !raw.text.trim() || raw.text.length > MAX_CHAT_TEXT_BYTES) {
    throw new ChatTurnRequestError('invalid_chat_text');
  }
  const conversationId = optionalId(raw.conversationId, DEFAULT_CHAT_CONVERSATION_ID, 'invalid_conversation_id');
  const idempotencyKey = optionalId(raw.idempotencyKey, randomUUID(), 'invalid_idempotency_key');
  return { text: raw.text.trim(), conversationId, idempotencyKey };
}

function optionalId(value: unknown, fallback: string, code: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || /\s/u.test(value)) {
    throw new ChatTurnRequestError(code);
  }
  return value.trim();
}

function chatTurn(input: ChatTurn): ChatTurn {
  assertChatTurn(input);
  return input;
}

function assistantShell(userTurn: ChatTurn, createdAt: string): ChatTurn {
  return {
    schemaVersion: CHAT_TURN_SCHEMA_VERSION,
    id: turnId(userTurn.conversationId, userTurn.idempotencyKey, 'assistant'),
    conversationId: userTurn.conversationId,
    role: 'assistant',
    state: 'answer',
    text: '',
    createdAt,
    commandId: userTurn.commandId,
    idempotencyKey: userTurn.idempotencyKey,
    source: 'desktop_text',
    ...(userTurn.intent ? { intent: userTurn.intent } : {}),
    ...('targetAgent' in userTurn ? { targetAgent: userTurn.targetAgent } : {}),
    ...(userTurn.dispatchStatus ? { dispatchStatus: userTurn.dispatchStatus } : {}),
  };
}

function composeReply(
  receiptPlan: HubDispatchReceipt['plan'],
  grounded?: GroundedResultEvent,
): string {
  if (grounded) {
    if (grounded.phase === 'resolved' && grounded.fullName) {
      const parts = [grounded.fullName];
      if (grounded.relationship) parts.push(grounded.relationship);
      if (grounded.employment?.length) parts.push(grounded.employment.join(', '));
      return parts.join(' — ');
    }
    if (grounded.phase === 'ambiguous') {
      return `I found more than one private match for ${grounded.subject}.`;
    }
    if (grounded.phase === 'unavailable' || grounded.phase === 'retrieving') {
      return `I do not have a private match for ${grounded.subject}.`;
    }
  }
  const agent = receiptPlan.targetAgent ?? 'JERICHO';
  if (receiptPlan.status === 'pending_approval') {
    const reason = receiptPlan.reason ? ` ${receiptPlan.reason}.` : '';
    return `${receiptPlan.summary} ${agent} is holding this ${receiptPlan.intent} for confirmation.${reason}`;
  }
  if (receiptPlan.intent === 'BRIEF') {
    return `Jericho brief — ${receiptPlan.summary}`;
  }
  if (receiptPlan.intent === 'DEMO') {
    return `Jericho can run that walkthrough: ${receiptPlan.summary}`;
  }
  if (receiptPlan.intent === 'QUERY') {
    return `${agent} QUERY: ${receiptPlan.summary}`;
  }
  return `${agent} ${receiptPlan.intent}: ${receiptPlan.summary}`;
}

async function maybeGround(
  text: string,
  intent: string,
  options: ChatTurnProcessorOptions,
): Promise<GroundedResultEvent | undefined> {
  const subject = identityQuestionSubject(text);
  if (!subject || intent !== 'QUERY' || !options.vaultSearch) return undefined;
  const resultId = randomUUID();
  emit(options, {
    event: 'grounded_result',
    data: {
      resultId,
      phase: 'retrieving',
      route: 'private_knowledge',
      subject,
      confidence: 'none',
      provenance: [],
      actions: {},
      retrievalCount: 0,
    },
  });
  try {
    const search = await executeVaultSearch(options.vaultSearch, { query: subject, limit: 8 });
    const hits = Array.isArray(search.results)
      ? (search.results as VaultEvidenceHit[]).map((hit) => ({
        ...hit,
        score: Math.min(1, Math.max(0, hit.score)),
      }))
      : [];
    const grouped = groupIdentityEvidence(subject, hits, 1);
    const grounded = buildGroundedResultEvent(grouped, resultId);
    assertGroundedResultEvent(grounded);
    return grounded;
  } catch {
    return undefined;
  }
}

function identityQuestionSubject(transcript: string): string | undefined {
  const normalized = transcript.replace(/\s+/gu, ' ').trim().replace(/[.!?]+$/u, '').trim();
  const patterns = [
    /^who(?:\s+is|['’]s)\s+(.+)$/iu,
    /^tell me who\s+(.+?)(?:\s+is)?$/iu,
    /^tell me about\s+(.+)$/iu,
    /^what do (?:we|you) know about\s+(.+)$/iu,
  ];
  for (const pattern of patterns) {
    const subject = pattern.exec(normalized)?.[1]?.trim();
    if (subject && /^[\p{L}][\p{L}\p{M}'’.-]*(?:\s+[\p{L}][\p{L}\p{M}'’.-]*){0,4}$/u.test(subject)) {
      return subject;
    }
  }
  return undefined;
}

function persistTurn(
  store: JerichoStore,
  turn: ChatTurn,
  groundedResult?: GroundedResultEvent,
): void {
  const payload = {
    turn,
    ...(groundedResult ? { groundedResult } : {}),
  } as unknown as JsonValue;
  store.commitLocalCapture({
    id: captureId(turn),
    source: CHAT_CAPTURE_SOURCE,
    sourceType: SourceType.User,
    sourceEventId: `${turn.conversationId}:${turn.idempotencyKey}:${turn.role}`,
    type: CHAT_CAPTURE_TYPE,
    occurredAt: turn.createdAt,
    ingestedAt: turn.createdAt,
    payload,
    provenance: [{
      source: CHAT_CAPTURE_SOURCE,
      sourceType: SourceType.User,
      sourceEventId: `${turn.conversationId}:${turn.idempotencyKey}:${turn.role}`,
      observedAt: turn.createdAt,
    }],
  });
}

function readAccepted(
  store: JerichoStore,
  conversationId: string,
  idempotencyKey: string,
): (ChatTurnAccepted & { groundedResult?: GroundedResultEvent }) | undefined {
  const userEvent = store.getEvent(captureIdFromParts(conversationId, idempotencyKey, 'user'));
  const assistantEvent = store.getEvent(captureIdFromParts(conversationId, idempotencyKey, 'assistant'));
  if (!userEvent || !assistantEvent) return undefined;
  const userTurn = turnFromEvent(userEvent);
  const assistantTurn = turnFromEvent(assistantEvent);
  if (!userTurn || !assistantTurn) return undefined;
  const groundedResult = groundedFromEvent(assistantEvent);
  const receipt: HubDispatchReceipt = {
    idempotencyKey,
    commandId: userTurn.commandId,
    plan: {
      schemaVersion: 1,
      commandId: userTurn.commandId,
      intent: userTurn.intent ?? 'QUERY',
      targetAgent: userTurn.targetAgent ?? null,
      confidence: 1,
      summary: userTurn.text,
      requiresConfirmation: userTurn.dispatchStatus === 'pending_approval',
      status: userTurn.dispatchStatus ?? 'planned',
    },
    replayed: true,
    updatedAt: assistantTurn.createdAt,
  };
  return {
    schemaVersion: CHAT_TURN_SCHEMA_VERSION,
    conversationId,
    userTurn,
    replyTurn: assistantTurn,
    receipt,
    replayed: true,
    ...(groundedResult ? { groundedResult } : {}),
  };
}

function turnFromEvent(event: EventEnvelope): ChatTurn | undefined {
  const payload = asRecord(event.payload);
  if (!payload) return undefined;
  const candidate = 'turn' in payload ? payload.turn : payload;
  try {
    assertChatTurn(candidate);
    return candidate;
  } catch {
    return undefined;
  }
}

function groundedFromEvent(event: EventEnvelope): GroundedResultEvent | undefined {
  const payload = asRecord(event.payload);
  if (!payload || !('groundedResult' in payload)) return undefined;
  try {
    assertGroundedResultEvent(payload.groundedResult);
    return payload.groundedResult;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function turnId(conversationId: string, idempotencyKey: string, role: ChatTurn['role']): string {
  return `chat-turn:${conversationId}:${idempotencyKey}:${role}`;
}

function captureId(turn: ChatTurn): string {
  return captureIdFromParts(turn.conversationId, turn.idempotencyKey, turn.role);
}

function captureIdFromParts(
  conversationId: string,
  idempotencyKey: string,
  role: ChatTurn['role'],
): string {
  const sourceEventId = `${conversationId}:${idempotencyKey}:${role}`;
  const digest = createHash('sha256')
    .update(`${CHAT_CAPTURE_SOURCE}\0${sourceEventId}`)
    .digest('hex')
    .slice(0, 32);
  return `${CHAT_CAPTURE_SOURCE}-${digest}`;
}

function emit(options: ChatTurnProcessorOptions, event: ChatLiveEvent): void {
  options.onLiveEvent?.(event);
}
