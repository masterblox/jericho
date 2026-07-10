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
  for (const field of [
    'id',
    'source',
    'sourceType',
    'sourceEventId',
    'type',
    'occurredAt',
    'ingestedAt',
  ]) {
    if (typeof value[field] !== 'string' || value[field].length === 0) {
      throw new TypeError(`Event envelope ${field} must be a non-empty string`);
    }
  }
  if (!Array.isArray(value.provenance)) {
    throw new TypeError('Event envelope provenance must be an array');
  }
  if (!isJsonValue(value.payload)) {
    throw new TypeError('Event envelope payload must be JSON-serializable');
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
    valid = value.every((item) => isJsonValue(item, seen));
  } else if (Object.getPrototypeOf(value) !== Object.prototype) {
    valid = false;
  } else {
    valid = Object.values(value).every((item) => isJsonValue(item, seen));
  }
  seen.delete(value);
  return valid;
}
