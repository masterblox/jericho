export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type IsoTimestamp = string;

export enum SourceType {
  User = 'user',
  Connector = 'connector',
  Agent = 'agent',
  System = 'system',
  Sensor = 'sensor',
  Import = 'import',
}

export enum LifecycleStatus {
  Draft = 'draft',
  Queued = 'queued',
  PendingApproval = 'pending_approval',
  Approved = 'approved',
  Active = 'active',
  Paused = 'paused',
  Succeeded = 'succeeded',
  Failed = 'failed',
  Cancelled = 'cancelled',
  Rejected = 'rejected',
  Archived = 'archived',
}

export enum RiskLevel {
  None = 'none',
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  Critical = 'critical',
}

export enum RouteType {
  Local = 'local',
  Agent = 'agent',
  Connector = 'connector',
  HumanApproval = 'human_approval',
  Blocked = 'blocked',
}

export enum FreshnessStatus {
  Fresh = 'fresh',
  Stale = 'stale',
  Unknown = 'unknown',
}

export enum EntityType {
  Person = 'person',
  Organization = 'organization',
  Project = 'project',
  Task = 'task',
  Location = 'location',
  Topic = 'topic',
  Document = 'document',
  Account = 'account',
  Device = 'device',
  Agent = 'agent',
  Service = 'service',
  Other = 'other',
}

export enum RelationType {
  SameAs = 'same_as',
  MemberOf = 'member_of',
  Owns = 'owns',
  WorksFor = 'works_for',
  DependsOn = 'depends_on',
  AssignedTo = 'assigned_to',
  Mentions = 'mentions',
  RelatedTo = 'related_to',
  LocatedAt = 'located_at',
  ParentOf = 'parent_of',
  Supports = 'supports',
  ConflictsWith = 'conflicts_with',
}

export enum IntentKind {
  Observe = 'observe',
  Query = 'query',
  Command = 'command',
  Goal = 'goal',
  Preference = 'preference',
  Correction = 'correction',
  Cancellation = 'cancellation',
}

export enum MissionTaskKind {
  Analyze = 'analyze',
  Research = 'research',
  Communicate = 'communicate',
  Execute = 'execute',
  Monitor = 'monitor',
  Decide = 'decide',
  Custom = 'custom',
}

export enum ProposalKind {
  Plan = 'plan',
  Action = 'action',
  Message = 'message',
  DataChange = 'data_change',
  PreferenceChange = 'preference_change',
}

export enum ReceiptStatus {
  Pending = 'pending',
  Started = 'started',
  Succeeded = 'succeeded',
  Failed = 'failed',
  Denied = 'denied',
  RolledBack = 'rolled_back',
}

export enum DecisionOutcome {
  Approved = 'approved',
  Rejected = 'rejected',
  Deferred = 'deferred',
  Superseded = 'superseded',
}

export enum ConnectorHealthStatus {
  Unknown = 'unknown',
  Healthy = 'healthy',
  Degraded = 'degraded',
  Unavailable = 'unavailable',
  Unauthorized = 'unauthorized',
  Disabled = 'disabled',
}

export enum PreferenceScope {
  User = 'user',
  Workspace = 'workspace',
  Connector = 'connector',
  Global = 'global',
}

export interface Freshness {
  observedAt: IsoTimestamp;
  validAt?: IsoTimestamp;
  staleAt?: IsoTimestamp;
  expiresAt?: IsoTimestamp;
  status?: FreshnessStatus;
}

export interface Provenance {
  source: string;
  sourceType: SourceType;
  sourceEventId?: string;
  observedAt: IsoTimestamp;
  receivedAt?: IsoTimestamp;
  actorId?: string;
  confidence?: number;
  integrityHash?: string;
}

export interface EventEnvelope {
  id: string;
  source: string;
  sourceType: SourceType;
  sourceEventId: string;
  type: string;
  occurredAt: IsoTimestamp;
  ingestedAt: IsoTimestamp;
  payload: JsonValue;
  status?: LifecycleStatus;
  route?: RouteType;
  risk?: RiskLevel;
  confidence?: number;
  freshness?: Freshness;
  provenance: Provenance[];
  integrityHash?: string;
}

export interface Entity {
  id: string;
  type: EntityType;
  canonicalName: string;
  aliases: string[];
  attributes: JsonObject;
  status?: LifecycleStatus;
  risk?: RiskLevel;
  confidence?: number;
  freshness: Freshness;
  provenance: Provenance[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  integrityHash?: string;
}

export interface Relation {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  type: RelationType;
  attributes: JsonObject;
  status?: LifecycleStatus;
  risk?: RiskLevel;
  confidence?: number;
  freshness: Freshness;
  provenance: Provenance[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  integrityHash?: string;
}

export interface IntentEnvelope {
  id: string;
  eventId?: string;
  source: string;
  sourceType: SourceType;
  actorEntityId?: string;
  kind: IntentKind;
  summary: string;
  payload: JsonObject;
  status: LifecycleStatus;
  route: RouteType;
  risk: RiskLevel;
  confidence?: number;
  freshness?: Freshness;
  provenance: Provenance[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  integrityHash?: string;
}

export interface MissionPlan {
  id: string;
  intentId: string;
  title: string;
  objective: string;
  status: LifecycleStatus;
  route: RouteType;
  risk: RiskLevel;
  confidence?: number;
  taskIds: string[];
  constraints: JsonObject;
  freshness?: Freshness;
  provenance: Provenance[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  integrityHash?: string;
}

export interface MissionTask {
  id: string;
  missionId: string;
  kind: MissionTaskKind;
  title: string;
  description?: string;
  status: LifecycleStatus;
  route: RouteType;
  risk: RiskLevel;
  sequence: number;
  requiredCapabilities: string[];
  dependsOn: string[];
  input: JsonObject;
  output?: JsonValue;
  confidence?: number;
  freshness?: Freshness;
  provenance: Provenance[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  startedAt?: IsoTimestamp;
  completedAt?: IsoTimestamp;
  integrityHash?: string;
}

export interface AgentCapability {
  id: string;
  agentId: string;
  name: string;
  description?: string;
  status: LifecycleStatus;
  routes: RouteType[];
  maximumRisk: RiskLevel;
  confidence?: number;
  metadata: JsonObject;
  lastVerifiedAt?: IsoTimestamp;
  provenance: Provenance[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  integrityHash?: string;
}

export interface Assignment {
  id: string;
  missionTaskId: string;
  agentId: string;
  capabilityIds: string[];
  status: LifecycleStatus;
  route: RouteType;
  risk: RiskLevel;
  confidence?: number;
  instructions: JsonObject;
  assignedAt: IsoTimestamp;
  acceptedAt?: IsoTimestamp;
  completedAt?: IsoTimestamp;
  provenance: Provenance[];
  integrityHash?: string;
}

export interface Proposal {
  id: string;
  assignmentId?: string;
  missionTaskId?: string;
  proposedByAgentId: string;
  kind: ProposalKind;
  summary: string;
  body: JsonObject;
  status: LifecycleStatus;
  route: RouteType;
  risk: RiskLevel;
  confidence?: number;
  createdAt: IsoTimestamp;
  expiresAt?: IsoTimestamp;
  provenance: Provenance[];
  integrityHash?: string;
}

export interface ActionReceipt {
  id: string;
  proposalId?: string;
  assignmentId?: string;
  missionTaskId?: string;
  connectorId?: string;
  action: string;
  status: ReceiptStatus;
  route: RouteType;
  risk: RiskLevel;
  requestedAt: IsoTimestamp;
  startedAt?: IsoTimestamp;
  completedAt?: IsoTimestamp;
  externalReference?: string;
  result?: JsonValue;
  error?: JsonObject;
  provenance: Provenance[];
  integrityHash?: string;
}

export interface DecisionRecord {
  id: string;
  intentId?: string;
  missionId?: string;
  missionTaskId?: string;
  proposalId?: string;
  decidedBy: string;
  outcome: DecisionOutcome;
  rationale: string;
  evidenceEventIds: string[];
  route: RouteType;
  risk: RiskLevel;
  confidence?: number;
  decidedAt: IsoTimestamp;
  provenance: Provenance[];
  integrityHash?: string;
}

export interface ConnectorHealth {
  connectorId: string;
  status: ConnectorHealthStatus;
  checkedAt: IsoTimestamp;
  lastSuccessAt?: IsoTimestamp;
  lastFailureAt?: IsoTimestamp;
  latencyMs?: number;
  consecutiveFailures: number;
  freshness: Freshness;
  details: JsonObject;
  provenance: Provenance[];
  integrityHash?: string;
}

export interface PreferenceChange {
  id: string;
  entityId?: string;
  scope: PreferenceScope;
  key: string;
  previousValue?: JsonValue;
  nextValue: JsonValue;
  status: LifecycleStatus;
  route: RouteType;
  risk: RiskLevel;
  source: string;
  sourceType: SourceType;
  changedAt: IsoTimestamp;
  reason?: string;
  provenance: Provenance[];
  integrityHash?: string;
}

export function assertEventEnvelope(value: unknown): asserts value is EventEnvelope {
  if (!isRecord(value)) {
    throw new TypeError('Event envelope must be an object');
  }
  if (!isJsonValue(value.payload)) {
    throw new TypeError('Event envelope payload must be JSON-serializable');
  }
  for (const field of ['id', 'source', 'sourceEventId', 'type']) {
    assertNonEmptyString(value[field], `Event envelope ${field}`);
  }
  assertEnum(value.sourceType, SourceType, 'Event envelope sourceType');
  assertTimestamp(value.occurredAt, 'Event envelope occurredAt');
  assertTimestamp(value.ingestedAt, 'Event envelope ingestedAt');
  assertOptionalEnum(value, 'status', LifecycleStatus, 'Event envelope status');
  assertOptionalEnum(value, 'route', RouteType, 'Event envelope route');
  assertOptionalEnum(value, 'risk', RiskLevel, 'Event envelope risk');
  assertOptionalConfidence(value, 'confidence', 'Event envelope confidence');
  if ('freshness' in value) {
    assertFreshness(value.freshness, 'Event envelope freshness');
  }
  assertProvenanceList(value.provenance, 'Event envelope provenance');
  assertOptionalIntegrityHash(value, 'Event envelope integrityHash');
  if (!isJsonValue(value)) {
    throw new TypeError('Event envelope must contain only JSON values');
  }
}

export function assertEntity(value: unknown): asserts value is Entity {
  if (!isRecord(value)) {
    throw new TypeError('Entity must be an object');
  }
  for (const field of ['id', 'canonicalName']) {
    assertNonEmptyString(value[field], `Entity ${field}`);
  }
  assertEnum(value.type, EntityType, 'Entity type');
  assertDenseStringArray(value.aliases, 'Entity aliases');
  assertJsonObject(value.attributes, 'Entity attributes');
  assertOptionalEnum(value, 'status', LifecycleStatus, 'Entity status');
  assertOptionalEnum(value, 'risk', RiskLevel, 'Entity risk');
  assertOptionalConfidence(value, 'confidence', 'Entity confidence');
  assertFreshness(value.freshness, 'Entity freshness');
  assertProvenanceList(value.provenance, 'Entity provenance');
  assertTimestamp(value.createdAt, 'Entity createdAt');
  assertTimestamp(value.updatedAt, 'Entity updatedAt');
  assertOptionalIntegrityHash(value, 'Entity integrityHash');
  if (!isJsonValue(value)) {
    throw new TypeError('Entity must contain only JSON values');
  }
}

export function assertRelation(value: unknown): asserts value is Relation {
  if (!isRecord(value)) {
    throw new TypeError('Relation must be an object');
  }
  for (const field of ['id', 'fromEntityId', 'toEntityId']) {
    assertNonEmptyString(value[field], `Relation ${field}`);
  }
  assertEnum(value.type, RelationType, 'Relation type');
  assertJsonObject(value.attributes, 'Relation attributes');
  assertOptionalEnum(value, 'status', LifecycleStatus, 'Relation status');
  assertOptionalEnum(value, 'risk', RiskLevel, 'Relation risk');
  assertOptionalConfidence(value, 'confidence', 'Relation confidence');
  assertFreshness(value.freshness, 'Relation freshness');
  assertProvenanceList(value.provenance, 'Relation provenance');
  assertTimestamp(value.createdAt, 'Relation createdAt');
  assertTimestamp(value.updatedAt, 'Relation updatedAt');
  assertOptionalIntegrityHash(value, 'Relation integrityHash');
  if (!isJsonValue(value)) {
    throw new TypeError('Relation must contain only JSON values');
  }
}

export function assertConnectorHealth(
  value: unknown,
): asserts value is ConnectorHealth {
  if (!isRecord(value)) {
    throw new TypeError('Connector health must be an object');
  }
  assertNonEmptyString(value.connectorId, 'Connector health connectorId');
  assertEnum(value.status, ConnectorHealthStatus, 'Connector health status');
  assertTimestamp(value.checkedAt, 'Connector health checkedAt');
  for (const field of ['lastSuccessAt', 'lastFailureAt']) {
    if (field in value) {
      assertTimestamp(value[field], `Connector health ${field}`);
    }
  }
  if (
    'latencyMs' in value &&
    (typeof value.latencyMs !== 'number' ||
      !Number.isFinite(value.latencyMs) ||
      value.latencyMs < 0)
  ) {
    throw new TypeError('Connector health latencyMs must be finite and non-negative');
  }
  if (
    !Number.isInteger(value.consecutiveFailures) ||
    Number(value.consecutiveFailures) < 0
  ) {
    throw new TypeError(
      'Connector health consecutiveFailures must be a non-negative integer',
    );
  }
  assertFreshness(value.freshness, 'Connector health freshness');
  assertJsonObject(value.details, 'Connector health details');
  assertProvenanceList(value.provenance, 'Connector health provenance');
  assertOptionalIntegrityHash(value, 'Connector health integrityHash');
  if (!isJsonValue(value)) {
    throw new TypeError('Connector health must contain only JSON values');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown, seen = new WeakSet<object>()): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value !== 'object' || seen.has(value)) {
    return false;
  }
  seen.add(value);
  let valid: boolean;
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    valid =
      keys.length === value.length &&
      keys.every((key, index) => key === String(index)) &&
      Object.getOwnPropertySymbols(value).length === 0 &&
      value.every(
        (item, index) =>
          Object.hasOwn(value, index) && isJsonValue(item, seen),
      );
  } else if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    valid = false;
  } else {
    valid =
      Object.getOwnPropertySymbols(value).length === 0 &&
      Object.values(value).every((item) => isJsonValue(item, seen));
  }
  seen.delete(value);
  return valid;
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

function assertDenseStringArray(
  value: unknown,
  field: string,
): asserts value is string[] {
  const keys = Array.isArray(value) ? Object.keys(value) : [];
  if (
    !Array.isArray(value) ||
    keys.length !== value.length ||
    !keys.every((key, index) => key === String(index)) ||
    !value.every(
      (item, index) =>
        Object.hasOwn(value, index) &&
        typeof item === 'string' &&
        item.length > 0,
    )
  ) {
    throw new TypeError(`${field} must be a dense string array`);
  }
}

function assertJsonObject(value: unknown, field: string): asserts value is JsonObject {
  if (!isRecord(value) || !isJsonValue(value)) {
    throw new TypeError(`${field} must be a JSON object`);
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

function assertOptionalEnum<T extends Record<string, string>>(
  record: Record<string, unknown>,
  key: string,
  enumeration: T,
  field: string,
): void {
  if (key in record) {
    assertEnum(record[key], enumeration, field);
  }
}

function assertOptionalConfidence(
  record: Record<string, unknown>,
  key: string,
  field: string,
): void {
  if (!(key in record)) return;
  const value = record[key];
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new TypeError(`${field} must be a finite number from 0 to 1`);
  }
}

function assertFreshness(value: unknown, field: string): asserts value is Freshness {
  if (!isRecord(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  assertTimestamp(value.observedAt, `${field}.observedAt`);
  for (const key of ['validAt', 'staleAt', 'expiresAt']) {
    if (key in value) assertTimestamp(value[key], `${field}.${key}`);
  }
  assertOptionalEnum(value, 'status', FreshnessStatus, `${field}.status`);
}

function assertProvenanceList(
  value: unknown,
  field: string,
): asserts value is Provenance[] {
  const keys = Array.isArray(value) ? Object.keys(value) : [];
  if (
    !Array.isArray(value) ||
    keys.length !== value.length ||
    !keys.every((key, index) => key === String(index))
  ) {
    throw new TypeError(`${field} must be a dense array`);
  }
  value.forEach((item, index) => assertProvenance(item, `${field}[${index}]`));
}

function assertProvenance(value: unknown, field: string): asserts value is Provenance {
  if (!isRecord(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  assertNonEmptyString(value.source, `${field}.source`);
  assertEnum(value.sourceType, SourceType, `${field}.sourceType`);
  assertTimestamp(value.observedAt, `${field}.observedAt`);
  for (const key of ['sourceEventId', 'actorId']) {
    if (key in value) assertNonEmptyString(value[key], `${field}.${key}`);
  }
  if ('receivedAt' in value) {
    assertTimestamp(value.receivedAt, `${field}.receivedAt`);
  }
  assertOptionalConfidence(value, 'confidence', `${field}.confidence`);
  assertOptionalIntegrityHash(value, `${field}.integrityHash`);
}

function assertOptionalIntegrityHash(
  record: Record<string, unknown>,
  field: string,
): void {
  const key = 'integrityHash';
  if (key in record && !/^[0-9a-f]{64}$/.test(String(record[key]))) {
    throw new TypeError(`${field} must be a lowercase SHA-256 digest`);
  }
}

function assertTimestamp(value: unknown, field: string): asserts value is IsoTimestamp {
  if (typeof value !== 'string' || !isCanonicalRfc3339(value)) {
    throw new TypeError(`${field} must be a canonical RFC3339 timestamp`);
  }
}

function isCanonicalRfc3339(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
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
