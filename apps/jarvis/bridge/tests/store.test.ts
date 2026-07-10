import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ConnectorHealthStatus,
  EntityType,
  LifecycleStatus,
  RelationType,
  RiskLevel,
  RouteType,
  SourceType,
  type ConnectorHealth,
  type Entity,
  type EventEnvelope,
  type Relation,
} from '@jericho/shared';

import { JerichoStore } from '../src/core/store.js';

const KEY = Buffer.alloc(32, 41);
const openStores: JerichoStore[] = [];
const tempDirectories: string[] = [];

afterEach(() => {
  for (const store of openStores.splice(0)) {
    store.close();
  }
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('JerichoStore events', () => {
  it('appends and retrieves an immutable encrypted event', () => {
    const store = openStore();
    const event = makeEvent();

    const appended = store.appendEvent(event);

    expect(appended.inserted).toBe(true);
    expect(appended.event.integrityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.getEvent(event.id)).toEqual(appended.event);
  });

  it('is idempotent for the same source event and integrity hash', () => {
    const store = openStore();
    const event = makeEvent();

    const first = store.appendEvent(event);
    const duplicate = store.appendEvent({
      ...event,
      payload: { unread: true, subject: 'private quarterly plan' },
    });

    expect(first.inserted).toBe(true);
    expect(duplicate).toEqual({ event: first.event, inserted: false });
  });

  it('rejects a reused source event ID with a different integrity hash', () => {
    const store = openStore();
    const event = makeEvent();
    store.appendEvent(event);

    expect(() =>
      store.appendEvent({
        ...event,
        id: 'evt-conflict',
        payload: { subject: 'changed after ingestion' },
      }),
    ).toThrow('Conflicting event for gmail/message-1');
    expect(store.getEvent(event.id)?.payload).toEqual(event.payload);
  });
});

describe('JerichoStore migrations', () => {
  it('creates the complete normalized truth-store schema', () => {
    const databasePath = temporaryDatabasePath();
    openStore(databasePath).close();

    const database = new DatabaseSync(databasePath);
    const tables = database
      .prepare(`
        SELECT name FROM sqlite_schema
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `)
      .all()
      .map((row) => row.name);
    database.close();

    expect(tables).toEqual([
      'agent_capabilities',
      'assignments',
      'connector_health',
      'decisions',
      'entities',
      'events',
      'intents',
      'mission_tasks',
      'missions',
      'preference_changes',
      'proposals',
      'receipts',
      'relations',
      'schema_migrations',
    ]);
  });

  it('reopens a file database and applies each migration only once', () => {
    const databasePath = temporaryDatabasePath();
    const first = openStore(databasePath);
    const appended = first.appendEvent(makeEvent());
    first.close();

    const reopened = openStore(databasePath);
    expect(reopened.getEvent('evt-1')).toEqual(appended.event);
    reopened.close();

    const database = new DatabaseSync(databasePath);
    expect(
      database
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all()
        .map((row) => row.version),
    ).toEqual([1, 2]);
    database.close();
  });
});

describe('JerichoStore encryption at rest', () => {
  it('does not leave a known payload secret in the raw SQLite event row', () => {
    const databasePath = temporaryDatabasePath();
    const secret = 'KNOWN-SECRET-PAYLOAD-4b8d9f';
    const store = openStore(databasePath);
    store.appendEvent(makeEvent({ payload: { secret } }));
    store.close();

    const database = new DatabaseSync(databasePath);
    const row = database.prepare('SELECT body FROM events WHERE id = ?').get('evt-1');
    database.close();

    expect(row).toBeDefined();
    expect(Buffer.from(row?.body as Uint8Array).includes(Buffer.from(secret))).toBe(false);
  });
});

describe('JerichoStore entities', () => {
  it('reconciles aliases, attributes, provenance, and freshness on upsert', () => {
    const store = openStore();
    const original = makeEntity();
    store.upsertEntity(original);

    const reconciled = store.upsertEntity({
      ...original,
      aliases: ['C. Prada'],
      attributes: { timezone: 'Asia/Dubai' },
      confidence: 0.99,
      freshness: { observedAt: '2026-07-11T02:00:00.000Z' },
      provenance: [
        {
          source: 'contacts',
          sourceType: SourceType.Connector,
          sourceEventId: 'contact-7',
          observedAt: '2026-07-11T02:00:00.000Z',
        },
      ],
      updatedAt: '2026-07-11T02:00:00.000Z',
    });

    expect(reconciled.aliases).toEqual(['Carlos', 'C. Prada']);
    expect(reconciled.attributes).toEqual({
      email: 'carlos@example.test',
      timezone: 'Asia/Dubai',
    });
    expect(reconciled.provenance).toHaveLength(2);
    expect(reconciled.freshness.observedAt).toBe('2026-07-11T02:00:00.000Z');
    expect(reconciled.integrityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.getEntity(original.id)).toEqual(reconciled);
  });

  it('lists decrypted entities by queryable type', () => {
    const store = openStore();
    const person = store.upsertEntity(makeEntity());
    store.upsertEntity(
      makeEntity({
        id: 'entity-company',
        type: EntityType.Organization,
        canonicalName: 'Example Company',
        aliases: [],
      }),
    );

    expect(store.listEntities({ type: EntityType.Person })).toEqual([person]);
  });
});

describe('JerichoStore relations', () => {
  it('upserts one typed relation per endpoint pair and relation type', () => {
    const store = openStore();
    store.upsertEntity(makeEntity({ id: 'entity-from' }));
    store.upsertEntity(
      makeEntity({
        id: 'entity-to',
        type: EntityType.Organization,
        canonicalName: 'Jericho',
      }),
    );
    const original = store.upsertRelation(makeRelation());

    const updated = store.upsertRelation(
      makeRelation({
        id: 'relation-duplicate-id',
        attributes: { role: 'owner' },
        freshness: { observedAt: '2026-07-11T03:00:00.000Z' },
        updatedAt: '2026-07-11T03:00:00.000Z',
      }),
    );

    expect(updated.id).toBe(original.id);
    expect(updated.attributes).toEqual({ role: 'owner' });
    expect(store.listRelations({ fromEntityId: 'entity-from' })).toEqual([updated]);
  });
});

describe('JerichoStore connector health', () => {
  it('upserts and lists the latest encrypted connector-health record', () => {
    const store = openStore();
    store.upsertConnectorHealth(makeConnectorHealth());

    const healthy = store.upsertConnectorHealth(
      makeConnectorHealth({
        status: ConnectorHealthStatus.Healthy,
        checkedAt: '2026-07-11T04:00:00.000Z',
        lastSuccessAt: '2026-07-11T04:00:00.000Z',
        consecutiveFailures: 0,
        latencyMs: 82,
        freshness: { observedAt: '2026-07-11T04:00:00.000Z' },
        details: { account: 'primary' },
      }),
    );

    expect(healthy.integrityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.listConnectorHealth()).toEqual([healthy]);
  });
});

function openStore(path = ':memory:'): JerichoStore {
  const store = new JerichoStore({ path, key: KEY });
  openStores.push(store);
  return store;
}

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'jericho-store-'));
  tempDirectories.push(directory);
  return join(directory, 'jericho.db');
}

function makeEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    id: 'evt-1',
    source: 'gmail',
    sourceType: SourceType.Connector,
    sourceEventId: 'message-1',
    type: 'message.received',
    occurredAt: '2026-07-11T01:00:00.000Z',
    ingestedAt: '2026-07-11T01:00:01.000Z',
    payload: { subject: 'private quarterly plan', unread: true },
    risk: RiskLevel.Low,
    route: RouteType.Connector,
    confidence: 0.99,
    freshness: { observedAt: '2026-07-11T01:00:00.000Z' },
    provenance: [
      {
        source: 'gmail',
        sourceType: SourceType.Connector,
        sourceEventId: 'message-1',
        observedAt: '2026-07-11T01:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'entity-carlos',
    type: EntityType.Person,
    canonicalName: 'Carlos Prada',
    aliases: ['Carlos'],
    attributes: { email: 'carlos@example.test' },
    status: LifecycleStatus.Active,
    risk: RiskLevel.Low,
    confidence: 0.95,
    freshness: { observedAt: '2026-07-11T01:00:00.000Z' },
    provenance: [
      {
        source: 'user',
        sourceType: SourceType.User,
        observedAt: '2026-07-11T01:00:00.000Z',
      },
    ],
    createdAt: '2026-07-11T01:00:00.000Z',
    updatedAt: '2026-07-11T01:00:00.000Z',
    ...overrides,
  };
}

function makeRelation(overrides: Partial<Relation> = {}): Relation {
  return {
    id: 'relation-1',
    fromEntityId: 'entity-from',
    toEntityId: 'entity-to',
    type: RelationType.MemberOf,
    attributes: {},
    status: LifecycleStatus.Active,
    risk: RiskLevel.Low,
    confidence: 0.9,
    freshness: { observedAt: '2026-07-11T01:00:00.000Z' },
    provenance: [
      {
        source: 'user',
        sourceType: SourceType.User,
        observedAt: '2026-07-11T01:00:00.000Z',
      },
    ],
    createdAt: '2026-07-11T01:00:00.000Z',
    updatedAt: '2026-07-11T01:00:00.000Z',
    ...overrides,
  };
}

function makeConnectorHealth(
  overrides: Partial<ConnectorHealth> = {},
): ConnectorHealth {
  return {
    connectorId: 'gmail',
    status: ConnectorHealthStatus.Degraded,
    checkedAt: '2026-07-11T01:00:00.000Z',
    lastFailureAt: '2026-07-11T01:00:00.000Z',
    latencyMs: 310,
    consecutiveFailures: 2,
    freshness: { observedAt: '2026-07-11T01:00:00.000Z' },
    details: { error: 'temporary connector timeout' },
    provenance: [
      {
        source: 'health-monitor',
        sourceType: SourceType.System,
        observedAt: '2026-07-11T01:00:00.000Z',
      },
    ],
    ...overrides,
  };
}
