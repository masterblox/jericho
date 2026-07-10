import { timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import {
  assertConnectorHealth,
  assertEntity,
  assertEventEnvelope,
  assertRelation,
  type ConnectorHealth,
  type ConnectorHealthStatus,
  type Entity,
  type EntityType,
  type EventEnvelope,
  type Freshness,
  type JsonValue,
  type LifecycleStatus,
  type Provenance,
  type Relation,
  type RelationType,
} from '@jericho/shared';

import { CoreCrypto, loadMasterKey } from './crypto.js';

export interface JerichoStoreOptions {
  path?: string;
  key?: Buffer;
}

export interface AppendEventResult {
  event: EventEnvelope;
  inserted: boolean;
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

export class EventConflictError extends Error {
  constructor(source: string, sourceEventId: string) {
    super(`Conflicting event for ${source}/${sourceEventId}`);
    this.name = 'EventConflictError';
  }
}

interface Migration {
  version: number;
  sql: string;
}

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
];

export class JerichoStore {
  readonly #database: DatabaseSync;
  readonly #crypto: CoreCrypto;

  constructor(options: JerichoStoreOptions = {}) {
    this.#crypto = new CoreCrypto(options.key ?? loadMasterKey());
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
      this.#migrate();
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  appendEvent(event: EventEnvelope): AppendEventResult {
    assertEventEnvelope(event);
    const normalized = normalizeEvent(event);
    assertEventEnvelope(normalized);
    return this.#writeTransaction(() => {
      const integrityHash = this.#integrityHashFor(normalized);
      const existing = this.#database
        .prepare(`
          SELECT id, integrity_hash, body
          FROM events
          WHERE source = ? AND source_event_id = ?
        `)
        .get(normalized.source, normalized.sourceEventId);
      if (existing) {
        const existingEvent = this.#readRecord<EventEnvelope>(
          'events',
          String(existing.id),
          existing.body,
          existing.integrity_hash,
          (value) => assertEventEnvelope(value),
          (value) => value.id,
        );
        if (digestsEqual(existing.integrity_hash, integrityHash)) {
          return { event: existingEvent, inserted: false };
        }
        throw new EventConflictError(normalized.source, normalized.sourceEventId);
      }
      const sealed = this.#sealRecord('events', normalized.id, normalized);

      this.#database
        .prepare(`
          INSERT INTO events (
            id, source, source_type, source_event_id, event_type,
            occurred_at, ingested_at, status, route, risk, confidence,
            freshness_at, integrity_hash, body
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          normalized.id,
          normalized.source,
          normalized.sourceType,
          normalized.sourceEventId,
          normalized.type,
          normalized.occurredAt,
          normalized.ingestedAt,
          normalized.status ?? null,
          normalized.route ?? null,
          normalized.risk ?? null,
          normalized.confidence ?? null,
          normalized.freshness?.observedAt ?? null,
          sealed.integrityHash,
          sealed.body,
        );

      return { event: sealed.record, inserted: true };
    });
  }

  getEvent(id: string): EventEnvelope | undefined {
    const row = this.#database
      .prepare('SELECT id, integrity_hash, body FROM events WHERE id = ?')
      .get(id);
    if (!row) {
      return undefined;
    }
    return this.#readRecord<EventEnvelope>(
      'events',
      String(row.id),
      row.body,
      row.integrity_hash,
      (value) => assertEventEnvelope(value),
      (value) => value.id,
    );
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
      const reconciled: Entity = current
        ? {
            ...current,
            ...(incomingIsNewer
              ? {
                  type: incoming.type,
                  canonicalName: incoming.canonicalName,
                  status: incoming.status,
                  risk: incoming.risk,
                  freshness: incoming.freshness,
                }
              : {}),
            aliases: uniqueStrings([...current.aliases, ...incoming.aliases]),
            attributes: incomingIsNewer
              ? { ...current.attributes, ...incoming.attributes }
              : { ...incoming.attributes, ...current.attributes },
            confidence: maximumDefined(current.confidence, incoming.confidence),
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
      .prepare('SELECT id, integrity_hash, body FROM entities WHERE id = ?')
      .get(id);
    if (!row) {
      return undefined;
    }
    return this.#readRecord<Entity>(
      'entities',
      String(row.id),
      row.body,
      row.integrity_hash,
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
        `SELECT id, integrity_hash, body FROM entities${where} ORDER BY updated_at DESC, id ASC`,
      )
      .all(...parameters)
      .map((row) =>
        this.#readRecord<Entity>(
          'entities',
          String(row.id),
          row.body,
          row.integrity_hash,
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
          SELECT id, integrity_hash, body FROM relations
          WHERE from_entity_id = ? AND to_entity_id = ? AND relation_type = ?
        `)
        .get(incoming.fromEntityId, incoming.toEntityId, incoming.type);
      const current = row
        ? this.#readRecord<Relation>(
            'relations',
            String(row.id),
            row.body,
            row.integrity_hash,
            (value) => assertRelation(value),
            (value) => value.id,
          )
        : undefined;
      const incomingIsNewer =
        !current ||
        timestampEpoch(incoming.freshness.observedAt) >
          timestampEpoch(current.freshness.observedAt);
      const reconciled: Relation = current
        ? {
            ...current,
            ...(incomingIsNewer
              ? {
                  status: incoming.status,
                  risk: incoming.risk,
                  freshness: incoming.freshness,
                }
              : {}),
            attributes: incomingIsNewer
              ? { ...current.attributes, ...incoming.attributes }
              : { ...incoming.attributes, ...current.attributes },
            confidence: maximumDefined(current.confidence, incoming.confidence),
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
        `SELECT id, integrity_hash, body FROM relations${where} ORDER BY updated_at DESC, id ASC`,
      )
      .all(...parameters)
      .map((item) =>
        this.#readRecord<Relation>(
          'relations',
          String(item.id),
          item.body,
          item.integrity_hash,
          (value) => assertRelation(value),
          (value) => value.id,
        ),
      );
  }

  upsertConnectorHealth(health: ConnectorHealth): ConnectorHealth {
    assertConnectorHealth(health);
    const normalized = normalizeConnectorHealth(health);
    assertConnectorHealth(normalized);
    return this.#writeTransaction(() => {
      const existing = this.#database
        .prepare(
          'SELECT connector_id, integrity_hash, body FROM connector_health WHERE connector_id = ?',
        )
        .get(normalized.connectorId);
      if (existing) {
        const current = this.#readRecord<ConnectorHealth>(
          'connector_health',
          String(existing.connector_id),
          existing.body,
          existing.integrity_hash,
          (value) => assertConnectorHealth(value),
          (value) => value.connectorId,
        );
        if (
          timestampEpoch(current.checkedAt) >= timestampEpoch(normalized.checkedAt)
        ) {
          return current;
        }
      }

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
            SELECT connector_id, integrity_hash, body FROM connector_health
            WHERE status = ?
            ORDER BY checked_at DESC, connector_id ASC
          `)
          .all(options.status)
      : this.#database
          .prepare(`
            SELECT connector_id, integrity_hash, body FROM connector_health
            ORDER BY checked_at DESC, connector_id ASC
          `)
          .all();
    return rows.map((row) =>
      this.#readRecord<ConnectorHealth>(
        'connector_health',
        String(row.connector_id),
        row.body,
        row.integrity_hash,
        (value) => assertConnectorHealth(value),
        (value) => value.connectorId,
      ),
    );
  }

  #writeTransaction<T>(operation: () => T): T {
    withBusyRetry(() => this.#database.exec('BEGIN IMMEDIATE'));
    try {
      const result = operation();
      this.#database.exec('COMMIT');
      return result;
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  #integrityHashFor(value: { integrityHash?: string } & object): string {
    const { integrityHash: _ignored, ...hashable } = value;
    return this.#crypto.integrityDigest(canonicalJson(hashable));
  }

  #sealRecord<T extends { integrityHash?: string } & object>(
    table: string,
    rowId: string,
    value: T,
  ): { record: T; integrityHash: string; body: Buffer } {
    const integrityHash = this.#integrityHashFor(value);
    const record = { ...value, integrityHash } as T;
    return {
      record,
      integrityHash,
      body: this.#crypto.encryptJson(
        record,
        recordAssociatedData(table, rowId),
      ),
    };
  }

  #readRecord<T extends { integrityHash?: string } & object>(
    table: string,
    rowId: string,
    body: SQLInputValue | undefined,
    visibleIntegrity: SQLInputValue | undefined,
    validate: (value: unknown) => void,
    identity: (value: T) => string,
  ): T {
    const value = this.#crypto.decryptJson<unknown>(
      asBuffer(body),
      recordAssociatedData(table, rowId),
    );
    validate(value);
    const record = value as T;
    if (identity(record) !== rowId) {
      throw new Error(`${table}/${rowId} decrypted identity mismatch`);
    }
    const expected = this.#integrityHashFor(record);
    if (
      !digestsEqual(record.integrityHash, expected) ||
      !digestsEqual(visibleIntegrity, expected)
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

  #migrate(): void {
    withBusyRetry(() => this.#database.exec('BEGIN IMMEDIATE'));
    try {
      this.#database.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        )
      `);
      if (this.#hasKeyVerifier()) {
        this.#verifyMasterKey();
      }
      const applied = new Set(
        this.#database
          .prepare('SELECT version FROM schema_migrations')
          .all()
          .map((row) => Number(row.version)),
      );
      for (const migration of MIGRATIONS) {
        if (applied.has(migration.version)) continue;
        this.#database.exec(migration.sql);
        this.#database
          .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
          .run(migration.version, new Date().toISOString());
      }
      this.#verifyMasterKey();
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  #hasKeyVerifier(): boolean {
    const table = this.#database
      .prepare(`
        SELECT 1 AS present FROM sqlite_schema
        WHERE type = 'table' AND name = 'store_metadata'
      `)
      .get();
    if (!table) return false;
    return Boolean(
      this.#database
        .prepare('SELECT 1 AS present FROM store_metadata WHERE name = ?')
        .get('key-verifier'),
    );
  }

  #verifyMasterKey(): void {
    const name = 'key-verifier';
    const associatedData = recordAssociatedData('store_metadata', name);
    const verifier = {
      purpose: 'jericho-core-store-key-verifier',
      version: 1,
    };
    this.#database
      .prepare('INSERT OR IGNORE INTO store_metadata (name, value) VALUES (?, ?)')
      .run(name, this.#crypto.encryptJson(verifier, associatedData));
    const row = this.#database
      .prepare('SELECT value FROM store_metadata WHERE name = ?')
      .get(name);
    try {
      const decrypted = this.#crypto.decryptJson<typeof verifier>(
        asBuffer(row?.value),
        associatedData,
      );
      if (
        decrypted.purpose !== verifier.purpose ||
        decrypted.version !== verifier.version
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

function recordAssociatedData(table: string, rowId: string): string {
  return JSON.stringify(['jericho-store', 1, table, rowId]);
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
    provenance: health.provenance.map(normalizeProvenance),
  };
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
