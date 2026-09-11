/** Canonical Jericho Hub command-plane contracts (WebSocket-ready, JSON-only). */

export type HubIsoTimestamp = string;

export type HubAgentId = 'DEV' | 'DONALD' | 'PA' | 'IRIS' | 'JERICHO';
export type HubIntentKind =
  | 'TASK'
  | 'QUERY'
  | 'CREATE'
  | 'BRIEF'
  | 'DEMO'
  // Maestro dispatch hooks (dispatch/verify/archive/ack) — see docs/maestro.
  | 'DISPATCH'
  | 'VERIFY'
  | 'ARCHIVE'
  | 'ACK';
export type HubPriority = 'critical' | 'high' | 'normal' | 'low';
export type HubHealth = 'green' | 'yellow' | 'red' | 'offline';
export type HubMode = 'live' | 'demo';
export type HubConnection = 'connected' | 'degraded' | 'reconnecting' | 'offline';
export type HubCommandSource =
  | 'telegram_voice'
  | 'telegram_text'
  | 'qr_text'
  | 'desktop_text';
export type HubDispatchStatus =
  | 'planned'
  | 'pending_approval'
  | 'approved'
  | 'dispatched'
  // Maestro lifecycle: -verified- means an independent verdict bound evidence,
  // -archived- means the receipt was closed and removed from the open ledger.
  | 'verified'
  | 'failed'
  | 'archived';
export type HubCommandPhase =
  | 'received'
  | 'classified'
  | 'planned'
  | 'approved'
  | 'dispatched'
  | 'verified'
  | 'archived'
  | 'completed'
  | 'acknowledged'
  | 'failed';
export type HubAlertCategory =
  | 'money'
  | 'failure'
  | 'deadline'
  | 'intelligence'
  | 'system';
export type HubWhisperBackend = 'local' | 'api_fallback' | 'unavailable';
export type HubDemoStream = 'competitor' | 'deploy_fix' | 'morning_brief';

export const HUB_AGENT_IDS: readonly HubAgentId[] = [
  'DEV',
  'DONALD',
  'PA',
  'IRIS',
  'JERICHO',
] as const;

export const HUB_AGGREGATION_WINDOW_MS = 72 * 60 * 60 * 1000;

export interface HubCommand {
  schemaVersion: 1;
  id: string;
  idempotencyKey: string;
  receivedAt: HubIsoTimestamp;
  source: HubCommandSource;
  text: string;
  provenance: { transportId: string; actorIdHash?: string };
}

export interface HubIntentClassification {
  intent: HubIntentKind;
  confidence: number;
  summary: string;
  signals: string[];
}

export interface HubDispatchPlan {
  schemaVersion: 1;
  commandId: string;
  intent: HubIntentKind;
  targetAgent: HubAgentId | null;
  confidence: number;
  summary: string;
  requiresConfirmation: boolean;
  status: HubDispatchStatus;
  reason?: string;
}

export interface HubDispatchReceipt {
  idempotencyKey: string;
  commandId: string;
  plan: HubDispatchPlan;
  replayed: boolean;
  updatedAt: HubIsoTimestamp;
  /** Board card / task id the dispatch targets (maestro dispatch hook). */
  targetId?: string;
  /** Independent verdict bound by the maestro verify hook. */
  verdict?: HubDispatchVerdict;
  /** Reason a dispatch was marked failed (failure disposition). */
  failureReason?: string;
  /** When the receipt was archived and removed from the open ledger. */
  archivedAt?: HubIsoTimestamp;
}

/** Independent lane-done verdict: evidence, never a bare worker claim. */
export interface HubDispatchVerdict {
  status: 'verified' | 'failed';
  /** Independent proof the lane finished (git sha, artifact, report path). */
  evidence: string;
  at: HubIsoTimestamp;
  /** Lane/agent that verified — independent of the worker that did the work. */
  verifier?: string;
}

export interface HubAgentStatus {
  agentId: HubAgentId;
  health: HubHealth;
  currentTask: string | null;
  lastOutputAt: string | null;
  unreadAlerts: number;
}

export interface HubCommandLogEntry {
  id: string;
  occurredAt: HubIsoTimestamp;
  agentId: HubAgentId;
  phase: HubCommandPhase;
  summary: string;
}

export interface HubAlert {
  id: string;
  occurredAt: HubIsoTimestamp;
  agentId: HubAgentId;
  priority: HubPriority;
  category: HubAlertCategory;
  title: string;
  summary: string;
  acknowledged: boolean;
  acknowledgedAt?: HubIsoTimestamp;
}

export interface HubWhisperProbeResult {
  backend: HubWhisperBackend;
  available: boolean;
  probedAt: HubIsoTimestamp;
  detail: string;
  fallbackConfigured: boolean;
}

export interface HubBootAnnouncementPlan {
  bootId: string;
  idempotencyKey: string;
  channel: 'telegram';
  /** Sanitized totals only — never private transcript text. */
  text: string;
  totals: { activeAgents: number; queuedTasks: number; opportunities: number };
  createdAt: HubIsoTimestamp;
}

export interface HubContextItem {
  id: string;
  category:
    | 'transcript'
    | 'repo'
    | 'pr'
    | 'linear'
    | 'opportunity'
    | 'task'
    | 'heartbeat';
  title: string;
  occurredAt: HubIsoTimestamp;
  source: string;
  summary: string;
  signal?: number;
}

export interface HubAggregationWindow {
  windowMs: typeof HUB_AGGREGATION_WINDOW_MS;
  since: HubIsoTimestamp;
  until: HubIsoTimestamp;
  items: HubContextItem[];
  counts: Record<HubContextItem['category'], number>;
  degradedProviders: string[];
}

export interface HubSealedDemoSnapshot {
  demoId: string;
  sealedAt: HubIsoTimestamp;
  contentHash: string;
  label: string;
  payload: Record<string, string | number | boolean | null>;
}

export interface HubWalkthroughEvent {
  stream: HubDemoStream;
  sequence: number;
  at: HubIsoTimestamp;
  kind: string;
  message: string;
  data: Record<string, string | number | boolean | null>;
}

export interface HubSnapshot {
  schemaVersion: 1;
  generatedAt: HubIsoTimestamp;
  mode: HubMode;
  connection: HubConnection;
  agents: HubAgentStatus[];
  commandLog: HubCommandLogEntry[];
  alerts: HubAlert[];
  totals: { activeAgents: number; queuedTasks: number; opportunities: number };
  /** Extended operational fields for backend consumers; frontend may ignore. */
  revision: string;
  bootAnnouncement?: HubBootAnnouncementPlan;
  aggregation?: HubAggregationWindow;
  whisper?: HubWhisperProbeResult;
  demos?: HubSealedDemoSnapshot[];
  walkthroughs?: Record<HubDemoStream, HubWalkthroughEvent[]>;
}

export type HubEvent =
  | { type: 'snapshot'; sequence: number; snapshot: HubSnapshot }
  | { type: 'agent_status'; sequence: number; status: HubAgentStatus }
  | { type: 'command_log'; sequence: number; entry: HubCommandLogEntry }
  | { type: 'alert'; sequence: number; alert: HubAlert }
  | { type: 'dispatch'; sequence: number; receipt: HubDispatchReceipt }
  | { type: 'ack'; sequence: number; alertId: string; acknowledgedAt: HubIsoTimestamp }
  | { type: 'mode'; sequence: number; mode: HubMode };

/** Durable desktop text-chat turn. Transcripts live only in encrypted Core records. */
export type ChatTurnRole = 'user' | 'assistant';
export type ChatTurnState = 'thinking' | 'speaking' | 'answer';

export const CHAT_TURN_SCHEMA_VERSION = 1 as const;
export const DEFAULT_CHAT_CONVERSATION_ID = 'desktop';

export interface ChatTurn {
  schemaVersion: typeof CHAT_TURN_SCHEMA_VERSION;
  id: string;
  conversationId: string;
  role: ChatTurnRole;
  state: ChatTurnState;
  text: string;
  createdAt: HubIsoTimestamp;
  commandId: string;
  idempotencyKey: string;
  source: 'desktop_text';
  intent?: HubIntentKind;
  targetAgent?: HubAgentId | null;
  dispatchStatus?: HubDispatchStatus;
}

export interface ChatTurnAccepted {
  schemaVersion: typeof CHAT_TURN_SCHEMA_VERSION;
  conversationId: string;
  userTurn: ChatTurn;
  replyTurn: ChatTurn;
  receipt: HubDispatchReceipt;
  replayed: boolean;
}

export interface ChatHistoryPage {
  schemaVersion: typeof CHAT_TURN_SCHEMA_VERSION;
  turns: ChatTurn[];
  nextBefore?: HubIsoTimestamp;
}
