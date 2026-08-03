import {
  HubAlertSeverity,
  HubAgentPresence,
  HubCapability,
  HubCommandKind,
  HubDispatchStatus,
  HubEventType,
  HubIngressPort,
  HubWalkthroughStream,
  HubWhisperBackend,
  type HubAggregateItem,
  type HubAggregationWindow,
  type HubAgentHeartbeat,
  type HubAlert,
  type HubBootSummary,
  type HubCommandClassification,
  type HubCommandRecord,
  type HubDispatchReceipt,
  type HubEvent,
  type HubIngressMessage,
  type HubRoutingDecision,
  type HubSealedDemoSnapshot,
  type HubSnapshot,
  type HubWalkthroughEvent,
  type HubWhisperProbeResult,
  HUB_AGGREGATION_WINDOW_MS,
} from './types.js';

const AGGREGATE_CATEGORIES = new Set<HubAggregateItem['category']>([
  'transcript',
  'repo',
  'pr',
  'linear',
  'opportunity',
  'task',
]);

export function assertHubCommandClassification(
  value: unknown,
): asserts value is HubCommandClassification {
  assertRecord(value, 'HubCommandClassification');
  assertEnum(value.kind, HubCommandKind, 'HubCommandClassification.kind');
  assertNonEmptyString(value.summary, 'HubCommandClassification.summary');
  assertConfidence(value.confidence, 'HubCommandClassification.confidence');
  assertDenseStringArray(value.signals, 'HubCommandClassification.signals');
}

export function assertHubRoutingDecision(
  value: unknown,
): asserts value is HubRoutingDecision {
  assertRecord(value, 'HubRoutingDecision');
  assertEnum(value.capability, HubCapability, 'HubRoutingDecision.capability');
  assertNonEmptyString(value.ruleId, 'HubRoutingDecision.ruleId');
  assertConfidence(value.confidence, 'HubRoutingDecision.confidence');
  assertNonEmptyString(value.rationale, 'HubRoutingDecision.rationale');
}

export function assertHubIngressMessage(
  value: unknown,
): asserts value is HubIngressMessage {
  assertRecord(value, 'HubIngressMessage');
  assertNonEmptyString(value.id, 'HubIngressMessage.id');
  assertEnum(value.port, HubIngressPort, 'HubIngressMessage.port');
  assertTimestamp(value.receivedAt, 'HubIngressMessage.receivedAt');
  assertNonEmptyString(value.text, 'HubIngressMessage.text');
  assertStringScalarMap(value.metadata, 'HubIngressMessage.metadata');
}

export function assertHubWhisperProbeResult(
  value: unknown,
): asserts value is HubWhisperProbeResult {
  assertRecord(value, 'HubWhisperProbeResult');
  assertEnum(value.backend, HubWhisperBackend, 'HubWhisperProbeResult.backend');
  if (typeof value.available !== 'boolean') {
    throw new TypeError('HubWhisperProbeResult.available must be boolean');
  }
  assertTimestamp(value.probedAt, 'HubWhisperProbeResult.probedAt');
  assertNonEmptyString(value.detail, 'HubWhisperProbeResult.detail');
  if (typeof value.fallbackConfigured !== 'boolean') {
    throw new TypeError('HubWhisperProbeResult.fallbackConfigured must be boolean');
  }
}

export function assertHubDispatchReceipt(
  value: unknown,
): asserts value is HubDispatchReceipt {
  assertRecord(value, 'HubDispatchReceipt');
  assertNonEmptyString(value.idempotencyKey, 'HubDispatchReceipt.idempotencyKey');
  assertNonEmptyString(value.commandId, 'HubDispatchReceipt.commandId');
  assertEnum(value.status, HubDispatchStatus, 'HubDispatchReceipt.status');
  assertEnum(value.capability, HubCapability, 'HubDispatchReceipt.capability');
  assertNonEmptyString(value.summary, 'HubDispatchReceipt.summary');
  assertTimestamp(value.updatedAt, 'HubDispatchReceipt.updatedAt');
  if (typeof value.replayed !== 'boolean') {
    throw new TypeError('HubDispatchReceipt.replayed must be boolean');
  }
}

export function assertHubAggregationWindow(
  value: unknown,
): asserts value is HubAggregationWindow {
  assertRecord(value, 'HubAggregationWindow');
  if (value.windowMs !== HUB_AGGREGATION_WINDOW_MS) {
    throw new TypeError('HubAggregationWindow.windowMs must be 72 hours');
  }
  assertTimestamp(value.since, 'HubAggregationWindow.since');
  assertTimestamp(value.until, 'HubAggregationWindow.until');
  if (!Array.isArray(value.items)) {
    throw new TypeError('HubAggregationWindow.items must be an array');
  }
  value.items.forEach((item, index) => assertHubAggregateItem(item, `items[${index}]`));
  assertRecord(value.counts, 'HubAggregationWindow.counts');
  for (const category of AGGREGATE_CATEGORIES) {
    const count = value.counts[category];
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      throw new TypeError(`HubAggregationWindow.counts.${category} must be a non-negative integer`);
    }
  }
}

export function assertHubAgentHeartbeat(
  value: unknown,
): asserts value is HubAgentHeartbeat {
  assertRecord(value, 'HubAgentHeartbeat');
  assertNonEmptyString(value.agentId, 'HubAgentHeartbeat.agentId');
  assertEnum(value.capability, HubCapability, 'HubAgentHeartbeat.capability');
  assertEnum(value.presence, HubAgentPresence, 'HubAgentHeartbeat.presence');
  assertTimestamp(value.lastSeenAt, 'HubAgentHeartbeat.lastSeenAt');
  if (typeof value.sequence !== 'number' || !Number.isInteger(value.sequence) || value.sequence < 0) {
    throw new TypeError('HubAgentHeartbeat.sequence must be a non-negative integer');
  }
  assertNonEmptyString(value.detail, 'HubAgentHeartbeat.detail');
}

export function assertHubAlert(value: unknown): asserts value is HubAlert {
  assertRecord(value, 'HubAlert');
  assertNonEmptyString(value.id, 'HubAlert.id');
  assertEnum(value.severity, HubAlertSeverity, 'HubAlert.severity');
  assertTimestamp(value.raisedAt, 'HubAlert.raisedAt');
  assertNonEmptyString(value.code, 'HubAlert.code');
  assertNonEmptyString(value.message, 'HubAlert.message');
  if ('relatedCommandId' in value) {
    assertNonEmptyString(value.relatedCommandId, 'HubAlert.relatedCommandId');
  }
}

export function assertHubBootSummary(value: unknown): asserts value is HubBootSummary {
  assertRecord(value, 'HubBootSummary');
  assertNonEmptyString(value.bootId, 'HubBootSummary.bootId');
  assertTimestamp(value.startedAt, 'HubBootSummary.startedAt');
  assertTimestamp(value.readyAt, 'HubBootSummary.readyAt');
  assertHubWhisperProbeResult(value.whisper);
  assertDenseEnumArray(value.ingressPorts, HubIngressPort, 'HubBootSummary.ingressPorts');
  assertDenseEnumArray(value.capabilities, HubCapability, 'HubBootSummary.capabilities');
  if (!Array.isArray(value.alerts)) throw new TypeError('HubBootSummary.alerts must be an array');
  value.alerts.forEach((alert) => assertHubAlert(alert));
  if (typeof value.healthy !== 'boolean') {
    throw new TypeError('HubBootSummary.healthy must be boolean');
  }
}

export function assertHubSealedDemoSnapshot(
  value: unknown,
): asserts value is HubSealedDemoSnapshot {
  assertRecord(value, 'HubSealedDemoSnapshot');
  assertNonEmptyString(value.demoId, 'HubSealedDemoSnapshot.demoId');
  assertTimestamp(value.sealedAt, 'HubSealedDemoSnapshot.sealedAt');
  if (!/^[0-9a-f]{64}$/.test(String(value.contentHash))) {
    throw new TypeError('HubSealedDemoSnapshot.contentHash must be lowercase SHA-256');
  }
  assertNonEmptyString(value.label, 'HubSealedDemoSnapshot.label');
  assertStringScalarMap(value.payload, 'HubSealedDemoSnapshot.payload');
}

export function assertHubWalkthroughEvent(
  value: unknown,
): asserts value is HubWalkthroughEvent {
  assertRecord(value, 'HubWalkthroughEvent');
  assertEnum(value.stream, HubWalkthroughStream, 'HubWalkthroughEvent.stream');
  if (typeof value.sequence !== 'number' || !Number.isInteger(value.sequence) || value.sequence < 0) {
    throw new TypeError('HubWalkthroughEvent.sequence must be a non-negative integer');
  }
  assertTimestamp(value.at, 'HubWalkthroughEvent.at');
  assertNonEmptyString(value.kind, 'HubWalkthroughEvent.kind');
  assertNonEmptyString(value.message, 'HubWalkthroughEvent.message');
  assertStringScalarMap(value.data, 'HubWalkthroughEvent.data');
}

export function assertHubCommandRecord(value: unknown): asserts value is HubCommandRecord {
  assertRecord(value, 'HubCommandRecord');
  assertNonEmptyString(value.id, 'HubCommandRecord.id');
  assertEnum(value.kind, HubCommandKind, 'HubCommandRecord.kind');
  assertEnum(value.capability, HubCapability, 'HubCommandRecord.capability');
  assertNonEmptyString(value.summary, 'HubCommandRecord.summary');
  assertEnum(value.ingressPort, HubIngressPort, 'HubCommandRecord.ingressPort');
  assertEnum(value.status, HubDispatchStatus, 'HubCommandRecord.status');
  assertTimestamp(value.createdAt, 'HubCommandRecord.createdAt');
  assertTimestamp(value.updatedAt, 'HubCommandRecord.updatedAt');
  if ('idempotencyKey' in value) {
    assertNonEmptyString(value.idempotencyKey, 'HubCommandRecord.idempotencyKey');
  }
}

export function assertHubSnapshot(value: unknown): asserts value is HubSnapshot {
  assertRecord(value, 'HubSnapshot');
  assertNonEmptyString(value.revision, 'HubSnapshot.revision');
  assertTimestamp(value.generatedAt, 'HubSnapshot.generatedAt');
  assertHubBootSummary(value.boot);
  if (!Array.isArray(value.commands)) throw new TypeError('HubSnapshot.commands must be an array');
  value.commands.forEach((command) => assertHubCommandRecord(command));
  if (!Array.isArray(value.heartbeats)) throw new TypeError('HubSnapshot.heartbeats must be an array');
  value.heartbeats.forEach((heartbeat) => assertHubAgentHeartbeat(heartbeat));
  if (!Array.isArray(value.alerts)) throw new TypeError('HubSnapshot.alerts must be an array');
  value.alerts.forEach((alert) => assertHubAlert(alert));
  assertHubAggregationWindow(value.aggregation);
  if (!Array.isArray(value.demos)) throw new TypeError('HubSnapshot.demos must be an array');
  value.demos.forEach((demo) => assertHubSealedDemoSnapshot(demo));
  assertRecord(value.walkthroughs, 'HubSnapshot.walkthroughs');
  for (const stream of Object.values(HubWalkthroughStream)) {
    const events = value.walkthroughs[stream];
    if (!Array.isArray(events)) {
      throw new TypeError(`HubSnapshot.walkthroughs.${stream} must be an array`);
    }
    events.forEach((event) => assertHubWalkthroughEvent(event));
  }
  assertHubWhisperProbeResult(value.whisper);
  assertDenseEnumArray(value.ingressPorts, HubIngressPort, 'HubSnapshot.ingressPorts');
}

export function assertHubEvent(value: unknown): asserts value is HubEvent {
  assertRecord(value, 'HubEvent');
  assertEnum(value.type, HubEventType, 'HubEvent.type');
  assertTimestamp(value.at, 'HubEvent.at');
  switch (value.type) {
    case HubEventType.CommandClassified:
      assertNonEmptyString(value.commandId, 'HubEvent.commandId');
      assertHubCommandClassification(value.classification);
      break;
    case HubEventType.CommandRouted:
      assertNonEmptyString(value.commandId, 'HubEvent.commandId');
      assertHubRoutingDecision(value.routing);
      break;
    case HubEventType.IngressReceived:
      assertHubIngressMessage(value.message);
      break;
    case HubEventType.WhisperProbed:
      assertHubWhisperProbeResult(value.result);
      break;
    case HubEventType.DispatchUpdated:
      assertHubDispatchReceipt(value.receipt);
      break;
    case HubEventType.AggregationReady:
      assertHubAggregationWindow(value.aggregation);
      break;
    case HubEventType.AgentHeartbeat:
      assertHubAgentHeartbeat(value.heartbeat);
      break;
    case HubEventType.AlertRaised:
      assertHubAlert(value.alert);
      break;
    case HubEventType.BootSummary:
      assertHubBootSummary(value.boot);
      break;
    case HubEventType.DemoSealed:
      assertHubSealedDemoSnapshot(value.demo);
      break;
    case HubEventType.WalkthroughEvent:
      assertHubWalkthroughEvent(value.event);
      break;
    case HubEventType.Snapshot:
      assertHubSnapshot(value.snapshot);
      break;
    default:
      throw new TypeError('HubEvent.type is unsupported');
  }
}

function assertHubAggregateItem(value: unknown, field: string): asserts value is HubAggregateItem {
  assertRecord(value, field);
  assertNonEmptyString(value.id, `${field}.id`);
  if (typeof value.category !== 'string' || !AGGREGATE_CATEGORIES.has(value.category as HubAggregateItem['category'])) {
    throw new TypeError(`${field}.category is invalid`);
  }
  assertNonEmptyString(value.title, `${field}.title`);
  assertTimestamp(value.occurredAt, `${field}.occurredAt`);
  assertNonEmptyString(value.source, `${field}.source`);
  assertNonEmptyString(value.summary, `${field}.summary`);
}

function assertRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

function assertConfidence(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${field} must be a finite number from 0 to 1`);
  }
}

function assertTimestamp(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !isCanonicalRfc3339(value)) {
    throw new TypeError(`${field} must be a canonical RFC3339 timestamp`);
  }
}

function assertDenseStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length) {
    throw new TypeError(`${field} must be a dense array`);
  }
  for (const item of value) {
    if (typeof item !== 'string') throw new TypeError(`${field} must contain only strings`);
  }
}

function assertDenseEnumArray<T extends Record<string, string>>(
  value: unknown,
  enumeration: T,
  field: string,
): asserts value is Array<T[keyof T]> {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length) {
    throw new TypeError(`${field} must be a dense array`);
  }
  for (const item of value) {
    assertEnum(item, enumeration, field);
  }
}

function assertEnum<T extends Record<string, string>>(
  value: unknown,
  enumeration: T,
  field: string,
): asserts value is T[keyof T] {
  if (typeof value !== 'string' || !Object.values(enumeration).includes(value)) {
    throw new TypeError(`${field} is invalid`);
  }
}

function assertStringScalarMap(
  value: unknown,
  field: string,
): asserts value is Record<string, string | number | boolean | null> {
  assertRecord(value, field);
  for (const [key, entry] of Object.entries(value)) {
    if (key.trim().length === 0) throw new TypeError(`${field} keys must be non-empty`);
    const type = typeof entry;
    if (entry !== null && type !== 'string' && type !== 'number' && type !== 'boolean') {
      throw new TypeError(`${field}.${key} must be a JSON scalar`);
    }
    if (type === 'number' && !Number.isFinite(entry)) {
      throw new TypeError(`${field}.${key} must be a finite number`);
    }
  }
}

function isCanonicalRfc3339(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
    value,
  );
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[10] ? Number(match[10]) : 0;
  const offsetMinute = match[11] ? Number(match[11]) : 0;
  if (
    year === 0 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}
