import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  ConnectorCapability,
  EntityType,
  ReceiptStatus,
  RiskLevel,
  RouteType,
  SourceType,
  type ActionReceipt,
  type EventEnvelope,
  type ExternalIdentityLink,
  type NormalizedCapture,
} from '@jericho/shared';

import { CoreCrypto } from '../src/core/crypto.js';
import { JerichoStore } from '../src/core/store.js';

const KEY = Buffer.alloc(32, 73);
const T0 = '2026-07-11T00:00:00.000Z';
const T1 = '2026-07-11T00:01:00.000Z';
const T2 = '2026-07-11T00:02:00.000Z';
const IDENTITY_SECRET = 'private-identity-2c7908d7';
const DESTINATION_SECRET = 'private-destination-c0884cf1';
const RECEIPT_EXTERNAL_SECRET = 'private-receipt-external-cfb7a110';
const FREE_PAGE_SECRET = 'private-free-page-remnant-95e30d9c';
const directories: string[] = [];
const stores: JerichoStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('private deterministic lookup projections', () => {
  it('keeps external identity and receipt lookup columns tokenized across lookup, idempotency, and reopen', () => {
    const path = databasePath();
    const first = openStore(path);
    const { link, receipt } = seedPrivateRecords(first);
    first.close();

    expectPrivateColumns(path);
    expectDatabaseArtifactsNotToContain(path, [
      IDENTITY_SECRET,
      DESTINATION_SECRET,
      RECEIPT_EXTERNAL_SECRET,
    ]);

    const reopened = openStore(path);
    expect(reopened.listExternalIdentityLinks()).toContainEqual(
      expect.objectContaining({ id: link.id, externalId: IDENTITY_SECRET }),
    );
    expect(reopened.getReceipt(receipt.id)).toMatchObject({
      destination: DESTINATION_SECRET,
      externalId: RECEIPT_EXTERNAL_SECRET,
    });
    expect(reopened.reserveReceipt(makeReceipt({ id: 'receipt-retry' }))).toMatchObject({
      id: receipt.id,
      destination: DESTINATION_SECRET,
    });

    const lease = reopened.acquireConnectorLease({
      connectorId: 'telegram', capability: ConnectorCapability.Capture,
      ownerId: 'privacy-reopen', now: T2, leaseMs: 120_000,
    })!;
    const replay = reopened.commitCaptureBatch({
      connectorId: 'telegram', capability: ConnectorCapability.Capture,
      partition: 'primary', expectedCursorVersion: 1,
      nextCursor: cursor(2, 2, T2), captures: [capture('privacy-event-2')],
      leaseToken: lease.leaseToken, committedAt: T2,
    });
    expect(replay.identityLinks[0].id).toBe(link.id);
    expect(reopened.listExternalIdentityLinks()).toHaveLength(1);
  });

  it('backfills a populated v6 database after key verification, reseals AAD, and physically scrubs legacy values', () => {
    const path = databasePath();
    const current = openStore(path);
    const records = seedPrivateRecords(current);
    current.close();
    downgradePrivateRowsToV6(path, records.link, records.receipt);
    expectDatabaseArtifactsToContain(path, [
      IDENTITY_SECRET,
      DESTINATION_SECRET,
      RECEIPT_EXTERNAL_SECRET,
    ]);

    const migrated = openStore(path);
    expect(migrated.listExternalIdentityLinks()[0].externalId).toBe(IDENTITY_SECRET);
    expect(migrated.getReceipt(records.receipt.id)).toMatchObject({
      destination: DESTINATION_SECRET,
      externalId: RECEIPT_EXTERNAL_SECRET,
    });
    migrated.close();

    expectPrivateColumns(path);
    expectDatabaseArtifactsNotToContain(path, [
      IDENTITY_SECRET,
      DESTINATION_SECRET,
      RECEIPT_EXTERNAL_SECRET,
    ]);
    const database = new DatabaseSync(path);
    expect(database.prepare('SELECT version FROM schema_migrations ORDER BY version').all().at(-1)?.version).toBe(7);
    expect(database.prepare('SELECT value FROM store_metadata WHERE name = ?').get('lookup-token-migration-v1')).toBeDefined();
    database.close();

    const reopened = openStore(path);
    expect(reopened.getReceiptByIdempotencyKey(records.receipt.idempotencyKey)?.id).toBe(records.receipt.id);
  });

  it('resumes the physical scrub when a crash leaves the durable migration state at rewritten', () => {
    const path = databasePath();
    const store = openStore(path);
    const records = seedPrivateRecords(store);
    store.close();
    leaveRewrittenMarkerAndFreePageRemnant(path);
    expectDatabaseArtifactsToContain(path, [FREE_PAGE_SECRET]);

    const recovered = openStore(path);
    expect(recovered.getReceipt(records.receipt.id)?.destination).toBe(DESTINATION_SECRET);
    recovered.close();
    expectDatabaseArtifactsNotToContain(path, [FREE_PAGE_SECRET]);
    expect(() => openStore(path)).not.toThrow();
  });
});

function seedPrivateRecords(store: JerichoStore): { link: ExternalIdentityLink; receipt: ActionReceipt } {
  const lease = store.acquireConnectorLease({
    connectorId: 'telegram', capability: ConnectorCapability.Capture,
    ownerId: 'privacy-seed', now: T0, leaseMs: 120_000,
  })!;
  const committed = store.commitCaptureBatch({
    connectorId: 'telegram', capability: ConnectorCapability.Capture,
    partition: 'primary', expectedCursorVersion: 0,
    nextCursor: cursor(1, 1, T1), captures: [capture('privacy-event-1')],
    leaseToken: lease.leaseToken, committedAt: T1,
  });
  const pending = store.reserveReceipt(makeReceipt());
  const receipt = store.completeReceipt(pending.id, {
    status: ReceiptStatus.Succeeded,
    externalId: RECEIPT_EXTERNAL_SECRET,
    result: { delivered: true },
    verified: true,
    verifiedAt: T2,
    completedAt: T2,
    evidenceEventIds: ['privacy-event-1'],
  });
  return {
    link: store.listExternalIdentityLinks().find((candidate) =>
      candidate.id === committed.identityLinks[0].id
    )!,
    receipt,
  };
}

function capture(id: string): NormalizedCapture {
  const event: EventEnvelope = {
    id,
    source: 'telegram',
    sourceType: SourceType.Connector,
    sourceEventId: id,
    type: 'telegram.message',
    occurredAt: T0,
    ingestedAt: T1,
    payload: { text: 'privacy fixture without lookup identifiers' },
    provenance: [{ source: 'telegram', sourceType: SourceType.Connector, sourceEventId: id, observedAt: T1 }],
  };
  return {
    event,
    identities: [{
      connectorId: 'telegram', namespace: 'user', externalId: IDENTITY_SECRET,
      entityType: EntityType.Person, displayName: 'Private Person', attributes: {},
      observedAt: T1, confidence: 1, evidenceEventId: id,
    }],
    relations: [],
  };
}

function cursor(version: number, sequence: number, updatedAt: string) {
  return {
    connectorId: 'telegram', capability: ConnectorCapability.Capture,
    partition: 'primary', epoch: 1, sequence, version, updatedAt,
  } as const;
}

function makeReceipt(overrides: Partial<ActionReceipt> = {}): ActionReceipt {
  return {
    id: 'receipt-private', connectorId: 'telegram-gateway', action: 'send_message',
    idempotencyKey: 'privacy-send-key', destination: DESTINATION_SECRET,
    status: ReceiptStatus.Pending, route: RouteType.Connector, risk: RiskLevel.Low,
    requestedAt: T1, verified: false, evidenceEventIds: [], attempt: 1,
    provenance: [{ source: 'privacy-test', sourceType: SourceType.System, observedAt: T1 }],
    ...overrides,
  };
}

function expectPrivateColumns(path: string): void {
  const database = new DatabaseSync(path);
  const identity = database.prepare('SELECT external_id FROM external_identities LIMIT 1').get();
  const receipt = database.prepare('SELECT destination, external_id FROM receipts LIMIT 1').get();
  database.close();
  expect(identity?.external_id).toMatch(/^hmac-sha256-v1:[a-f0-9]{64}$/);
  expect(receipt?.destination).toMatch(/^hmac-sha256-v1:[a-f0-9]{64}$/);
  expect(receipt?.external_id).toMatch(/^hmac-sha256-v1:[a-f0-9]{64}$/);
}

function downgradePrivateRowsToV6(
  path: string,
  link: ExternalIdentityLink,
  receipt: ActionReceipt,
): void {
  const database = new DatabaseSync(path);
  const uuidRow = database.prepare('SELECT value FROM store_metadata WHERE name = ?').get('store-uuid');
  if (!(uuidRow?.value instanceof Uint8Array)) throw new Error('Missing store UUID fixture');
  const storeUuid = Buffer.from(uuidRow.value).toString('utf8');
  const crypto = new CoreCrypto(KEY).deriveScoped(`jericho-store:${storeUuid}`);
  database.exec('PRAGMA journal_mode = DELETE; PRAGMA secure_delete = ON');
  database.prepare('DELETE FROM store_metadata WHERE name = ?').run('lookup-token-migration-v1');
  database.prepare('DELETE FROM schema_migrations WHERE version = 7').run();
  database.exec('DROP INDEX IF EXISTS receipts_destination_lookup_idx; DROP INDEX IF EXISTS receipts_external_id_lookup_idx');
  database.prepare('UPDATE external_identities SET external_id = ?, body = ? WHERE id = ?').run(
    link.externalId,
    crypto.encryptJson(link, legacyAssociatedData(storeUuid, 'external_identities', link.id, {
      id: link.id, connector_id: link.connectorId, namespace: link.namespace,
      external_id: link.externalId, entity_id: link.entityId, status: link.status,
      last_observed_at: link.lastObservedAt,
    })),
    link.id,
  );
  database.prepare('UPDATE receipts SET destination = ?, external_id = ?, body = ? WHERE id = ?').run(
    receipt.destination,
    receipt.externalId ?? null,
    crypto.encryptJson(receipt, legacyAssociatedData(storeUuid, 'receipts', receipt.id, {
      id: receipt.id, proposal_id: receipt.proposalId ?? null,
      assignment_id: receipt.assignmentId ?? null, mission_task_id: receipt.missionTaskId ?? null,
      connector_id: receipt.connectorId ?? null, status: receipt.status, route: receipt.route,
      risk: receipt.risk, requested_at: receipt.requestedAt, started_at: receipt.startedAt ?? null,
      completed_at: receipt.completedAt ?? null, idempotency_key: receipt.idempotencyKey,
      destination: receipt.destination, external_id: receipt.externalId ?? null,
      verified: receipt.verified ? 1 : 0, verified_at: receipt.verifiedAt ?? null,
      attempt: receipt.attempt,
    })),
    receipt.id,
  );
  database.exec('VACUUM');
  database.close();
}

function legacyAssociatedData(
  storeUuid: string,
  table: string,
  rowId: string,
  projection: Record<string, unknown>,
): string {
  return canonicalJson(['jericho-store-record', 2, storeUuid, table, rowId, projection]);
}

function leaveRewrittenMarkerAndFreePageRemnant(path: string): void {
  const database = new DatabaseSync(path);
  const uuidRow = database.prepare('SELECT value FROM store_metadata WHERE name = ?').get('store-uuid');
  if (!(uuidRow?.value instanceof Uint8Array)) throw new Error('Missing store UUID fixture');
  const storeUuid = Buffer.from(uuidRow.value).toString('utf8');
  const crypto = new CoreCrypto(KEY).deriveScoped(`jericho-store:${storeUuid}`);
  database.prepare('UPDATE store_metadata SET value = ? WHERE name = ?').run(
    crypto.encryptJson({
      purpose: 'jericho-private-lookup-migration',
      version: 1,
      storeUuid,
      state: 'rewritten',
    }, JSON.stringify([
      'jericho-store-private-lookup-migration',
      1,
      storeUuid,
      'lookup-token-migration-v1',
    ])),
    'lookup-token-migration-v1',
  );
  database.exec('PRAGMA secure_delete = OFF; CREATE TABLE discarded_private_remnant (value TEXT)');
  database.prepare('INSERT INTO discarded_private_remnant (value) VALUES (?)').run(FREE_PAGE_SECRET);
  database.exec('DROP TABLE discarded_private_remnant');
  database.close();
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'jericho-private-lookups-'));
  directories.push(directory);
  return join(directory, 'jericho.db');
}

function openStore(path: string): JerichoStore {
  const store = new JerichoStore({ path, key: KEY });
  stores.push(store);
  return store;
}

function databaseArtifacts(path: string): Buffer {
  const directory = dirname(path);
  const prefix = basename(path);
  return Buffer.concat(readdirSync(directory)
    .filter((name) => name === prefix || name === `${prefix}-wal` || name === `${prefix}-shm`)
    .map((name) => readFileSync(join(directory, name))));
}

function expectDatabaseArtifactsNotToContain(path: string, values: string[]): void {
  const bytes = databaseArtifacts(path);
  for (const value of values) expect(bytes.includes(Buffer.from(value))).toBe(false);
}

function expectDatabaseArtifactsToContain(path: string, values: string[]): void {
  const bytes = databaseArtifacts(path);
  for (const value of values) expect(bytes.includes(Buffer.from(value))).toBe(true);
}
