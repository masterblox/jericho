import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  ConnectorCapability,
  CaptureFailureKind,
  EntityType,
  ExternalIdentityLinkStatus,
  IdentityReviewKind,
  LifecycleStatus,
  RiskLevel,
  RelationType,
  RouteType,
  SourceType,
  type EventEnvelope,
  type CaptureFailure,
  type ExternalIdentityObservation,
  type NormalizedCapture,
  type VersionedCursor,
} from '@jericho/shared';

import {
  CursorConflictError,
  JerichoStore,
} from '../src/core/store.js';

const KEY = Buffer.alloc(32, 41);
const T0 = '2026-07-11T00:00:00.000Z';
const T1 = '2026-07-11T00:01:00.000Z';
const T2 = '2026-07-11T00:02:00.000Z';
const stores: JerichoStore[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('atomic connector capture persistence', () => {
  it('commits events, provisional identity resolution, cursor CAS, and change log atomically', () => {
    const store = openStore();
    const leaseToken = captureLease(store);
    const result = store.commitCaptureBatch({
      connectorId: 'telegram',
      capability: ConnectorCapability.Capture,
      partition: 'primary',
      expectedCursorVersion: 0,
      nextCursor: cursor(1, 10),
      captures: [capture('event-1', observation('user-42', 'Carlos'))],
      leaseToken,
      committedAt: T1,
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0].inserted).toBe(true);
    expect(result.identityLinks).toHaveLength(1);
    expect(result.identityLinks[0]).toMatchObject({
      connectorId: 'telegram',
      namespace: 'user',
      externalId: 'user-42',
      status: ExternalIdentityLinkStatus.Provisional,
    });
    expect(store.getEntity(result.identityLinks[0].entityId)).toMatchObject({
      canonicalName: 'Carlos',
      type: EntityType.Person,
    });
    expect(store.getConnectorCursor('telegram', ConnectorCapability.Capture, 'primary')).toMatchObject(result.cursor);
    expect(store.listChangeLog({ afterSequence: 0 })).toHaveLength(3);
  });

  it('commits typed source relations after resolving their external identities', () => {
    const store = openStore();
    const leaseToken = captureLease(store);
    const message = capture('event-rel');
    message.identities = [
      observation('user-1', 'Carlos'),
      { ...observation('chat-1', 'Jericho Chat'), namespace: 'conversation', entityType: EntityType.Conversation },
    ];
    message.relations = [{
      from: { connectorId: 'telegram', namespace: 'user', externalId: 'user-1' },
      to: { connectorId: 'telegram', namespace: 'conversation', externalId: 'chat-1' },
      type: RelationType.MemberOf,
      attributes: { role: 'sender' },
      observedAt: T1,
      evidenceEventId: 'event-rel',
    }];

    const result = store.commitCaptureBatch({
      connectorId: 'telegram', capability: ConnectorCapability.Capture,
      partition: 'primary', expectedCursorVersion: 0,
      nextCursor: cursor(1, 1), captures: [message], leaseToken, committedAt: T1,
    });

    expect(result.identityLinks).toHaveLength(2);
    expect(store.listRelations()).toContainEqual(expect.objectContaining({
      type: RelationType.MemberOf,
      attributes: { role: 'sender' },
    }));
  });

  it('requires a live fenced connector lease for cursor advancement', () => {
    const store = openStore();
    captureLease(store);
    expect(() => store.commitCaptureBatch({
      connectorId: 'telegram', capability: ConnectorCapability.Capture,
      partition: 'primary', expectedCursorVersion: 0,
      nextCursor: cursor(1, 1), captures: [capture('event-unleased')],
      leaseToken: 'wrong-token', committedAt: T1,
    })).toThrow(/lease|token/i);
    expect(store.getEvent('event-unleased')).toBeUndefined();
    expect(store.getConnectorCursor('telegram', ConnectorCapability.Capture, 'primary')).toBeUndefined();
  });

  it('quarantines non-retryable invalid records with cursor advance but never advances transport failures', () => {
    const store = openStore();
    const leaseToken = captureLease(store);
    const invalid = captureFailure(CaptureFailureKind.InvalidPayload, false, 'bad source row');
    const committed = store.commitCaptureBatch({
      connectorId: 'telegram', capability: ConnectorCapability.Capture,
      partition: 'primary', expectedCursorVersion: 0,
      nextCursor: cursor(1, 1), captures: [], failures: [invalid], leaseToken, committedAt: T1,
    });
    expect(committed.failures).toContainEqual(expect.objectContaining({ id: invalid.id }));
    expect(store.getConnectorCursor('telegram', ConnectorCapability.Capture, 'primary')?.version).toBe(1);

    const transport = captureFailure(CaptureFailureKind.Transport, true, 'gateway timeout');
    expect(() => store.commitCaptureBatch({
      connectorId: 'telegram', capability: ConnectorCapability.Capture,
      partition: 'primary', expectedCursorVersion: 1,
      nextCursor: cursor(2, 2), captures: [], failures: [transport], leaseToken, committedAt: T2,
    })).toThrow(/retryable|transport|cursor/i);
    store.recordCaptureFailure(transport);
    expect(store.getConnectorCursor('telegram', ConnectorCapability.Capture, 'primary')?.version).toBe(1);
    expect(store.listCaptureFailures('telegram')).toHaveLength(2);
  });

  it('rolls back the entire batch on event conflict or stale cursor and survives restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jericho-capture-'));
    directories.push(directory);
    const path = join(directory, 'core.db');
    const store = openStore(path);
    const leaseToken = captureLease(store);
    store.commitCaptureBatch({
      connectorId: 'telegram', capability: ConnectorCapability.Capture,
      partition: 'primary', expectedCursorVersion: 0,
      nextCursor: cursor(1, 10), captures: [capture('event-1')], leaseToken, committedAt: T1,
    });
    const changesBefore = store.listChangeLog({ afterSequence: 0 });

    expect(() => store.commitCaptureBatch({
      connectorId: 'telegram', capability: ConnectorCapability.Capture,
      partition: 'primary', expectedCursorVersion: 1,
      nextCursor: cursor(2, 11),
      captures: [{ ...capture('event-conflict'), event: { ...event('event-1'), payload: { changed: true } } }],
      leaseToken,
      committedAt: T2,
    })).toThrow(/conflicting event/i);
    expect(store.getConnectorCursor('telegram', ConnectorCapability.Capture, 'primary')?.version).toBe(1);
    expect(store.getEvent('event-conflict')).toBeUndefined();
    expect(store.listChangeLog({ afterSequence: 0 })).toEqual(changesBefore);

    expect(() => store.commitCaptureBatch({
      connectorId: 'telegram', capability: ConnectorCapability.Capture,
      partition: 'primary', expectedCursorVersion: 0,
      nextCursor: cursor(2, 12), captures: [capture('event-2')], leaseToken, committedAt: T2,
    })).toThrow(CursorConflictError);
    expect(store.getEvent('event-2')).toBeUndefined();
    store.close();

    const reopened = openStore(path);
    expect(reopened.getConnectorCursor('telegram', ConnectorCapability.Capture, 'primary')).toMatchObject({
      version: 1,
      epoch: 1,
      sequence: 10,
    });
  });

  it('reuses an exact established identity but never merges on display name', () => {
    const store = openStore();
    const leaseToken = captureLease(store);
    const first = store.commitCaptureBatch({
      connectorId: 'telegram', capability: ConnectorCapability.Capture,
      partition: 'primary', expectedCursorVersion: 0,
      nextCursor: cursor(1, 1),
      captures: [capture('event-1', observation('external-a', 'Same Name'))],
      leaseToken,
      committedAt: T1,
    });
    const established = store.establishExternalIdentity(
      first.identityLinks[0].id,
      first.identityLinks[0].entityId,
      T1,
    );
    expect(established.status).toBe(ExternalIdentityLinkStatus.Established);

    const second = store.commitCaptureBatch({
      connectorId: 'telegram', capability: ConnectorCapability.Capture,
      partition: 'primary', expectedCursorVersion: 1,
      nextCursor: cursor(2, 2),
      captures: [
        capture('event-2', observation('external-a', 'Renamed Person')),
        capture('event-3', observation('external-b', 'Same Name')),
      ],
      leaseToken,
      committedAt: T2,
    });

    expect(second.identityLinks[0].entityId).toBe(established.entityId);
    expect(second.identityLinks[0].status).toBe(ExternalIdentityLinkStatus.Established);
    expect(second.identityLinks[1].entityId).not.toBe(established.entityId);
    expect(second.reviewCandidates).toContainEqual(expect.objectContaining({
      kind: IdentityReviewKind.ProposedMerge,
      status: LifecycleStatus.PendingApproval,
      route: RouteType.HumanApproval,
      candidateEntityIds: expect.arrayContaining([established.entityId]),
    }));
  });

  it('quarantines contradictory external identity claims into Review without remapping', () => {
    const store = openStore();
    const leaseToken = captureLease(store);
    const first = store.commitCaptureBatch({
      connectorId: 'telegram', capability: ConnectorCapability.Capture,
      partition: 'primary', expectedCursorVersion: 0,
      nextCursor: cursor(1, 1),
      captures: [capture('event-1', observation('external-a', 'Carlos'))],
      leaseToken,
      committedAt: T1,
    });
    store.establishExternalIdentity(first.identityLinks[0].id, first.identityLinks[0].entityId, T1);
    const collision = observation('external-a', 'Carlos');
    collision.claimedEntityId = 'entity-someone-else';

    const result = store.commitCaptureBatch({
      connectorId: 'telegram', capability: ConnectorCapability.Capture,
      partition: 'primary', expectedCursorVersion: 1,
      nextCursor: cursor(2, 2), captures: [capture('event-2', collision)], leaseToken, committedAt: T2,
    });

    expect(result.identityLinks[0].entityId).toBe(first.identityLinks[0].entityId);
    expect(result.failures).toContainEqual(expect.objectContaining({
      status: LifecycleStatus.PendingApproval,
      route: RouteType.HumanApproval,
      risk: RiskLevel.Medium,
    }));
    expect(result.reviewCandidates).toContainEqual(expect.objectContaining({
      kind: IdentityReviewKind.Contradiction,
    }));
  });

  it('encrypts connector state and authenticates its query projections', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jericho-capture-crypto-'));
    directories.push(directory);
    const path = join(directory, 'core.db');
    const store = openStore(path);
    const leaseToken = captureLease(store);
    store.commitCaptureBatch({
      connectorId: 'telegram', capability: ConnectorCapability.Capture,
      partition: 'primary', expectedCursorVersion: 0,
      nextCursor: cursor(1, 1),
      captures: [capture('event-secret', observation('external-secret', 'Secret Name'))],
      leaseToken,
      committedAt: T1,
    });
    store.close();

    const database = new DatabaseSync(path);
    const row = database.prepare('SELECT id, body FROM external_identities LIMIT 1').get();
    expect(Buffer.from(row?.body as Uint8Array).includes(Buffer.from('Secret Name'))).toBe(false);
    database.prepare('UPDATE external_identities SET external_id = ? WHERE id = ?')
      .run('tampered-external', row?.id as string);
    database.close();

    const reopened = openStore(path);
    expect(() => reopened.listExternalIdentityLinks({ connectorId: 'telegram' })).toThrow(/authentication|projection/i);
  });
});

describe('connector leases', () => {
  it('acquires, renews, fences, expires, and releases capability-scoped leases', () => {
    const store = openStore();
    const lease = store.acquireConnectorLease({
      connectorId: 'telegram', capability: ConnectorCapability.Capture,
      ownerId: 'worker-a', now: T1, leaseMs: 1_000,
    });
    expect(lease).toBeDefined();
    expect(store.acquireConnectorLease({
      connectorId: 'telegram', capability: ConnectorCapability.Capture,
      ownerId: 'worker-b', now: T1, leaseMs: 1_000,
    })).toBeUndefined();
    expect(() => store.renewConnectorLease(lease!.id, 'wrong-token', T1, 1_000)).toThrow(/lease|token/i);
    const renewed = store.renewConnectorLease(lease!.id, lease!.leaseToken, T1, 2_000);
    expect(renewed.version).toBe(lease!.version + 1);
    expect(store.releaseConnectorLease(lease!.id, renewed.leaseToken)).toBe(true);
    expect(store.acquireConnectorLease({
      connectorId: 'telegram', capability: ConnectorCapability.Capture,
      ownerId: 'worker-b', now: T2, leaseMs: 1_000,
    })?.ownerId).toBe('worker-b');
  });
});

function openStore(path = ':memory:'): JerichoStore {
  const store = new JerichoStore({ path, key: KEY });
  stores.push(store);
  return store;
}

function captureLease(store: JerichoStore): string {
  return store.acquireConnectorLease({
    connectorId: 'telegram',
    capability: ConnectorCapability.Capture,
    ownerId: 'capture-test',
    now: T0,
    leaseMs: 86_400_000,
  })!.leaseToken;
}

function cursor(version: number, sequence: number): VersionedCursor {
  return {
    connectorId: 'telegram',
    capability: ConnectorCapability.Capture,
    partition: 'primary',
    epoch: 1,
    sequence,
    version,
    updatedAt: version === 1 ? T1 : T2,
  };
}

function event(id: string): EventEnvelope {
  return {
    id,
    source: 'telegram',
    sourceType: SourceType.Connector,
    sourceEventId: id,
    type: 'telegram.message',
    occurredAt: T0,
    ingestedAt: T1,
    payload: { text: `message-${id}` },
    provenance: [{ source: 'telegram', sourceType: SourceType.Connector, sourceEventId: id, observedAt: T1 }],
  };
}

function observation(externalId: string, displayName: string): ExternalIdentityObservation {
  return {
    connectorId: 'telegram',
    namespace: 'user',
    externalId,
    entityType: EntityType.Person,
    displayName,
    attributes: {},
    observedAt: T1,
    confidence: 1,
    evidenceEventId: 'event-1',
  };
}

function capture(id: string, identity?: ExternalIdentityObservation): NormalizedCapture {
  return {
    event: event(id),
    identities: identity ? [{ ...identity, evidenceEventId: id }] : [],
    relations: [],
  };
}

function captureFailure(
  kind: CaptureFailureKind,
  retryable: boolean,
  message: string,
): CaptureFailure {
  return {
    id: `failure-${kind}`,
    connectorId: 'telegram',
    capability: ConnectorCapability.Capture,
    kind,
    message,
    retryable,
    status: LifecycleStatus.PendingApproval,
    route: RouteType.HumanApproval,
    risk: RiskLevel.Medium,
    details: {},
    occurredAt: T1,
    provenance: [{ source: 'telegram', sourceType: SourceType.Connector, observedAt: T1 }],
  };
}
