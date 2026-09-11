import { DEFAULT_CHAT_CONVERSATION_ID } from '@jericho/shared';
import type { GroundedResultPayload } from './grounded-result';

export type AgentState = 'idle' | 'listening' | 'thinking' | 'speaking';

export type ChatSurface = 'chat' | 'sphere';

export type ChatTurn =
  | {
    id: string;
    kind: 'user';
    channel: 'text' | 'voice';
    text: string;
    at: string;
  }
  | {
    id: string;
    kind: 'jericho';
    channel: 'text' | 'voice';
    text: string;
    at: string;
  }
  | {
    id: string;
    kind: 'grounded';
    result: GroundedResultPayload;
    at: string;
  }
  | {
    id: string;
    kind: 'system';
    text: string;
    at: string;
  };

export interface ToolActivity {
  name: string;
  state: 'running' | 'succeeded' | 'failed';
  message: string;
}

export interface ChatSessionState {
  conversationId: string;
  turns: ChatTurn[];
  agentState: AgentState;
  speechPlaying: boolean;
  voiceStatus: string;
  tool: ToolActivity | null;
  composerError?: string;
}

const INITIAL_STATE: ChatSessionState = {
  conversationId: DEFAULT_CHAT_CONVERSATION_ID,
  turns: [],
  agentState: 'idle',
  speechPlaying: false,
  voiceStatus: 'standby',
  tool: null,
};

function nextId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `turn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function now(): string {
  return new Date().toISOString();
}

function deriveAgentState(state: ChatSessionState): AgentState {
  if (state.speechPlaying) return 'speaking';
  if (state.tool?.state === 'running') return 'thinking';
  const status = state.voiceStatus;
  if (status.includes('listening')) return 'listening';
  if (status.includes('greeting') || status.includes('speaking')) return 'speaking';
  if (status.includes('agent action') || status.includes('thinking')) return 'thinking';
  return 'idle';
}

/**
 * In-memory conversation projection. Turns are never written to localStorage,
 * snapshots, or diagnostics. Core captures remain the only durable path.
 */
export class ChatSessionStore {
  #state: ChatSessionState = INITIAL_STATE;
  readonly #listeners = new Set<() => void>();

  getSnapshot = (): ChatSessionState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  appendUserText(text: string): ChatTurn {
    const turn: ChatTurn = {
      id: nextId(),
      kind: 'user',
      channel: 'text',
      text,
      at: now(),
    };
    this.#set({ ...this.#state, turns: [...this.#state.turns, turn], composerError: undefined });
    return turn;
  }

  appendVoiceWake(): void {
    const last = this.#state.turns.at(-1);
    if (last?.kind === 'user' && last.channel === 'voice' && last.text === 'Voice turn') return;
    const turn: ChatTurn = {
      id: nextId(),
      kind: 'user',
      channel: 'voice',
      text: 'Voice turn',
      at: now(),
    };
    this.#set({ ...this.#state, turns: [...this.#state.turns, turn] });
  }

  appendJerichoText(text: string): void {
    if (typeof text !== 'string' || text.length === 0) return;
    const last = this.#state.turns.at(-1);
    if (last?.kind === 'jericho') {
      const merged: ChatTurn = { ...last, text: `${last.text}${text}`, at: now() };
      this.#set({ ...this.#state, turns: [...this.#state.turns.slice(0, -1), merged] });
      return;
    }
    if (!text.trim()) return;
    this.#set({
      ...this.#state,
      turns: [...this.#state.turns, {
        id: nextId(),
        kind: 'jericho',
        channel: 'voice',
        text,
        at: now(),
      }],
    });
  }

  appendJerichoReply(text: string): void {
    if (typeof text !== 'string' || !text.trim()) return;
    this.#set({
      ...this.#state,
      turns: [...this.#state.turns, {
        id: nextId(),
        kind: 'jericho',
        channel: 'text',
        text,
        at: now(),
      }],
    });
  }

  appendGroundedResult(result: GroundedResultPayload): void {
    const last = this.#state.turns.at(-1);
    if (last?.kind === 'grounded' && last.result.resultId === result.resultId) {
      this.#set({
        ...this.#state,
        turns: [...this.#state.turns.slice(0, -1), { ...last, result, at: now() }],
      });
      return;
    }
    this.#set({
      ...this.#state,
      turns: [...this.#state.turns, { id: nextId(), kind: 'grounded', result, at: now() }],
    });
  }

  setVoiceStatus(status: string): void {
    const next = { ...this.#state, voiceStatus: status };
    next.agentState = deriveAgentState(next);
    this.#set(next);
  }

  setSpeechPlaying(playing: boolean): void {
    const next = { ...this.#state, speechPlaying: playing };
    next.agentState = deriveAgentState(next);
    this.#set(next);
  }

  setTool(tool: ToolActivity | null): void {
    const next = { ...this.#state, tool };
    next.agentState = deriveAgentState(next);
    this.#set(next);
  }

  setComposerError(error: string | undefined): void {
    this.#set({ ...this.#state, composerError: error });
  }

  startNewChat(): string {
    const conversationId = nextId();
    this.#set({
      ...this.#state,
      conversationId,
      turns: [],
      composerError: undefined,
    });
    return conversationId;
  }

  hydrateFromCore(conversationId: string, turns: ChatTurn[]): void {
    this.#set({
      ...this.#state,
      conversationId,
      turns,
      composerError: undefined,
    });
  }

  #set(state: ChatSessionState): void {
    if (state.composerError === undefined) delete state.composerError;
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }
}
