import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import {
  assertActionReceipt,
  assertAgentCapability,
  assertAssignment,
  assertCaptureFailure,
  assertChangeLog,
  assertConnectorLease,
  assertConnectorHealth,
  assertCostRecord,
  assertDecisionRecord,
  assertEntity,
  assertEventEnvelope,
  assertExternalIdentityLink,
  assertNormalizedCapture,
  assertIntentEnvelope,
  assertMissionPlan,
  assertMissionTask,
  assertPreferenceChange,
  assertProposal,
  assertRelation,
  assertVersionedCursor,
  CaptureFailureKind,
  ChangeLogKind,
  ConnectorCapability,
  ConnectorHealthStatus,
  DecisionOutcome,
  ExternalIdentityLinkStatus,
  IdentityReviewKind,
  LifecycleStatus,
  ProposalKind,
  ReceiptStatus,
  RiskLevel,
  RouteType,
  SourceType,
  type ActionReceipt,
  type AgentCapability,
  type AgentLane,
  type Assignment,
  type CaptureFailure,
  type ChangeLog,
  type ConnectorLease,
  type ConnectorHealth,
  type ConnectorCapabilityHealth,
  type CostRecord,
  type DecisionRecord,
  type Entity,
  type EntityType,
  type EventEnvelope,
  type ExternalIdentityLink,
  type ExternalIdentityObservation,
  type ExternalIdentityReviewCandidate,
  type Freshness,
  type IntentEnvelope,
  type IntentRoute,
  type JsonValue,
  type JsonObject,
  type MissionPlan,
  type MissionTask,
  type PreferenceChange,
  type Proposal,
  type Provenance,
  type ReceiptStatus as ReceiptStatusType,
  type Relation,
  type RelationType,
  type NormalizedCapture,
  type VersionedCursor,
} from '@jericho/shared';

import { CapabilityRegistry } from '../orchestration/capability-registry.js';
import { computeMissionPlanHash } from '../orchestration/mission-hash.js';
import {
  validateMissionPlanInput,
  type MissionPlanInput,
} from '../orchestration/planner.js';
import { CoreCrypto, loadMasterKey } from './crypto.js';

export interface JerichoStoreOptions {
  path?: string;
  key?: Buffer;
}

export interface AppendEventResult {
  event: EventEnvelope;
  inserted: boolean;
}

export interface CommitLocalCaptureResult extends AppendEventResult {
  change?: ChangeLog;
}

export interface EventListOptions {
  source?: string;
  limit?: number;
}

export interface MissionCancellationBinding {
  planHash: string;
  planVersion: number;
  decision: DecisionRecord;
}

export interface ReviewIntentResolutionInput {
  intentId: string;
  intentHash: string;
  decision: DecisionRecord;
  derivedIntent?: IntentEnvelope;
  derivedMission?: MissionPlan;
}

export interface ReviewIntentResolution {
  originalIntent: IntentEnvelope;
  decision: DecisionRecord;
  derivedIntent?: IntentEnvelope;
  mission?: MissionPlan;
}

export interface CheckpointResolutionInput {
  proposalId: string;
  planHash: string;
  planVersion: number;
  decision: DecisionRecord;
  resume: boolean;
}

export interface CheckpointResolution {
  proposal: Proposal;
  decision: DecisionRecord;
  assignment: Assignment;
  mission: MissionPlan;
  resumed: boolean;
  requiresNewPlan: boolean;
}

export interface CommitCaptureBatchInput {
  connectorId: string;
  capability: ConnectorCapability;
  partition: string;
  expectedCursorVersion: number;
  nextCursor: VersionedCursor;
  captures: NormalizedCapture[];
  failures?: CaptureFailure[];
  leaseToken: string;
  committedAt: string;
}

export interface CommitCaptureBatchResult {
  events: AppendEventResult[];
  identityLinks: ExternalIdentityLink[];
  reviewCandidates: ExternalIdentityReviewCandidate[];
  failures: CaptureFailure[];
  cursor: VersionedCursor;
  changes: ChangeLog[];
}

export interface ExternalIdentityListOptions {
  connectorId?: string;
  entityId?: string;
  status?: ExternalIdentityLinkStatus;
}

export interface ChangeLogListOptions {
  afterSequence?: number;
  limit?: number;
}

export interface AcquireConnectorLeaseInput {
  connectorId: string;
  capability: ConnectorCapability;
  ownerId: string;
  now: string;
  leaseMs: number;
}

export interface EntityListOptions {
  type?: EntityType;
  status?: LifecycleStatus;
  freshAfter?: string;
}

export interface RelationListOptions {
  fromEntityId?: string;
  toEntityId?: string;
  type?: RelationType;
  status?: LifecycleStatus;
}

export interface ConnectorHealthListOptions {
  status?: ConnectorHealthStatus;
}

export interface IntentListOptions {
  status?: LifecycleStatus;
  route?: IntentRoute;
}

export interface MissionListOptions {
  status?: LifecycleStatus;
  seriesId?: string;
}

export interface CapabilityListOptions {
  agentId?: string;
  lane?: AgentLane;
  status?: LifecycleStatus;
}

export interface AssignmentListOptions {
  missionId?: string;
  missionTaskId?: string;
  agentId?: string;
  status?: LifecycleStatus;
}

export interface LeaseReadyOptions {
  workerId: string;
  now: string;
  leaseMs: number;
  limit: number;
}

export interface MissionCostSummary {
  estimatedMicroUsd: number;
  actualMicroUsd: number;
}

export interface CompleteReceiptInput {
  status: ReceiptStatusType;
  externalId?: string;
  result?: JsonValue;
  error?: Record<string, JsonValue>;
  verified: boolean;
  verifiedAt?: string;
  completedAt: string;
  evidenceEventIds: string[];
}

export class MissionPlanConflictError extends Error {
  constructor(id: string) {
    super(`Mission plan ${id} is immutable or conflicts with the stored version`);
    this.name = 'MissionPlanConflictError';
  }
}

export class MissionDecisionConflictError extends Error {
  constructor(id: string, reason: string) {
    super(`Mission ${id} decision ${reason}`);
    this.name = 'MissionDecisionConflictError';
  }
}

export class ReviewIntentDecisionConflictError extends Error {
  constructor(id: string, reason: string) {
    super(`Review intent ${id} decision ${reason}`);
    this.name = 'ReviewIntentDecisionConflictError';
  }
}

export class CheckpointDecisionConflictError extends Error {
  constructor(id: string, reason: string) {
    super(`Checkpoint ${id} decision ${reason}`);
    this.name = 'CheckpointDecisionConflictError';
  }
}

export class AssignmentLeaseError extends Error {
  constructor(id: string) {
    super(`Assignment ${id} lease fencing token is invalid`);
    this.name = 'AssignmentLeaseError';
  }
}

export class IdempotencyConflictError extends Error {
  constructor(key: string) {
    super(`Idempotency key ${key} conflicts with an existing action`);
    this.name = 'IdempotencyConflictError';
  }
}

export class EventConflictError extends Error {
  constructor(source: string, sourceEventId: string) {
    super(`Conflicting event for ${source}/${sourceEventId}`);
    this.name = 'EventConflictError';
  }
}

export class CursorConflictError extends Error {
  constructor(connectorId: string, partition: string) {
    super(`Connector cursor compare-and-swap failed for ${connectorId}/${partition}`);
    this.name = 'CursorConflictError';
  }
}

export class ConnectorLeaseError extends Error {
  constructor(id: string) {
    super(`Connector lease ${id} token is invalid or expired`);
    this.name = 'ConnectorLeaseError';
  }
}

interface Migration {
  version: number;
  sql: string;
}

type EncryptedRecordTable =
  | 'events'
  | 'entities'
  | 'relations'
  | 'intents'
  | 'missions'
  | 'mission_tasks'
  | 'agent_capabilities'
  | 'assignments'
  | 'proposals'
  | 'receipts'
  | 'decisions'
  | 'connector_health'
  | 'preference_changes'
  | 'cost_records'
  | 'connector_cursors'
  | 'connector_leases'
  | 'external_identities'
  | 'capture_failures'
  | 'change_log';

type DatabaseRow = Record<string, SQLInputValue>;
type RecordProjection = Record<string, string | number | null>;

const STORE_UUID_NAME = 'store-uuid';
const KEY_VERIFIER_NAME = 'key-verifier';
const STORE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LEGACY_RECORD_TABLES = [
  'events',
  'entities',
  'relations',
  'intents',
  'missions',
  'mission_tasks',
  'agent_capabilities',
  'assignments',
  'proposals',
  'receipts',
  'decisions',
  'connector_health',
  'preference_changes',
  'cost_records',
] as const;
const PRE_V4_ORCHESTRATION_TABLES = [
  'intents',
  'missions',
  'mission_tasks',
  'agent_capabilities',
  'assignments',
  'proposals',
  'receipts',
  'decisions',
  'preference_changes',
] as const;

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_event_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        ingested_at TEXT NOT NULL,
        status TEXT,
        route TEXT,
        risk TEXT,
        confidence REAL,
        freshness_at TEXT,
        integrity_hash TEXT NOT NULL,
        body BLOB NOT NULL,
        UNIQUE (source, source_event_id)
      );
      CREATE INDEX events_occurred_at_idx ON events (occurred_at);
      CREATE INDEX events_status_route_idx ON events (status, route);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE entities (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        status TEXT,
        risk TEXT,
        confidence REAL,
        freshness_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        integrity_hash TEXT NOT NULL,
        body BLOB NOT NULL
      );
      CREATE INDEX entities_type_idx ON entities (entity_type);
      CREATE INDEX entities_freshness_idx ON entities (freshness_at);

      CREATE TABLE relations (
        id TEXT PRIMARY KEY,
        from_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        to_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL,
        status TEXT,
        risk TEXT,
        confidence REAL,
        freshness_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        integrity_hash TEXT NOT NULL,
        body BLOB NOT NULL,
        UNIQUE (from_entity_id, to_entity_id, relation_type)
      );
      CREATE INDEX relations_from_idx ON relations (from_entity_id, relation_type);
      CREATE INDEX relations_to_idx ON relations (to_entity_id, relation_type);

      CREATE TABLE intents (
        id TEXT PRIMARY KEY,
        event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
        actor_entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
        intent_type TEXT NOT NULL,
        status TEXT NOT NULL,
        route TEXT NOT NULL,
        risk TEXT NOT NULL,
        confidence REAL,
        freshness_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        integrity_hash TEXT NOT NULL,
        body BLOB NOT NULL
      );
      CREATE INDEX intents_status_idx ON intents (status, created_at);

      CREATE TABLE missions (
        id TEXT PRIMARY KEY,
        intent_id TEXT NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        route TEXT NOT NULL,
        risk TEXT NOT NULL,
        confidence REAL,
        freshness_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        integrity_hash TEXT NOT NULL,
        body BLOB NOT NULL
      );
      CREATE INDEX missions_status_idx ON missions (status, updated_at);

      CREATE TABLE mission_tasks (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
        task_type TEXT NOT NULL,
        status TEXT NOT NULL,
        route TEXT NOT NULL,
        risk TEXT NOT NULL,
        confidence REAL,
        sequence INTEGER NOT NULL,
        freshness_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        integrity_hash TEXT NOT NULL,
        body BLOB NOT NULL,
        UNIQUE (mission_id, sequence)
      );
      CREATE INDEX mission_tasks_status_idx ON mission_tasks (mission_id, status);

      CREATE TABLE agent_capabilities (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        status TEXT NOT NULL,
        route TEXT,
        risk TEXT NOT NULL,
        confidence REAL,
        freshness_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        integrity_hash TEXT NOT NULL,
        body BLOB NOT NULL
      );
      CREATE INDEX agent_capabilities_agent_idx ON agent_capabilities (agent_id, status);

      CREATE TABLE assignments (
        id TEXT PRIMARY KEY,
        mission_task_id TEXT NOT NULL REFERENCES mission_tasks(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        primary_capability_id TEXT REFERENCES agent_capabilities(id) ON DELETE SET NULL,
        status TEXT NOT NULL,
        route TEXT NOT NULL,
        risk TEXT NOT NULL,
        confidence REAL,
        assigned_at TEXT NOT NULL,
        accepted_at TEXT,
        completed_at TEXT,
        integrity_hash TEXT NOT NULL,
        body BLOB NOT NULL
      );
      CREATE INDEX assignments_task_idx ON assignments (mission_task_id, status);
      CREATE INDEX assignments_agent_idx ON assignments (agent_id, status);

      CREATE TABLE proposals (
        id TEXT PRIMARY KEY,
        assignment_id TEXT REFERENCES assignments(id) ON DELETE SET NULL,
        mission_task_id TEXT REFERENCES mission_tasks(id) ON DELETE SET NULL,
        proposal_type TEXT NOT NULL,
        status TEXT NOT NULL,
        route TEXT NOT NULL,
        risk TEXT NOT NULL,
        confidence REAL,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        integrity_hash TEXT NOT NULL,
        body BLOB NOT NULL
      );
      CREATE INDEX proposals_status_idx ON proposals (status, created_at);

      CREATE TABLE receipts (
        id TEXT PRIMARY KEY,
        proposal_id TEXT REFERENCES proposals(id) ON DELETE SET NULL,
        assignment_id TEXT REFERENCES assignments(id) ON DELETE SET NULL,
        mission_task_id TEXT REFERENCES mission_tasks(id) ON DELETE SET NULL,
        connector_id TEXT,
        status TEXT NOT NULL,
        route TEXT NOT NULL,
        risk TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        integrity_hash TEXT NOT NULL,
        body BLOB NOT NULL
      );
      CREATE INDEX receipts_status_idx ON receipts (status, requested_at);

      CREATE TABLE decisions (
        id TEXT PRIMARY KEY,
        intent_id TEXT REFERENCES intents(id) ON DELETE SET NULL,
        mission_id TEXT REFERENCES missions(id) ON DELETE SET NULL,
        mission_task_id TEXT REFERENCES mission_tasks(id) ON DELETE SET NULL,
        proposal_id TEXT REFERENCES proposals(id) ON DELETE SET NULL,
        status TEXT NOT NULL,
        route TEXT NOT NULL,
        risk TEXT NOT NULL,
        confidence REAL,
        decided_at TEXT NOT NULL,
        integrity_hash TEXT NOT NULL,
        body BLOB NOT NULL
      );
      CREATE INDEX decisions_time_idx ON decisions (decided_at);

      CREATE TABLE connector_health (
        connector_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        checked_at TEXT NOT NULL,
        last_success_at TEXT,
        last_failure_at TEXT,
        latency_ms REAL,
        consecutive_failures INTEGER NOT NULL,
        freshness_at TEXT NOT NULL,
        integrity_hash TEXT NOT NULL,
        body BLOB NOT NULL
      );
      CREATE INDEX connector_health_status_idx ON connector_health (status, checked_at);

      CREATE TABLE preference_changes (
        id TEXT PRIMARY KEY,
        entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
        status TEXT NOT NULL,
        route TEXT NOT NULL,
        risk TEXT NOT NULL,
        changed_at TEXT NOT NULL,
        integrity_hash TEXT NOT NULL,
        body BLOB NOT NULL
      );
      CREATE INDEX preference_changes_time_idx ON preference_changes (changed_at);
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE store_metadata (
        name TEXT PRIMARY KEY,
        value BLOB NOT NULL
      );
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE missions ADD COLUMN series_id TEXT;
      ALTER TABLE missions ADD COLUMN plan_version INTEGER;
      ALTER TABLE missions ADD COLUMN plan_hash TEXT;
      ALTER TABLE missions ADD COLUMN approval_decision_id TEXT;
      ALTER TABLE missions ADD COLUMN approved_at TEXT;
      ALTER TABLE missions ADD COLUMN started_at TEXT;
      ALTER TABLE missions ADD COLUMN completed_at TEXT;
      ALTER TABLE missions ADD COLUMN cancel_requested_at TEXT;
      CREATE UNIQUE INDEX missions_series_version_idx ON missions (series_id, plan_version);
      CREATE INDEX missions_plan_hash_idx ON missions (plan_hash);

      ALTER TABLE mission_tasks ADD COLUMN lane TEXT;
      ALTER TABLE mission_tasks ADD COLUMN selected_agent_id TEXT;

      ALTER TABLE agent_capabilities ADD COLUMN lane TEXT;

      ALTER TABLE assignments ADD COLUMN mission_id TEXT REFERENCES missions(id) ON DELETE CASCADE;
      ALTER TABLE assignments ADD COLUMN idempotency_key TEXT;
      ALTER TABLE assignments ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE assignments ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE assignments ADD COLUMN available_at TEXT;
      ALTER TABLE assignments ADD COLUMN estimated_cost_microusd INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE assignments ADD COLUMN lease_owner TEXT;
      ALTER TABLE assignments ADD COLUMN lease_token TEXT;
      ALTER TABLE assignments ADD COLUMN lease_expires_at TEXT;
      ALTER TABLE assignments ADD COLUMN cancel_requested_at TEXT;
      CREATE UNIQUE INDEX assignments_idempotency_idx ON assignments (idempotency_key);
      CREATE INDEX assignments_ready_idx ON assignments (status, available_at, lease_expires_at);
      CREATE INDEX assignments_mission_status_idx ON assignments (mission_id, status);

      ALTER TABLE receipts ADD COLUMN idempotency_key TEXT;
      ALTER TABLE receipts ADD COLUMN destination TEXT;
      ALTER TABLE receipts ADD COLUMN external_id TEXT;
      ALTER TABLE receipts ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE receipts ADD COLUMN verified_at TEXT;
      ALTER TABLE receipts ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1;
      CREATE UNIQUE INDEX receipts_idempotency_idx ON receipts (idempotency_key);

      ALTER TABLE decisions ADD COLUMN plan_hash TEXT;

      CREATE TABLE mission_task_dependencies (
        mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES mission_tasks(id) ON DELETE CASCADE,
        depends_on_task_id TEXT NOT NULL REFERENCES mission_tasks(id) ON DELETE CASCADE,
        PRIMARY KEY (task_id, depends_on_task_id)
      );
      CREATE INDEX mission_task_dependencies_mission_idx ON mission_task_dependencies (mission_id, task_id);

      CREATE TABLE cost_records (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
        assignment_id TEXT REFERENCES assignments(id) ON DELETE SET NULL,
        category TEXT NOT NULL,
        estimated_microusd INTEGER NOT NULL,
        actual_microusd INTEGER NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        incurred_at TEXT NOT NULL,
        integrity_hash TEXT NOT NULL,
        body BLOB NOT NULL
      );
      CREATE INDEX cost_records_mission_idx ON cost_records (mission_id, incurred_at);
    `,
  },
  {
    version: 5,
    sql: `
      CREATE UNIQUE INDEX assignments_one_per_task_idx
      ON assignments (mission_id, mission_task_id);
    `,
  },
  {
    version: 6,
    sql: `
      CREATE TABLE connector_cursors (
        id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        partition_key TEXT NOT NULL,
        cursor_version INTEGER NOT NULL,
        epoch INTEGER NOT NULL,
        sequence INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        integrity_hash TEXT NOT NULL,
        body BLOB NOT NULL,
        UNIQUE (connector_id, capability, partition_key)
      );
      CREATE INDEX connector_cursors_lookup_idx
      ON connector_cursors (connector_id, capability, partition_key);

      CREATE TABLE connector_leases (
        id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        lease_token TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        lease_version INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        integrity_hash TEXT NOT NULL,
        body BLOB NOT NULL,
        UNIQUE (connector_id, capability)
      );
      CREATE INDEX connector_leases_expiry_idx ON connector_leases (expires_at);

      CREATE TABLE external_identities (
        id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL,
        namespace TEXT NOT NULL,
        external_id TEXT NOT NULL,
        entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
        status TEXT NOT NULL,
        last_observed_at TEXT NOT NULL,
        integrity_hash TEXT NOT NULL,
        body BLOB NOT NULL,
        UNIQUE (connector_id, namespace, external_id)
      );
      CREATE INDEX external_identities_entity_idx ON external_identities (entity_id, status);

      CREATE TABLE capture_failures (
        id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        status TEXT NOT NULL,
        route TEXT NOT NULL,
        risk TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        integrity_hash TEXT NOT NULL,
        body BLOB NOT NULL
      );
      CREATE INDEX capture_failures_connector_idx
      ON capture_failures (connector_id, capability, occurred_at);

      CREATE TABLE change_log (
        id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        connector_id TEXT,
        record_type TEXT NOT NULL,
        record_id TEXT NOT NULL,
        event_id TEXT,
        changed_at TEXT NOT NULL,
        integrity_hash TEXT NOT NULL,
        body BLOB NOT NULL
      );
      CREATE INDEX change_log_sequence_idx ON change_log (sequence);
    `,
  },
];

export class JerichoStore {
  readonly #database: DatabaseSync;
  readonly #masterCrypto: CoreCrypto;
  readonly #crypto: CoreCrypto;
  readonly #storeUuid: string;
  #writeTransactionDepth = 0;

  constructor(options: JerichoStoreOptions = {}) {
    this.#masterCrypto = new CoreCrypto(options.key ?? loadMasterKey());
    const databasePath = options.path ?? join(homedir(), '.jericho', 'jericho.db');
    if (databasePath !== ':memory:') {
      mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
    }

    this.#database = new DatabaseSync(databasePath);
    this.#database.exec('PRAGMA busy_timeout = 5000');
    if (databasePath !== ':memory:') {
      chmodSync(databasePath, 0o600);
    }
    this.#database.exec('PRAGMA foreign_keys = ON');
    if (databasePath !== ':memory:') {
      withBusyRetry(() => this.#database.exec('PRAGMA journal_mode = WAL'));
    }
    try {
      this.#storeUuid = this.#migrate();
      this.#crypto = this.#masterCrypto.deriveScoped(
        `jericho-store:${this.#storeUuid}`,
      );
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  appendEvent(event: EventEnvelope): AppendEventResult {
    assertEventEnvelope(event);
    const normalized = normalizeEvent(event);
    assertEventEnvelope(normalized);
    return this.#writeTransaction(() => this.#appendEventRecord(normalized));
  }

  commitLocalCapture(event: EventEnvelope): CommitLocalCaptureResult {
    const authorityFields = ['status', 'route', 'risk', 'confidence', 'integrityHash'] as const;
    if (authorityFields.some((field) => Object.hasOwn(event, field))) {
      throw new TypeError('Local capture events cannot supply lifecycle or authority fields');
    }
    if (
      !event.source.startsWith('local:') ||
      !event.type.startsWith('local.capture.') ||
      ![SourceType.User, SourceType.Sensor, SourceType.Import].includes(event.sourceType)
    ) {
      throw new TypeError('Local capture event source is invalid');
    }
    assertEventEnvelope(event);
    const normalized = normalizeEvent(event);
    return this.#writeTransaction(() => {
      const result = this.#appendEventRecord(normalized);
      if (!result.inserted) return result;
      const change = this.#appendChangeLog({
        kind: ChangeLogKind.EventCaptured,
        connectorId: 'local',
        recordType: 'event',
        recordId: result.event.id,
        eventId: result.event.id,
        changedAt: result.event.ingestedAt,
        payload: { eventType: result.event.type },
      });
      return { ...result, change };
    });
  }

  getEvent(id: string): EventEnvelope | undefined {
    const row = this.#database
      .prepare('SELECT * FROM events WHERE id = ?')
      .get(id);
    if (!row) {
      return undefined;
    }
    return this.#readRecord<EventEnvelope>(
      'events',
      String(row.id),
      row,
      (value) => assertEventEnvelope(value),
      (value) => value.id,
    );
  }

  listEvents(options: EventListOptions = {}): EventEnvelope[] {
    const limit = options.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
      throw new TypeError('Event list limit is invalid');
    }
    const rows = options.source
      ? this.#database.prepare(`
          SELECT * FROM events WHERE source = ?
          ORDER BY occurred_at DESC, id ASC LIMIT ?
        `).all(options.source, limit)
      : this.#database.prepare(`
          SELECT * FROM events ORDER BY occurred_at DESC, id ASC LIMIT ?
        `).all(limit);
    return rows.map((row) => this.#readRecord<EventEnvelope>(
      'events', String(row.id), row,
      (value) => assertEventEnvelope(value), (value) => value.id,
    ));
  }

  getConnectorCursor(
    connectorId: string,
    capability: ConnectorCapability,
    partition: string,
  ): VersionedCursor | undefined {
    const row = this.#database.prepare(`
      SELECT * FROM connector_cursors
      WHERE connector_id = ? AND capability = ? AND partition_key = ?
    `).get(connectorId, capability, partition);
    return row ? this.#readRecord<VersionedCursor>(
      'connector_cursors',
      String(row.id),
      row,
      (value) => assertVersionedCursor(value),
      (value) => cursorRecordId(value.connectorId, value.capability, value.partition),
    ) : undefined;
  }

  commitCaptureBatch(input: CommitCaptureBatchInput): CommitCaptureBatchResult {
    if (!Number.isInteger(input.expectedCursorVersion) || input.expectedCursorVersion < 0) {
      throw new TypeError('Expected cursor version must be a non-negative integer');
    }
    assertVersionedCursor(input.nextCursor);
    input.captures.forEach(assertNormalizedCapture);
    (input.failures ?? []).forEach(assertCaptureFailure);
    const committedAt = normalizeTimestamp(input.committedAt);
    if (
      input.nextCursor.connectorId !== input.connectorId ||
      input.nextCursor.capability !== input.capability ||
      input.nextCursor.partition !== input.partition ||
      input.nextCursor.version !== input.expectedCursorVersion + 1
    ) {
      throw new CursorConflictError(input.connectorId, input.partition);
    }

    return this.#writeTransaction(() => {
      this.#requireConnectorLease(
        input.connectorId,
        input.capability,
        input.leaseToken,
        committedAt,
      );
      const current = this.getConnectorCursor(
        input.connectorId,
        input.capability,
        input.partition,
      );
      if ((current?.version ?? 0) !== input.expectedCursorVersion) {
        throw new CursorConflictError(input.connectorId, input.partition);
      }

      const events: AppendEventResult[] = [];
      const identityLinks: ExternalIdentityLink[] = [];
      const reviewCandidates: ExternalIdentityReviewCandidate[] = [];
      const failures: CaptureFailure[] = [];
      const changes: ChangeLog[] = [];

      for (const capture of input.captures) {
        const eventResult = this.#appendEventRecord(normalizeEvent(capture.event));
        events.push(eventResult);
        if (eventResult.inserted) {
          changes.push(this.#appendChangeLog({
            kind: ChangeLogKind.EventCaptured,
            connectorId: input.connectorId,
            recordType: 'event',
            recordId: eventResult.event.id,
            eventId: eventResult.event.id,
            changedAt: committedAt,
            payload: { eventType: eventResult.event.type },
          }));
        }

        for (const observation of capture.identities) {
          const resolution = this.#resolveExternalIdentity(
            observation,
            input.connectorId,
            input.capability,
            committedAt,
          );
          identityLinks.push(resolution.link);
          changes.push(this.#appendChangeLog({
            kind: ChangeLogKind.IdentityObserved,
            connectorId: input.connectorId,
            recordType: 'external_identity',
            recordId: resolution.link.id,
            eventId: capture.event.id,
            changedAt: committedAt,
            payload: { entityId: resolution.link.entityId, status: resolution.link.status },
          }));
          if (resolution.reviewCandidate && resolution.failure) {
            reviewCandidates.push(resolution.reviewCandidate);
            failures.push(resolution.failure);
            this.#insertCaptureFailure(resolution.failure);
            changes.push(this.#appendChangeLog({
              kind: ChangeLogKind.IdentityReview,
              connectorId: input.connectorId,
              recordType: 'capture_failure',
              recordId: resolution.failure.id,
              eventId: capture.event.id,
              changedAt: committedAt,
              payload: { reviewCandidateId: resolution.reviewCandidate.id },
            }));
          }
        }

        for (const observation of capture.relations) {
          const relation = this.#resolveExternalRelation(observation, committedAt);
          if (!relation) {
            const failure = this.#identityFailure(
              input.connectorId,
              input.capability,
              CaptureFailureKind.IdentityConflict,
              `Relation ${observation.type} references an unresolved external identity`,
              observation.evidenceEventId,
              committedAt,
            );
            failures.push(failure);
            this.#insertCaptureFailure(failure);
            continue;
          }
          changes.push(this.#appendChangeLog({
            kind: ChangeLogKind.RelationObserved,
            connectorId: input.connectorId,
            recordType: 'relation',
            recordId: relation.id,
            eventId: capture.event.id,
            changedAt: committedAt,
            payload: { relationType: relation.type },
          }));
        }
      }

      for (const failure of input.failures ?? []) {
        if (
          failure.connectorId !== input.connectorId ||
          failure.capability !== input.capability ||
          failure.retryable ||
          (
            failure.kind !== CaptureFailureKind.InvalidPayload &&
            failure.kind !== CaptureFailureKind.ContradictoryHistory
          )
        ) {
          throw new Error('Retryable transport or authorization failures cannot advance a cursor');
        }
        this.#insertCaptureFailure(failure);
        failures.push(failure);
        changes.push(this.#appendChangeLog({
          kind: ChangeLogKind.CaptureFailed,
          connectorId: input.connectorId,
          recordType: 'capture_failure',
          recordId: failure.id,
          changedAt: committedAt,
          payload: { kind: failure.kind, retryable: failure.retryable },
        }));
      }

      const cursor = normalizeCursor(input.nextCursor);
      this.#writeConnectorCursor(cursor);
      changes.push(this.#appendChangeLog({
        kind: ChangeLogKind.CursorAdvanced,
        connectorId: input.connectorId,
        recordType: 'connector_cursor',
        recordId: cursorRecordId(cursor.connectorId, cursor.capability, cursor.partition),
        changedAt: committedAt,
        payload: { version: cursor.version, epoch: cursor.epoch, sequence: cursor.sequence },
      }));
      return { events, identityLinks, reviewCandidates, failures, cursor, changes };
    });
  }

  listExternalIdentityLinks(options: ExternalIdentityListOptions = {}): ExternalIdentityLink[] {
    const clauses: string[] = [];
    const parameters: SQLInputValue[] = [];
    if (options.connectorId) { clauses.push('connector_id = ?'); parameters.push(options.connectorId); }
    if (options.entityId) { clauses.push('entity_id = ?'); parameters.push(options.entityId); }
    if (options.status) { clauses.push('status = ?'); parameters.push(options.status); }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    return this.#database.prepare(`
      SELECT * FROM external_identities${where}
      ORDER BY last_observed_at DESC, id ASC
    `).all(...parameters).map((row) => this.#readRecord<ExternalIdentityLink>(
      'external_identities',
      String(row.id),
      row,
      (value) => assertExternalIdentityLink(value),
      (value) => value.id,
    ));
  }

  establishExternalIdentity(
    id: string,
    entityId: string,
    establishedAt: string,
  ): ExternalIdentityLink {
    return this.#writeTransaction(() => {
      const row = this.#database.prepare('SELECT * FROM external_identities WHERE id = ?').get(id);
      if (!row) throw new Error(`External identity ${id} does not exist`);
      const link = this.#readRecord<ExternalIdentityLink>(
        'external_identities', String(row.id), row,
        (value) => assertExternalIdentityLink(value), (value) => value.id,
      );
      if (link.entityId !== entityId || !this.getEntity(entityId)) {
        throw new Error('Establishing an external identity cannot silently merge entities');
      }
      const established: ExternalIdentityLink = {
        ...link,
        status: ExternalIdentityLinkStatus.Established,
        lastObservedAt: normalizeTimestamp(establishedAt),
      };
      this.#writeExternalIdentity(established);
      return this.listExternalIdentityLinks().find((item) => item.id === id)!;
    });
  }

  listCaptureFailures(connectorId?: string): CaptureFailure[] {
    const rows = connectorId
      ? this.#database.prepare('SELECT * FROM capture_failures WHERE connector_id = ? ORDER BY occurred_at DESC, id ASC').all(connectorId)
      : this.#database.prepare('SELECT * FROM capture_failures ORDER BY occurred_at DESC, id ASC').all();
    return rows.map((row) => this.#readRecord<CaptureFailure>(
      'capture_failures', String(row.id), row,
      (value) => assertCaptureFailure(value), (value) => value.id,
    ));
  }

  recordCaptureFailure(failure: CaptureFailure): CaptureFailure {
    assertCaptureFailure(failure);
    return this.#writeTransaction(() => {
      this.#insertCaptureFailure(failure);
      this.#appendChangeLog({
        kind: ChangeLogKind.CaptureFailed,
        connectorId: failure.connectorId,
        recordType: 'capture_failure',
        recordId: failure.id,
        changedAt: failure.occurredAt,
        payload: { kind: failure.kind, retryable: failure.retryable },
      });
      return this.listCaptureFailures().find((item) => item.id === failure.id)!;
    });
  }

  listChangeLog(options: ChangeLogListOptions = {}): ChangeLog[] {
    const after = options.afterSequence ?? 0;
    const limit = options.limit ?? 1_000;
    if (!Number.isInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 10_000) {
      throw new TypeError('Change log range is invalid');
    }
    return this.#database.prepare(`
      SELECT * FROM change_log WHERE sequence > ? ORDER BY sequence ASC LIMIT ?
    `).all(after, limit).map((row) => this.#readRecord<ChangeLog>(
      'change_log', String(row.id), row,
      (value) => assertChangeLog(value), (value) => value.id,
    ));
  }

  getLatestChangeSequence(): number {
    const row = this.#database.prepare(`
      SELECT * FROM change_log ORDER BY sequence DESC LIMIT 1
    `).get();
    if (!row) return 0;
    return this.#readRecord<ChangeLog>(
      'change_log', String(row.id), row,
      (value) => assertChangeLog(value), (value) => value.id,
    ).sequence;
  }

  acquireConnectorLease(input: AcquireConnectorLeaseInput): ConnectorLease | undefined {
    if (!Number.isInteger(input.leaseMs) || input.leaseMs < 1) throw new TypeError('Connector lease duration is invalid');
    const now = normalizeTimestamp(input.now);
    return this.#writeTransaction(() => {
      const id = connectorLeaseId(input.connectorId, input.capability);
      const row = this.#database.prepare('SELECT * FROM connector_leases WHERE id = ?').get(id);
      const current = row ? this.#readRecord<ConnectorLease>(
        'connector_leases', String(row.id), row,
        (value) => assertConnectorLease(value), (value) => value.id,
      ) : undefined;
      if (current && Date.parse(current.expiresAt) > Date.parse(now)) return undefined;
      const lease: ConnectorLease = {
        id,
        connectorId: input.connectorId,
        capability: input.capability,
        ownerId: input.ownerId,
        leaseToken: randomUUID(),
        expiresAt: new Date(Date.parse(now) + input.leaseMs).toISOString(),
        version: (current?.version ?? 0) + 1,
        updatedAt: now,
      };
      this.#writeConnectorLease(lease);
      return lease;
    });
  }

  renewConnectorLease(id: string, leaseToken: string, now: string, leaseMs: number): ConnectorLease {
    if (!Number.isInteger(leaseMs) || leaseMs < 1) throw new TypeError('Connector lease duration is invalid');
    return this.#writeTransaction(() => {
      const at = normalizeTimestamp(now);
      const row = this.#database.prepare('SELECT * FROM connector_leases WHERE id = ?').get(id);
      if (!row) throw new ConnectorLeaseError(id);
      const current = this.#readRecord<ConnectorLease>(
        'connector_leases', String(row.id), row,
        (value) => assertConnectorLease(value), (value) => value.id,
      );
      if (current.leaseToken !== leaseToken || Date.parse(current.expiresAt) <= Date.parse(at)) {
        throw new ConnectorLeaseError(id);
      }
      const renewed: ConnectorLease = {
        ...current,
        expiresAt: new Date(Date.parse(at) + leaseMs).toISOString(),
        version: current.version + 1,
        updatedAt: at,
      };
      this.#writeConnectorLease(renewed);
      return renewed;
    });
  }

  releaseConnectorLease(id: string, leaseToken: string): boolean {
    return this.#writeTransaction(() => {
      const row = this.#database.prepare('SELECT * FROM connector_leases WHERE id = ?').get(id);
      if (!row) return false;
      const current = this.#readRecord<ConnectorLease>(
        'connector_leases', String(row.id), row,
        (value) => assertConnectorLease(value), (value) => value.id,
      );
      if (current.leaseToken !== leaseToken) throw new ConnectorLeaseError(id);
      this.#database.prepare('DELETE FROM connector_leases WHERE id = ?').run(id);
      return true;
    });
  }

  upsertEntity(entity: Entity): Entity {
    assertEntity(entity);
    const incoming = normalizeEntity(entity);
    return this.#writeTransaction(() => {
      const current = this.getEntity(incoming.id);
      const incomingIsNewer =
        !current ||
        timestampEpoch(incoming.freshness.observedAt) >
          timestampEpoch(current.freshness.observedAt);
      const confidence = maximumDefined(current?.confidence, incoming.confidence);
      const reconciled: Entity = current
        ? {
            ...current,
            ...(incomingIsNewer
              ? {
                  type: incoming.type,
                  canonicalName: incoming.canonicalName,
                  freshness: incoming.freshness,
                  ...('status' in incoming ? { status: incoming.status } : {}),
                  ...('risk' in incoming ? { risk: incoming.risk } : {}),
                }
              : {}),
            aliases: uniqueStrings([...current.aliases, ...incoming.aliases]),
            attributes: incomingIsNewer
              ? { ...current.attributes, ...incoming.attributes }
              : { ...incoming.attributes, ...current.attributes },
            ...(confidence !== undefined ? { confidence } : {}),
            provenance: mergeProvenance(current.provenance, incoming.provenance),
            createdAt: earlierTimestamp(current.createdAt, incoming.createdAt),
            updatedAt: laterTimestamp(current.updatedAt, incoming.updatedAt),
          }
        : { ...incoming };
      assertEntity(reconciled);
      const sealed = this.#sealRecord('entities', reconciled.id, reconciled);
      const stored = sealed.record;

      this.#database
        .prepare(`
          INSERT INTO entities (
            id, entity_type, status, risk, confidence, freshness_at,
            created_at, updated_at, integrity_hash, body
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET
            entity_type = excluded.entity_type,
            status = excluded.status,
            risk = excluded.risk,
            confidence = excluded.confidence,
            freshness_at = excluded.freshness_at,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            integrity_hash = excluded.integrity_hash,
            body = excluded.body
        `)
        .run(
          stored.id,
          stored.type,
          stored.status ?? null,
          stored.risk ?? null,
          stored.confidence ?? null,
          stored.freshness.observedAt,
          stored.createdAt,
          stored.updatedAt,
          sealed.integrityHash,
          sealed.body,
        );
      return stored;
    });
  }

  getEntity(id: string): Entity | undefined {
    const row = this.#database
      .prepare('SELECT * FROM entities WHERE id = ?')
      .get(id);
    if (!row) {
      return undefined;
    }
    return this.#readRecord<Entity>(
      'entities',
      String(row.id),
      row,
      (value) => assertEntity(value),
      (value) => value.id,
    );
  }

  listEntities(options: EntityListOptions = {}): Entity[] {
    const clauses: string[] = [];
    const parameters: SQLInputValue[] = [];
    if (options.type) {
      clauses.push('entity_type = ?');
      parameters.push(options.type);
    }
    if (options.status) {
      clauses.push('status = ?');
      parameters.push(options.status);
    }
    if (options.freshAfter) {
      clauses.push('freshness_at >= ?');
      parameters.push(normalizeTimestamp(options.freshAfter));
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    return this.#database
      .prepare(
        `SELECT * FROM entities${where} ORDER BY updated_at DESC, id ASC`,
      )
      .all(...parameters)
      .map((row) =>
        this.#readRecord<Entity>(
          'entities',
          String(row.id),
          row,
          (value) => assertEntity(value),
          (value) => value.id,
        ),
      );
  }

  upsertRelation(relation: Relation): Relation {
    assertRelation(relation);
    const incoming = normalizeRelation(relation);
    return this.#writeTransaction(() => {
      const row = this.#database
        .prepare(`
          SELECT * FROM relations
          WHERE from_entity_id = ? AND to_entity_id = ? AND relation_type = ?
        `)
        .get(incoming.fromEntityId, incoming.toEntityId, incoming.type);
      const current = row
        ? this.#readRecord<Relation>(
            'relations',
            String(row.id),
            row,
            (value) => assertRelation(value),
            (value) => value.id,
          )
        : undefined;
      const incomingIsNewer =
        !current ||
        timestampEpoch(incoming.freshness.observedAt) >
          timestampEpoch(current.freshness.observedAt);
      const confidence = maximumDefined(current?.confidence, incoming.confidence);
      const reconciled: Relation = current
        ? {
            ...current,
            ...(incomingIsNewer
              ? {
                  freshness: incoming.freshness,
                  ...('status' in incoming ? { status: incoming.status } : {}),
                  ...('risk' in incoming ? { risk: incoming.risk } : {}),
                }
              : {}),
            attributes: incomingIsNewer
              ? { ...current.attributes, ...incoming.attributes }
              : { ...incoming.attributes, ...current.attributes },
            ...(confidence !== undefined ? { confidence } : {}),
            provenance: mergeProvenance(current.provenance, incoming.provenance),
            createdAt: earlierTimestamp(current.createdAt, incoming.createdAt),
            updatedAt: laterTimestamp(current.updatedAt, incoming.updatedAt),
          }
        : { ...incoming };
      assertRelation(reconciled);
      const sealed = this.#sealRecord('relations', reconciled.id, reconciled);
      const stored = sealed.record;

      this.#database
        .prepare(`
          INSERT INTO relations (
            id, from_entity_id, to_entity_id, relation_type, status, risk,
            confidence, freshness_at, created_at, updated_at, integrity_hash, body
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET
            from_entity_id = excluded.from_entity_id,
            to_entity_id = excluded.to_entity_id,
            relation_type = excluded.relation_type,
            status = excluded.status,
            risk = excluded.risk,
            confidence = excluded.confidence,
            freshness_at = excluded.freshness_at,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            integrity_hash = excluded.integrity_hash,
            body = excluded.body
        `)
        .run(
          stored.id,
          stored.fromEntityId,
          stored.toEntityId,
          stored.type,
          stored.status ?? null,
          stored.risk ?? null,
          stored.confidence ?? null,
          stored.freshness.observedAt,
          stored.createdAt,
          stored.updatedAt,
          sealed.integrityHash,
          sealed.body,
        );
      return stored;
    });
  }

  listRelations(options: RelationListOptions = {}): Relation[] {
    const clauses: string[] = [];
    const parameters: SQLInputValue[] = [];
    if (options.fromEntityId) {
      clauses.push('from_entity_id = ?');
      parameters.push(options.fromEntityId);
    }
    if (options.toEntityId) {
      clauses.push('to_entity_id = ?');
      parameters.push(options.toEntityId);
    }
    if (options.type) {
      clauses.push('relation_type = ?');
      parameters.push(options.type);
    }
    if (options.status) {
      clauses.push('status = ?');
      parameters.push(options.status);
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    return this.#database
      .prepare(
        `SELECT * FROM relations${where} ORDER BY updated_at DESC, id ASC`,
      )
      .all(...parameters)
      .map((item) =>
        this.#readRecord<Relation>(
          'relations',
          String(item.id),
          item,
          (value) => assertRelation(value),
          (value) => value.id,
        ),
      );
  }

  saveIntent(intent: IntentEnvelope): IntentEnvelope {
    assertIntentEnvelope(intent);
    const normalized = normalizeIntent(intent);
    assertIntentEnvelope(normalized);
    return this.#writeTransaction(() => this.#insertIntentRecord(normalized));
  }

  getIntent(id: string): IntentEnvelope | undefined {
    const row = this.#database.prepare('SELECT * FROM intents WHERE id = ?').get(id);
    return row ? this.#readRecord<IntentEnvelope>(
      'intents', String(row.id), row, (value) => assertIntentEnvelope(value), (value) => value.id,
    ) : undefined;
  }

  listIntents(options: IntentListOptions = {}): IntentEnvelope[] {
    const clauses: string[] = [];
    const parameters: SQLInputValue[] = [];
    if (options.status) { clauses.push('status = ?'); parameters.push(options.status); }
    if (options.route) { clauses.push('route = ?'); parameters.push(options.route); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    return this.#database.prepare(`SELECT * FROM intents${where} ORDER BY created_at DESC, id ASC`)
      .all(...parameters)
      .map((row) => this.#readRecord<IntentEnvelope>(
        'intents', String(row.id), row, (value) => assertIntentEnvelope(value), (value) => value.id,
      ));
  }

  resolveReviewIntent(input: ReviewIntentResolutionInput): ReviewIntentResolution {
    return this.#writeTransaction(() => {
      const original = this.getIntent(input.intentId);
      if (!original) throw new ReviewIntentDecisionConflictError(input.intentId, 'does not exist');
      if (
        original.route !== 'review' ||
        original.status !== LifecycleStatus.PendingApproval
      ) {
        throw new ReviewIntentDecisionConflictError(input.intentId, 'is not pending Review');
      }
      if (!original.integrityHash || original.integrityHash !== input.intentHash) {
        throw new ReviewIntentDecisionConflictError(input.intentId, 'hash does not match');
      }
      if (this.listDecisions().some((decision) => decision.intentId === input.intentId)) {
        throw new ReviewIntentDecisionConflictError(input.intentId, 'was already disposed');
      }
      if (
        input.decision.intentId !== undefined && input.decision.intentId !== input.intentId ||
        input.decision.intentHash !== undefined && input.decision.intentHash !== input.intentHash
      ) {
        throw new ReviewIntentDecisionConflictError(input.intentId, 'binding does not match');
      }
      if (
        input.derivedIntent &&
        (
          input.derivedIntent.route !== 'project' ||
          input.derivedIntent.status !== LifecycleStatus.Active ||
          input.decision.outcome !== DecisionOutcome.Superseded
        )
      ) {
        throw new ReviewIntentDecisionConflictError(input.intentId, 'reclassification is invalid');
      }
      if (
        Boolean(input.derivedIntent) !== Boolean(input.derivedMission) ||
        input.derivedMission && input.derivedIntent &&
        input.derivedMission.intentId !== input.derivedIntent.id
      ) {
        throw new ReviewIntentDecisionConflictError(input.intentId, 'derived plan binding is invalid');
      }
      if (!input.derivedIntent && input.decision.outcome !== DecisionOutcome.Rejected) {
        throw new ReviewIntentDecisionConflictError(input.intentId, 'dismissal is invalid');
      }
      const decision = this.#insertDecision(normalizeDecision({
        ...input.decision,
        intentId: input.intentId,
        intentHash: input.intentHash,
      }));
      const derivedIntent = input.derivedIntent
        ? this.#insertIntentRecord(normalizeIntent(input.derivedIntent))
        : undefined;
      const mission = input.derivedMission
        ? this.createMissionPlan(input.derivedMission)
        : undefined;
      return {
        originalIntent: original,
        decision,
        ...(derivedIntent ? { derivedIntent } : {}),
        ...(mission ? { mission } : {}),
      };
    });
  }

  registerAgentCapability(capability: AgentCapability): AgentCapability {
    assertAgentCapability(capability);
    const normalized = normalizeCapability(capability);
    return this.#writeTransaction(() => {
      const existing = this.getAgentCapability(normalized.id);
      if (existing) {
        if (this.#integrityHashFor(existing) === this.#integrityHashFor(normalized)) return existing;
        throw new Error(`Capability ${normalized.id} conflicts with the registered version`);
      }
      const sealed = this.#sealRecord('agent_capabilities', normalized.id, normalized);
      const stored = sealed.record;
      this.#database.prepare(`
        INSERT INTO agent_capabilities (
          id, agent_id, status, route, risk, confidence, freshness_at,
          created_at, updated_at, integrity_hash, body, lane
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        stored.id, stored.agentId, stored.status, canonicalJson(stored.routes),
        stored.maximumRisk, stored.confidence ?? null, stored.lastVerifiedAt ?? null,
        stored.createdAt, stored.updatedAt, sealed.integrityHash, sealed.body, stored.lane,
      );
      return stored;
    });
  }

  getAgentCapability(id: string): AgentCapability | undefined {
    const row = this.#database.prepare('SELECT * FROM agent_capabilities WHERE id = ?').get(id);
    return row ? this.#readRecord<AgentCapability>(
      'agent_capabilities', String(row.id), row, (value) => assertAgentCapability(value), (value) => value.id,
    ) : undefined;
  }

  listAgentCapabilities(options: CapabilityListOptions = {}): AgentCapability[] {
    const clauses: string[] = [];
    const parameters: SQLInputValue[] = [];
    if (options.agentId) { clauses.push('agent_id = ?'); parameters.push(options.agentId); }
    if (options.lane) { clauses.push('lane = ?'); parameters.push(options.lane); }
    if (options.status) { clauses.push('status = ?'); parameters.push(options.status); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    return this.#database.prepare(`SELECT * FROM agent_capabilities${where} ORDER BY updated_at DESC, id ASC`)
      .all(...parameters)
      .map((row) => this.#readRecord<AgentCapability>(
        'agent_capabilities', String(row.id), row, (value) => assertAgentCapability(value), (value) => value.id,
      ));
  }

  createMissionPlan(plan: MissionPlan): MissionPlan {
    assertMissionPlan(plan);
    const normalized = normalizeMission(plan);
    assertMissionPlan(normalized);
    if (
      normalized.status !== LifecycleStatus.PendingApproval ||
      normalized.approvalDecisionId !== undefined ||
      normalized.approvedAt !== undefined ||
      normalized.startedAt !== undefined ||
      normalized.completedAt !== undefined ||
      normalized.cancelRequestedAt !== undefined
    ) {
      throw new Error(
        `Mission ${normalized.id} creation requires pending approval with no lifecycle metadata`,
      );
    }
    if (computeMissionPlanHash(normalized) !== normalized.planHash) {
      throw new MissionPlanConflictError(normalized.id);
    }
    return this.#writeTransaction(() => {
      const existing = this.getMission(normalized.id);
      if (existing) {
        if (existing.planHash === normalized.planHash) return existing;
        throw new MissionPlanConflictError(normalized.id);
      }
      if (!this.getIntent(normalized.intentId)) {
        throw new Error(`Mission intent ${normalized.intentId} does not exist`);
      }
      validateMissionPlanInput(
        normalized as MissionPlan & MissionPlanInput,
        new CapabilityRegistry(this.listAgentCapabilities()),
      );
      if (normalized.version === 1 && normalized.supersedesPlanId) {
        throw new MissionPlanConflictError(normalized.id);
      }
      if (normalized.version > 1) {
        const previous = normalized.supersedesPlanId
          ? this.getMission(normalized.supersedesPlanId)
          : undefined;
        if (
          !previous ||
          previous.seriesId !== normalized.seriesId ||
          previous.version !== normalized.version - 1
        ) {
          throw new MissionPlanConflictError(normalized.id);
        }
      }
      const versionRow = this.#database.prepare(
        'SELECT id FROM missions WHERE series_id = ? AND plan_version = ?',
      ).get(normalized.seriesId, normalized.version);
      if (versionRow) throw new MissionPlanConflictError(normalized.id);

      const sealed = this.#sealRecord('missions', normalized.id, normalized);
      const stored = sealed.record;
      this.#database.prepare(`
        INSERT INTO missions (
          id, intent_id, status, route, risk, confidence, freshness_at,
          created_at, updated_at, integrity_hash, body, series_id, plan_version,
          plan_hash, approval_decision_id, approved_at, started_at, completed_at,
          cancel_requested_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        stored.id, stored.intentId, stored.status, stored.route, stored.risk,
        stored.confidence ?? null, stored.freshness?.observedAt ?? null,
        stored.createdAt, stored.updatedAt, sealed.integrityHash, sealed.body,
        stored.seriesId, stored.version, stored.planHash,
        stored.approvalDecisionId ?? null, stored.approvedAt ?? null,
        stored.startedAt ?? null, stored.completedAt ?? null,
        stored.cancelRequestedAt ?? null,
      );

      for (const definition of stored.taskGraph) {
        const task: MissionTask = {
          ...structuredClone(definition),
          missionId: stored.id,
          status: LifecycleStatus.Queued,
          requiredCapabilities: [...definition.capabilityIds],
          provenance: structuredClone(stored.provenance),
          createdAt: stored.createdAt,
          updatedAt: stored.createdAt,
        };
        this.#insertMissionTask(task);
      }
      for (const definition of stored.taskGraph) {
        for (const dependency of definition.dependsOn) {
          this.#database.prepare(`
            INSERT INTO mission_task_dependencies (mission_id, task_id, depends_on_task_id)
            VALUES (?, ?, ?)
          `).run(stored.id, definition.id, dependency);
        }
      }
      return stored;
    });
  }

  getMission(id: string): MissionPlan | undefined {
    const row = this.#database.prepare('SELECT * FROM missions WHERE id = ?').get(id);
    return row ? this.#readRecord<MissionPlan>(
      'missions', String(row.id), row, (value) => assertMissionPlan(value), (value) => value.id,
    ) : undefined;
  }

  listMissions(options: MissionListOptions = {}): MissionPlan[] {
    const clauses: string[] = [];
    const parameters: SQLInputValue[] = [];
    if (options.status) { clauses.push('status = ?'); parameters.push(options.status); }
    if (options.seriesId) { clauses.push('series_id = ?'); parameters.push(options.seriesId); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    return this.#database.prepare(`SELECT * FROM missions${where} ORDER BY plan_version DESC, created_at DESC, id ASC`)
      .all(...parameters)
      .map((row) => this.#readRecord<MissionPlan>(
        'missions', String(row.id), row, (value) => assertMissionPlan(value), (value) => value.id,
      ));
  }

  getMissionTask(id: string): MissionTask | undefined {
    const row = this.#database.prepare('SELECT * FROM mission_tasks WHERE id = ?').get(id);
    return row ? this.#readRecord<MissionTask>(
      'mission_tasks', String(row.id), row, (value) => assertMissionTask(value), (value) => value.id,
    ) : undefined;
  }

  listMissionTasks(missionId: string): MissionTask[] {
    return this.#database.prepare(
      'SELECT * FROM mission_tasks WHERE mission_id = ? ORDER BY sequence ASC, id ASC',
    ).all(missionId).map((row) => this.#readRecord<MissionTask>(
      'mission_tasks', String(row.id), row, (value) => assertMissionTask(value), (value) => value.id,
    ));
  }

  approveMission(
    missionId: string,
    expectedPlanHash: string,
    decision: DecisionRecord,
  ): MissionPlan {
    const mission = this.getMission(missionId);
    if (!mission) throw new Error(`Mission ${missionId} does not exist`);
    if (decision.outcome !== DecisionOutcome.Approved) {
      throw new Error('Mission approval requires an approved decision');
    }
    return this.decideMission(
      missionId,
      expectedPlanHash,
      mission.version,
      decision,
    );
  }

  decideMission(
    missionId: string,
    expectedPlanHash: string,
    expectedPlanVersion: number,
    decision: DecisionRecord,
  ): MissionPlan {
    if (!Number.isInteger(expectedPlanVersion) || expectedPlanVersion < 1) {
      throw new TypeError('Mission decision plan version is invalid');
    }
    return this.#writeTransaction(() => {
      const mission = this.getMission(missionId);
      if (!mission) throw new Error(`Mission ${missionId} does not exist`);
      if (mission.version !== expectedPlanVersion) {
        throw new MissionDecisionConflictError(missionId, 'version does not match');
      }
      if (mission.planHash !== expectedPlanHash || computeMissionPlanHash(mission) !== expectedPlanHash) {
        throw new MissionDecisionConflictError(missionId, 'hash does not match');
      }
      if (mission.status !== LifecycleStatus.PendingApproval) {
        throw new MissionDecisionConflictError(missionId, 'requires a pending plan');
      }
      if (
        decision.outcome !== DecisionOutcome.Approved &&
        decision.outcome !== DecisionOutcome.Rejected
      ) {
        throw new MissionDecisionConflictError(missionId, 'must approve or reject the pending plan');
      }
      if (
        (decision.missionId !== undefined && decision.missionId !== missionId) ||
        (decision.planHash !== undefined && decision.planHash !== expectedPlanHash) ||
        (decision.planVersion !== undefined && decision.planVersion !== expectedPlanVersion)
      ) {
        throw new MissionDecisionConflictError(missionId, 'binding does not match');
      }
      const boundDecision = normalizeDecision({
        ...decision,
        missionId,
        planHash: expectedPlanHash,
        planVersion: expectedPlanVersion,
      });
      this.#insertDecision(boundDecision);
      const decided: MissionPlan = {
        ...mission,
        status: decision.outcome === DecisionOutcome.Approved
          ? LifecycleStatus.Approved
          : LifecycleStatus.Rejected,
        ...(decision.outcome === DecisionOutcome.Approved ? {
          approvalDecisionId: boundDecision.id,
          approvedAt: boundDecision.decidedAt,
        } : {}),
        updatedAt: boundDecision.decidedAt,
      };
      this.#writeMissionRecord(decided);
      return this.getMission(missionId)!;
    });
  }

  saveProposal(proposal: Proposal): Proposal {
    assertProposal(proposal);
    const normalized = normalizeProposal(proposal);
    if (normalized.status !== LifecycleStatus.PendingApproval) {
      throw new Error(`Proposal ${normalized.id} initial lifecycle must be pending approval`);
    }
    return this.#writeTransaction(() => this.#insertProposalRecord(normalized));
  }

  getProposal(id: string): Proposal | undefined {
    const row = this.#database.prepare('SELECT * FROM proposals WHERE id = ?').get(id);
    return row ? this.#readRecord<Proposal>(
      'proposals', String(row.id), row, (value) => assertProposal(value), (value) => value.id,
    ) : undefined;
  }

  listProposals(status?: LifecycleStatus): Proposal[] {
    const rows = status
      ? this.#database.prepare('SELECT * FROM proposals WHERE status = ? ORDER BY created_at DESC, id ASC').all(status)
      : this.#database.prepare('SELECT * FROM proposals ORDER BY created_at DESC, id ASC').all();
    return rows.map((row) => this.#readRecord<Proposal>(
      'proposals', String(row.id), row, (value) => assertProposal(value), (value) => value.id,
    ));
  }

  transitionProposal(
    id: string,
    expectedStatus: LifecycleStatus,
    nextStatus: LifecycleStatus,
    decision: DecisionRecord,
  ): Proposal {
    return this.#writeTransaction(() => {
      const proposal = this.getProposal(id);
      if (!proposal) throw new Error(`Proposal ${id} does not exist`);
      assertLifecycleTransition('proposal', proposal.status, expectedStatus, nextStatus);
      assertDecisionMatchesStatus(decision, nextStatus);
      const boundDecision = normalizeDecision({ ...decision, proposalId: id });
      this.#insertDecision(boundDecision);
      this.#writeProposalRecord({ ...proposal, status: nextStatus });
      return this.getProposal(id)!;
    });
  }

  resolveCheckpoint(input: CheckpointResolutionInput): CheckpointResolution {
    return this.#writeTransaction(() => {
      const proposal = this.getProposal(input.proposalId);
      if (!proposal || !isCheckpointProposal(proposal)) {
        throw new CheckpointDecisionConflictError(input.proposalId, 'does not exist');
      }
      if (proposal.status !== LifecycleStatus.PendingApproval) {
        throw new CheckpointDecisionConflictError(input.proposalId, 'is not pending');
      }
      const missionId = String(proposal.body.missionId);
      const assignmentId = String(proposal.body.assignmentId);
      const mission = this.getMission(missionId);
      const assignment = this.getAssignment(assignmentId);
      const task = assignment ? this.getMissionTask(assignment.missionTaskId) : undefined;
      if (!mission || !assignment || !task) {
        throw new CheckpointDecisionConflictError(input.proposalId, 'context is missing');
      }
      if (
        input.planVersion !== mission.version ||
        input.planHash !== mission.planHash ||
        computeMissionPlanHash(mission) !== input.planHash ||
        proposal.body.planHash !== input.planHash ||
        proposal.body.planVersion !== input.planVersion
      ) {
        throw new CheckpointDecisionConflictError(input.proposalId, 'plan binding does not match');
      }
      if (
        assignment.id !== proposal.assignmentId ||
        assignment.missionId !== mission.id ||
        assignment.status !== LifecycleStatus.Paused ||
        task.status !== LifecycleStatus.Paused
      ) {
        throw new CheckpointDecisionConflictError(input.proposalId, 'paused assignment binding does not match');
      }
      if (
        input.decision.proposalId !== undefined && input.decision.proposalId !== proposal.id ||
        input.decision.missionId !== undefined && input.decision.missionId !== mission.id ||
        input.decision.planHash !== undefined && input.decision.planHash !== input.planHash ||
        input.decision.planVersion !== undefined && input.decision.planVersion !== input.planVersion
      ) {
        throw new CheckpointDecisionConflictError(input.proposalId, 'decision binding does not match');
      }
      const requiresNewPlan = proposal.body.requiresNewPlan === true;
      const resumable = proposal.body.resumable === true && !requiresNewPlan;
      if (input.resume) {
        if (input.decision.outcome !== DecisionOutcome.Approved || !resumable) {
          throw new CheckpointDecisionConflictError(input.proposalId, 'requires a new immutable plan');
        }
        const reasons = Array.isArray(proposal.body.reasons) ? proposal.body.reasons : [];
        if (!reasons.length || reasons.some((reason) => reason !== 'concurrency_budget')) {
          throw new CheckpointDecisionConflictError(input.proposalId, 'cannot resume within the original plan');
        }
        const active = this.listAssignments({ missionId: mission.id, status: LifecycleStatus.Active });
        if (active.length >= mission.budget.maxConcurrency) {
          throw new CheckpointDecisionConflictError(input.proposalId, 'concurrency is still exhausted');
        }
      } else if (input.decision.outcome !== DecisionOutcome.Rejected) {
        throw new CheckpointDecisionConflictError(input.proposalId, 'approval must resume exact scope');
      }
      const decision = this.#insertDecision(normalizeDecision({
        ...input.decision,
        proposalId: proposal.id,
        missionId: mission.id,
        missionTaskId: assignment.missionTaskId,
        planHash: input.planHash,
        planVersion: input.planVersion,
      }));
      this.#writeProposalRecord({
        ...proposal,
        status: input.resume ? LifecycleStatus.Approved : LifecycleStatus.Rejected,
      });
      if (input.resume) {
        this.#writeAssignmentRecord({
          ...assignment,
          status: LifecycleStatus.Queued,
          availableAt: decision.decidedAt,
          instructions: withoutCheckpointReasons(assignment.instructions),
        });
        this.#writeMissionTaskRecord({
          ...task,
          status: LifecycleStatus.Queued,
          updatedAt: decision.decidedAt,
        });
        this.#writeMissionRecord({
          ...mission,
          status: LifecycleStatus.Active,
          updatedAt: decision.decidedAt,
        });
      } else {
        this.requestMissionCancellation(
          mission.id,
          decision.rationale,
          decision.decidedAt,
        );
      }
      return {
        proposal: this.getProposal(proposal.id)!,
        decision,
        assignment: this.getAssignment(assignment.id)!,
        mission: this.getMission(mission.id)!,
        resumed: input.resume,
        requiresNewPlan,
      };
    });
  }

  appendDecision(decision: DecisionRecord): DecisionRecord {
    assertDecisionRecord(decision);
    return this.#writeTransaction(() => this.#insertDecision(normalizeDecision(decision)));
  }

  getDecision(id: string): DecisionRecord | undefined {
    const row = this.#database.prepare('SELECT * FROM decisions WHERE id = ?').get(id);
    return row ? this.#readRecord<DecisionRecord>(
      'decisions', String(row.id), row, (value) => assertDecisionRecord(value), (value) => value.id,
    ) : undefined;
  }

  listDecisions(missionId?: string): DecisionRecord[] {
    const rows = missionId
      ? this.#database.prepare('SELECT * FROM decisions WHERE mission_id = ? ORDER BY decided_at DESC, id ASC').all(missionId)
      : this.#database.prepare('SELECT * FROM decisions ORDER BY decided_at DESC, id ASC').all();
    return rows.map((row) => this.#readRecord<DecisionRecord>(
      'decisions', String(row.id), row, (value) => assertDecisionRecord(value), (value) => value.id,
    ));
  }

  savePreferenceChange(preference: PreferenceChange): PreferenceChange {
    assertPreferenceChange(preference);
    const normalized = normalizePreference(preference);
    if (normalized.status !== LifecycleStatus.PendingApproval) {
      throw new Error(
        `Preference change ${normalized.id} initial lifecycle must be pending approval`,
      );
    }
    return this.#writeTransaction(() => {
      const row = this.#database.prepare('SELECT * FROM preference_changes WHERE id = ?').get(normalized.id);
      if (row) {
        const existing = this.#readRecord<PreferenceChange>(
          'preference_changes', String(row.id), row, (value) => assertPreferenceChange(value), (value) => value.id,
        );
        if (this.#integrityHashFor(existing) === this.#integrityHashFor(normalized)) return existing;
        throw new Error(`Preference change ${normalized.id} conflicts with the stored record`);
      }
      const sealed = this.#sealRecord('preference_changes', normalized.id, normalized);
      const stored = sealed.record;
      this.#database.prepare(`
        INSERT INTO preference_changes (
          id, entity_id, status, route, risk, changed_at, integrity_hash, body
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        stored.id, stored.entityId ?? null, stored.status, stored.route,
        stored.risk, stored.changedAt, sealed.integrityHash, sealed.body,
      );
      return stored;
    });
  }

  getPreferenceChange(id: string): PreferenceChange | undefined {
    const row = this.#database.prepare('SELECT * FROM preference_changes WHERE id = ?').get(id);
    return row ? this.#readRecord<PreferenceChange>(
      'preference_changes', String(row.id), row, (value) => assertPreferenceChange(value), (value) => value.id,
    ) : undefined;
  }

  listPreferenceChanges(status?: LifecycleStatus): PreferenceChange[] {
    const rows = status
      ? this.#database.prepare('SELECT * FROM preference_changes WHERE status = ? ORDER BY changed_at DESC, id ASC').all(status)
      : this.#database.prepare('SELECT * FROM preference_changes ORDER BY changed_at DESC, id ASC').all();
    return rows.map((row) => this.#readRecord<PreferenceChange>(
      'preference_changes', String(row.id), row, (value) => assertPreferenceChange(value), (value) => value.id,
    ));
  }

  transitionPreferenceChange(
    id: string,
    expectedStatus: LifecycleStatus,
    nextStatus: LifecycleStatus,
    decision: DecisionRecord,
  ): PreferenceChange {
    return this.#writeTransaction(() => {
      const preference = this.getPreferenceChange(id);
      if (!preference) throw new Error(`Preference change ${id} does not exist`);
      assertLifecycleTransition(
        'preference',
        preference.status,
        expectedStatus,
        nextStatus,
      );
      assertDecisionMatchesStatus(decision, nextStatus);
      const boundDecision = normalizeDecision({
        ...decision,
        preferenceChangeId: id,
      });
      this.#insertDecision(boundDecision);
      this.#writePreferenceRecord({ ...preference, status: nextStatus });
      return this.getPreferenceChange(id)!;
    });
  }

  reserveReceipt(receipt: ActionReceipt): ActionReceipt {
    assertActionReceipt(receipt);
    const normalized = normalizeReceipt(receipt);
    if (
      normalized.status !== ReceiptStatus.Pending ||
      normalized.verified ||
      normalized.startedAt !== undefined ||
      normalized.completedAt !== undefined ||
      normalized.externalId !== undefined ||
      normalized.result !== undefined ||
      normalized.error !== undefined ||
      normalized.verifiedAt !== undefined
    ) {
      throw new Error('Receipt reservation must be pristine, pending, and unverified');
    }
    return this.#writeTransaction(() => {
      const row = this.#database.prepare('SELECT * FROM receipts WHERE idempotency_key = ?').get(normalized.idempotencyKey);
      if (row) {
        const existing = this.#readRecord<ActionReceipt>(
          'receipts', String(row.id), row, (value) => assertActionReceipt(value), (value) => value.id,
        );
        if (
          existing.action === normalized.action &&
          existing.destination === normalized.destination &&
          existing.connectorId === normalized.connectorId &&
          existing.assignmentId === normalized.assignmentId &&
          existing.missionTaskId === normalized.missionTaskId &&
          existing.proposalId === normalized.proposalId
        ) return existing;
        throw new IdempotencyConflictError(normalized.idempotencyKey);
      }
      const sealed = this.#sealRecord('receipts', normalized.id, normalized);
      const stored = sealed.record;
      this.#database.prepare(`
        INSERT INTO receipts (
          id, proposal_id, assignment_id, mission_task_id, connector_id,
          status, route, risk, requested_at, started_at, completed_at,
          integrity_hash, body, idempotency_key, destination, external_id,
          verified, verified_at, attempt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        stored.id, stored.proposalId ?? null, stored.assignmentId ?? null,
        stored.missionTaskId ?? null, stored.connectorId ?? null, stored.status,
        stored.route, stored.risk, stored.requestedAt, stored.startedAt ?? null,
        stored.completedAt ?? null, sealed.integrityHash, sealed.body,
        stored.idempotencyKey, stored.destination, stored.externalId ?? null,
        stored.verified ? 1 : 0, stored.verifiedAt ?? null, stored.attempt,
      );
      this.#appendChangeLog({
        kind: ChangeLogKind.ReceiptChanged,
        recordType: 'receipt',
        recordId: stored.id,
        changedAt: stored.requestedAt,
        payload: { status: stored.status, verified: stored.verified },
      });
      return stored;
    });
  }

  getReceiptByIdempotencyKey(key: string): ActionReceipt | undefined {
    const row = this.#database.prepare('SELECT * FROM receipts WHERE idempotency_key = ?').get(key);
    return row ? this.#readRecord<ActionReceipt>(
      'receipts', String(row.id), row, (value) => assertActionReceipt(value), (value) => value.id,
    ) : undefined;
  }

  getReceipt(id: string): ActionReceipt | undefined {
    const row = this.#database.prepare('SELECT * FROM receipts WHERE id = ?').get(id);
    return row ? this.#readRecord<ActionReceipt>(
      'receipts', String(row.id), row, (value) => assertActionReceipt(value), (value) => value.id,
    ) : undefined;
  }

  startReceipt(id: string, startedAt: string): ActionReceipt {
    return this.#writeTransaction(() => {
      const receipt = this.getReceipt(id);
      if (!receipt || receipt.status !== ReceiptStatus.Pending || receipt.verified) {
        throw new Error(`Receipt ${id} is not a pending reserved action`);
      }
      if (receipt.startedAt) {
        throw new Error(`Receipt ${id} already started and is uncertain; refusing to resend`);
      }
      const started: ActionReceipt = {
        ...receipt,
        startedAt: normalizeTimestamp(startedAt),
      };
      this.#writeReceiptRecord(started);
      return this.getReceipt(id)!;
    });
  }

  listReceipts(status?: ReceiptStatusType): ActionReceipt[] {
    const rows = status
      ? this.#database.prepare('SELECT * FROM receipts WHERE status = ? ORDER BY requested_at DESC, id ASC').all(status)
      : this.#database.prepare('SELECT * FROM receipts ORDER BY requested_at DESC, id ASC').all();
    return rows.map((row) => this.#readRecord<ActionReceipt>(
      'receipts', String(row.id), row, (value) => assertActionReceipt(value), (value) => value.id,
    ));
  }

  completeReceipt(id: string, input: CompleteReceiptInput): ActionReceipt {
    return this.#writeTransaction(() => {
      const row = this.#database.prepare('SELECT * FROM receipts WHERE id = ?').get(id);
      if (!row) throw new Error(`Receipt ${id} does not exist`);
      const current = this.#readRecord<ActionReceipt>(
        'receipts', String(row.id), row, (value) => assertActionReceipt(value), (value) => value.id,
      );
      if (
        current.status === ReceiptStatus.Succeeded ||
        current.status === ReceiptStatus.Failed ||
        current.status === ReceiptStatus.Denied ||
        current.status === ReceiptStatus.RolledBack
      ) {
        throw new Error(`Receipt ${id} is terminal and immutable`);
      }
      if (
        input.status !== ReceiptStatus.Succeeded &&
        input.status !== ReceiptStatus.Failed &&
        input.status !== ReceiptStatus.Denied
      ) {
        throw new Error(`Receipt ${id} has an invalid forward transition`);
      }
      if (
        input.status === ReceiptStatus.Succeeded &&
        (!input.verified || !input.externalId || !input.verifiedAt)
      ) {
        throw new Error(`Receipt ${id} success requires verified external evidence`);
      }
      const completed: ActionReceipt = normalizeReceipt({
        ...current,
        status: input.status,
        ...(input.externalId ? { externalId: input.externalId } : {}),
        ...(input.result !== undefined ? { result: input.result } : {}),
        ...(input.error ? { error: input.error } : {}),
        verified: input.verified,
        ...(input.verifiedAt ? { verifiedAt: input.verifiedAt } : {}),
        completedAt: input.completedAt,
        evidenceEventIds: [...input.evidenceEventIds],
      });
      this.#writeReceiptRecord(completed);
      return this.getReceiptByIdempotencyKey(completed.idempotencyKey)!;
    });
  }

  recordCost(cost: CostRecord): CostRecord {
    assertCostRecord(cost);
    const normalized = normalizeCost(cost);
    return this.#writeTransaction(() => {
      const row = this.#database.prepare('SELECT * FROM cost_records WHERE idempotency_key = ?').get(normalized.idempotencyKey);
      if (row) {
        const existing = this.#readRecord<CostRecord>(
          'cost_records', String(row.id), row, (value) => assertCostRecord(value), (value) => value.id,
        );
        if (this.#integrityHashFor(existing) === this.#integrityHashFor(normalized)) return existing;
        throw new IdempotencyConflictError(normalized.idempotencyKey);
      }
      const sealed = this.#sealRecord('cost_records', normalized.id, normalized);
      const stored = sealed.record;
      this.#database.prepare(`
        INSERT INTO cost_records (
          id, mission_id, assignment_id, category, estimated_microusd,
          actual_microusd, idempotency_key, incurred_at, integrity_hash, body
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        stored.id, stored.missionId, stored.assignmentId ?? null, stored.category,
        stored.estimatedMicroUsd, stored.actualMicroUsd, stored.idempotencyKey,
        stored.incurredAt, sealed.integrityHash, sealed.body,
      );
      this.#appendChangeLog({
        kind: ChangeLogKind.CostRecorded,
        recordType: 'cost',
        recordId: stored.id,
        changedAt: stored.incurredAt,
        payload: { missionId: stored.missionId, category: stored.category },
      });
      return stored;
    });
  }

  getCost(id: string): CostRecord | undefined {
    const row = this.#database.prepare('SELECT * FROM cost_records WHERE id = ?').get(id);
    return row ? this.#readRecord<CostRecord>(
      'cost_records', String(row.id), row, (value) => assertCostRecord(value), (value) => value.id,
    ) : undefined;
  }

  listCosts(missionId: string): CostRecord[] {
    return this.#database.prepare('SELECT * FROM cost_records WHERE mission_id = ? ORDER BY incurred_at ASC, id ASC')
      .all(missionId)
      .map((row) => this.#readRecord<CostRecord>(
        'cost_records', String(row.id), row, (value) => assertCostRecord(value), (value) => value.id,
      ));
  }

  summarizeMissionCost(missionId: string): MissionCostSummary {
    return this.listCosts(missionId).reduce(
      (summary, cost) => ({
        estimatedMicroUsd: summary.estimatedMicroUsd + cost.estimatedMicroUsd,
        actualMicroUsd: summary.actualMicroUsd + cost.actualMicroUsd,
      }),
      { estimatedMicroUsd: 0, actualMicroUsd: 0 },
    );
  }

  enqueueAssignment(assignment: Assignment): Assignment {
    assertAssignment(assignment);
    const normalized = normalizeAssignment(assignment);
    if (
      normalized.status !== LifecycleStatus.Queued ||
      normalized.attempt !== 0 ||
      normalized.acceptedAt !== undefined ||
      normalized.completedAt !== undefined ||
      normalized.artifact !== undefined ||
      normalized.leaseOwner !== undefined ||
      normalized.leaseToken !== undefined ||
      normalized.leaseExpiresAt !== undefined ||
      normalized.cancelRequestedAt !== undefined ||
      normalized.cancelReason !== undefined
    ) {
      throw new Error(
        `Assignment ${normalized.id} must enter the queue in a pristine lifecycle at attempt zero`,
      );
    }
    return this.#writeTransaction(() => {
      const byId = this.getAssignment(normalized.id);
      if (byId) {
        if (this.#integrityHashFor(byId) === this.#integrityHashFor(normalized)) return byId;
        throw new Error(`Assignment ${normalized.id} conflicts with queued work`);
      }
      const byKey = this.#database.prepare('SELECT id FROM assignments WHERE idempotency_key = ?')
        .get(normalized.idempotencyKey);
      if (byKey) throw new IdempotencyConflictError(normalized.idempotencyKey);
      const taskAssignment = this.#database.prepare(
        'SELECT id FROM assignments WHERE mission_id = ? AND mission_task_id = ?',
      ).get(normalized.missionId, normalized.missionTaskId);
      if (taskAssignment) {
        throw new Error(
          `Mission task ${normalized.missionTaskId} already has an assignment`,
        );
      }
      const mission = this.getMission(normalized.missionId);
      if (!mission || (mission.status !== LifecycleStatus.Approved && mission.status !== LifecycleStatus.Active)) {
        throw new Error(`Assignment mission ${normalized.missionId} is not approved`);
      }
      const task = this.getMissionTask(normalized.missionTaskId);
      if (!task || task.missionId !== mission.id) {
        throw new Error(`Assignment task ${normalized.missionTaskId} is outside mission ${mission.id}`);
      }
      const definition = mission.taskGraph.find((item) => item.id === task.id);
      if (!definition) throw new Error(`Assignment task ${task.id} is not in the approved graph`);
      new CapabilityRegistry(this.listAgentCapabilities()).assertTaskSupported(definition);
      if (
        normalized.agentId !== definition.selectedAgentId ||
        !sameStrings(normalized.capabilityIds, definition.capabilityIds)
      ) {
        throw new Error(`Assignment ${normalized.id} expands the approved agent capabilities`);
      }
      if (
        normalized.route !== definition.route ||
        normalized.risk !== definition.risk ||
        canonicalJson(normalized.expectedArtifact) !== canonicalJson(definition.expectedArtifact) ||
        canonicalJson(normalized.externalAction ?? null) !==
          canonicalJson(definition.externalAction ?? null)
      ) {
        throw new Error(`Assignment ${normalized.id} expands the approved task definition`);
      }
      if (normalized.maxAttempts !== mission.budget.maxRetriesPerAssignment + 1) {
        throw new Error(`Assignment ${normalized.id} max attempts exceed the approved retry budget`);
      }
      if (
        canonicalJson(normalized.instructions) !== canonicalJson(definition.input) ||
        !sameStrings(normalized.evidenceEventIds, definition.evidenceEventIds) ||
        normalized.estimatedCostMicroUsd !== definition.estimatedCostMicroUsd
      ) {
        throw new Error(`Assignment ${normalized.id} is not exactly bound to the approved task`);
      }
      const sealed = this.#sealRecord('assignments', normalized.id, normalized);
      const stored = sealed.record;
      this.#database.prepare(`
        INSERT INTO assignments (
          id, mission_task_id, agent_id, primary_capability_id, status, route,
          risk, confidence, assigned_at, accepted_at, completed_at,
          integrity_hash, body, mission_id, idempotency_key, attempt,
          max_attempts, available_at, estimated_cost_microusd, lease_owner,
          lease_token, lease_expires_at, cancel_requested_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        stored.id, stored.missionTaskId, stored.agentId,
        stored.capabilityIds[0] ?? null, stored.status, stored.route, stored.risk,
        stored.confidence ?? null, stored.assignedAt, stored.acceptedAt ?? null,
        stored.completedAt ?? null, sealed.integrityHash, sealed.body,
        stored.missionId, stored.idempotencyKey, stored.attempt,
        stored.maxAttempts, stored.availableAt, stored.estimatedCostMicroUsd,
        stored.leaseOwner ?? null, stored.leaseToken ?? null,
        stored.leaseExpiresAt ?? null, stored.cancelRequestedAt ?? null,
      );
      this.#appendChangeLog({
        kind: ChangeLogKind.AssignmentChanged,
        recordType: 'assignment',
        recordId: stored.id,
        changedAt: stored.assignedAt,
        payload: { missionId: stored.missionId, status: stored.status, attempt: stored.attempt },
      });
      return stored;
    });
  }

  getAssignment(id: string): Assignment | undefined {
    const row = this.#database.prepare('SELECT * FROM assignments WHERE id = ?').get(id);
    return row ? this.#readRecord<Assignment>(
      'assignments', String(row.id), row, (value) => assertAssignment(value), (value) => value.id,
    ) : undefined;
  }

  listAssignments(options: AssignmentListOptions = {}): Assignment[] {
    const clauses: string[] = [];
    const parameters: SQLInputValue[] = [];
    if (options.missionId) { clauses.push('mission_id = ?'); parameters.push(options.missionId); }
    if (options.missionTaskId) { clauses.push('mission_task_id = ?'); parameters.push(options.missionTaskId); }
    if (options.agentId) { clauses.push('agent_id = ?'); parameters.push(options.agentId); }
    if (options.status) { clauses.push('status = ?'); parameters.push(options.status); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    return this.#database.prepare(`SELECT * FROM assignments${where} ORDER BY available_at ASC, assigned_at ASC, id ASC`)
      .all(...parameters)
      .map((row) => this.#readRecord<Assignment>(
        'assignments', String(row.id), row, (value) => assertAssignment(value), (value) => value.id,
      ));
  }

  leaseReadyAssignments(options: LeaseReadyOptions): Assignment[] {
    if (!Number.isInteger(options.leaseMs) || options.leaseMs < 1) throw new Error('Lease duration is invalid');
    if (!Number.isInteger(options.limit) || options.limit < 1) throw new Error('Lease limit is invalid');
    const now = normalizeTimestamp(options.now);
    return this.#writeTransaction(() => {
      this.#expireAssignmentLeases(now);
      const candidates = this.#database.prepare(`
        SELECT * FROM assignments
        WHERE status = ? AND available_at <= ? AND cancel_requested_at IS NULL
        ORDER BY available_at ASC, assigned_at ASC, id ASC
      `).all(LifecycleStatus.Queued, now).map((row) => this.#readRecord<Assignment>(
        'assignments', String(row.id), row, (value) => assertAssignment(value), (value) => value.id,
      ));
      const leased: Assignment[] = [];
      const activeByMission = new Map<string, number>();
      for (const candidate of candidates) {
        if (leased.length >= options.limit) break;
        const mission = this.getMission(candidate.missionId);
        if (!mission || (mission.status !== LifecycleStatus.Approved && mission.status !== LifecycleStatus.Active)) continue;
        this.#assertDependencyProjection(mission, candidate.missionTaskId);
        if (!this.#dependenciesSucceeded(candidate.missionTaskId)) continue;
        const active = activeByMission.get(mission.id) ?? this.listAssignments({
          missionId: mission.id,
          status: LifecycleStatus.Active,
        }).length;
        if (active >= mission.budget.maxConcurrency) continue;
        if (candidate.attempt >= candidate.maxAttempts) {
          this.#writeAssignmentRecord({ ...candidate, status: LifecycleStatus.Failed, completedAt: now });
          continue;
        }
        const leaseToken = randomUUID();
        const leasedAssignment: Assignment = {
          ...candidate,
          status: LifecycleStatus.Active,
          attempt: candidate.attempt + 1,
          acceptedAt: now,
          leaseOwner: options.workerId,
          leaseToken,
          leaseExpiresAt: new Date(Date.parse(now) + options.leaseMs).toISOString(),
        };
        this.#writeAssignmentRecord(leasedAssignment);
        const task = this.getMissionTask(candidate.missionTaskId)!;
        this.#writeMissionTaskRecord({
          ...task,
          status: LifecycleStatus.Active,
          startedAt: task.startedAt ?? now,
          updatedAt: now,
        });
        if (mission.status === LifecycleStatus.Approved) {
          this.#writeMissionRecord({
            ...mission,
            status: LifecycleStatus.Active,
            startedAt: mission.startedAt ?? now,
            updatedAt: now,
          });
        }
        activeByMission.set(mission.id, active + 1);
        leased.push(this.getAssignment(candidate.id)!);
      }
      return leased;
    });
  }

  renewAssignmentLease(id: string, leaseToken: string, now: string, leaseMs: number): Assignment {
    return this.#writeTransaction(() => {
      const normalizedNow = normalizeTimestamp(now);
      if (!Number.isInteger(leaseMs) || leaseMs < 1) throw new Error('Lease duration is invalid');
      const assignment = this.#requireAssignmentLease(id, leaseToken, normalizedNow);
      const renewed: Assignment = {
        ...assignment,
        leaseExpiresAt: new Date(Date.parse(normalizedNow) + leaseMs).toISOString(),
      };
      this.#writeAssignmentRecord(renewed);
      return this.getAssignment(id)!;
    });
  }

  completeAssignment(
    id: string,
    leaseToken: string,
    artifact: JsonValue,
    completedAt: string,
  ): Assignment {
    return this.#writeTransaction(() => {
      const at = normalizeTimestamp(completedAt);
      const assignment = this.#requireAssignmentLease(id, leaseToken, at);
      if (assignment.cancelRequestedAt) {
        throw new Error(`Assignment ${id} is cancelled and cannot complete`);
      }
      const completed: Assignment = withoutLease({
        ...assignment,
        status: LifecycleStatus.Succeeded,
        artifact,
        completedAt: at,
      });
      this.#writeAssignmentRecord(completed);
      const task = this.getMissionTask(assignment.missionTaskId)!;
      this.#writeMissionTaskRecord({
        ...task,
        status: LifecycleStatus.Succeeded,
        output: artifact,
        completedAt: at,
        updatedAt: at,
      });
      const mission = this.getMission(assignment.missionId)!;
      const allTasksSucceeded = this.listMissionTasks(mission.id).every(
        (item) => item.status === LifecycleStatus.Succeeded,
      );
      const hasPendingAssignments = this.listAssignments({ missionId: mission.id }).some(
        (item) =>
          item.status === LifecycleStatus.Queued ||
          item.status === LifecycleStatus.Active ||
          item.status === LifecycleStatus.Paused,
      );
      if (allTasksSucceeded && !hasPendingAssignments) {
        this.#writeMissionRecord({
          ...mission,
          status: LifecycleStatus.Succeeded,
          completedAt: at,
          updatedAt: at,
        });
      }
      return this.getAssignment(id)!;
    });
  }

  pauseAssignmentForCheckpoint(
    id: string,
    leaseToken: string,
    reasons: readonly string[],
    pausedAt: string,
  ): Assignment {
    return this.#writeTransaction(() => {
      const at = normalizeTimestamp(pausedAt);
      const assignment = this.#requireAssignmentLease(id, leaseToken, at);
      const paused = withoutLease({
        ...assignment,
        status: LifecycleStatus.Paused,
        instructions: {
          ...assignment.instructions,
          checkpointReasons: [...reasons],
        },
      });
      this.#writeAssignmentRecord(paused);
      const task = this.getMissionTask(assignment.missionTaskId)!;
      this.#writeMissionTaskRecord({ ...task, status: LifecycleStatus.Paused, updatedAt: at });
      const mission = this.getMission(assignment.missionId)!;
      this.#writeMissionRecord({ ...mission, status: LifecycleStatus.Paused, updatedAt: at });
      this.#insertProposalRecord(checkpointProposal(assignment, mission, reasons, at));
      return this.getAssignment(id)!;
    });
  }

  failAssignment(
    id: string,
    leaseToken: string,
    error: Record<string, JsonValue>,
    failedAt: string,
    retryAt: string,
  ): Assignment {
    return this.#writeTransaction(() => {
      const at = normalizeTimestamp(failedAt);
      const assignment = this.#requireAssignmentLease(id, leaseToken, at);
      const retry = assignment.attempt < assignment.maxAttempts;
      const failed: Assignment = withoutLease({
        ...assignment,
        status: retry ? LifecycleStatus.Queued : LifecycleStatus.Failed,
        instructions: { ...assignment.instructions, lastError: error },
        availableAt: retry ? normalizeTimestamp(retryAt) : assignment.availableAt,
        ...(retry ? {} : { completedAt: at }),
      });
      this.#writeAssignmentRecord(failed);
      const task = this.getMissionTask(assignment.missionTaskId)!;
      this.#writeMissionTaskRecord({
        ...task,
        status: retry ? LifecycleStatus.Queued : LifecycleStatus.Failed,
        updatedAt: at,
        ...(retry ? {} : { completedAt: at }),
      });
      if (!retry) {
        const mission = this.getMission(assignment.missionId)!;
        this.#writeMissionRecord({
          ...mission,
          status: LifecycleStatus.Failed,
          completedAt: at,
          updatedAt: at,
        });
      }
      return this.getAssignment(id)!;
    });
  }

  requestMissionCancellation(
    missionId: string,
    reason: string,
    requestedAt: string,
    binding?: MissionCancellationBinding,
  ): MissionPlan {
    return this.#writeTransaction(() => {
      const mission = this.getMission(missionId);
      if (!mission) throw new Error(`Mission ${missionId} does not exist`);
      const at = normalizeTimestamp(requestedAt);
      if ([
        LifecycleStatus.Succeeded,
        LifecycleStatus.Failed,
        LifecycleStatus.Cancelled,
        LifecycleStatus.Rejected,
        LifecycleStatus.Archived,
      ].includes(mission.status)) {
        throw new MissionDecisionConflictError(missionId, 'is already terminal');
      }
      if (binding) {
        if (
          binding.planVersion !== mission.version ||
          binding.planHash !== mission.planHash ||
          computeMissionPlanHash(mission) !== binding.planHash
        ) {
          throw new MissionDecisionConflictError(missionId, 'cancellation binding does not match');
        }
        if (
          binding.decision.missionId !== undefined && binding.decision.missionId !== missionId ||
          binding.decision.planHash !== undefined && binding.decision.planHash !== binding.planHash ||
          binding.decision.planVersion !== undefined && binding.decision.planVersion !== binding.planVersion
        ) {
          throw new MissionDecisionConflictError(missionId, 'cancellation decision binding does not match');
        }
        const decision = normalizeDecision({
          ...binding.decision,
          missionId,
          planHash: binding.planHash,
          planVersion: binding.planVersion,
          decidedAt: at,
        });
        this.#insertDecision(decision);
      }
      for (const assignment of this.listAssignments({ missionId })) {
        if (
          assignment.status === LifecycleStatus.Queued ||
          assignment.status === LifecycleStatus.Paused
        ) {
          this.#writeAssignmentRecord({
            ...assignment,
            status: LifecycleStatus.Cancelled,
            cancelRequestedAt: at,
            cancelReason: reason,
            completedAt: at,
          });
        } else if (assignment.status === LifecycleStatus.Active) {
          this.#writeAssignmentRecord({
            ...assignment,
            cancelRequestedAt: at,
            cancelReason: reason,
          });
        }
      }
      for (const task of this.listMissionTasks(missionId)) {
        if (
          task.status === LifecycleStatus.Queued ||
          task.status === LifecycleStatus.Paused
        ) {
          this.#writeMissionTaskRecord({
            ...task,
            status: LifecycleStatus.Cancelled,
            updatedAt: at,
            completedAt: at,
          });
        }
      }
      this.#writeMissionRecord({
        ...mission,
        status: LifecycleStatus.Cancelled,
        cancelRequestedAt: at,
        updatedAt: at,
      });
      return this.getMission(missionId)!;
    });
  }

  acknowledgeAssignmentCancellation(id: string, leaseToken: string, completedAt: string): Assignment {
    return this.#writeTransaction(() => {
      const at = normalizeTimestamp(completedAt);
      const assignment = this.#requireAssignmentLease(id, leaseToken, at);
      if (!assignment.cancelRequestedAt) throw new Error(`Assignment ${id} has no cancellation request`);
      const cancelled = withoutLease({
        ...assignment,
        status: LifecycleStatus.Cancelled,
        completedAt: at,
      });
      this.#writeAssignmentRecord(cancelled);
      const task = this.getMissionTask(assignment.missionTaskId)!;
      this.#writeMissionTaskRecord({
        ...task,
        status: LifecycleStatus.Cancelled,
        completedAt: at,
        updatedAt: at,
      });
      return this.getAssignment(id)!;
    });
  }

  upsertConnectorHealth(health: ConnectorHealth): ConnectorHealth {
    assertConnectorHealth(health);
    const normalized = normalizeConnectorHealth(health);
    assertConnectorHealth(normalized);
    return this.#writeTransaction(() => {
      const existing = this.#database
        .prepare(
          'SELECT * FROM connector_health WHERE connector_id = ?',
        )
        .get(normalized.connectorId);
      if (existing) {
        const current = this.#readRecord<ConnectorHealth>(
          'connector_health',
          String(existing.connector_id),
          existing,
          (value) => assertConnectorHealth(value),
          (value) => value.connectorId,
        );
        const mergedCapabilities = [...current.capabilities];
        let capabilityChanged = false;
        for (const incoming of normalized.capabilities) {
          const index = mergedCapabilities.findIndex(
            (candidate) => candidate.capability === incoming.capability,
          );
          if (index < 0) {
            mergedCapabilities.push(incoming);
            capabilityChanged = true;
          } else if (
            timestampEpoch(incoming.checkedAt) >
            timestampEpoch(mergedCapabilities[index].checkedAt)
          ) {
            mergedCapabilities[index] = incoming;
            capabilityChanged = true;
          }
        }
        const incomingIsNewer =
          timestampEpoch(normalized.checkedAt) > timestampEpoch(current.checkedAt);
        if (!capabilityChanged && !incomingIsNewer) {
          return current;
        }
        const newest = incomingIsNewer ? normalized : current;
        normalized.capabilities = mergedCapabilities.sort((first, second) =>
          first.capability.localeCompare(second.capability),
        );
        normalized.status = aggregateConnectorHealth(normalized.capabilities);
        normalized.checkedAt = laterTimestamp(current.checkedAt, normalized.checkedAt);
        normalized.lastSuccessAt = latestOptionalTimestamp(
          current.lastSuccessAt,
          normalized.lastSuccessAt,
        );
        normalized.lastFailureAt = latestOptionalTimestamp(
          current.lastFailureAt,
          normalized.lastFailureAt,
        );
        normalized.latencyMs = newest.latencyMs;
        normalized.consecutiveFailures = newest.consecutiveFailures;
        normalized.freshness = timestampEpoch(normalized.freshness.observedAt) >
          timestampEpoch(current.freshness.observedAt)
          ? normalized.freshness
          : current.freshness;
        normalized.details = { ...current.details, ...normalized.details };
        normalized.provenance = mergeProvenance(current.provenance, normalized.provenance);
      }

      normalized.status = aggregateConnectorHealth(normalized.capabilities);
      if (normalized.lastSuccessAt === undefined) delete normalized.lastSuccessAt;
      if (normalized.lastFailureAt === undefined) delete normalized.lastFailureAt;
      if (normalized.latencyMs === undefined) delete normalized.latencyMs;

      const sealed = this.#sealRecord(
        'connector_health',
        normalized.connectorId,
        normalized,
      );
      const stored = sealed.record;
      this.#database
        .prepare(`
          INSERT INTO connector_health (
            connector_id, status, checked_at, last_success_at, last_failure_at,
            latency_ms, consecutive_failures, freshness_at, integrity_hash, body
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (connector_id) DO UPDATE SET
            status = excluded.status,
            checked_at = excluded.checked_at,
            last_success_at = excluded.last_success_at,
            last_failure_at = excluded.last_failure_at,
            latency_ms = excluded.latency_ms,
            consecutive_failures = excluded.consecutive_failures,
            freshness_at = excluded.freshness_at,
            integrity_hash = excluded.integrity_hash,
            body = excluded.body
        `)
        .run(
          stored.connectorId,
          stored.status,
          stored.checkedAt,
          stored.lastSuccessAt ?? null,
          stored.lastFailureAt ?? null,
          stored.latencyMs ?? null,
          stored.consecutiveFailures,
          stored.freshness.observedAt,
          sealed.integrityHash,
          sealed.body,
        );
      return stored;
    });
  }

  listConnectorHealth(
    options: ConnectorHealthListOptions = {},
  ): ConnectorHealth[] {
    const rows = options.status
      ? this.#database
          .prepare(`
            SELECT * FROM connector_health
            WHERE status = ?
            ORDER BY checked_at DESC, connector_id ASC
          `)
          .all(options.status)
      : this.#database
          .prepare(`
            SELECT * FROM connector_health
            ORDER BY checked_at DESC, connector_id ASC
          `)
          .all();
    return rows.map((row) =>
      this.#readRecord<ConnectorHealth>(
        'connector_health',
        String(row.connector_id),
        row,
        (value) => assertConnectorHealth(value),
        (value) => value.connectorId,
      ),
    );
  }

  #appendEventRecord(normalized: EventEnvelope): AppendEventResult {
    const integrityHash = this.#integrityHashFor(normalized);
    const existing = this.#database.prepare(`
      SELECT * FROM events WHERE source = ? AND source_event_id = ?
    `).get(normalized.source, normalized.sourceEventId);
    if (existing) {
      const existingEvent = this.#readRecord<EventEnvelope>(
        'events', String(existing.id), existing,
        (value) => assertEventEnvelope(value), (value) => value.id,
      );
      if (digestsEqual(existing.integrity_hash, integrityHash)) {
        return { event: existingEvent, inserted: false };
      }
      throw new EventConflictError(normalized.source, normalized.sourceEventId);
    }
    const sealed = this.#sealRecord('events', normalized.id, normalized);
    this.#database.prepare(`
      INSERT INTO events (
        id, source, source_type, source_event_id, event_type,
        occurred_at, ingested_at, status, route, risk, confidence,
        freshness_at, integrity_hash, body
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      normalized.id, normalized.source, normalized.sourceType,
      normalized.sourceEventId, normalized.type, normalized.occurredAt,
      normalized.ingestedAt, normalized.status ?? null, normalized.route ?? null,
      normalized.risk ?? null, normalized.confidence ?? null,
      normalized.freshness?.observedAt ?? null, sealed.integrityHash, sealed.body,
    );
    return { event: sealed.record, inserted: true };
  }

  #resolveExternalIdentity(
    observation: ExternalIdentityObservation,
    connectorId: string,
    capability: ConnectorCapability,
    committedAt: string,
  ): {
    link: ExternalIdentityLink;
    reviewCandidate?: ExternalIdentityReviewCandidate;
    failure?: CaptureFailure;
  } {
    if (observation.connectorId !== connectorId) {
      throw new Error('External identity connector does not match its capture batch');
    }
    const row = this.#database.prepare(`
      SELECT * FROM external_identities
      WHERE connector_id = ? AND namespace = ? AND external_id = ?
    `).get(observation.connectorId, observation.namespace, observation.externalId);
    const provenance: Provenance = {
      source: observation.connectorId,
      sourceType: SourceType.Connector,
      sourceEventId: observation.evidenceEventId,
      observedAt: observation.observedAt,
      confidence: observation.confidence,
    };

    if (row) {
      const existing = this.#readRecord<ExternalIdentityLink>(
        'external_identities', String(row.id), row,
        (value) => assertExternalIdentityLink(value), (value) => value.id,
      );
      const link: ExternalIdentityLink = {
        ...existing,
        lastObservedAt: laterTimestamp(existing.lastObservedAt, observation.observedAt),
        evidenceEventIds: uniqueStrings([...existing.evidenceEventIds, observation.evidenceEventId]),
        confidence: Math.max(existing.confidence, observation.confidence),
        provenance: mergeProvenance(existing.provenance, [provenance]),
      };
      this.#writeExternalIdentity(link);
      this.#refreshEntityFromExternalObservation(
        existing.entityId,
        observation,
        provenance,
        committedAt,
      );
      if (observation.claimedEntityId && observation.claimedEntityId !== existing.entityId) {
        const reviewCandidate = this.#identityReview(
          IdentityReviewKind.Contradiction,
          observation,
          existing.entityId,
          [observation.claimedEntityId],
          'An established external identity was claimed for a different entity',
          committedAt,
        );
        const failure: CaptureFailure = {
          ...this.#identityFailure(
            connectorId,
            capability,
            CaptureFailureKind.IdentityConflict,
            reviewCandidate.reason,
            observation.evidenceEventId,
            committedAt,
          ),
          reviewCandidate,
        };
        return { link, reviewCandidate, failure };
      }
      return { link };
    }

    const entityId = `entity-${randomUUID()}`;
    const entity: Entity = {
      id: entityId,
      type: observation.entityType,
      canonicalName: observation.displayName ?? `${observation.namespace}:${observation.externalId}`,
      aliases: [],
      attributes: structuredClone(observation.attributes),
      status: LifecycleStatus.Draft,
      risk: RiskLevel.Low,
      confidence: observation.confidence,
      freshness: { observedAt: observation.observedAt },
      provenance: [provenance],
      createdAt: observation.observedAt,
      updatedAt: observation.observedAt,
    };
    this.#insertEntityRecord(entity);
    const link: ExternalIdentityLink = {
      id: `identity-${randomUUID()}`,
      connectorId: observation.connectorId,
      namespace: observation.namespace,
      externalId: observation.externalId,
      entityId,
      status: ExternalIdentityLinkStatus.Provisional,
      firstObservedAt: observation.observedAt,
      lastObservedAt: observation.observedAt,
      evidenceEventIds: [observation.evidenceEventId],
      confidence: observation.confidence,
      provenance: [provenance],
    };
    this.#writeExternalIdentity(link);

    const displayCandidates = observation.displayName
      ? this.listEntities()
          .filter((candidate) =>
            candidate.id !== entityId &&
            candidate.canonicalName.localeCompare(observation.displayName!, undefined, { sensitivity: 'accent' }) === 0
          )
          .map((candidate) => candidate.id)
      : [];
    const candidateEntityIds = uniqueStrings([
      ...displayCandidates,
      ...(observation.claimedEntityId ? [observation.claimedEntityId] : []),
    ]);
    if (candidateEntityIds.length === 0) return { link };
    const reviewCandidate = this.#identityReview(
      IdentityReviewKind.ProposedMerge,
      observation,
      entityId,
      candidateEntityIds,
      'Display names and claimed candidates require explicit identity review',
      committedAt,
    );
    const failure: CaptureFailure = {
      ...this.#identityFailure(
        connectorId,
        capability,
        CaptureFailureKind.IdentityConflict,
        reviewCandidate.reason,
        observation.evidenceEventId,
        committedAt,
      ),
      reviewCandidate,
    };
    return { link, reviewCandidate, failure };
  }

  #resolveExternalRelation(
    observation: NormalizedCapture['relations'][number],
    committedAt: string,
  ): Relation | undefined {
    const resolve = (key: typeof observation.from) => {
      const row = this.#database.prepare(`
        SELECT * FROM external_identities
        WHERE connector_id = ? AND namespace = ? AND external_id = ?
      `).get(key.connectorId, key.namespace, key.externalId);
      return row ? this.#readRecord<ExternalIdentityLink>(
        'external_identities', String(row.id), row,
        (value) => assertExternalIdentityLink(value), (value) => value.id,
      ) : undefined;
    };
    const from = resolve(observation.from);
    const to = resolve(observation.to);
    if (!from || !to) return undefined;
    const row = this.#database.prepare(`
      SELECT * FROM relations
      WHERE from_entity_id = ? AND to_entity_id = ? AND relation_type = ?
    `).get(from.entityId, to.entityId, observation.type);
    const provenance: Provenance = {
      source: observation.from.connectorId,
      sourceType: SourceType.Connector,
      sourceEventId: observation.evidenceEventId,
      observedAt: observation.observedAt,
    };
    const current = row ? this.#readRecord<Relation>(
      'relations', String(row.id), row,
      (value) => assertRelation(value), (value) => value.id,
    ) : undefined;
    const relation: Relation = current ? {
      ...current,
      attributes: { ...current.attributes, ...observation.attributes },
      freshness: { observedAt: observation.observedAt },
      provenance: mergeProvenance(current.provenance, [provenance]),
      updatedAt: laterTimestamp(current.updatedAt, committedAt),
    } : {
      id: `relation-${randomUUID()}`,
      fromEntityId: from.entityId,
      toEntityId: to.entityId,
      type: observation.type,
      attributes: structuredClone(observation.attributes),
      status: LifecycleStatus.Active,
      risk: RiskLevel.Low,
      freshness: { observedAt: observation.observedAt },
      provenance: [provenance],
      createdAt: committedAt,
      updatedAt: committedAt,
    };
    this.#writeRelationRecord(relation, Boolean(current));
    return relation;
  }

  #identityReview(
    kind: IdentityReviewKind,
    observation: ExternalIdentityObservation,
    observedEntityId: string,
    candidateEntityIds: string[],
    reason: string,
    createdAt: string,
  ): ExternalIdentityReviewCandidate {
    return {
      id: `identity-review-${randomUUID()}`,
      kind,
      connectorId: observation.connectorId,
      namespace: observation.namespace,
      externalId: observation.externalId,
      observedEntityId,
      candidateEntityIds,
      reason,
      status: LifecycleStatus.PendingApproval,
      route: RouteType.HumanApproval,
      risk: RiskLevel.Medium,
      evidenceEventIds: [observation.evidenceEventId],
      createdAt,
      provenance: [{
        source: observation.connectorId,
        sourceType: SourceType.Connector,
        sourceEventId: observation.evidenceEventId,
        observedAt: observation.observedAt,
      }],
    };
  }

  #identityFailure(
    connectorId: string,
    capability: ConnectorCapability,
    kind: CaptureFailureKind,
    message: string,
    sourceEventId: string,
    occurredAt: string,
  ): CaptureFailure {
    return {
      id: `capture-failure-${randomUUID()}`,
      connectorId,
      capability,
      kind,
      message,
      retryable: false,
      sourceEventId,
      status: LifecycleStatus.PendingApproval,
      route: RouteType.HumanApproval,
      risk: RiskLevel.Medium,
      details: {},
      occurredAt,
      provenance: [{
        source: connectorId,
        sourceType: SourceType.Connector,
        sourceEventId,
        observedAt: occurredAt,
      }],
    };
  }

  #insertEntityRecord(entity: Entity): void {
    assertEntity(entity);
    const sealed = this.#sealRecord('entities', entity.id, entity);
    const stored = sealed.record;
    this.#database.prepare(`
      INSERT INTO entities (
        id, entity_type, status, risk, confidence, freshness_at,
        created_at, updated_at, integrity_hash, body
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      stored.id, stored.type, stored.status ?? null, stored.risk ?? null,
      stored.confidence ?? null, stored.freshness.observedAt, stored.createdAt,
      stored.updatedAt, sealed.integrityHash, sealed.body,
    );
  }

  #refreshEntityFromExternalObservation(
    entityId: string,
    observation: ExternalIdentityObservation,
    provenance: Provenance,
    committedAt: string,
  ): void {
    const current = this.getEntity(entityId);
    if (!current) throw new Error(`External identity entity ${entityId} does not exist`);
    const incomingIsNewer = timestampEpoch(observation.observedAt) >
      timestampEpoch(current.freshness.observedAt);
    const canonicalName = incomingIsNewer && observation.displayName
      ? observation.displayName
      : current.canonicalName;
    const aliases = uniqueStrings([
      ...current.aliases,
      ...(canonicalName !== current.canonicalName ? [current.canonicalName] : []),
      ...(observation.displayName && observation.displayName !== canonicalName
        ? [observation.displayName]
        : []),
    ]).filter((alias) => alias !== canonicalName);
    const refreshed: Entity = {
      ...current,
      ...(incomingIsNewer ? { type: observation.entityType } : {}),
      canonicalName,
      aliases,
      attributes: incomingIsNewer
        ? { ...current.attributes, ...observation.attributes }
        : { ...observation.attributes, ...current.attributes },
      confidence: Math.max(current.confidence ?? 0, observation.confidence),
      freshness: incomingIsNewer
        ? { observedAt: observation.observedAt }
        : current.freshness,
      provenance: mergeProvenance(current.provenance, [provenance]),
      updatedAt: laterTimestamp(current.updatedAt, committedAt),
    };
    assertEntity(refreshed);
    const sealed = this.#sealRecord('entities', refreshed.id, refreshed);
    const stored = sealed.record;
    this.#database.prepare(`
      UPDATE entities SET
        entity_type = ?, status = ?, risk = ?, confidence = ?, freshness_at = ?,
        created_at = ?, updated_at = ?, integrity_hash = ?, body = ?
      WHERE id = ?
    `).run(
      stored.type, stored.status ?? null, stored.risk ?? null,
      stored.confidence ?? null, stored.freshness.observedAt,
      stored.createdAt, stored.updatedAt, sealed.integrityHash, sealed.body, stored.id,
    );
  }

  #writeRelationRecord(relation: Relation, update: boolean): void {
    assertRelation(relation);
    const sealed = this.#sealRecord('relations', relation.id, relation);
    const stored = sealed.record;
    if (update) {
      this.#database.prepare(`
        UPDATE relations SET status = ?, risk = ?, confidence = ?, freshness_at = ?,
          created_at = ?, updated_at = ?, integrity_hash = ?, body = ? WHERE id = ?
      `).run(
        stored.status ?? null, stored.risk ?? null, stored.confidence ?? null,
        stored.freshness.observedAt, stored.createdAt, stored.updatedAt,
        sealed.integrityHash, sealed.body, stored.id,
      );
      return;
    }
    this.#database.prepare(`
      INSERT INTO relations (
        id, from_entity_id, to_entity_id, relation_type, status, risk,
        confidence, freshness_at, created_at, updated_at, integrity_hash, body
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      stored.id, stored.fromEntityId, stored.toEntityId, stored.type,
      stored.status ?? null, stored.risk ?? null, stored.confidence ?? null,
      stored.freshness.observedAt, stored.createdAt, stored.updatedAt,
      sealed.integrityHash, sealed.body,
    );
  }

  #writeExternalIdentity(link: ExternalIdentityLink): void {
    assertExternalIdentityLink(link);
    const sealed = this.#sealRecord('external_identities', link.id, link);
    const stored = sealed.record;
    this.#database.prepare(`
      INSERT INTO external_identities (
        id, connector_id, namespace, external_id, entity_id, status,
        last_observed_at, integrity_hash, body
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        entity_id = excluded.entity_id,
        status = excluded.status,
        last_observed_at = excluded.last_observed_at,
        integrity_hash = excluded.integrity_hash,
        body = excluded.body
    `).run(
      stored.id, stored.connectorId, stored.namespace, stored.externalId,
      stored.entityId, stored.status, stored.lastObservedAt,
      sealed.integrityHash, sealed.body,
    );
  }

  #insertCaptureFailure(failure: CaptureFailure): void {
    assertCaptureFailure(failure);
    const existing = this.#database.prepare('SELECT * FROM capture_failures WHERE id = ?').get(failure.id);
    if (existing) {
      const current = this.#readRecord<CaptureFailure>(
        'capture_failures', String(existing.id), existing,
        (value) => assertCaptureFailure(value), (value) => value.id,
      );
      if (this.#integrityHashFor(current) === this.#integrityHashFor(failure)) return;
      throw new Error(`Capture failure ${failure.id} conflicts with its immutable record`);
    }
    const sealed = this.#sealRecord('capture_failures', failure.id, failure);
    const stored = sealed.record;
    this.#database.prepare(`
      INSERT INTO capture_failures (
        id, connector_id, capability, status, route, risk, occurred_at,
        integrity_hash, body
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      stored.id, stored.connectorId, stored.capability, stored.status,
      stored.route, stored.risk, stored.occurredAt, sealed.integrityHash, sealed.body,
    );
  }

  #writeConnectorCursor(cursor: VersionedCursor): void {
    assertVersionedCursor(cursor);
    const id = cursorRecordId(cursor.connectorId, cursor.capability, cursor.partition);
    const sealed = this.#sealRecord('connector_cursors', id, cursor);
    const stored = sealed.record;
    this.#database.prepare(`
      INSERT INTO connector_cursors (
        id, connector_id, capability, partition_key, cursor_version, epoch,
        sequence, updated_at, integrity_hash, body
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        cursor_version = excluded.cursor_version,
        epoch = excluded.epoch,
        sequence = excluded.sequence,
        updated_at = excluded.updated_at,
        integrity_hash = excluded.integrity_hash,
        body = excluded.body
    `).run(
      id, stored.connectorId, stored.capability, stored.partition,
      stored.version, stored.epoch, stored.sequence, stored.updatedAt,
      sealed.integrityHash, sealed.body,
    );
  }

  #writeConnectorLease(lease: ConnectorLease): void {
    assertConnectorLease(lease);
    const sealed = this.#sealRecord('connector_leases', lease.id, lease);
    const stored = sealed.record;
    this.#database.prepare(`
      INSERT INTO connector_leases (
        id, connector_id, capability, owner_id, lease_token, expires_at,
        lease_version, updated_at, integrity_hash, body
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        owner_id = excluded.owner_id,
        lease_token = excluded.lease_token,
        expires_at = excluded.expires_at,
        lease_version = excluded.lease_version,
        updated_at = excluded.updated_at,
        integrity_hash = excluded.integrity_hash,
        body = excluded.body
    `).run(
      stored.id, stored.connectorId, stored.capability, stored.ownerId,
      stored.leaseToken, stored.expiresAt, stored.version, stored.updatedAt,
      sealed.integrityHash, sealed.body,
    );
  }

  #requireConnectorLease(
    connectorId: string,
    capability: ConnectorCapability,
    leaseToken: string,
    at: string,
  ): ConnectorLease {
    const id = connectorLeaseId(connectorId, capability);
    const row = this.#database.prepare('SELECT * FROM connector_leases WHERE id = ?').get(id);
    if (!row) throw new ConnectorLeaseError(id);
    const lease = this.#readRecord<ConnectorLease>(
      'connector_leases', String(row.id), row,
      (value) => assertConnectorLease(value), (value) => value.id,
    );
    if (lease.leaseToken !== leaseToken || Date.parse(lease.expiresAt) <= Date.parse(at)) {
      throw new ConnectorLeaseError(id);
    }
    return lease;
  }

  #appendChangeLog(input: Omit<ChangeLog, 'id' | 'sequence' | 'integrityHash'>): ChangeLog {
    const row = this.#database.prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM change_log').get();
    const change: ChangeLog = {
      id: `change-${randomUUID()}`,
      sequence: Number(row?.sequence ?? 0) + 1,
      ...input,
    };
    assertChangeLog(change);
    const sealed = this.#sealRecord('change_log', change.id, change);
    const stored = sealed.record;
    this.#database.prepare(`
      INSERT INTO change_log (
        id, sequence, kind, connector_id, record_type, record_id, event_id,
        changed_at, integrity_hash, body
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      stored.id, stored.sequence, stored.kind, stored.connectorId ?? null,
      stored.recordType, stored.recordId, stored.eventId ?? null,
      stored.changedAt, sealed.integrityHash, sealed.body,
    );
    return stored;
  }

  #writeAssignmentRecord(assignment: Assignment): void {
    assertAssignment(assignment);
    const normalized = normalizeAssignment(assignment);
    const previous = this.#database.prepare(`
      SELECT status, attempt, cancel_requested_at, completed_at
      FROM assignments WHERE id = ?
    `).get(normalized.id);
    const sealed = this.#sealRecord('assignments', normalized.id, normalized);
    const stored = sealed.record;
    this.#database.prepare(`
      UPDATE assignments SET
        mission_task_id = ?, agent_id = ?, primary_capability_id = ?, status = ?,
        route = ?, risk = ?, confidence = ?, assigned_at = ?, accepted_at = ?,
        completed_at = ?, integrity_hash = ?, body = ?, mission_id = ?,
        idempotency_key = ?, attempt = ?, max_attempts = ?, available_at = ?,
        estimated_cost_microusd = ?, lease_owner = ?, lease_token = ?,
        lease_expires_at = ?, cancel_requested_at = ?
      WHERE id = ?
    `).run(
      stored.missionTaskId, stored.agentId, stored.capabilityIds[0] ?? null,
      stored.status, stored.route, stored.risk, stored.confidence ?? null,
      stored.assignedAt, stored.acceptedAt ?? null, stored.completedAt ?? null,
      sealed.integrityHash, sealed.body, stored.missionId, stored.idempotencyKey,
      stored.attempt, stored.maxAttempts, stored.availableAt,
      stored.estimatedCostMicroUsd, stored.leaseOwner ?? null,
      stored.leaseToken ?? null, stored.leaseExpiresAt ?? null,
      stored.cancelRequestedAt ?? null, stored.id,
    );
    if (
      !previous ||
      previous.status !== stored.status ||
      Number(previous.attempt) !== stored.attempt ||
      (previous.cancel_requested_at ?? null) !== (stored.cancelRequestedAt ?? null) ||
      (previous.completed_at ?? null) !== (stored.completedAt ?? null)
    ) {
      this.#appendChangeLog({
        kind: ChangeLogKind.AssignmentChanged,
        recordType: 'assignment',
        recordId: stored.id,
        changedAt: stored.completedAt ?? stored.cancelRequestedAt ?? stored.acceptedAt ?? stored.availableAt,
        payload: { missionId: stored.missionId, status: stored.status, attempt: stored.attempt },
      });
    }
  }

  #requireAssignmentLease(id: string, leaseToken: string, at?: string): Assignment {
    const assignment = this.getAssignment(id);
    if (
      !assignment ||
      assignment.status !== LifecycleStatus.Active ||
      !assignment.leaseToken ||
      assignment.leaseToken !== leaseToken
    ) {
      throw new AssignmentLeaseError(id);
    }
    if (
      at &&
      assignment.leaseExpiresAt &&
      Date.parse(assignment.leaseExpiresAt) <= Date.parse(at)
    ) {
      throw new AssignmentLeaseError(id);
    }
    return assignment;
  }

  #expireAssignmentLeases(now: string): void {
    const rows = this.#database.prepare(`
      SELECT * FROM assignments
      WHERE status = ? AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
    `).all(LifecycleStatus.Active, now);
    for (const row of rows) {
      const assignment = this.#readRecord<Assignment>(
        'assignments', String(row.id), row, (value) => assertAssignment(value), (value) => value.id,
      );
      const cancelled = Boolean(assignment.cancelRequestedAt);
      this.#writeAssignmentRecord(withoutLease({
        ...assignment,
        status: cancelled ? LifecycleStatus.Cancelled : LifecycleStatus.Queued,
        ...(cancelled ? { completedAt: now } : {}),
      }));
      const task = this.getMissionTask(assignment.missionTaskId);
      if (task && task.status === LifecycleStatus.Active) {
        this.#writeMissionTaskRecord({
          ...task,
          status: cancelled ? LifecycleStatus.Cancelled : LifecycleStatus.Queued,
          updatedAt: now,
          ...(cancelled ? { completedAt: now } : {}),
        });
      }
    }
  }

  #dependenciesSucceeded(taskId: string): boolean {
    const dependencies = this.#database.prepare(`
      SELECT dependency.*
      FROM mission_task_dependencies edge
      JOIN mission_tasks dependency ON dependency.id = edge.depends_on_task_id
      WHERE edge.task_id = ?
    `).all(taskId);
    return dependencies.every((row) => {
      const task = this.#readRecord<MissionTask>(
        'mission_tasks', String(row.id), row, (value) => assertMissionTask(value), (value) => value.id,
      );
      return task.status === LifecycleStatus.Succeeded;
    });
  }

  #assertDependencyProjection(mission: MissionPlan, taskId: string): void {
    const expected = mission.taskGraph.find((task) => task.id === taskId)?.dependsOn;
    if (!expected) throw new Error(`Mission ${mission.id} does not contain task ${taskId}`);
    const actual = this.#database.prepare(`
      SELECT depends_on_task_id FROM mission_task_dependencies
      WHERE mission_id = ? AND task_id = ? ORDER BY depends_on_task_id ASC
    `).all(mission.id, taskId).map((row) => String(row.depends_on_task_id));
    if (!sameStrings(actual, expected)) {
      throw new Error(`Mission ${mission.id} dependency projection mismatch for ${taskId}`);
    }
  }

  #insertMissionTask(task: MissionTask): MissionTask {
    assertMissionTask(task);
    const normalized = normalizeMissionTask(task);
    const sealed = this.#sealRecord('mission_tasks', normalized.id, normalized);
    const stored = sealed.record;
    this.#database.prepare(`
      INSERT INTO mission_tasks (
        id, mission_id, task_type, status, route, risk, confidence, sequence,
        freshness_at, created_at, updated_at, started_at, completed_at,
        integrity_hash, body, lane, selected_agent_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      stored.id, stored.missionId, stored.kind, stored.status, stored.route,
      stored.risk, stored.confidence ?? null, stored.sequence,
      stored.freshness?.observedAt ?? null, stored.createdAt, stored.updatedAt,
      stored.startedAt ?? null, stored.completedAt ?? null,
      sealed.integrityHash, sealed.body, stored.lane, stored.selectedAgentId,
    );
    return stored;
  }

  #writeMissionTaskRecord(task: MissionTask): void {
    assertMissionTask(task);
    const normalized = normalizeMissionTask(task);
    const previous = this.#database.prepare(
      'SELECT status, completed_at FROM mission_tasks WHERE id = ?',
    ).get(normalized.id);
    const sealed = this.#sealRecord('mission_tasks', normalized.id, normalized);
    const stored = sealed.record;
    this.#database.prepare(`
      UPDATE mission_tasks SET
        mission_id = ?, task_type = ?, status = ?, route = ?, risk = ?,
        confidence = ?, sequence = ?, freshness_at = ?, created_at = ?,
        updated_at = ?, started_at = ?, completed_at = ?, integrity_hash = ?,
        body = ?, lane = ?, selected_agent_id = ?
      WHERE id = ?
    `).run(
      stored.missionId, stored.kind, stored.status, stored.route, stored.risk,
      stored.confidence ?? null, stored.sequence, stored.freshness?.observedAt ?? null,
      stored.createdAt, stored.updatedAt, stored.startedAt ?? null,
      stored.completedAt ?? null, sealed.integrityHash, sealed.body, stored.lane,
      stored.selectedAgentId, stored.id,
    );
    if (
      !previous ||
      previous.status !== stored.status ||
      (previous.completed_at ?? null) !== (stored.completedAt ?? null)
    ) {
      this.#appendChangeLog({
        kind: ChangeLogKind.MissionChanged,
        recordType: 'mission_task',
        recordId: stored.id,
        changedAt: stored.updatedAt,
        payload: { missionId: stored.missionId, status: stored.status },
      });
    }
  }

  #writeMissionRecord(mission: MissionPlan): void {
    assertMissionPlan(mission);
    if (computeMissionPlanHash(mission) !== mission.planHash) {
      throw new MissionPlanConflictError(mission.id);
    }
    const normalized = normalizeMission(mission);
    const previous = this.#database.prepare(
      'SELECT status, completed_at, cancel_requested_at FROM missions WHERE id = ?',
    ).get(normalized.id);
    const sealed = this.#sealRecord('missions', normalized.id, normalized);
    const stored = sealed.record;
    this.#database.prepare(`
      UPDATE missions SET
        intent_id = ?, status = ?, route = ?, risk = ?, confidence = ?,
        freshness_at = ?, created_at = ?, updated_at = ?, integrity_hash = ?,
        body = ?, series_id = ?, plan_version = ?, plan_hash = ?,
        approval_decision_id = ?, approved_at = ?, started_at = ?,
        completed_at = ?, cancel_requested_at = ?
      WHERE id = ?
    `).run(
      stored.intentId, stored.status, stored.route, stored.risk,
      stored.confidence ?? null, stored.freshness?.observedAt ?? null,
      stored.createdAt, stored.updatedAt, sealed.integrityHash, sealed.body,
      stored.seriesId, stored.version, stored.planHash,
      stored.approvalDecisionId ?? null, stored.approvedAt ?? null,
      stored.startedAt ?? null, stored.completedAt ?? null,
      stored.cancelRequestedAt ?? null, stored.id,
    );
    if (
      !previous ||
      previous.status !== stored.status ||
      (previous.completed_at ?? null) !== (stored.completedAt ?? null) ||
      (previous.cancel_requested_at ?? null) !== (stored.cancelRequestedAt ?? null)
    ) {
      this.#appendChangeLog({
        kind: ChangeLogKind.MissionChanged,
        recordType: 'mission',
        recordId: stored.id,
        changedAt: stored.updatedAt,
        payload: { status: stored.status, version: stored.version },
      });
    }
  }

  #insertDecision(decision: DecisionRecord): DecisionRecord {
    assertDecisionRecord(decision);
    const existing = this.#database.prepare('SELECT * FROM decisions WHERE id = ?').get(decision.id);
    if (existing) {
      const stored = this.#readRecord<DecisionRecord>(
        'decisions', String(existing.id), existing, (value) => assertDecisionRecord(value), (value) => value.id,
      );
      if (this.#integrityHashFor(stored) === this.#integrityHashFor(decision)) return stored;
      throw new Error(`Decision ${decision.id} conflicts with the immutable record`);
    }
    const sealed = this.#sealRecord('decisions', decision.id, decision);
    const stored = sealed.record;
    this.#database.prepare(`
      INSERT INTO decisions (
        id, intent_id, mission_id, mission_task_id, proposal_id, status,
        route, risk, confidence, decided_at, integrity_hash, body, plan_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      stored.id, stored.intentId ?? null, stored.missionId ?? null,
      stored.missionTaskId ?? null, stored.proposalId ?? null, stored.outcome,
      stored.route, stored.risk, stored.confidence ?? null, stored.decidedAt,
      sealed.integrityHash, sealed.body, stored.planHash ?? null,
    );
    this.#appendChangeLog({
      kind: ChangeLogKind.DecisionRecorded,
      recordType: 'decision',
      recordId: stored.id,
      changedAt: stored.decidedAt,
      payload: {
        outcome: stored.outcome,
        ...(stored.missionId ? { missionId: stored.missionId } : {}),
        ...(stored.proposalId ? { proposalId: stored.proposalId } : {}),
      },
    });
    return stored;
  }

  #insertIntentRecord(intent: IntentEnvelope): IntentEnvelope {
    assertIntentEnvelope(intent);
    const normalized = normalizeIntent(intent);
    const existing = this.getIntent(normalized.id);
    if (existing) {
      if (this.#integrityHashFor(existing) === this.#integrityHashFor(normalized)) return existing;
      throw new Error(`Intent ${normalized.id} conflicts with the stored record`);
    }
    const sealed = this.#sealRecord('intents', normalized.id, normalized);
    const stored = sealed.record;
    this.#database.prepare(`
      INSERT INTO intents (
        id, event_id, actor_entity_id, intent_type, status, route, risk,
        confidence, freshness_at, created_at, updated_at, integrity_hash, body
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      stored.id, stored.eventId ?? null, stored.actorEntityId ?? null,
      stored.kind, stored.status, stored.route, stored.risk, stored.confidence,
      stored.freshness?.observedAt ?? null, stored.createdAt, stored.updatedAt,
      sealed.integrityHash, sealed.body,
    );
    return stored;
  }

  #insertProposalRecord(proposal: Proposal): Proposal {
    assertProposal(proposal);
    const normalized = normalizeProposal(proposal);
    if (normalized.status !== LifecycleStatus.PendingApproval) {
      throw new Error(`Proposal ${normalized.id} initial lifecycle must be pending approval`);
    }
    const existingRow = this.#database.prepare('SELECT * FROM proposals WHERE id = ?').get(normalized.id);
    if (existingRow) {
      const existing = this.#readRecord<Proposal>(
        'proposals', String(existingRow.id), existingRow, (value) => assertProposal(value), (value) => value.id,
      );
      if (this.#integrityHashFor(existing) === this.#integrityHashFor(normalized)) return existing;
      throw new Error(`Proposal ${normalized.id} conflicts with the stored record`);
    }
    const sealed = this.#sealRecord('proposals', normalized.id, normalized);
    const stored = sealed.record;
    this.#database.prepare(`
      INSERT INTO proposals (
        id, assignment_id, mission_task_id, proposal_type, status, route,
        risk, confidence, created_at, expires_at, integrity_hash, body
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      stored.id, stored.assignmentId ?? null, stored.missionTaskId ?? null,
      stored.kind, stored.status, stored.route, stored.risk,
      stored.confidence ?? null, stored.createdAt, stored.expiresAt ?? null,
      sealed.integrityHash, sealed.body,
    );
    this.#appendChangeLog({
      kind: ChangeLogKind.ProposalChanged,
      recordType: 'proposal',
      recordId: stored.id,
      changedAt: stored.createdAt,
      payload: { status: stored.status, kind: stored.kind },
    });
    return stored;
  }

  #writeReceiptRecord(receipt: ActionReceipt): void {
    assertActionReceipt(receipt);
    const previous = this.#database.prepare(`
      SELECT status, started_at, completed_at, verified, external_id
      FROM receipts WHERE id = ?
    `).get(receipt.id);
    const sealed = this.#sealRecord('receipts', receipt.id, receipt);
    const stored = sealed.record;
    this.#database.prepare(`
      UPDATE receipts SET
        proposal_id = ?, assignment_id = ?, mission_task_id = ?, connector_id = ?,
        status = ?, route = ?, risk = ?, requested_at = ?, started_at = ?,
        completed_at = ?, integrity_hash = ?, body = ?, idempotency_key = ?,
        destination = ?, external_id = ?, verified = ?, verified_at = ?, attempt = ?
      WHERE id = ?
    `).run(
      stored.proposalId ?? null, stored.assignmentId ?? null,
      stored.missionTaskId ?? null, stored.connectorId ?? null, stored.status,
      stored.route, stored.risk, stored.requestedAt, stored.startedAt ?? null,
      stored.completedAt ?? null, sealed.integrityHash, sealed.body,
      stored.idempotencyKey, stored.destination, stored.externalId ?? null,
      stored.verified ? 1 : 0, stored.verifiedAt ?? null, stored.attempt, stored.id,
    );
    if (
      !previous ||
      previous.status !== stored.status ||
      (previous.started_at ?? null) !== (stored.startedAt ?? null) ||
      (previous.completed_at ?? null) !== (stored.completedAt ?? null) ||
      Number(previous.verified ?? 0) !== (stored.verified ? 1 : 0) ||
      (previous.external_id ?? null) !== (stored.externalId ?? null)
    ) {
      this.#appendChangeLog({
        kind: ChangeLogKind.ReceiptChanged,
        recordType: 'receipt',
        recordId: stored.id,
        changedAt: stored.completedAt ?? stored.startedAt ?? stored.requestedAt,
        payload: { status: stored.status, verified: stored.verified },
      });
    }
  }

  #writeProposalRecord(proposal: Proposal): void {
    assertProposal(proposal);
    const normalized = normalizeProposal(proposal);
    const sealed = this.#sealRecord('proposals', normalized.id, normalized);
    const stored = sealed.record;
    this.#database.prepare(`
      UPDATE proposals SET
        assignment_id = ?, mission_task_id = ?, proposal_type = ?, status = ?,
        route = ?, risk = ?, confidence = ?, created_at = ?, expires_at = ?,
        integrity_hash = ?, body = ?
      WHERE id = ?
    `).run(
      stored.assignmentId ?? null, stored.missionTaskId ?? null, stored.kind,
      stored.status, stored.route, stored.risk, stored.confidence ?? null,
      stored.createdAt, stored.expiresAt ?? null, sealed.integrityHash,
      sealed.body, stored.id,
    );
    this.#appendChangeLog({
      kind: ChangeLogKind.ProposalChanged,
      recordType: 'proposal',
      recordId: stored.id,
      changedAt: stored.createdAt,
      payload: { status: stored.status, kind: stored.kind },
    });
  }

  #writePreferenceRecord(preference: PreferenceChange): void {
    assertPreferenceChange(preference);
    const normalized = normalizePreference(preference);
    const sealed = this.#sealRecord(
      'preference_changes',
      normalized.id,
      normalized,
    );
    const stored = sealed.record;
    this.#database.prepare(`
      UPDATE preference_changes SET
        entity_id = ?, status = ?, route = ?, risk = ?, changed_at = ?,
        integrity_hash = ?, body = ?
      WHERE id = ?
    `).run(
      stored.entityId ?? null, stored.status, stored.route, stored.risk,
      stored.changedAt, sealed.integrityHash, sealed.body, stored.id,
    );
  }

  #writeTransaction<T>(operation: () => T): T {
    if (this.#writeTransactionDepth > 0) return operation();
    withBusyRetry(() => this.#database.exec('BEGIN IMMEDIATE'));
    this.#writeTransactionDepth = 1;
    try {
      const result = operation();
      this.#database.exec('COMMIT');
      return result;
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    } finally {
      this.#writeTransactionDepth = 0;
    }
  }

  #integrityHashFor(value: { integrityHash?: string } & object): string {
    const { integrityHash: _ignored, ...hashable } = value;
    return this.#crypto.integrityDigest(canonicalJson(hashable));
  }

  #sealRecord<T extends { integrityHash?: string } & object>(
    table: EncryptedRecordTable,
    rowId: string,
    value: T,
  ): { record: T; integrityHash: string; body: Buffer } {
    const integrityHash = this.#integrityHashFor(value);
    const record = { ...value, integrityHash } as T;
    const projection = recordProjection(table, record);
    return {
      record,
      integrityHash,
      body: this.#crypto.encryptJson(
        record,
        recordAssociatedData(this.#storeUuid, table, rowId, projection),
      ),
    };
  }

  #readRecord<T extends { integrityHash?: string } & object>(
    table: EncryptedRecordTable,
    rowId: string,
    row: DatabaseRow,
    validate: (value: unknown) => void,
    identity: (value: T) => string,
  ): T {
    const visibleProjection = rowProjection(table, row, rowId);
    const value = this.#crypto.decryptJson<unknown>(
      asBuffer(row.body),
      recordAssociatedData(
        this.#storeUuid,
        table,
        rowId,
        visibleProjection,
      ),
    );
    validate(value);
    const record = value as T;
    if (identity(record) !== rowId) {
      throw new Error(`${table}/${rowId} decrypted identity mismatch`);
    }
    const expectedProjection = recordProjection(table, record);
    if (canonicalJson(expectedProjection) !== canonicalJson(visibleProjection)) {
      throw new Error(`${table}/${rowId} visible projection mismatch`);
    }
    const expected = this.#integrityHashFor(record);
    if (
      !digestsEqual(record.integrityHash, expected) ||
      !digestsEqual(row.integrity_hash, expected)
    ) {
      throw new Error(`${table}/${rowId} integrity verification failed`);
    }
    return record;
  }

  close(): void {
    if (this.#database.isOpen) {
      this.#database.close();
    }
  }

  #migrate(): string {
    withBusyRetry(() => this.#database.exec('BEGIN IMMEDIATE'));
    try {
      this.#database.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        )
      `);
      const applied = new Set(
        this.#database
          .prepare('SELECT version FROM schema_migrations')
          .all()
          .map((row) => Number(row.version)),
      );
      const isBoundStore = applied.has(3);
      let storeUuid: string | undefined;
      if (isBoundStore) {
        if (!this.#tableExists('store_metadata')) {
          throw new Error(
            'Jericho store metadata is corrupt: metadata table is missing',
          );
        }
        if (!this.#metadataExists(KEY_VERIFIER_NAME)) {
          throw new Error(
            'Jericho store metadata is corrupt: key verifier is missing',
          );
        }
        storeUuid = this.#readStoreUuid();
        this.#verifyMasterKey(storeUuid);
        if (!applied.has(4) && this.#preV4OrchestrationStoreHasRows()) {
          throw new Error(
            'Refusing to migrate nonempty pre-v4 Jericho orchestration records',
          );
        }
      } else {
        if (this.#legacyStoreHasRows()) {
          throw new Error('Refusing to migrate nonempty pre-v3 Jericho store');
        }
        if (this.#tableExists('store_metadata')) {
          throw new Error(
            'Jericho store metadata is corrupt: v3 migration marker is missing',
          );
        }
      }
      for (const migration of MIGRATIONS) {
        if (applied.has(migration.version)) continue;
        this.#database.exec(migration.sql);
        this.#database
          .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
          .run(migration.version, new Date().toISOString());
      }
      storeUuid ??= this.#initializeStoreBinding();
      this.#database.exec('COMMIT');
      return storeUuid;
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  #tableExists(name: string): boolean {
    return Boolean(
      this.#database
        .prepare(`
          SELECT 1 AS present FROM sqlite_schema
          WHERE type = 'table' AND name = ?
        `)
        .get(name),
    );
  }

  #metadataExists(name: string): boolean {
    return Boolean(
      this.#database
        .prepare('SELECT 1 AS present FROM store_metadata WHERE name = ?')
        .get(name),
    );
  }

  #legacyStoreHasRows(): boolean {
    for (const table of LEGACY_RECORD_TABLES) {
      if (
        this.#tableExists(table) &&
        this.#database.prepare(`SELECT 1 AS present FROM ${table} LIMIT 1`).get()
      ) {
        return true;
      }
    }
    return false;
  }

  #preV4OrchestrationStoreHasRows(): boolean {
    for (const table of PRE_V4_ORCHESTRATION_TABLES) {
      if (
        this.#tableExists(table) &&
        this.#database.prepare(`SELECT 1 AS present FROM ${table} LIMIT 1`).get()
      ) {
        return true;
      }
    }
    return false;
  }

  #readStoreUuid(): string {
    const row = this.#database
      .prepare('SELECT value FROM store_metadata WHERE name = ?')
      .get(STORE_UUID_NAME);
    if (!row) {
      throw new Error('Jericho store metadata is corrupt: store UUID is missing');
    }
    if (!(row.value instanceof Uint8Array)) {
      throw new Error('Jericho store metadata is corrupt: store UUID is not a BLOB');
    }
    const storeUuid = Buffer.from(row.value).toString('utf8');
    if (!STORE_UUID_PATTERN.test(storeUuid)) {
      throw new Error('Jericho store metadata is corrupt: store UUID is invalid');
    }
    return storeUuid;
  }

  #initializeStoreBinding(): string {
    const storeUuid = randomUUID();
    const verifier = storeKeyVerifier(storeUuid);
    this.#database
      .prepare('INSERT INTO store_metadata (name, value) VALUES (?, ?)')
      .run(STORE_UUID_NAME, Buffer.from(storeUuid, 'utf8'));
    this.#database
      .prepare('INSERT INTO store_metadata (name, value) VALUES (?, ?)')
      .run(
        KEY_VERIFIER_NAME,
        this.#masterCrypto.encryptJson(
          verifier,
          metadataAssociatedData(storeUuid, KEY_VERIFIER_NAME),
        ),
      );
    return storeUuid;
  }

  #verifyMasterKey(storeUuid: string): void {
    const verifier = storeKeyVerifier(storeUuid);
    const row = this.#database
      .prepare('SELECT value FROM store_metadata WHERE name = ?')
      .get(KEY_VERIFIER_NAME);
    if (!row) {
      throw new Error(
        'Jericho store metadata is corrupt: key verifier is missing',
      );
    }
    try {
      const decrypted = this.#masterCrypto.decryptJson<typeof verifier>(
        asBuffer(row.value),
        metadataAssociatedData(storeUuid, KEY_VERIFIER_NAME),
      );
      if (
        decrypted.purpose !== verifier.purpose ||
        decrypted.version !== verifier.version ||
        decrypted.storeUuid !== verifier.storeUuid
      ) {
        throw new Error('Invalid Jericho store key verifier');
      }
    } catch (cause) {
      throw new Error('Jericho store master key does not match this database', {
        cause,
      });
    }
  }
}

function storeKeyVerifier(storeUuid: string) {
  return {
    purpose: 'jericho-core-store-key-verifier',
    version: 2,
    storeUuid,
  } as const;
}

function metadataAssociatedData(storeUuid: string, name: string): string {
  return JSON.stringify(['jericho-store-metadata', 2, storeUuid, name]);
}

function recordAssociatedData(
  storeUuid: string,
  table: EncryptedRecordTable,
  rowId: string,
  projection: RecordProjection,
): string {
  return canonicalJson([
    'jericho-store-record',
    2,
    storeUuid,
    table,
    rowId,
    projection,
  ]);
}

function recordProjection(
  table: EncryptedRecordTable,
  value: object,
): RecordProjection {
  switch (table) {
    case 'events': {
      const event = value as EventEnvelope;
      return {
        id: event.id,
        source: event.source,
        source_type: event.sourceType,
        source_event_id: event.sourceEventId,
        event_type: event.type,
        occurred_at: event.occurredAt,
        ingested_at: event.ingestedAt,
        status: event.status ?? null,
        route: event.route ?? null,
        risk: event.risk ?? null,
        confidence: event.confidence ?? null,
        freshness_at: event.freshness?.observedAt ?? null,
      };
    }
    case 'entities': {
      const entity = value as Entity;
      return {
        id: entity.id,
        entity_type: entity.type,
        status: entity.status ?? null,
        risk: entity.risk ?? null,
        confidence: entity.confidence ?? null,
        freshness_at: entity.freshness.observedAt,
        created_at: entity.createdAt,
        updated_at: entity.updatedAt,
      };
    }
    case 'relations': {
      const relation = value as Relation;
      return {
        id: relation.id,
        from_entity_id: relation.fromEntityId,
        to_entity_id: relation.toEntityId,
        relation_type: relation.type,
        status: relation.status ?? null,
        risk: relation.risk ?? null,
        confidence: relation.confidence ?? null,
        freshness_at: relation.freshness.observedAt,
        created_at: relation.createdAt,
        updated_at: relation.updatedAt,
      };
    }
    case 'intents': {
      const intent = value as IntentEnvelope;
      return {
        id: intent.id,
        event_id: intent.eventId ?? null,
        actor_entity_id: intent.actorEntityId ?? null,
        intent_type: intent.kind,
        status: intent.status,
        route: intent.route,
        risk: intent.risk,
        confidence: intent.confidence,
        freshness_at: intent.freshness?.observedAt ?? null,
        created_at: intent.createdAt,
        updated_at: intent.updatedAt,
      };
    }
    case 'missions': {
      const mission = value as MissionPlan;
      return {
        id: mission.id,
        intent_id: mission.intentId,
        status: mission.status,
        route: mission.route,
        risk: mission.risk,
        confidence: mission.confidence ?? null,
        freshness_at: mission.freshness?.observedAt ?? null,
        created_at: mission.createdAt,
        updated_at: mission.updatedAt,
        series_id: mission.seriesId,
        plan_version: mission.version,
        plan_hash: mission.planHash,
        approval_decision_id: mission.approvalDecisionId ?? null,
        approved_at: mission.approvedAt ?? null,
        started_at: mission.startedAt ?? null,
        completed_at: mission.completedAt ?? null,
        cancel_requested_at: mission.cancelRequestedAt ?? null,
      };
    }
    case 'mission_tasks': {
      const task = value as MissionTask;
      return {
        id: task.id,
        mission_id: task.missionId,
        task_type: task.kind,
        status: task.status,
        route: task.route,
        risk: task.risk,
        confidence: task.confidence ?? null,
        sequence: task.sequence,
        freshness_at: task.freshness?.observedAt ?? null,
        created_at: task.createdAt,
        updated_at: task.updatedAt,
        started_at: task.startedAt ?? null,
        completed_at: task.completedAt ?? null,
        lane: task.lane,
        selected_agent_id: task.selectedAgentId,
      };
    }
    case 'agent_capabilities': {
      const capability = value as AgentCapability;
      return {
        id: capability.id,
        agent_id: capability.agentId,
        status: capability.status,
        route: canonicalJson(capability.routes),
        risk: capability.maximumRisk,
        confidence: capability.confidence ?? null,
        freshness_at: capability.lastVerifiedAt ?? null,
        created_at: capability.createdAt,
        updated_at: capability.updatedAt,
        lane: capability.lane,
      };
    }
    case 'assignments': {
      const assignment = value as Assignment;
      return {
        id: assignment.id,
        mission_task_id: assignment.missionTaskId,
        agent_id: assignment.agentId,
        primary_capability_id: assignment.capabilityIds[0] ?? null,
        status: assignment.status,
        route: assignment.route,
        risk: assignment.risk,
        confidence: assignment.confidence ?? null,
        assigned_at: assignment.assignedAt,
        accepted_at: assignment.acceptedAt ?? null,
        completed_at: assignment.completedAt ?? null,
        mission_id: assignment.missionId,
        idempotency_key: assignment.idempotencyKey,
        attempt: assignment.attempt,
        max_attempts: assignment.maxAttempts,
        available_at: assignment.availableAt,
        estimated_cost_microusd: assignment.estimatedCostMicroUsd,
        lease_owner: assignment.leaseOwner ?? null,
        lease_token: assignment.leaseToken ?? null,
        lease_expires_at: assignment.leaseExpiresAt ?? null,
        cancel_requested_at: assignment.cancelRequestedAt ?? null,
      };
    }
    case 'proposals': {
      const proposal = value as Proposal;
      return {
        id: proposal.id,
        assignment_id: proposal.assignmentId ?? null,
        mission_task_id: proposal.missionTaskId ?? null,
        proposal_type: proposal.kind,
        status: proposal.status,
        route: proposal.route,
        risk: proposal.risk,
        confidence: proposal.confidence ?? null,
        created_at: proposal.createdAt,
        expires_at: proposal.expiresAt ?? null,
      };
    }
    case 'receipts': {
      const receipt = value as ActionReceipt;
      return {
        id: receipt.id,
        proposal_id: receipt.proposalId ?? null,
        assignment_id: receipt.assignmentId ?? null,
        mission_task_id: receipt.missionTaskId ?? null,
        connector_id: receipt.connectorId ?? null,
        status: receipt.status,
        route: receipt.route,
        risk: receipt.risk,
        requested_at: receipt.requestedAt,
        started_at: receipt.startedAt ?? null,
        completed_at: receipt.completedAt ?? null,
        idempotency_key: receipt.idempotencyKey,
        destination: receipt.destination,
        external_id: receipt.externalId ?? null,
        verified: receipt.verified ? 1 : 0,
        verified_at: receipt.verifiedAt ?? null,
        attempt: receipt.attempt,
      };
    }
    case 'decisions': {
      const decision = value as DecisionRecord;
      return {
        id: decision.id,
        intent_id: decision.intentId ?? null,
        mission_id: decision.missionId ?? null,
        mission_task_id: decision.missionTaskId ?? null,
        proposal_id: decision.proposalId ?? null,
        status: decision.outcome,
        route: decision.route,
        risk: decision.risk,
        confidence: decision.confidence ?? null,
        decided_at: decision.decidedAt,
        plan_hash: decision.planHash ?? null,
      };
    }
    case 'connector_health': {
      const health = value as ConnectorHealth;
      return {
        connector_id: health.connectorId,
        status: health.status,
        checked_at: health.checkedAt,
        last_success_at: health.lastSuccessAt ?? null,
        last_failure_at: health.lastFailureAt ?? null,
        latency_ms: health.latencyMs ?? null,
        consecutive_failures: health.consecutiveFailures,
        freshness_at: health.freshness.observedAt,
      };
    }
    case 'preference_changes': {
      const preference = value as PreferenceChange;
      return {
        id: preference.id,
        entity_id: preference.entityId ?? null,
        status: preference.status,
        route: preference.route,
        risk: preference.risk,
        changed_at: preference.changedAt,
      };
    }
    case 'cost_records': {
      const cost = value as CostRecord;
      return {
        id: cost.id,
        mission_id: cost.missionId,
        assignment_id: cost.assignmentId ?? null,
        category: cost.category,
        estimated_microusd: cost.estimatedMicroUsd,
        actual_microusd: cost.actualMicroUsd,
        idempotency_key: cost.idempotencyKey,
        incurred_at: cost.incurredAt,
      };
    }
    case 'connector_cursors': {
      const cursor = value as VersionedCursor;
      return {
        id: cursorRecordId(cursor.connectorId, cursor.capability, cursor.partition),
        connector_id: cursor.connectorId,
        capability: cursor.capability,
        partition_key: cursor.partition,
        cursor_version: cursor.version,
        epoch: cursor.epoch,
        sequence: cursor.sequence,
        updated_at: cursor.updatedAt,
      };
    }
    case 'connector_leases': {
      const lease = value as ConnectorLease;
      return {
        id: lease.id,
        connector_id: lease.connectorId,
        capability: lease.capability,
        owner_id: lease.ownerId,
        lease_token: lease.leaseToken,
        expires_at: lease.expiresAt,
        lease_version: lease.version,
        updated_at: lease.updatedAt,
      };
    }
    case 'external_identities': {
      const link = value as ExternalIdentityLink;
      return {
        id: link.id,
        connector_id: link.connectorId,
        namespace: link.namespace,
        external_id: link.externalId,
        entity_id: link.entityId,
        status: link.status,
        last_observed_at: link.lastObservedAt,
      };
    }
    case 'capture_failures': {
      const failure = value as CaptureFailure;
      return {
        id: failure.id,
        connector_id: failure.connectorId,
        capability: failure.capability,
        status: failure.status,
        route: failure.route,
        risk: failure.risk,
        occurred_at: failure.occurredAt,
      };
    }
    case 'change_log': {
      const change = value as ChangeLog;
      return {
        id: change.id,
        sequence: change.sequence,
        kind: change.kind,
        connector_id: change.connectorId ?? null,
        record_type: change.recordType,
        record_id: change.recordId,
        event_id: change.eventId ?? null,
        changed_at: change.changedAt,
      };
    }
  }
}

function rowProjection(
  table: EncryptedRecordTable,
  row: DatabaseRow,
  rowId: string,
): RecordProjection {
  return Object.fromEntries(
    projectionColumns(table).map((column) => [
      column,
      projectionValue(row[column], table, rowId, column),
    ]),
  );
}

function projectionColumns(table: EncryptedRecordTable): readonly string[] {
  switch (table) {
    case 'events':
      return [
        'id',
        'source',
        'source_type',
        'source_event_id',
        'event_type',
        'occurred_at',
        'ingested_at',
        'status',
        'route',
        'risk',
        'confidence',
        'freshness_at',
      ];
    case 'entities':
      return [
        'id',
        'entity_type',
        'status',
        'risk',
        'confidence',
        'freshness_at',
        'created_at',
        'updated_at',
      ];
    case 'relations':
      return [
        'id',
        'from_entity_id',
        'to_entity_id',
        'relation_type',
        'status',
        'risk',
        'confidence',
        'freshness_at',
        'created_at',
        'updated_at',
      ];
    case 'intents':
      return ['id', 'event_id', 'actor_entity_id', 'intent_type', 'status', 'route', 'risk', 'confidence', 'freshness_at', 'created_at', 'updated_at'];
    case 'missions':
      return ['id', 'intent_id', 'status', 'route', 'risk', 'confidence', 'freshness_at', 'created_at', 'updated_at', 'series_id', 'plan_version', 'plan_hash', 'approval_decision_id', 'approved_at', 'started_at', 'completed_at', 'cancel_requested_at'];
    case 'mission_tasks':
      return ['id', 'mission_id', 'task_type', 'status', 'route', 'risk', 'confidence', 'sequence', 'freshness_at', 'created_at', 'updated_at', 'started_at', 'completed_at', 'lane', 'selected_agent_id'];
    case 'agent_capabilities':
      return ['id', 'agent_id', 'status', 'route', 'risk', 'confidence', 'freshness_at', 'created_at', 'updated_at', 'lane'];
    case 'assignments':
      return ['id', 'mission_task_id', 'agent_id', 'primary_capability_id', 'status', 'route', 'risk', 'confidence', 'assigned_at', 'accepted_at', 'completed_at', 'mission_id', 'idempotency_key', 'attempt', 'max_attempts', 'available_at', 'estimated_cost_microusd', 'lease_owner', 'lease_token', 'lease_expires_at', 'cancel_requested_at'];
    case 'proposals':
      return ['id', 'assignment_id', 'mission_task_id', 'proposal_type', 'status', 'route', 'risk', 'confidence', 'created_at', 'expires_at'];
    case 'receipts':
      return ['id', 'proposal_id', 'assignment_id', 'mission_task_id', 'connector_id', 'status', 'route', 'risk', 'requested_at', 'started_at', 'completed_at', 'idempotency_key', 'destination', 'external_id', 'verified', 'verified_at', 'attempt'];
    case 'decisions':
      return ['id', 'intent_id', 'mission_id', 'mission_task_id', 'proposal_id', 'status', 'route', 'risk', 'confidence', 'decided_at', 'plan_hash'];
    case 'connector_health':
      return [
        'connector_id',
        'status',
        'checked_at',
        'last_success_at',
        'last_failure_at',
        'latency_ms',
        'consecutive_failures',
        'freshness_at',
      ];
    case 'preference_changes':
      return ['id', 'entity_id', 'status', 'route', 'risk', 'changed_at'];
    case 'cost_records':
      return ['id', 'mission_id', 'assignment_id', 'category', 'estimated_microusd', 'actual_microusd', 'idempotency_key', 'incurred_at'];
    case 'connector_cursors':
      return ['id', 'connector_id', 'capability', 'partition_key', 'cursor_version', 'epoch', 'sequence', 'updated_at'];
    case 'connector_leases':
      return ['id', 'connector_id', 'capability', 'owner_id', 'lease_token', 'expires_at', 'lease_version', 'updated_at'];
    case 'external_identities':
      return ['id', 'connector_id', 'namespace', 'external_id', 'entity_id', 'status', 'last_observed_at'];
    case 'capture_failures':
      return ['id', 'connector_id', 'capability', 'status', 'route', 'risk', 'occurred_at'];
    case 'change_log':
      return ['id', 'sequence', 'kind', 'connector_id', 'record_type', 'record_id', 'event_id', 'changed_at'];
  }
}

function projectionValue(
  value: SQLInputValue | undefined,
  table: EncryptedRecordTable,
  rowId: string,
  column: string,
): string | number | null {
  if (
    value === null ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  throw new Error(`${table}/${rowId} visible projection ${column} is invalid`);
}

function digestsEqual(first: unknown, second: unknown): boolean {
  if (
    typeof first !== 'string' ||
    typeof second !== 'string' ||
    !/^[0-9a-f]{64}$/.test(first) ||
    !/^[0-9a-f]{64}$/.test(second)
  ) {
    return false;
  }
  return timingSafeEqual(Buffer.from(first, 'hex'), Buffer.from(second, 'hex'));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const record = value as Record<string, JsonValue | undefined>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function asBuffer(value: SQLInputValue | undefined): Buffer {
  if (!(value instanceof Uint8Array)) {
    throw new Error('Encrypted SQLite body is not a BLOB');
  }
  return Buffer.from(value);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function sameStrings(first: readonly string[], second: readonly string[]): boolean {
  if (first.length !== second.length) return false;
  const left = [...first].sort();
  const right = [...second].sort();
  return left.every((value, index) => value === right[index]);
}

function withoutLease(assignment: Assignment): Assignment {
  const {
    leaseOwner: _leaseOwner,
    leaseToken: _leaseToken,
    leaseExpiresAt: _leaseExpiresAt,
    ...remaining
  } = assignment;
  return remaining;
}

function withoutCheckpointReasons(instructions: JsonObject): JsonObject {
  const { checkpointReasons: _checkpointReasons, ...remaining } = instructions;
  return remaining;
}

function checkpointProposal(
  assignment: Assignment,
  mission: MissionPlan,
  rawReasons: readonly string[],
  createdAt: string,
): Proposal {
  const reasons = uniqueStrings(rawReasons);
  const resumable = reasons.length > 0 && reasons.every((reason) => reason === 'concurrency_budget');
  const digest = createHash('sha256').update(canonicalJson({
    assignmentId: assignment.id,
    attempt: assignment.attempt,
    planHash: mission.planHash,
    reasons,
  })).digest('hex').slice(0, 32);
  const highRisk = reasons.some((reason) => [
    'destructive_mutation',
    'production_mutation',
    'contradictory_evidence',
    'uncertain_external_action',
  ].includes(reason));
  return {
    id: `checkpoint-${digest}`,
    assignmentId: assignment.id,
    missionTaskId: assignment.missionTaskId,
    proposedByAgentId: 'jericho:mission-runner',
    kind: ProposalKind.Action,
    summary: `Mission paused: ${reasons.map((reason) => reason.replaceAll('_', ' ')).join(', ')}`,
    body: {
      checkpoint: true,
      missionId: mission.id,
      assignmentId: assignment.id,
      planHash: mission.planHash,
      planVersion: mission.version,
      reasons,
      resumable,
      requiresNewPlan: !resumable,
    },
    status: LifecycleStatus.PendingApproval,
    route: RouteType.HumanApproval,
    risk: highRisk ? RiskLevel.High : RiskLevel.Medium,
    createdAt,
    provenance: [{
      source: 'local:mission-runner',
      sourceType: SourceType.System,
      sourceEventId: `checkpoint-${digest}`,
      observedAt: createdAt,
    }],
  };
}

function isCheckpointProposal(proposal: Proposal): boolean {
  return (
    proposal.kind === ProposalKind.Action &&
    proposal.body.checkpoint === true &&
    typeof proposal.body.missionId === 'string' &&
    typeof proposal.body.assignmentId === 'string' &&
    typeof proposal.body.planHash === 'string' &&
    Number.isInteger(proposal.body.planVersion) &&
    Array.isArray(proposal.body.reasons) &&
    proposal.body.reasons.every((reason) => typeof reason === 'string') &&
    typeof proposal.body.resumable === 'boolean' &&
    typeof proposal.body.requiresNewPlan === 'boolean'
  );
}

function assertLifecycleTransition(
  kind: 'proposal' | 'preference',
  actual: LifecycleStatus,
  expected: LifecycleStatus,
  next: LifecycleStatus,
): void {
  if (actual !== expected) {
    throw new Error(`${kind} lifecycle transition expected ${expected} but found ${actual}`);
  }
  const common = new Map<LifecycleStatus, readonly LifecycleStatus[]>([
    [LifecycleStatus.Draft, [LifecycleStatus.PendingApproval]],
    [LifecycleStatus.PendingApproval, [LifecycleStatus.Approved, LifecycleStatus.Rejected]],
    [LifecycleStatus.Approved, [LifecycleStatus.Active, LifecycleStatus.Archived]],
    [LifecycleStatus.Active, [LifecycleStatus.Archived]],
  ]);
  if (!common.get(actual)?.includes(next)) {
    throw new Error(`Invalid ${kind} lifecycle transition from ${actual} to ${next}`);
  }
}

function assertDecisionMatchesStatus(
  decision: DecisionRecord,
  status: LifecycleStatus,
): void {
  if (
    (status === LifecycleStatus.Approved && decision.outcome !== DecisionOutcome.Approved) ||
    (status === LifecycleStatus.Rejected && decision.outcome !== DecisionOutcome.Rejected)
  ) {
    throw new Error(`Decision outcome does not authorize ${status} transition`);
  }
}

function maximumDefined(
  first: number | undefined,
  second: number | undefined,
): number | undefined {
  if (first === undefined) return second;
  if (second === undefined) return first;
  return Math.max(first, second);
}

function mergeProvenance(
  current: readonly Provenance[],
  incoming: readonly Provenance[],
): Provenance[] {
  const byValue = new Map<string, Provenance>();
  for (const item of [...current, ...incoming]) {
    byValue.set(canonicalJson(item), item);
  }
  return [...byValue.values()];
}

function normalizeEvent(event: EventEnvelope): EventEnvelope {
  return {
    ...event,
    occurredAt: normalizeTimestamp(event.occurredAt),
    ingestedAt: normalizeTimestamp(event.ingestedAt),
    ...(event.freshness
      ? { freshness: normalizeFreshness(event.freshness) }
      : {}),
    provenance: event.provenance.map(normalizeProvenance),
  };
}

function normalizeEntity(entity: Entity): Entity {
  return {
    ...entity,
    freshness: normalizeFreshness(entity.freshness),
    provenance: entity.provenance.map(normalizeProvenance),
    createdAt: normalizeTimestamp(entity.createdAt),
    updatedAt: normalizeTimestamp(entity.updatedAt),
  };
}

function normalizeRelation(relation: Relation): Relation {
  return {
    ...relation,
    freshness: normalizeFreshness(relation.freshness),
    provenance: relation.provenance.map(normalizeProvenance),
    createdAt: normalizeTimestamp(relation.createdAt),
    updatedAt: normalizeTimestamp(relation.updatedAt),
  };
}

function normalizeConnectorHealth(health: ConnectorHealth): ConnectorHealth {
  return {
    ...health,
    checkedAt: normalizeTimestamp(health.checkedAt),
    ...(health.lastSuccessAt
      ? { lastSuccessAt: normalizeTimestamp(health.lastSuccessAt) }
      : {}),
    ...(health.lastFailureAt
      ? { lastFailureAt: normalizeTimestamp(health.lastFailureAt) }
      : {}),
    freshness: normalizeFreshness(health.freshness),
    capabilities: health.capabilities.map((capability) => ({
      ...capability,
      checkedAt: normalizeTimestamp(capability.checkedAt),
      ...(capability.lastSuccessAt
        ? { lastSuccessAt: normalizeTimestamp(capability.lastSuccessAt) }
        : {}),
      ...(capability.lastFailureAt
        ? { lastFailureAt: normalizeTimestamp(capability.lastFailureAt) }
        : {}),
    })),
    provenance: health.provenance.map(normalizeProvenance),
  };
}

function aggregateConnectorHealth(
  capabilities: readonly ConnectorCapabilityHealth[],
): ConnectorHealthStatus {
  if (capabilities.length === 0) return ConnectorHealthStatus.Unknown;
  if (capabilities.every((item) => item.status === ConnectorHealthStatus.Disabled)) {
    return ConnectorHealthStatus.Disabled;
  }
  const rank: Record<ConnectorHealthStatus, number> = {
    [ConnectorHealthStatus.Disabled]: 0,
    [ConnectorHealthStatus.Healthy]: 1,
    [ConnectorHealthStatus.Unknown]: 2,
    [ConnectorHealthStatus.Degraded]: 3,
    [ConnectorHealthStatus.Unavailable]: 4,
    [ConnectorHealthStatus.Unauthorized]: 5,
  };
  return capabilities.reduce<ConnectorHealthStatus>((worst, item) =>
    rank[item.status] > rank[worst] ? item.status : worst,
  ConnectorHealthStatus.Disabled);
}

function latestOptionalTimestamp(
  first: string | undefined,
  second: string | undefined,
): string | undefined {
  if (!first) return second;
  if (!second) return first;
  return laterTimestamp(first, second);
}

function normalizeIntent(intent: IntentEnvelope): IntentEnvelope {
  return {
    ...intent,
    deadlines: intent.deadlines.map((deadline) => ({
      ...deadline,
      at: normalizeTimestamp(deadline.at),
    })),
    ...(intent.freshness ? { freshness: normalizeFreshness(intent.freshness) } : {}),
    provenance: intent.provenance.map(normalizeProvenance),
    createdAt: normalizeTimestamp(intent.createdAt),
    updatedAt: normalizeTimestamp(intent.updatedAt),
  };
}

function normalizeMission(mission: MissionPlan): MissionPlan {
  return {
    ...mission,
    ...(mission.approvedAt ? { approvedAt: normalizeTimestamp(mission.approvedAt) } : {}),
    ...(mission.startedAt ? { startedAt: normalizeTimestamp(mission.startedAt) } : {}),
    ...(mission.completedAt ? { completedAt: normalizeTimestamp(mission.completedAt) } : {}),
    ...(mission.cancelRequestedAt ? { cancelRequestedAt: normalizeTimestamp(mission.cancelRequestedAt) } : {}),
    ...(mission.freshness ? { freshness: normalizeFreshness(mission.freshness) } : {}),
    provenance: mission.provenance.map(normalizeProvenance),
    createdAt: normalizeTimestamp(mission.createdAt),
    updatedAt: normalizeTimestamp(mission.updatedAt),
  };
}

function normalizeMissionTask(task: MissionTask): MissionTask {
  return {
    ...task,
    ...(task.freshness ? { freshness: normalizeFreshness(task.freshness) } : {}),
    provenance: task.provenance.map(normalizeProvenance),
    createdAt: normalizeTimestamp(task.createdAt),
    updatedAt: normalizeTimestamp(task.updatedAt),
    ...(task.startedAt ? { startedAt: normalizeTimestamp(task.startedAt) } : {}),
    ...(task.completedAt ? { completedAt: normalizeTimestamp(task.completedAt) } : {}),
  };
}

function normalizeCapability(capability: AgentCapability): AgentCapability {
  return {
    ...capability,
    ...(capability.lastVerifiedAt ? { lastVerifiedAt: normalizeTimestamp(capability.lastVerifiedAt) } : {}),
    provenance: capability.provenance.map(normalizeProvenance),
    createdAt: normalizeTimestamp(capability.createdAt),
    updatedAt: normalizeTimestamp(capability.updatedAt),
  };
}

function normalizeAssignment(assignment: Assignment): Assignment {
  return {
    ...assignment,
    availableAt: normalizeTimestamp(assignment.availableAt),
    assignedAt: normalizeTimestamp(assignment.assignedAt),
    ...(assignment.acceptedAt ? { acceptedAt: normalizeTimestamp(assignment.acceptedAt) } : {}),
    ...(assignment.completedAt ? { completedAt: normalizeTimestamp(assignment.completedAt) } : {}),
    ...(assignment.leaseExpiresAt ? { leaseExpiresAt: normalizeTimestamp(assignment.leaseExpiresAt) } : {}),
    ...(assignment.cancelRequestedAt ? { cancelRequestedAt: normalizeTimestamp(assignment.cancelRequestedAt) } : {}),
    provenance: assignment.provenance.map(normalizeProvenance),
  };
}

function normalizeProposal(proposal: Proposal): Proposal {
  return {
    ...proposal,
    createdAt: normalizeTimestamp(proposal.createdAt),
    ...(proposal.expiresAt ? { expiresAt: normalizeTimestamp(proposal.expiresAt) } : {}),
    provenance: proposal.provenance.map(normalizeProvenance),
  };
}

function normalizeDecision(decision: DecisionRecord): DecisionRecord {
  return {
    ...decision,
    decidedAt: normalizeTimestamp(decision.decidedAt),
    provenance: decision.provenance.map(normalizeProvenance),
  };
}

function normalizePreference(preference: PreferenceChange): PreferenceChange {
  return {
    ...preference,
    changedAt: normalizeTimestamp(preference.changedAt),
    provenance: preference.provenance.map(normalizeProvenance),
  };
}

function normalizeReceipt(receipt: ActionReceipt): ActionReceipt {
  return {
    ...receipt,
    requestedAt: normalizeTimestamp(receipt.requestedAt),
    ...(receipt.startedAt ? { startedAt: normalizeTimestamp(receipt.startedAt) } : {}),
    ...(receipt.completedAt ? { completedAt: normalizeTimestamp(receipt.completedAt) } : {}),
    ...(receipt.verifiedAt ? { verifiedAt: normalizeTimestamp(receipt.verifiedAt) } : {}),
    provenance: receipt.provenance.map(normalizeProvenance),
  };
}

function normalizeCost(cost: CostRecord): CostRecord {
  return {
    ...cost,
    incurredAt: normalizeTimestamp(cost.incurredAt),
    provenance: cost.provenance.map(normalizeProvenance),
  };
}

function normalizeCursor(cursor: VersionedCursor): VersionedCursor {
  return {
    ...cursor,
    updatedAt: normalizeTimestamp(cursor.updatedAt),
    ...(cursor.watermark ? { watermark: normalizeTimestamp(cursor.watermark) } : {}),
    ...(cursor.overlapFrom ? { overlapFrom: normalizeTimestamp(cursor.overlapFrom) } : {}),
  };
}

function cursorRecordId(
  connectorId: string,
  capability: ConnectorCapability,
  partition: string,
): string {
  return `${connectorId}:${capability}:${partition}`;
}

function connectorLeaseId(
  connectorId: string,
  capability: ConnectorCapability,
): string {
  return `${connectorId}:${capability}`;
}

function normalizeFreshness(freshness: Freshness): Freshness {
  return {
    ...freshness,
    observedAt: normalizeTimestamp(freshness.observedAt),
    ...(freshness.validAt
      ? { validAt: normalizeTimestamp(freshness.validAt) }
      : {}),
    ...(freshness.staleAt
      ? { staleAt: normalizeTimestamp(freshness.staleAt) }
      : {}),
    ...(freshness.expiresAt
      ? { expiresAt: normalizeTimestamp(freshness.expiresAt) }
      : {}),
  };
}

function normalizeProvenance(provenance: Provenance): Provenance {
  return {
    ...provenance,
    observedAt: normalizeTimestamp(provenance.observedAt),
    ...(provenance.receivedAt
      ? { receivedAt: normalizeTimestamp(provenance.receivedAt) }
      : {}),
  };
}

function normalizeTimestamp(timestamp: string): string {
  return new Date(timestamp).toISOString();
}

function timestampEpoch(timestamp: string): number {
  return Date.parse(timestamp);
}

function earlierTimestamp(first: string, second: string): string {
  return timestampEpoch(first) <= timestampEpoch(second) ? first : second;
}

function laterTimestamp(first: string, second: string): string {
  return timestampEpoch(first) >= timestampEpoch(second) ? first : second;
}

const BUSY_WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4));

function withBusyRetry<T>(operation: () => T): T {
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      return operation();
    } catch (error) {
      if (!isSqliteBusy(error) || Date.now() >= deadline) throw error;
      Atomics.wait(BUSY_WAIT_BUFFER, 0, 0, 20);
    }
  }
}

function isSqliteBusy(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'errcode' in error &&
    error.errcode === 5
  );
}
