import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import {
  assertEventEnvelope,
  type ConnectorHealth,
  type ConnectorHealthStatus,
  type Entity,
  type EntityType,
  type EventEnvelope,
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
];

export class JerichoStore {
  readonly #database: DatabaseSync;
  readonly #crypto: CoreCrypto;

  constructor(options: JerichoStoreOptions = {}) {
    const databasePath = options.path ?? join(homedir(), '.jericho', 'jericho.db');
    if (databasePath !== ':memory:') {
      mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
    }

    this.#database = new DatabaseSync(databasePath);
    if (databasePath !== ':memory:') {
      chmodSync(databasePath, 0o600);
    }
    this.#database.exec('PRAGMA foreign_keys = ON');
    if (databasePath !== ':memory:') {
      this.#database.exec('PRAGMA journal_mode = WAL');
    }
    this.#crypto = new CoreCrypto(options.key ?? loadMasterKey());
    this.#migrate();
  }

  appendEvent(event: EventEnvelope): AppendEventResult {
    assertEventEnvelope(event);
    const integrityHash = integrityHashFor(event);
    const existing = this.#database
      .prepare(`
        SELECT integrity_hash, body
        FROM events
        WHERE source = ? AND source_event_id = ?
      `)
      .get(event.source, event.sourceEventId);
    if (existing?.integrity_hash === integrityHash) {
      return {
        event: this.#crypto.decryptJson<EventEnvelope>(asBuffer(existing.body)),
        inserted: false,
      };
    }
    if (existing) {
      throw new EventConflictError(event.source, event.sourceEventId);
    }
    const storedEvent: EventEnvelope = { ...event, integrityHash };
    const encryptedBody = this.#crypto.encryptJson(storedEvent);

    this.#database
      .prepare(`
        INSERT INTO events (
          id, source, source_type, source_event_id, event_type,
          occurred_at, ingested_at, status, route, risk, confidence,
          freshness_at, integrity_hash, body
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        event.id,
        event.source,
        event.sourceType,
        event.sourceEventId,
        event.type,
        event.occurredAt,
        event.ingestedAt,
        event.status ?? null,
        event.route ?? null,
        event.risk ?? null,
        event.confidence ?? null,
        event.freshness?.observedAt ?? null,
        integrityHash,
        encryptedBody,
      );

    return { event: storedEvent, inserted: true };
  }

  getEvent(id: string): EventEnvelope | undefined {
    const row = this.#database.prepare('SELECT body FROM events WHERE id = ?').get(id);
    if (!row) {
      return undefined;
    }
    return this.#crypto.decryptJson<EventEnvelope>(asBuffer(row.body));
  }

  upsertEntity(entity: Entity): Entity {
    const current = this.getEntity(entity.id);
    const incomingIsNewer =
      !current || entity.freshness.observedAt >= current.freshness.observedAt;
    const reconciled: Entity = current
      ? {
          ...current,
          ...(incomingIsNewer
            ? {
                type: entity.type,
                canonicalName: entity.canonicalName,
                status: entity.status,
                risk: entity.risk,
                freshness: entity.freshness,
              }
            : {}),
          aliases: uniqueStrings([...current.aliases, ...entity.aliases]),
          attributes: { ...current.attributes, ...entity.attributes },
          confidence: maximumDefined(current.confidence, entity.confidence),
          provenance: mergeProvenance(current.provenance, entity.provenance),
          createdAt:
            current.createdAt <= entity.createdAt ? current.createdAt : entity.createdAt,
          updatedAt:
            current.updatedAt >= entity.updatedAt ? current.updatedAt : entity.updatedAt,
        }
      : { ...entity };
    const integrityHash = integrityHashFor(reconciled);
    const stored: Entity = { ...reconciled, integrityHash };

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
        integrityHash,
        this.#crypto.encryptJson(stored),
      );
    return stored;
  }

  getEntity(id: string): Entity | undefined {
    const row = this.#database.prepare('SELECT body FROM entities WHERE id = ?').get(id);
    if (!row) {
      return undefined;
    }
    return this.#crypto.decryptJson<Entity>(asBuffer(row.body));
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
      parameters.push(options.freshAfter);
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    return this.#database
      .prepare(`SELECT body FROM entities${where} ORDER BY updated_at DESC, id ASC`)
      .all(...parameters)
      .map((row) => this.#crypto.decryptJson<Entity>(asBuffer(row.body)));
  }

  upsertRelation(relation: Relation): Relation {
    const row = this.#database
      .prepare(`
        SELECT body FROM relations
        WHERE from_entity_id = ? AND to_entity_id = ? AND relation_type = ?
      `)
      .get(relation.fromEntityId, relation.toEntityId, relation.type);
    const current = row
      ? this.#crypto.decryptJson<Relation>(asBuffer(row.body))
      : undefined;
    const incomingIsNewer =
      !current || relation.freshness.observedAt >= current.freshness.observedAt;
    const reconciled: Relation = current
      ? {
          ...current,
          ...(incomingIsNewer
            ? {
                status: relation.status,
                risk: relation.risk,
                freshness: relation.freshness,
              }
            : {}),
          attributes: { ...current.attributes, ...relation.attributes },
          confidence: maximumDefined(current.confidence, relation.confidence),
          provenance: mergeProvenance(current.provenance, relation.provenance),
          createdAt:
            current.createdAt <= relation.createdAt
              ? current.createdAt
              : relation.createdAt,
          updatedAt:
            current.updatedAt >= relation.updatedAt
              ? current.updatedAt
              : relation.updatedAt,
        }
      : { ...relation };
    const integrityHash = integrityHashFor(reconciled);
    const stored: Relation = { ...reconciled, integrityHash };

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
        integrityHash,
        this.#crypto.encryptJson(stored),
      );
    return stored;
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
      .prepare(`SELECT body FROM relations${where} ORDER BY updated_at DESC, id ASC`)
      .all(...parameters)
      .map((item) => this.#crypto.decryptJson<Relation>(asBuffer(item.body)));
  }

  upsertConnectorHealth(health: ConnectorHealth): ConnectorHealth {
    const existing = this.#database
      .prepare('SELECT body FROM connector_health WHERE connector_id = ?')
      .get(health.connectorId);
    if (existing) {
      const current = this.#crypto.decryptJson<ConnectorHealth>(
        asBuffer(existing.body),
      );
      if (current.checkedAt > health.checkedAt) {
        return current;
      }
    }

    const integrityHash = integrityHashFor(health);
    const stored: ConnectorHealth = { ...health, integrityHash };
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
        integrityHash,
        this.#crypto.encryptJson(stored),
      );
    return stored;
  }

  listConnectorHealth(
    options: ConnectorHealthListOptions = {},
  ): ConnectorHealth[] {
    const rows = options.status
      ? this.#database
          .prepare(`
            SELECT body FROM connector_health
            WHERE status = ?
            ORDER BY checked_at DESC, connector_id ASC
          `)
          .all(options.status)
      : this.#database
          .prepare(`
            SELECT body FROM connector_health
            ORDER BY checked_at DESC, connector_id ASC
          `)
          .all();
    return rows.map((row) =>
      this.#crypto.decryptJson<ConnectorHealth>(asBuffer(row.body)),
    );
  }

  close(): void {
    if (this.#database.isOpen) {
      this.#database.close();
    }
  }

  #migrate(): void {
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

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) {
        continue;
      }
      this.#database.exec('BEGIN IMMEDIATE');
      try {
        this.#database.exec(migration.sql);
        this.#database
          .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
          .run(migration.version, new Date().toISOString());
        this.#database.exec('COMMIT');
      } catch (error) {
        this.#database.exec('ROLLBACK');
        throw error;
      }
    }
  }
}

function integrityHashFor(value: { integrityHash?: string } & object): string {
  const { integrityHash: _ignored, ...hashable } = value;
  return createHash('sha256').update(canonicalJson(hashable)).digest('hex');
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
