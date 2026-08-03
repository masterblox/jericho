/** Jericho Hub command-plane contracts. WebSocket-ready and JSON-only. */

export type HubIsoTimestamp = string;

/** Classification kinds for inbound Hub commands. */
export enum HubCommandKind {
  Task = 'TASK',
  Query = 'QUERY',
  Create = 'CREATE',
  Brief = 'BRIEF',
  Demo = 'DEMO',
}

/** Capability lanes the Hub may route work toward. */
export enum HubCapability {
  Dev = 'DEV',
  Donald = 'Donald',
  PA = 'PA',
  Iris = 'Iris',
  Jericho = 'Jericho',
}

/** Physical/logical ingress ports into the Hub. */
export enum HubIngressPort {
  TelegramVoice = 'telegram_voice',
  TelegramText = 'telegram_text',
  Qr = 'qr',
}

export enum HubWhisperBackend {
  Local = 'local',
  ApiFallback = 'api_fallback',
  Unavailable = 'unavailable',
}

export enum HubDispatchStatus {
  AwaitingConfirmation = 'awaiting_confirmation',
  Confirmed = 'confirmed',
  Dispatched = 'dispatched',
  Rejected = 'rejected',
  Duplicate = 'duplicate',
  Blocked = 'blocked',
}

export enum HubAlertSeverity {
  Info = 'info',
  Warning = 'warning',
  Critical = 'critical',
}

export enum HubAgentPresence {
  Online = 'online',
  Degraded = 'degraded',
  Offline = 'offline',
  Unknown = 'unknown',
}

export enum HubWalkthroughStream {
  Command = 'command',
  Fleet = 'fleet',
  Brief = 'brief',
}

export enum HubEventType {
  CommandClassified = 'hub.command.classified',
  CommandRouted = 'hub.command.routed',
  IngressReceived = 'hub.ingress.received',
  WhisperProbed = 'hub.whisper.probed',
  DispatchUpdated = 'hub.dispatch.updated',
  AggregationReady = 'hub.aggregation.ready',
  AgentHeartbeat = 'hub.agent.heartbeat',
  AlertRaised = 'hub.alert.raised',
  BootSummary = 'hub.boot.summary',
  DemoSealed = 'hub.demo.sealed',
  WalkthroughEvent = 'hub.walkthrough.event',
  Snapshot = 'hub.snapshot',
}

/** 72-hour aggregation window in milliseconds. */
export const HUB_AGGREGATION_WINDOW_MS = 72 * 60 * 60 * 1000;

export interface HubCommandClassification {
  kind: HubCommandKind;
  summary: string;
  confidence: number;
  signals: string[];
}

export interface HubRoutingDecision {
  capability: HubCapability;
  ruleId: string;
  confidence: number;
  rationale: string;
}

export interface HubIngressMessage {
  id: string;
  port: HubIngressPort;
  receivedAt: HubIsoTimestamp;
  /** Normalized plaintext after voice transcription or QR decode. */
  text: string;
  /** Opaque transport metadata; must remain JSON-serializable. */
  metadata: Record<string, string | number | boolean | null>;
}

export interface HubWhisperProbeResult {
  backend: HubWhisperBackend;
  available: boolean;
  probedAt: HubIsoTimestamp;
  detail: string;
  /** When local fails and API is configured, reports the fallback target. */
  fallbackConfigured: boolean;
}

export interface HubDispatchRequest {
  idempotencyKey: string;
  commandId: string;
  kind: HubCommandKind;
  capability: HubCapability;
  summary: string;
  /** Explicit confirmation token; dispatch refuses without it. */
  confirmationToken?: string;
  createdAt: HubIsoTimestamp;
}

export interface HubDispatchReceipt {
  idempotencyKey: string;
  commandId: string;
  status: HubDispatchStatus;
  capability: HubCapability;
  summary: string;
  updatedAt: HubIsoTimestamp;
  /** True when a prior identical key already produced this receipt. */
  replayed: boolean;
}

export interface HubAggregateItem {
  id: string;
  category:
    | 'transcript'
    | 'repo'
    | 'pr'
    | 'linear'
    | 'opportunity'
    | 'task';
  title: string;
  occurredAt: HubIsoTimestamp;
  source: string;
  summary: string;
}

export interface HubAggregationWindow {
  windowMs: typeof HUB_AGGREGATION_WINDOW_MS;
  since: HubIsoTimestamp;
  until: HubIsoTimestamp;
  items: HubAggregateItem[];
  counts: Record<HubAggregateItem['category'], number>;
}

export interface HubAgentHeartbeat {
  agentId: string;
  capability: HubCapability;
  presence: HubAgentPresence;
  lastSeenAt: HubIsoTimestamp;
  sequence: number;
  detail: string;
}

export interface HubAlert {
  id: string;
  severity: HubAlertSeverity;
  raisedAt: HubIsoTimestamp;
  code: string;
  message: string;
  relatedCommandId?: string;
}

export interface HubBootSummary {
  bootId: string;
  startedAt: HubIsoTimestamp;
  readyAt: HubIsoTimestamp;
  whisper: HubWhisperProbeResult;
  ingressPorts: HubIngressPort[];
  capabilities: HubCapability[];
  alerts: HubAlert[];
  healthy: boolean;
}

export interface HubSealedDemoSnapshot {
  demoId: string;
  sealedAt: HubIsoTimestamp;
  /** Lowercase SHA-256 of the canonical sealed payload. */
  contentHash: string;
  label: string;
  payload: Record<string, string | number | boolean | null>;
}

export interface HubWalkthroughEvent {
  stream: HubWalkthroughStream;
  sequence: number;
  at: HubIsoTimestamp;
  kind: string;
  message: string;
  data: Record<string, string | number | boolean | null>;
}

export interface HubCommandRecord {
  id: string;
  kind: HubCommandKind;
  capability: HubCapability;
  summary: string;
  ingressPort: HubIngressPort;
  status: HubDispatchStatus;
  createdAt: HubIsoTimestamp;
  updatedAt: HubIsoTimestamp;
  idempotencyKey?: string;
}

/**
 * Full Hub projection suitable for an authenticated WebSocket `hub.snapshot`
 * frame. Keep dense arrays and JSON-only values.
 */
export interface HubSnapshot {
  revision: string;
  generatedAt: HubIsoTimestamp;
  boot: HubBootSummary;
  commands: HubCommandRecord[];
  heartbeats: HubAgentHeartbeat[];
  alerts: HubAlert[];
  aggregation: HubAggregationWindow;
  demos: HubSealedDemoSnapshot[];
  walkthroughs: Record<HubWalkthroughStream, HubWalkthroughEvent[]>;
  whisper: HubWhisperProbeResult;
  ingressPorts: HubIngressPort[];
}

/**
 * Discriminated Hub event envelope for live WebSocket streams.
 * `type` is always a HubEventType; `payload` is JSON-serializable.
 */
export type HubEvent =
  | {
      type: HubEventType.CommandClassified;
      at: HubIsoTimestamp;
      commandId: string;
      classification: HubCommandClassification;
    }
  | {
      type: HubEventType.CommandRouted;
      at: HubIsoTimestamp;
      commandId: string;
      routing: HubRoutingDecision;
    }
  | {
      type: HubEventType.IngressReceived;
      at: HubIsoTimestamp;
      message: HubIngressMessage;
    }
  | {
      type: HubEventType.WhisperProbed;
      at: HubIsoTimestamp;
      result: HubWhisperProbeResult;
    }
  | {
      type: HubEventType.DispatchUpdated;
      at: HubIsoTimestamp;
      receipt: HubDispatchReceipt;
    }
  | {
      type: HubEventType.AggregationReady;
      at: HubIsoTimestamp;
      aggregation: HubAggregationWindow;
    }
  | {
      type: HubEventType.AgentHeartbeat;
      at: HubIsoTimestamp;
      heartbeat: HubAgentHeartbeat;
    }
  | {
      type: HubEventType.AlertRaised;
      at: HubIsoTimestamp;
      alert: HubAlert;
    }
  | {
      type: HubEventType.BootSummary;
      at: HubIsoTimestamp;
      boot: HubBootSummary;
    }
  | {
      type: HubEventType.DemoSealed;
      at: HubIsoTimestamp;
      demo: HubSealedDemoSnapshot;
    }
  | {
      type: HubEventType.WalkthroughEvent;
      at: HubIsoTimestamp;
      event: HubWalkthroughEvent;
    }
  | {
      type: HubEventType.Snapshot;
      at: HubIsoTimestamp;
      snapshot: HubSnapshot;
    };
