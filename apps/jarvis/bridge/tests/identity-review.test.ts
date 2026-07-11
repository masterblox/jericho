import { afterEach, describe, expect, it } from 'vitest';

import {
  ConnectorCapability,
  DecisionOutcome,
  EntityType,
  ExternalIdentityLinkStatus,
  IdentityReviewDisposition,
  IdentityReviewKind,
  LifecycleStatus,
  RelationType,
  RiskLevel,
  RouteType,
  SourceType,
  type DecisionRecord,
  type Entity,
  type EventEnvelope,
  type ExternalIdentityObservation,
  type NormalizedCapture,
  type VersionedCursor,
} from '@jericho/shared';

import { JerichoStore } from '../src/core/store.js';
import { createJerichoServer, type JerichoServer } from '../src/server.js';

const KEY = Buffer.alloc(32, 83);
const T0 = '2026-07-11T00:00:00.000Z';
const T1 = '2026-07-11T00:01:00.000Z';
const T2 = '2026-07-11T00:02:00.000Z';
const T3 = '2026-07-11T00:03:00.000Z';
const TOKEN = 'identity-review-api-token';
const stores: JerichoStore[] = [];
const servers: JerichoServer[] = [];
const captureLeases = new WeakMap<JerichoStore, string>();

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const store of stores.splice(0)) store.close();
});

describe('source-backed external identity review', () => {
  it('lists an exact, source-backed pending review and explicitly establishes its observed entity', () => {
    const store = openStore();
    store.upsertEntity(entity('known-carlos', EntityType.Person, 'Carlos'));
    const capture = commit(store, 0, 'event-1', observation('telegram-42', 'Carlos'));

    const reviews = store.listIdentityReviews({ status: LifecycleStatus.PendingApproval });

    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      failureId: capture.failures[0].id,
      id: capture.reviewCandidates[0].id,
      version: 1,
      kind: IdentityReviewKind.ProposedMerge,
      observedEntity: {
        id: capture.identityLinks[0].entityId,
        type: EntityType.Person,
      },
      candidateEntities: [{ id: 'known-carlos', type: EntityType.Person }],
      evidenceEventIds: ['event-1'],
      status: LifecycleStatus.PendingApproval,
    });
    expect(reviews[0].reviewHash).toMatch(/^[a-f0-9]{64}$/);
    expect(reviews[0]).not.toHaveProperty('externalId');
    expect(reviews[0].evidence).toEqual([{
      eventId: 'event-1',
      integrityHash: store.getEvent('event-1')!.integrityHash,
    }]);

    const resolved = store.resolveIdentityReview({
      failureId: reviews[0].failureId,
      reviewHash: reviews[0].reviewHash,
      reviewVersion: reviews[0].version,
      disposition: IdentityReviewDisposition.EstablishObserved,
      decision: decision(reviews[0], 'decision-establish', T2),
    });

    expect(resolved.link).toMatchObject({
      id: capture.identityLinks[0].id,
      entityId: capture.identityLinks[0].entityId,
      status: ExternalIdentityLinkStatus.Established,
    });
    expect(resolved.sameAsRelation).toBeUndefined();
    expect(resolved.decision).toMatchObject({
      identityReviewId: reviews[0].id,
      identityReviewFailureId: reviews[0].failureId,
      identityReviewHash: reviews[0].reviewHash,
      identityReviewVersion: 1,
      identityDisposition: IdentityReviewDisposition.EstablishObserved,
      identitySelectedEntityId: reviews[0].observedEntity.id,
      decidedBy: 'carlos',
    });
    expect(store.listIdentityReviews({ status: LifecycleStatus.PendingApproval })).toEqual([]);
    expect(store.listIdentityReviews({ status: LifecycleStatus.Approved })[0]?.decision?.id)
      .toBe('decision-establish');
  });

  it('relinks only a provisional identity to a compatible candidate and preserves a verified SameAs trail', () => {
    const store = openStore();
    const candidate = store.upsertEntity(entity('known-carlos', EntityType.Person, 'Carlos'));
    const capture = commit(store, 0, 'event-1', observation('telegram-42', 'Carlos'));
    const observedId = capture.identityLinks[0].entityId;
    const observedBefore = store.getEntity(observedId)!;
    const review = store.listIdentityReviews()[0];

    const resolved = store.resolveIdentityReview({
      failureId: review.failureId,
      reviewHash: review.reviewHash,
      reviewVersion: review.version,
      disposition: IdentityReviewDisposition.RelinkCandidate,
      targetEntityId: candidate.id,
      decision: decision(review, 'decision-relink', T2, {
        disposition: IdentityReviewDisposition.RelinkCandidate,
        targetEntityId: candidate.id,
      }),
    });

    expect(resolved.link).toMatchObject({
      entityId: candidate.id,
      status: ExternalIdentityLinkStatus.Established,
    });
    expect(store.getEntity(observedId)).toEqual(observedBefore);
    expect(store.getEntity(candidate.id)).toEqual(candidate);
    expect(resolved.sameAsRelation).toMatchObject({
      fromEntityId: observedId,
      toEntityId: candidate.id,
      type: RelationType.SameAs,
      status: LifecycleStatus.Active,
      attributes: {
        verified: true,
        identityReviewId: review.id,
        decisionId: 'decision-relink',
      },
      provenance: expect.arrayContaining([
        expect.objectContaining({ sourceEventId: 'event-1' }),
        expect.objectContaining({ sourceEventId: 'decision-relink' }),
      ]),
    });
    expect(store.listChangeLog({ afterSequence: 0 })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'identity_resolved',
        recordType: 'external_identity',
        recordId: capture.identityLinks[0].id,
        payload: {
          decisionId: 'decision-relink',
          disposition: IdentityReviewDisposition.RelinkCandidate,
          observedEntityId: observedId,
          targetEntityId: candidate.id,
          relationId: resolved.sameAsRelation!.id,
          reviewId: review.id,
        },
      }),
    ]));
  });

  it('rejects stale, incompatible, or replayed decisions without partial writes', () => {
    const store = openStore();
    const candidate = store.upsertEntity(entity('same-name-company', EntityType.Organization, 'Carlos'));
    const capture = commit(store, 0, 'event-1', observation('telegram-42', 'Carlos'));
    const review = store.listIdentityReviews()[0];
    const linkBefore = store.listExternalIdentityLinks()[0];
    const decisionCountBefore = store.listDecisions().length;
    const changeCountBefore = store.listChangeLog({ afterSequence: 0 }).length;

    expect(() => store.resolveIdentityReview({
      failureId: review.failureId,
      reviewHash: `${review.reviewHash.slice(0, -1)}0`,
      reviewVersion: review.version,
      disposition: IdentityReviewDisposition.EstablishObserved,
      decision: decision(review, 'decision-stale', T2),
    })).toThrow(/hash|stale|binding/i);
    expect(() => store.resolveIdentityReview({
      failureId: review.failureId,
      reviewHash: review.reviewHash,
      reviewVersion: review.version,
      disposition: IdentityReviewDisposition.RelinkCandidate,
      targetEntityId: candidate.id,
      decision: decision(review, 'decision-incompatible', T2, {
        disposition: IdentityReviewDisposition.RelinkCandidate,
        targetEntityId: candidate.id,
      }),
    })).toThrow(/type|compatible/i);

    expect(store.listExternalIdentityLinks()[0]).toEqual(linkBefore);
    expect(store.listDecisions()).toHaveLength(decisionCountBefore);
    expect(store.listChangeLog({ afterSequence: 0 })).toHaveLength(changeCountBefore);

    store.resolveIdentityReview({
      failureId: review.failureId,
      reviewHash: review.reviewHash,
      reviewVersion: review.version,
      disposition: IdentityReviewDisposition.EstablishObserved,
      decision: decision(review, 'decision-valid', T2),
    });
    expect(() => store.resolveIdentityReview({
      failureId: review.failureId,
      reviewHash: review.reviewHash,
      reviewVersion: review.version,
      disposition: IdentityReviewDisposition.EstablishObserved,
      decision: decision(review, 'decision-replay', T3),
    })).toThrow(/already resolved|replay|decision/i);
    expect(store.getDecision('decision-replay')).toBeUndefined();
    expect(store.listExternalIdentityLinks()[0]).toMatchObject({
      id: capture.identityLinks[0].id,
      entityId: capture.identityLinks[0].entityId,
      status: ExternalIdentityLinkStatus.Established,
    });
  });

  it('never auto-relinks an established contradiction and requires a new explicit resolution each time', () => {
    const store = openStore();
    const claimed = store.upsertEntity(entity('claimed-carlos', EntityType.Person, 'Carlos Other'));
    const initial = commit(store, 0, 'event-1', observation('telegram-42', 'Carlos'));
    store.establishExternalIdentity(initial.identityLinks[0].id, initial.identityLinks[0].entityId, T1);

    const contradictory = observation('telegram-42', 'Carlos');
    contradictory.claimedEntityId = claimed.id;
    const contradiction = commit(store, 1, 'event-2', contradictory);
    const review = store.listIdentityReviews({ status: LifecycleStatus.PendingApproval })[0];

    expect(review.kind).toBe(IdentityReviewKind.Contradiction);
    expect(contradiction.identityLinks[0].entityId).toBe(initial.identityLinks[0].entityId);
    expect(() => store.resolveIdentityReview({
      failureId: review.failureId,
      reviewHash: review.reviewHash,
      reviewVersion: review.version,
      disposition: IdentityReviewDisposition.RelinkCandidate,
      targetEntityId: claimed.id,
      decision: decision(review, 'decision-forbidden-relink', T2, {
        disposition: IdentityReviewDisposition.RelinkCandidate,
        targetEntityId: claimed.id,
      }),
    })).toThrow(/provisional|established|relink/i);

    store.resolveIdentityReview({
      failureId: review.failureId,
      reviewHash: review.reviewHash,
      reviewVersion: review.version,
      disposition: IdentityReviewDisposition.EstablishObserved,
      decision: decision(review, 'decision-keep-established', T2),
    });
    expect(store.listExternalIdentityLinks()[0].entityId).toBe(initial.identityLinks[0].entityId);

    const nextContradiction = observation('telegram-42', 'Carlos');
    nextContradiction.claimedEntityId = claimed.id;
    commit(store, 2, 'event-3', nextContradiction);
    expect(store.listIdentityReviews({ status: LifecycleStatus.PendingApproval })).toEqual([
      expect.objectContaining({
        kind: IdentityReviewKind.Contradiction,
        evidenceEventIds: ['event-3'],
      }),
    ]);
  });

  it('exposes authenticated privacy-minimized review and exact decision endpoints', async () => {
    const store = openStore();
    store.upsertEntity(entity('known-carlos', EntityType.Person, 'Carlos'));
    commit(store, 0, 'event-api', observation('raw-private-telegram-id', 'Carlos'));
    const server = createJerichoServer({
      store,
      apiToken: TOKEN,
      host: '127.0.0.1',
      clock: () => T2,
      decisionIdFactory: () => 'decision-api',
    });
    servers.push(server);
    const address = await server.listen(0);
    const origin = `http://127.0.0.1:${address.port}`;

    expect((await fetch(`${origin}/api/v1/identity-reviews`)).status).toBe(401);
    const listedResponse = await authenticatedFetch(origin, '/api/v1/identity-reviews');
    expect(listedResponse.status).toBe(200);
    const listedText = await listedResponse.text();
    expect(listedText).not.toContain('raw-private-telegram-id');
    const listed = JSON.parse(listedText) as { reviews: ReturnType<JerichoStore['listIdentityReviews']> };
    expect(listed.reviews).toHaveLength(1);
    const review = listed.reviews[0];

    const decidedResponse = await authenticatedFetch(
      origin,
      `/api/v1/identity-reviews/${encodeURIComponent(review.failureId)}/decisions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          disposition: IdentityReviewDisposition.EstablishObserved,
          reviewHash: review.reviewHash,
          version: review.version,
          reason: 'Carlos confirmed this observed source identity',
        }),
      },
    );
    expect(decidedResponse.status).toBe(200);
    const decided = await decidedResponse.json() as {
      review: ReturnType<JerichoStore['listIdentityReviews']>[number];
      decision: DecisionRecord;
      snapshot: { identityReviews?: ReturnType<JerichoStore['listIdentityReviews']> };
    };
    expect(decided).toMatchObject({
      review: { failureId: review.failureId, status: LifecycleStatus.Approved },
      decision: {
        id: 'decision-api',
        identityReviewFailureId: review.failureId,
        identityReviewHash: review.reviewHash,
        identityDisposition: IdentityReviewDisposition.EstablishObserved,
        decidedBy: 'carlos',
      },
    });
    expect(decided.snapshot.identityReviews).toEqual([
      expect.objectContaining({ failureId: review.failureId, status: LifecycleStatus.Approved }),
    ]);

    const replay = await authenticatedFetch(
      origin,
      `/api/v1/identity-reviews/${encodeURIComponent(review.failureId)}/decisions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          disposition: IdentityReviewDisposition.EstablishObserved,
          reviewHash: review.reviewHash,
          version: review.version,
        }),
      },
    );
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ error: 'identity_review_decision_conflict' });
  });
});

function openStore(): JerichoStore {
  const store = new JerichoStore({ path: ':memory:', key: KEY });
  stores.push(store);
  return store;
}

function commit(
  store: JerichoStore,
  currentVersion: number,
  eventId: string,
  identity: ExternalIdentityObservation,
) {
  const lease = currentVersion === 0
    ? store.acquireConnectorLease({
        connectorId: 'telegram',
        capability: ConnectorCapability.Capture,
        ownerId: 'identity-review-test',
        now: T0,
        leaseMs: 86_400_000,
      })!
    : undefined;
  if (lease) captureLeases.set(store, lease.leaseToken);
  const leaseToken = captureLeases.get(store);
  if (!leaseToken) throw new Error('Identity review fixture has no connector lease');
  return store.commitCaptureBatch({
    connectorId: 'telegram',
    capability: ConnectorCapability.Capture,
    partition: 'primary',
    expectedCursorVersion: currentVersion,
    nextCursor: cursor(currentVersion + 1, currentVersion + 1),
    captures: [capture(eventId, identity)],
    leaseToken,
    committedAt: currentVersion === 0 ? T1 : currentVersion === 1 ? T2 : T3,
  });
}

function decision(
  review: ReturnType<JerichoStore['listIdentityReviews']>[number],
  id: string,
  decidedAt: string,
  options: {
    disposition?: IdentityReviewDisposition;
    targetEntityId?: string;
  } = {},
): DecisionRecord {
  const disposition = options.disposition ?? IdentityReviewDisposition.EstablishObserved;
  return {
    id,
    identityReviewId: review.id,
    identityReviewFailureId: review.failureId,
    identityReviewHash: review.reviewHash,
    identityReviewVersion: review.version,
    identityDisposition: disposition,
    identitySelectedEntityId: options.targetEntityId ?? review.observedEntity.id,
    decidedBy: 'carlos',
    outcome: DecisionOutcome.Approved,
    rationale: disposition === IdentityReviewDisposition.RelinkCandidate
      ? 'Explicitly relink this provisional source identity'
      : 'Keep and establish the observed source identity',
    assumptions: [],
    evidenceEventIds: [...review.evidenceEventIds],
    route: RouteType.HumanApproval,
    risk: review.risk,
    decidedAt,
    provenance: [{
      source: 'local:command-center',
      sourceType: SourceType.User,
      sourceEventId: id,
      observedAt: decidedAt,
    }],
  };
}

function entity(id: string, type: EntityType, name: string): Entity {
  return {
    id,
    type,
    canonicalName: name,
    aliases: [],
    attributes: {},
    status: LifecycleStatus.Active,
    risk: RiskLevel.Low,
    confidence: 1,
    freshness: { observedAt: T0 },
    provenance: [{
      source: 'fixture',
      sourceType: SourceType.User,
      sourceEventId: id,
      observedAt: T0,
    }],
    createdAt: T0,
    updatedAt: T0,
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
    evidenceEventId: 'replaced-by-capture',
  };
}

function capture(id: string, identity: ExternalIdentityObservation): NormalizedCapture {
  return {
    event: event(id),
    identities: [{ ...identity, evidenceEventId: id }],
    relations: [],
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
    provenance: [{
      source: 'telegram',
      sourceType: SourceType.Connector,
      sourceEventId: id,
      observedAt: T1,
    }],
  };
}

function cursor(version: number, sequence: number): VersionedCursor {
  return {
    connectorId: 'telegram',
    capability: ConnectorCapability.Capture,
    partition: 'primary',
    epoch: 1,
    sequence,
    version,
    updatedAt: version === 1 ? T1 : version === 2 ? T2 : T3,
  };
}

function authenticatedFetch(origin: string, path: string, init: RequestInit = {}) {
  return fetch(`${origin}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(init.headers ?? {}),
    },
  });
}
