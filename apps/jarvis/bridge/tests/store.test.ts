import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ConnectorHealthStatus,
  ConnectorCapability,
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
  it('normalizes accepted RFC3339 offsets to UTC before hashing and storage', () => {
    const store = openStore();
    const appended = store.appendEvent(
      makeEvent({
        occurredAt: '2026-07-11T05:00:00+04:00',
        ingestedAt: '2026-07-11T05:00:01+04:00',
        freshness: { observedAt: '2026-07-11T05:00:00+04:00' },
        provenance: [
          {
            source: 'gmail',
            sourceType: SourceType.Connector,
            observedAt: '2026-07-11T05:00:00+04:00',
          },
        ],
      }),
    );

    expect(appended.event.occurredAt).toBe('2026-07-11T01:00:00.000Z');
    expect(appended.event.ingestedAt).toBe('2026-07-11T01:00:01.000Z');
    expect(appended.event.freshness?.observedAt).toBe(
      '2026-07-11T01:00:00.000Z',
    );
    expect(appended.event.provenance[0].observedAt).toBe(
      '2026-07-11T01:00:00.000Z',
    );
  });

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
      'capture_failures',
      'change_log',
      'connector_cursors',
      'connector_health',
      'connector_leases',
      'cost_records',
      'decisions',
      'entities',
      'events',
      'external_identities',
      'intents',
      'mission_task_dependencies',
      'mission_tasks',
      'missions',
      'preference_changes',
      'proposals',
      'receipts',
      'relations',
      'schema_migrations',
      'store_metadata',
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
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
    database.close();
  });

  it('safely upgrades an empty v2 test database and binds its key', () => {
    const databasePath = temporaryDatabasePath();
    openStore(databasePath).close();
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      DROP TABLE store_metadata;
      DELETE FROM schema_migrations WHERE version = 3;
    `);
    legacy.close();

    const upgraded = openStore(databasePath);
    upgraded.close();
    expect(
      () =>
        new JerichoStore({
          path: databasePath,
          key: Buffer.alloc(32, 100),
        }),
    ).toThrow('Jericho store master key does not match this database');
  });

  it('safely upgrades an empty v1 test database through all migrations', () => {
    const databasePath = temporaryDatabasePath();
    createV1TestDatabase(databasePath, false);

    const upgraded = openStore(databasePath);
    expect(upgraded.appendEvent(makeEvent()).inserted).toBe(true);
    upgraded.close();
    const database = new DatabaseSync(databasePath);
    expect(
      database
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all()
        .map((row) => row.version),
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
    database.close();
  });

  it('refuses to bind or migrate a populated v1 store', () => {
    const databasePath = temporaryDatabasePath();
    createV1TestDatabase(databasePath, true);

    expect(() => openStore(databasePath)).toThrow(
      'Refusing to migrate nonempty pre-v3 Jericho store',
    );

    const database = new DatabaseSync(databasePath);
    expect(
      database
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all()
        .map((row) => row.version),
    ).toEqual([1]);
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'store_metadata'",
        )
        .get(),
    ).toBeUndefined();
    database.close();
  });

  it('refuses to bind or migrate a populated v2 store', () => {
    const databasePath = temporaryDatabasePath();
    const current = openStore(databasePath);
    current.upsertEntity(makeEntity());
    current.close();
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      DROP TABLE store_metadata;
      DELETE FROM schema_migrations WHERE version = 3;
    `);
    legacy.close();

    expect(() => openStore(databasePath)).toThrow(
      'Refusing to migrate nonempty pre-v3 Jericho store',
    );
  });

  it('treats a missing v3 key verifier as corruption instead of rebinding', () => {
    const databasePath = temporaryDatabasePath();
    openStore(databasePath).close();
    const database = new DatabaseSync(databasePath);
    database
      .prepare('DELETE FROM store_metadata WHERE name = ?')
      .run('key-verifier');
    database.close();

    expect(() => openStore(databasePath)).toThrow(
      'Jericho store metadata is corrupt: key verifier is missing',
    );
  });

  it(
    'serializes concurrent process opens and entity read-merge-write upserts',
    async () => {
      const databasePath = temporaryDatabasePath();
      const fixture = fileURLToPath(
        new URL('./fixtures/concurrent-entity-upsert.ts', import.meta.url),
      );

      await Promise.all(
        Array.from({ length: 4 }, (_, index) =>
          runChildProcess(fixture, [
            databasePath,
            KEY.toString('base64'),
            String(index),
          ]),
        ),
      );

      const store = openStore(databasePath);
      const entity = store.getEntity('entity-concurrent');
      expect(entity?.aliases.sort()).toEqual([
        'alias-0',
        'alias-1',
        'alias-2',
        'alias-3',
      ]);
      expect(entity?.attributes).toEqual({
        field0: 'value-0',
        field1: 'value-1',
        field2: 'value-2',
        field3: 'value-3',
      });
      expect(entity?.provenance).toHaveLength(4);
    },
    15_000,
  );
});

describe('JerichoStore encryption at rest', () => {
  it('binds a file database to its master key before allowing access', () => {
    const databasePath = temporaryDatabasePath();
    const first = openStore(databasePath);
    const appended = first.appendEvent(makeEvent());
    first.close();

    expect(
      () =>
        new JerichoStore({
          path: databasePath,
          key: Buffer.alloc(32, 99),
        }),
    ).toThrow('Jericho store master key does not match this database');

    const correct = openStore(databasePath);
    expect(correct.getEvent(appended.event.id)).toEqual(appended.event);
  });

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

  it('stores a keyed integrity digest instead of a visible plaintext hash', () => {
    const store = openStore();
    const appended = store.appendEvent(makeEvent()).event;
    const { integrityHash, ...hashable } = appended;
    const rawHash = createHash('sha256')
      .update(canonicalJsonForTest(hashable))
      .digest('hex');

    expect(integrityHash).not.toBe(rawHash);
  });

  it('rejects a tampered visible integrity digest before returning a row', () => {
    const databasePath = temporaryDatabasePath();
    const store = openStore(databasePath);
    store.appendEvent(makeEvent());
    store.close();
    const database = new DatabaseSync(databasePath);
    database
      .prepare('UPDATE events SET integrity_hash = ? WHERE id = ?')
      .run('0'.repeat(64), 'evt-1');
    database.close();

    const reopened = openStore(databasePath);
    expect(() => reopened.getEvent('evt-1')).toThrow('integrity verification failed');
  });

  it('binds encrypted event bodies to their table and row identity', () => {
    const databasePath = temporaryDatabasePath();
    const store = openStore(databasePath);
    store.appendEvent(makeEvent());
    store.appendEvent(
      makeEvent({
        id: 'evt-2',
        sourceEventId: 'message-2',
        payload: { subject: 'second' },
      }),
    );
    store.close();
    const database = new DatabaseSync(databasePath);
    const rows = database
      .prepare('SELECT id, body FROM events ORDER BY id')
      .all();
    database.prepare('UPDATE events SET body = ? WHERE id = ?').run(rows[1].body, 'evt-1');
    database.prepare('UPDATE events SET body = ? WHERE id = ?').run(rows[0].body, 'evt-2');
    database.close();

    const reopened = openStore(databasePath);
    expect(() => reopened.getEvent('evt-1')).toThrow(
      'Encrypted payload authentication failed',
    );
  });

  it('binds encrypted rows and integrity digests to a persistent random store UUID', () => {
    const firstPath = temporaryDatabasePath();
    const secondPath = temporaryDatabasePath();
    const first = openStore(firstPath);
    const firstEvent = first.appendEvent(makeEvent()).event;
    first.close();
    const second = openStore(secondPath);
    second.appendEvent(
      makeEvent({ payload: { subject: 'different database contents' } }),
    );
    second.close();

    const firstDatabase = new DatabaseSync(firstPath);
    const secondDatabase = new DatabaseSync(secondPath);
    const firstUuid = metadataText(firstDatabase, 'store-uuid');
    const secondUuid = metadataText(secondDatabase, 'store-uuid');
    expect(firstUuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(secondUuid).not.toBe(firstUuid);

    const firstRow = firstDatabase
      .prepare('SELECT body, integrity_hash FROM events WHERE id = ?')
      .get('evt-1');
    if (!firstRow) throw new Error('Missing first database event fixture');
    secondDatabase
      .prepare('UPDATE events SET body = ?, integrity_hash = ? WHERE id = ?')
      .run(firstRow.body, firstRow.integrity_hash, 'evt-1');
    firstDatabase.close();
    secondDatabase.close();

    const reopenedFirst = openStore(firstPath);
    expect(reopenedFirst.getEvent('evt-1')).toEqual(firstEvent);
    reopenedFirst.close();
    const reopenedSecond = openStore(secondPath);
    expect(() => reopenedSecond.getEvent('evt-1')).toThrow(
      'Encrypted payload authentication failed',
    );
  });
});

describe('JerichoStore entities', () => {
  it('omits absent optional entity fields and preserves current values on update', () => {
    const store = openStore();
    const current = store.upsertEntity(makeEntity());
    const {
      status: _status,
      risk: _risk,
      confidence: _confidence,
      ...withoutOptionals
    } = makeEntity({
      aliases: ['Updated Alias'],
      freshness: { observedAt: '2026-07-11T02:00:00.000Z' },
      updatedAt: '2026-07-11T02:00:00.000Z',
    });

    const updated = store.upsertEntity(withoutOptionals);

    expect(updated.status).toBe(current.status);
    expect(updated.risk).toBe(current.risk);
    expect(updated.confidence).toBe(current.confidence);

    const {
      status: _newStatus,
      risk: _newRisk,
      confidence: _newConfidence,
      ...newWithoutOptionals
    } = makeEntity({ id: 'entity-no-optionals' });
    const created = store.upsertEntity(newWithoutOptionals);
    expect(Object.hasOwn(created, 'status')).toBe(false);
    expect(Object.hasOwn(created, 'risk')).toBe(false);
    expect(Object.hasOwn(created, 'confidence')).toBe(false);
  });

  it('validates an entity before hashing or writing it', () => {
    const store = openStore();
    const invalid = {
      ...makeEntity(),
      type: 'contact',
      attributes: { hidden: new Date() },
    } as unknown as Entity;

    expect(() => store.upsertEntity(invalid)).toThrow(TypeError);
    expect(store.getEntity(invalid.id)).toBeUndefined();
  });

  it.each([
    ['entity_type', EntityType.Organization],
    ['status', LifecycleStatus.Archived],
    ['freshness_at', '2027-01-01T00:00:00.000Z'],
  ])(
    'authenticates the visible entity %s projection before returning a row',
    (column, tamperedValue) => {
      const databasePath = temporaryDatabasePath();
      const store = openStore(databasePath);
      store.upsertEntity(makeEntity());
      store.close();
      const database = new DatabaseSync(databasePath);
      database
        .prepare(`UPDATE entities SET ${column} = ? WHERE id = ?`)
        .run(tamperedValue, 'entity-carlos');
      database.close();

      const reopened = openStore(databasePath);
      const query =
        column === 'entity_type'
          ? () => reopened.listEntities({ type: tamperedValue as EntityType })
          : column === 'status'
            ? () =>
                reopened.listEntities({
                  status: tamperedValue as LifecycleStatus,
                })
            : () =>
                reopened.listEntities({
                  freshAfter: '2027-01-01T00:00:00.000Z',
                });
      expect(query).toThrow(
        'Encrypted payload authentication failed',
      );
    },
  );

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

  it('keeps current colliding attributes for stale and equal-time observations', () => {
    const store = openStore();
    store.upsertEntity(
      makeEntity({
        attributes: { owner: 'current', currentOnly: true },
        freshness: { observedAt: '2026-07-11T01:00:00.000Z' },
      }),
    );

    const stale = store.upsertEntity(
      makeEntity({
        canonicalName: 'Stale Name',
        attributes: { owner: 'stale', staleOnly: true },
        freshness: { observedAt: '2026-07-11T01:30:00+01:00' },
        updatedAt: '2026-07-11T01:30:00+01:00',
      }),
    );
    const equalTime = store.upsertEntity(
      makeEntity({
        canonicalName: 'Equal Name',
        attributes: { owner: 'equal', equalOnly: true },
        freshness: { observedAt: '2026-07-11T05:00:00+04:00' },
        updatedAt: '2026-07-11T05:00:00+04:00',
      }),
    );

    expect(stale.canonicalName).toBe('Carlos Prada');
    expect(equalTime.canonicalName).toBe('Carlos Prada');
    expect(equalTime.attributes).toEqual({
      staleOnly: true,
      equalOnly: true,
      owner: 'current',
      currentOnly: true,
    });
    expect(equalTime.freshness.observedAt).toBe('2026-07-11T01:00:00.000Z');
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

  it('normalizes freshness filters before timestamp comparison', () => {
    const store = openStore();
    store.upsertEntity(
      makeEntity({
        id: 'entity-early',
        freshness: { observedAt: '2026-07-11T01:00:00.000Z' },
      }),
    );
    const late = store.upsertEntity(
      makeEntity({
        id: 'entity-late',
        freshness: { observedAt: '2026-07-11T02:00:00.000Z' },
      }),
    );

    expect(
      store.listEntities({ freshAfter: '2026-07-11T05:30:00+04:00' }),
    ).toEqual([late]);
  });
});

describe('JerichoStore relations', () => {
  it('omits absent optional relation fields and preserves current values on update', () => {
    const store = openStore();
    store.upsertEntity(makeEntity({ id: 'entity-from' }));
    store.upsertEntity(makeEntity({ id: 'entity-to' }));
    const current = store.upsertRelation(makeRelation());
    const {
      status: _status,
      risk: _risk,
      confidence: _confidence,
      ...withoutOptionals
    } = makeRelation({
      attributes: { updated: true },
      freshness: { observedAt: '2026-07-11T02:00:00.000Z' },
      updatedAt: '2026-07-11T02:00:00.000Z',
    });

    const updated = store.upsertRelation(withoutOptionals);

    expect(updated.status).toBe(current.status);
    expect(updated.risk).toBe(current.risk);
    expect(updated.confidence).toBe(current.confidence);

    const {
      status: _newStatus,
      risk: _newRisk,
      confidence: _newConfidence,
      ...newWithoutOptionals
    } = makeRelation({
      id: 'relation-no-optionals',
      type: RelationType.RelatedTo,
    });
    const created = store.upsertRelation(newWithoutOptionals);
    expect(Object.hasOwn(created, 'status')).toBe(false);
    expect(Object.hasOwn(created, 'risk')).toBe(false);
    expect(Object.hasOwn(created, 'confidence')).toBe(false);
  });

  it('validates a relation before hashing or writing it', () => {
    const store = openStore();
    store.upsertEntity(makeEntity({ id: 'entity-from' }));
    store.upsertEntity(makeEntity({ id: 'entity-to' }));
    const invalid = {
      ...makeRelation(),
      type: 'knows',
      confidence: Number.POSITIVE_INFINITY,
    } as unknown as Relation;

    expect(() => store.upsertRelation(invalid)).toThrow(TypeError);
    expect(store.listRelations()).toEqual([]);
  });

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

  it('keeps current colliding relation attributes on an equal-time observation', () => {
    const store = openStore();
    store.upsertEntity(makeEntity({ id: 'entity-from' }));
    store.upsertEntity(makeEntity({ id: 'entity-to' }));
    store.upsertRelation(
      makeRelation({
        attributes: { role: 'current' },
        freshness: { observedAt: '2026-07-11T01:00:00.000Z' },
      }),
    );

    const relation = store.upsertRelation(
      makeRelation({
        attributes: { role: 'equal', added: true },
        freshness: { observedAt: '2026-07-11T05:00:00+04:00' },
        updatedAt: '2026-07-11T05:00:00+04:00',
      }),
    );

    expect(relation.attributes).toEqual({ added: true, role: 'current' });
    expect(relation.freshness.observedAt).toBe('2026-07-11T01:00:00.000Z');
  });
});

describe('JerichoStore connector health', () => {
  it('validates connector health before hashing or writing it', () => {
    const store = openStore();
    const invalid = {
      ...makeConnectorHealth(),
      status: 'online',
      details: { invalid: undefined },
    } as unknown as ConnectorHealth;

    expect(() => store.upsertConnectorHealth(invalid)).toThrow(TypeError);
    expect(store.listConnectorHealth()).toEqual([]);
  });

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

  it('uses first-write-wins for equal connector check instants', () => {
    const store = openStore();
    const first = store.upsertConnectorHealth(
      makeConnectorHealth({
        status: ConnectorHealthStatus.Healthy,
        checkedAt: '2026-07-11T01:00:00.000Z',
        freshness: { observedAt: '2026-07-11T01:00:00.000Z' },
        details: { state: 'current' },
      }),
    );

    const tied = store.upsertConnectorHealth(
      makeConnectorHealth({
        status: ConnectorHealthStatus.Unavailable,
        checkedAt: '2026-07-11T05:00:00+04:00',
        freshness: { observedAt: '2026-07-11T05:00:00+04:00' },
        details: { state: 'equal' },
      }),
    );

    expect(tied).toEqual(first);
  });

  it('merges independently checked capabilities without losing concurrent health', () => {
    const store = openStore();
    store.upsertConnectorHealth(makeConnectorHealth({
      status: ConnectorHealthStatus.Healthy,
      capabilities: [{
        capability: ConnectorCapability.Capture,
        status: ConnectorHealthStatus.Healthy,
        checkedAt: '2026-07-11T01:00:00.000Z',
        details: {},
      }],
    }));
    const merged = store.upsertConnectorHealth(makeConnectorHealth({
      status: ConnectorHealthStatus.Unavailable,
      capabilities: [{
        capability: ConnectorCapability.Search,
        status: ConnectorHealthStatus.Unavailable,
        checkedAt: '2026-07-11T01:00:00.000Z',
        details: { reason: 'missing config' },
      }],
    }));

    expect(merged.status).toBe(ConnectorHealthStatus.Unavailable);
    expect(merged.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: ConnectorCapability.Capture, status: ConnectorHealthStatus.Healthy }),
      expect.objectContaining({ capability: ConnectorCapability.Search, status: ConnectorHealthStatus.Unavailable }),
    ]));
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
  const status = overrides.status ?? ConnectorHealthStatus.Degraded;
  return {
    connectorId: 'gmail',
    status,
    checkedAt: '2026-07-11T01:00:00.000Z',
    lastFailureAt: '2026-07-11T01:00:00.000Z',
    latencyMs: 310,
    consecutiveFailures: 2,
    freshness: { observedAt: '2026-07-11T01:00:00.000Z' },
    capabilities: overrides.capabilities ?? [{
      capability: ConnectorCapability.Capture,
      status,
      checkedAt: '2026-07-11T01:00:00.000Z',
      lastFailureAt: '2026-07-11T01:00:00.000Z',
      details: {},
    }],
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

function canonicalJsonForTest(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonForTest).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonForTest(record[key])}`)
    .join(',')}}`;
}

function metadataText(database: DatabaseSync, name: string): string {
  const row = database
    .prepare('SELECT value FROM store_metadata WHERE name = ?')
    .get(name);
  if (!(row?.value instanceof Uint8Array)) {
    throw new Error(`Missing BLOB metadata value ${name}`);
  }
  return Buffer.from(row.value).toString('utf8');
}

function createV1TestDatabase(path: string, populated: boolean): void {
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    INSERT INTO schema_migrations (version, applied_at)
    VALUES (1, '2026-07-11T00:00:00.000Z');
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
  `);
  if (populated) {
    database
      .prepare(`
        INSERT INTO events (
          id, source, source_type, source_event_id, event_type,
          occurred_at, ingested_at, integrity_hash, body
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        'legacy-event',
        'legacy',
        'import',
        'legacy-1',
        'legacy.event',
        '2026-07-11T00:00:00.000Z',
        '2026-07-11T00:00:00.000Z',
        '0'.repeat(64),
        Buffer.from([0]),
      );
  }
  database.close();
}

function runChildProcess(script: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', script, ...args], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`child exited ${code}\n${stdout}${stderr}`));
    });
  });
}
