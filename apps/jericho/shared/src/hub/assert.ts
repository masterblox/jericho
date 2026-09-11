import {
  HUB_AGGREGATION_WINDOW_MS,
  HUB_AGENT_IDS,
  type HubAgentId,
  type HubAgentStatus,
  type HubAggregationWindow,
  type HubAlert,
  type HubBootAnnouncementPlan,
  type HubCommand,
  type HubCommandLogEntry,
  type HubContextItem,
  type HubDispatchPlan,
  type HubDispatchReceipt,
  type HubDispatchVerdict,
  type HubEvent,
  type HubIntentClassification,
  type HubSealedDemoSnapshot,
  type HubSnapshot,
  type HubWalkthroughEvent,
  type HubWhisperProbeResult,
} from './types.js';

const INTENT_KINDS = new Set(['TASK', 'QUERY', 'CREATE', 'BRIEF', 'DEMO', 'DISPATCH', 'VERIFY', 'ARCHIVE', 'ACK']);
const SOURCES = new Set(['telegram_voice', 'telegram_text', 'qr_text', 'desktop_text']);
const DISPATCH_STATUSES = new Set([
  'planned',
  'pending_approval',
  'approved',
  'dispatched',
  'verified',
  'failed',
  'archived',
]);
const PHASES = new Set([
  'received',
  'classified',
  'planned',
  'approved',
  'dispatched',
  'verified',
  'archived',
  'completed',
  'acknowledged',
  'failed',
]);
const PRIORITIES = new Set(['critical', 'high', 'normal', 'low']);
const CATEGORIES = new Set(['money', 'failure', 'deadline', 'intelligence', 'system']);
const HEALTH = new Set(['green', 'yellow', 'red', 'offline']);
const MODES = new Set(['live', 'demo']);
const CONNECTIONS = new Set(['connected', 'degraded', 'reconnecting', 'offline']);
const WHISPER = new Set(['local', 'api_fallback', 'unavailable']);
const DEMO_STREAMS = new Set(['competitor', 'deploy_fix', 'morning_brief']);
const CONTEXT_CATEGORIES = new Set([
  'transcript',
  'repo',
  'pr',
  'linear',
  'opportunity',
  'task',
  'heartbeat',
]);
const AGENT_IDS = new Set<string>(HUB_AGENT_IDS);

export function assertHubCommand(value: unknown): asserts value is HubCommand {
  assertRecord(value, 'HubCommand');
  if (value.schemaVersion !== 1) throw new TypeError('HubCommand.schemaVersion must be 1');
  assertNonEmptyString(value.id, 'HubCommand.id');
  assertNonEmptyString(value.idempotencyKey, 'HubCommand.idempotencyKey');
  assertTimestamp(value.receivedAt, 'HubCommand.receivedAt');
  assertOneOf(value.source, SOURCES, 'HubCommand.source');
  assertNonEmptyString(value.text, 'HubCommand.text');
  assertRecord(value.provenance, 'HubCommand.provenance');
  assertNonEmptyString(value.provenance.transportId, 'HubCommand.provenance.transportId');
  if ('actorIdHash' in value.provenance) {
    assertNonEmptyString(value.provenance.actorIdHash, 'HubCommand.provenance.actorIdHash');
  }
}

export function assertHubIntentClassification(
  value: unknown,
): asserts value is HubIntentClassification {
  assertRecord(value, 'HubIntentClassification');
  assertOneOf(value.intent, INTENT_KINDS, 'HubIntentClassification.intent');
  assertConfidence(value.confidence, 'HubIntentClassification.confidence');
  assertNonEmptyString(value.summary, 'HubIntentClassification.summary');
  assertDenseStringArray(value.signals, 'HubIntentClassification.signals');
}

export function assertHubDispatchPlan(value: unknown): asserts value is HubDispatchPlan {
  assertRecord(value, 'HubDispatchPlan');
  if (value.schemaVersion !== 1) throw new TypeError('HubDispatchPlan.schemaVersion must be 1');
  assertNonEmptyString(value.commandId, 'HubDispatchPlan.commandId');
  assertOneOf(value.intent, INTENT_KINDS, 'HubDispatchPlan.intent');
  if (value.targetAgent !== null) assertAgentId(value.targetAgent, 'HubDispatchPlan.targetAgent');
  assertConfidence(value.confidence, 'HubDispatchPlan.confidence');
  assertNonEmptyString(value.summary, 'HubDispatchPlan.summary');
  if (typeof value.requiresConfirmation !== 'boolean') {
    throw new TypeError('HubDispatchPlan.requiresConfirmation must be boolean');
  }
  assertOneOf(value.status, DISPATCH_STATUSES, 'HubDispatchPlan.status');
  if ('reason' in value) assertNonEmptyString(value.reason, 'HubDispatchPlan.reason');
}

export function assertHubDispatchReceipt(value: unknown): asserts value is HubDispatchReceipt {
  assertRecord(value, 'HubDispatchReceipt');
  assertNonEmptyString(value.idempotencyKey, 'HubDispatchReceipt.idempotencyKey');
  assertNonEmptyString(value.commandId, 'HubDispatchReceipt.commandId');
  assertHubDispatchPlan(value.plan);
  if (typeof value.replayed !== 'boolean') {
    throw new TypeError('HubDispatchReceipt.replayed must be boolean');
  }
  assertTimestamp(value.updatedAt, 'HubDispatchReceipt.updatedAt');
  if ('targetId' in value) assertNonEmptyString(value.targetId, 'HubDispatchReceipt.targetId');
  if ('verdict' in value) assertHubDispatchVerdict(value.verdict);
  if ('failureReason' in value) {
    assertNonEmptyString(value.failureReason, 'HubDispatchReceipt.failureReason');
  }
  if ('archivedAt' in value) assertTimestamp(value.archivedAt, 'HubDispatchReceipt.archivedAt');
}

export function assertHubDispatchVerdict(value: unknown): asserts value is HubDispatchVerdict {
  assertRecord(value, 'HubDispatchVerdict');
  if (value.status !== 'verified' && value.status !== 'failed') {
    throw new TypeError('HubDispatchVerdict.status must be verified | failed');
  }
  assertNonEmptyString(value.evidence, 'HubDispatchVerdict.evidence');
  assertTimestamp(value.at, 'HubDispatchVerdict.at');
  if ('verifier' in value) assertNonEmptyString(value.verifier, 'HubDispatchVerdict.verifier');
}

export function assertHubAgentStatus(value: unknown): asserts value is HubAgentStatus {
  assertRecord(value, 'HubAgentStatus');
  assertAgentId(value.agentId, 'HubAgentStatus.agentId');
  assertOneOf(value.health, HEALTH, 'HubAgentStatus.health');
  if (value.currentTask !== null) assertNonEmptyString(value.currentTask, 'HubAgentStatus.currentTask');
  if (value.lastOutputAt !== null) assertTimestamp(value.lastOutputAt, 'HubAgentStatus.lastOutputAt');
  if (
    typeof value.unreadAlerts !== 'number' ||
    !Number.isInteger(value.unreadAlerts) ||
    value.unreadAlerts < 0
  ) {
    throw new TypeError('HubAgentStatus.unreadAlerts must be a non-negative integer');
  }
}

export function assertHubCommandLogEntry(value: unknown): asserts value is HubCommandLogEntry {
  assertRecord(value, 'HubCommandLogEntry');
  assertNonEmptyString(value.id, 'HubCommandLogEntry.id');
  assertTimestamp(value.occurredAt, 'HubCommandLogEntry.occurredAt');
  assertAgentId(value.agentId, 'HubCommandLogEntry.agentId');
  assertOneOf(value.phase, PHASES, 'HubCommandLogEntry.phase');
  assertNonEmptyString(value.summary, 'HubCommandLogEntry.summary');
}

export function assertHubAlert(value: unknown): asserts value is HubAlert {
  assertRecord(value, 'HubAlert');
  assertNonEmptyString(value.id, 'HubAlert.id');
  assertTimestamp(value.occurredAt, 'HubAlert.occurredAt');
  assertAgentId(value.agentId, 'HubAlert.agentId');
  assertOneOf(value.priority, PRIORITIES, 'HubAlert.priority');
  assertOneOf(value.category, CATEGORIES, 'HubAlert.category');
  assertNonEmptyString(value.title, 'HubAlert.title');
  assertNonEmptyString(value.summary, 'HubAlert.summary');
  if (typeof value.acknowledged !== 'boolean') {
    throw new TypeError('HubAlert.acknowledged must be boolean');
  }
  if ('acknowledgedAt' in value) {
    assertTimestamp(value.acknowledgedAt, 'HubAlert.acknowledgedAt');
  }
}

export function assertHubWhisperProbeResult(
  value: unknown,
): asserts value is HubWhisperProbeResult {
  assertRecord(value, 'HubWhisperProbeResult');
  assertOneOf(value.backend, WHISPER, 'HubWhisperProbeResult.backend');
  if (typeof value.available !== 'boolean') {
    throw new TypeError('HubWhisperProbeResult.available must be boolean');
  }
  assertTimestamp(value.probedAt, 'HubWhisperProbeResult.probedAt');
  assertNonEmptyString(value.detail, 'HubWhisperProbeResult.detail');
  if (typeof value.fallbackConfigured !== 'boolean') {
    throw new TypeError('HubWhisperProbeResult.fallbackConfigured must be boolean');
  }
}

export function assertHubBootAnnouncementPlan(
  value: unknown,
): asserts value is HubBootAnnouncementPlan {
  assertRecord(value, 'HubBootAnnouncementPlan');
  assertNonEmptyString(value.bootId, 'HubBootAnnouncementPlan.bootId');
  assertNonEmptyString(value.idempotencyKey, 'HubBootAnnouncementPlan.idempotencyKey');
  if (value.channel !== 'telegram') {
    throw new TypeError('HubBootAnnouncementPlan.channel must be telegram');
  }
  assertNonEmptyString(value.text, 'HubBootAnnouncementPlan.text');
  assertTotals(value.totals, 'HubBootAnnouncementPlan.totals');
  assertTimestamp(value.createdAt, 'HubBootAnnouncementPlan.createdAt');
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
  if (!Array.isArray(value.items)) throw new TypeError('HubAggregationWindow.items must be an array');
  value.items.forEach((item, index) => assertHubContextItem(item, `items[${index}]`));
  assertRecord(value.counts, 'HubAggregationWindow.counts');
  for (const category of CONTEXT_CATEGORIES) {
    const count = value.counts[category as HubContextItem['category']];
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      throw new TypeError(`HubAggregationWindow.counts.${category} invalid`);
    }
  }
  assertDenseStringArray(value.degradedProviders, 'HubAggregationWindow.degradedProviders');
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
  assertOneOf(value.stream, DEMO_STREAMS, 'HubWalkthroughEvent.stream');
  if (typeof value.sequence !== 'number' || !Number.isInteger(value.sequence) || value.sequence < 0) {
    throw new TypeError('HubWalkthroughEvent.sequence must be a non-negative integer');
  }
  assertTimestamp(value.at, 'HubWalkthroughEvent.at');
  assertNonEmptyString(value.kind, 'HubWalkthroughEvent.kind');
  assertNonEmptyString(value.message, 'HubWalkthroughEvent.message');
  assertStringScalarMap(value.data, 'HubWalkthroughEvent.data');
}

export function assertHubSnapshot(value: unknown): asserts value is HubSnapshot {
  assertRecord(value, 'HubSnapshot');
  if (value.schemaVersion !== 1) throw new TypeError('HubSnapshot.schemaVersion must be 1');
  assertTimestamp(value.generatedAt, 'HubSnapshot.generatedAt');
  assertOneOf(value.mode, MODES, 'HubSnapshot.mode');
  assertOneOf(value.connection, CONNECTIONS, 'HubSnapshot.connection');
  if (!Array.isArray(value.agents)) throw new TypeError('HubSnapshot.agents must be an array');
  value.agents.forEach((agent) => assertHubAgentStatus(agent));
  if (!Array.isArray(value.commandLog)) throw new TypeError('HubSnapshot.commandLog must be an array');
  value.commandLog.forEach((entry) => assertHubCommandLogEntry(entry));
  if (!Array.isArray(value.alerts)) throw new TypeError('HubSnapshot.alerts must be an array');
  value.alerts.forEach((alert) => assertHubAlert(alert));
  assertTotals(value.totals, 'HubSnapshot.totals');
  assertNonEmptyString(value.revision, 'HubSnapshot.revision');
  if ('bootAnnouncement' in value) assertHubBootAnnouncementPlan(value.bootAnnouncement);
  if ('aggregation' in value) assertHubAggregationWindow(value.aggregation);
  if ('whisper' in value) assertHubWhisperProbeResult(value.whisper);
  if ('demos' in value) {
    if (!Array.isArray(value.demos)) throw new TypeError('HubSnapshot.demos must be an array');
    value.demos.forEach((demo) => assertHubSealedDemoSnapshot(demo));
  }
  if ('walkthroughs' in value) {
    assertRecord(value.walkthroughs, 'HubSnapshot.walkthroughs');
    for (const stream of DEMO_STREAMS) {
      const events = value.walkthroughs[stream as string];
      if (!Array.isArray(events)) {
        throw new TypeError(`HubSnapshot.walkthroughs.${stream} must be an array`);
      }
      events.forEach((event) => assertHubWalkthroughEvent(event));
    }
  }
}

export function assertHubEvent(value: unknown): asserts value is HubEvent {
  assertRecord(value, 'HubEvent');
  if (typeof value.sequence !== 'number' || !Number.isInteger(value.sequence) || value.sequence < 0) {
    throw new TypeError('HubEvent.sequence must be a non-negative integer');
  }
  switch (value.type) {
    case 'snapshot':
      assertHubSnapshot(value.snapshot);
      break;
    case 'agent_status':
      assertHubAgentStatus(value.status);
      break;
    case 'command_log':
      assertHubCommandLogEntry(value.entry);
      break;
    case 'alert':
      assertHubAlert(value.alert);
      break;
    case 'dispatch':
      assertHubDispatchReceipt(value.receipt);
      break;
    case 'ack':
      assertNonEmptyString(value.alertId, 'HubEvent.alertId');
      assertTimestamp(value.acknowledgedAt, 'HubEvent.acknowledgedAt');
      break;
    case 'mode':
      assertOneOf(value.mode, MODES, 'HubEvent.mode');
      break;
    default:
      throw new TypeError('HubEvent.type is unsupported');
  }
}

function assertHubContextItem(value: unknown, field: string): asserts value is HubContextItem {
  assertRecord(value, field);
  assertNonEmptyString(value.id, `${field}.id`);
  assertOneOf(value.category, CONTEXT_CATEGORIES, `${field}.category`);
  assertNonEmptyString(value.title, `${field}.title`);
  assertTimestamp(value.occurredAt, `${field}.occurredAt`);
  assertNonEmptyString(value.source, `${field}.source`);
  assertNonEmptyString(value.summary, `${field}.summary`);
  if ('signal' in value) {
    if (typeof value.signal !== 'number' || !Number.isFinite(value.signal)) {
      throw new TypeError(`${field}.signal must be finite`);
    }
  }
}

function assertTotals(
  value: unknown,
  field: string,
): asserts value is { activeAgents: number; queuedTasks: number; opportunities: number } {
  assertRecord(value, field);
  for (const key of ['activeAgents', 'queuedTasks', 'opportunities'] as const) {
    const count = value[key];
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      throw new TypeError(`${field}.${key} must be a non-negative integer`);
    }
  }
}

function assertAgentId(value: unknown, field: string): asserts value is HubAgentId {
  if (typeof value !== 'string' || !AGENT_IDS.has(value)) {
    throw new TypeError(`${field} is invalid`);
  }
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

function assertOneOf(value: unknown, allowed: Set<string>, field: string): void {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new TypeError(`${field} is invalid`);
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
