import { afterEach, describe, expect, it } from 'vitest';

import {
  DecisionOutcome,
  EntityType,
  LifecycleStatus,
  ProposalKind,
  RelationType,
  RiskLevel,
  RouteType,
  SourceType,
  type DecisionRecord,
  type Entity,
  type EventEnvelope,
  type Proposal,
  type Relation,
} from '@jericho/shared';

import { JerichoStore } from '../src/core/store.js';
import { createJerichoServer } from '../src/server.js';

const KEY = Buffer.alloc(32, 109);
const T0 = '2026-07-11T00:00:00.000Z';
const T1 = '2026-07-11T00:01:00.000Z';
const stores: JerichoStore[] = [];
const servers: Array<{ close(): Promise<void> }> = [];
const TOKEN = 'proposal-api-token';

type VersionedProposal = Proposal & { version: number };
type ProposalBoundDecision = DecisionRecord & {
  proposalHash: string;
  proposalVersion: number;
};
type ProposalResolution = {
  proposal: VersionedProposal;
  decision: ProposalBoundDecision;
  relation?: Relation;
};
type ProposalDecisionStore = JerichoStore & {
  resolveProposal(input: {
    proposalId: string;
    proposalHash: string;
    proposalVersion: number;
    decision: ProposalBoundDecision;
  }): ProposalResolution;
};

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const store of stores.splice(0)) store.close();
});

describe('generic proposal decisions', () => {
  it('atomically binds a draft approval to the exact proposal hash/version without executing it', () => {
    const store = openStore();
    const proposal = saveVersionedProposal(store, {
      id: 'proposal-message',
      kind: ProposalKind.Message,
      summary: 'Draft reply to Paula',
      body: { to: 'Paula', draft: 'Hello Paula' },
    });
    const decision = boundDecision(proposal, DecisionOutcome.Approved, 'decision-message');

    const resolved = proposalStore(store).resolveProposal({
      proposalId: proposal.id,
      proposalHash: proposal.integrityHash!,
      proposalVersion: proposal.version,
      decision,
    });

    expect(resolved).toMatchObject({
      proposal: { id: proposal.id, status: LifecycleStatus.Approved, version: 1 },
      decision: {
        id: 'decision-message', proposalId: proposal.id,
        proposalHash: proposal.integrityHash, proposalVersion: 1,
      },
    });
    expect(resolved.relation).toBeUndefined();
    expect(store.listAssignments()).toEqual([]);
    expect(store.listReceipts()).toEqual([]);
    expect(store.listRelations()).toEqual([]);
    expect(store.listChangeLog({ limit: 10 }).filter((change) =>
      change.recordId === proposal.id).map((change) => change.changedAt)).toEqual([T0, T1]);

    expect(() => proposalStore(store).resolveProposal({
      proposalId: proposal.id,
      proposalHash: proposal.integrityHash!,
      proposalVersion: proposal.version,
      decision: boundDecision(proposal, DecisionOutcome.Approved, 'decision-replay'),
    })).toThrow(/proposal.*(?:pending|conflict)/i);
    expect(store.listDecisions()).toHaveLength(1);
  });

  it('rejects stale or forged bindings with zero lifecycle or decision writes', () => {
    const store = openStore();
    const proposal = saveVersionedProposal(store, {
      id: 'proposal-action',
      kind: ProposalKind.Action,
      summary: 'Draft a follow-up action',
      body: { action: 'follow_up', target: 'Paula' },
    });

    expect(() => proposalStore(store).resolveProposal({
      proposalId: proposal.id,
      proposalHash: 'f'.repeat(64),
      proposalVersion: proposal.version,
      decision: boundDecision(proposal, DecisionOutcome.Approved, 'decision-stale-hash'),
    })).toThrow(/proposal.*(?:hash|binding|conflict)/i);
    expect(() => proposalStore(store).resolveProposal({
      proposalId: proposal.id,
      proposalHash: proposal.integrityHash!,
      proposalVersion: proposal.version + 1,
      decision: boundDecision(proposal, DecisionOutcome.Approved, 'decision-stale-version'),
    })).toThrow(/proposal.*(?:version|binding|conflict)/i);

    expect(store.getProposal(proposal.id)?.status).toBe(LifecycleStatus.PendingApproval);
    expect(store.listDecisions()).toEqual([]);
    expect(store.listRelations()).toEqual([]);
  });

  it('applies only an exact source-backed Nucleus relationship effect with decision provenance', () => {
    const store = openStore();
    seedVerifiedEntity(store, 'person-paula', EntityType.Person, 'Paula', 'event-paula');
    seedVerifiedEntity(store, 'company-acme', EntityType.Organization, 'Acme', 'event-acme');
    const proposal = saveVersionedProposal(store, {
      id: 'relationship-proposal',
      proposedByAgentId: 'carlos',
      kind: ProposalKind.DataChange,
      summary: 'Relate Paula to Acme',
      body: {
        effect: 'create_relation',
        fromNodeId: 'entity:person-paula',
        toNodeId: 'entity:company-acme',
        fromEntityId: 'person-paula',
        toEntityId: 'company-acme',
        relation: RelationType.RelatedTo,
        evidenceEventIds: ['event-paula', 'event-acme'],
        verified: false,
      },
      provenance: [{
        source: 'local:nucleus', sourceType: SourceType.User,
        sourceEventId: 'relationship-proposal', observedAt: T0,
      }],
    });

    const resolved = proposalStore(store).resolveProposal({
      proposalId: proposal.id,
      proposalHash: proposal.integrityHash!,
      proposalVersion: proposal.version,
      decision: boundDecision(proposal, DecisionOutcome.Approved, 'decision-relation'),
    });

    expect(resolved.relation).toMatchObject({
      fromEntityId: 'person-paula',
      toEntityId: 'company-acme',
      type: RelationType.RelatedTo,
      status: LifecycleStatus.Active,
      attributes: {
        effect: 'create_relation',
        verified: true,
        proposalId: proposal.id,
        decisionId: 'decision-relation',
        evidenceEventIds: ['event-paula', 'event-acme'],
      },
    });
    expect(resolved.relation?.provenance).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'local:nucleus', sourceEventId: proposal.id }),
      expect.objectContaining({ source: 'local:command-center', sourceEventId: 'decision-relation' }),
      expect.objectContaining({ sourceEventId: 'event-paula' }),
      expect.objectContaining({ sourceEventId: 'event-acme' }),
    ]));
    expect(store.listRelations()).toHaveLength(1);
  });

  it('rolls back a relationship approval on duplicate edges and never applies rejected or reflection suggestions', () => {
    const store = openStore();
    seedVerifiedEntity(store, 'person-paula', EntityType.Person, 'Paula', 'event-paula');
    seedVerifiedEntity(store, 'company-acme', EntityType.Organization, 'Acme', 'event-acme');
    store.upsertRelation(existingRelation());
    const duplicate = relationshipProposal(store, 'relationship-duplicate');

    expect(() => proposalStore(store).resolveProposal({
      proposalId: duplicate.id,
      proposalHash: duplicate.integrityHash!,
      proposalVersion: duplicate.version,
      decision: boundDecision(duplicate, DecisionOutcome.Approved, 'decision-duplicate'),
    })).toThrow(/relation.*(?:exists|conflict)/i);
    expect(store.getProposal(duplicate.id)?.status).toBe(LifecycleStatus.PendingApproval);
    expect(store.listDecisions()).toEqual([]);
    expect(store.listRelations()).toEqual([expect.objectContaining({ id: 'existing-relation' })]);

    const rejected = relationshipProposal(store, 'relationship-rejected');
    const rejectedResolution = proposalStore(store).resolveProposal({
      proposalId: rejected.id,
      proposalHash: rejected.integrityHash!,
      proposalVersion: rejected.version,
      decision: boundDecision(rejected, DecisionOutcome.Rejected, 'decision-rejected'),
    });
    expect(rejectedResolution.proposal.status).toBe(LifecycleStatus.Rejected);
    expect(store.listRelations()).toHaveLength(1);

    const reflection = saveVersionedProposal(store, {
      id: 'reflection-contradiction',
      proposedByAgentId: 'jericho-reflection-v1',
      kind: ProposalKind.DataChange,
      summary: 'Review contradictory decisions',
      body: {
        kind: 'decision_conflict', recordIds: ['decision-a', 'decision-b'],
        evidenceEventIds: ['event-paula'], autoResolution: false, observedAt: T0,
      },
      provenance: [{
        source: 'jericho-reflection-v1', sourceType: SourceType.System,
        sourceEventId: 'reflection-contradiction', observedAt: T0,
      }],
    });
    const reflectionResolution = proposalStore(store).resolveProposal({
      proposalId: reflection.id,
      proposalHash: reflection.integrityHash!,
      proposalVersion: reflection.version,
      decision: boundDecision(reflection, DecisionOutcome.Approved, 'decision-reflection'),
    });
    expect(reflectionResolution.proposal.status).toBe(LifecycleStatus.Approved);
    expect(reflectionResolution.relation).toBeUndefined();
    expect(store.listRelations()).toHaveLength(1);
    expect(store.listAssignments()).toEqual([]);
    expect(store.listReceipts()).toEqual([]);
  });
});

describe('generic proposal decision API', () => {
  it('authenticates and applies an exact relationship decision once with a refreshed graph', async () => {
    const store = openStore();
    seedVerifiedEntity(store, 'person-paula', EntityType.Person, 'Paula', 'event-paula');
    seedVerifiedEntity(store, 'company-acme', EntityType.Organization, 'Acme', 'event-acme');
    const server = createJerichoServer({
      store,
      apiToken: TOKEN,
      host: '127.0.0.1',
      clock: () => T1,
      decisionIdFactory: () => 'decision-api-relation',
    });
    servers.push(server);
    const address = await server.listen(0);
    const origin = `http://127.0.0.1:${address.port}`;

    expect((await fetch(`${origin}/api/v1/relationship-proposals`, { method: 'POST' })).status).toBe(401);
    const createdResponse = await api(origin, '/api/v1/relationship-proposals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fromNodeId: 'entity:person-paula',
        toNodeId: 'entity:company-acme',
        relation: RelationType.RelatedTo,
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as {
      proposal: VersionedProposal;
      snapshot: { nucleus: { edges: unknown[] } };
    };
    expect(created.proposal).toMatchObject({
      version: 1,
      status: LifecycleStatus.PendingApproval,
      body: {
        effect: 'create_relation',
        fromEntityId: 'person-paula',
        toEntityId: 'company-acme',
        verified: false,
      },
    });
    expect(created.proposal.integrityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(created.snapshot.nucleus.edges).toEqual([]);

    const decisionPath = `/api/v1/proposals/${encodeURIComponent(created.proposal.id)}/decisions`;
    expect((await fetch(`${origin}${decisionPath}`, { method: 'POST' })).status).toBe(401);
    const stale = await api(origin, decisionPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        outcome: DecisionOutcome.Approved,
        proposalHash: 'f'.repeat(64),
        version: created.proposal.version,
      }),
    });
    expect(stale.status).toBe(409);
    expect(store.listDecisions()).toEqual([]);
    expect(store.listRelations()).toEqual([]);

    const decidedResponse = await api(
      origin,
      decisionPath,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          outcome: DecisionOutcome.Approved,
          proposalHash: created.proposal.integrityHash,
          version: created.proposal.version,
          reason: 'Carlos reviewed the exact relationship evidence',
        }),
      },
    );
    expect(decidedResponse.status).toBe(200);
    const decided = await decidedResponse.json() as any;
    expect(decided).toMatchObject({
      proposal: { id: created.proposal.id, status: LifecycleStatus.Approved, version: 1 },
      decision: {
        id: 'decision-api-relation',
        proposalHash: created.proposal.integrityHash,
        proposalVersion: 1,
        outcome: DecisionOutcome.Approved,
      },
      relation: {
        fromEntityId: 'person-paula', toEntityId: 'company-acme',
        type: RelationType.RelatedTo, attributes: { verified: true },
      },
    });
    expect(decided.snapshot.nucleus.edges).toEqual([
      expect.objectContaining({
        fromNodeId: 'entity:person-paula',
        toNodeId: 'entity:company-acme',
        relation: RelationType.RelatedTo,
        verified: true,
      }),
    ]);

    const replay = await api(
      origin,
      decisionPath,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          outcome: DecisionOutcome.Approved,
          proposalHash: created.proposal.integrityHash,
          version: created.proposal.version,
        }),
      },
    );
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ error: 'proposal_decision_conflict' });
    expect(store.listDecisions()).toHaveLength(1);
    expect(store.listRelations()).toHaveLength(1);
  });

  it('marks message approval as reviewed while creating no executable work or receipts', async () => {
    const store = openStore();
    const proposal = saveVersionedProposal(store, {
      id: 'message-api', kind: ProposalKind.Message,
      summary: 'Draft Telegram reply', body: { to: 'Paula', draft: 'Hello' },
    });
    const server = createJerichoServer({
      store, apiToken: TOKEN, host: '127.0.0.1', clock: () => T1,
      decisionIdFactory: () => 'decision-api-message',
    });
    servers.push(server);
    const address = await server.listen(0);
    const origin = `http://127.0.0.1:${address.port}`;

    const response = await api(origin, `/api/v1/proposals/${proposal.id}/decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        outcome: DecisionOutcome.Approved,
        proposalHash: proposal.integrityHash,
        version: proposal.version,
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      proposal: { id: proposal.id, status: LifecycleStatus.Approved },
      decision: { outcome: DecisionOutcome.Approved },
    });
    expect(store.listAssignments()).toEqual([]);
    expect(store.listReceipts()).toEqual([]);
  });

  it('creates an exact Isabella note preview and approval never writes or queues work', async () => {
    const store = openStore();
    const server = createJerichoServer({
      store, apiToken: TOKEN, host: '127.0.0.1', clock: () => T1,
      decisionIdFactory: () => 'decision-isabella-preview',
    });
    servers.push(server);
    const address = await server.listen(0);
    const origin = `http://127.0.0.1:${address.port}`;

    const createdResponse = await api(origin, '/api/v1/obsidian/reorganization-proposals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ relativePath: 'People/Isabella.md', title: 'Isabella' }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { proposal: VersionedProposal };
    expect(created.proposal).toMatchObject({
      status: LifecycleStatus.PendingApproval,
      proposedByAgentId: 'jericho-guided-test',
      body: {
        effect: 'reorganize_obsidian_note',
        relativePath: 'People/Isabella.md',
        writesApplied: false,
        changes: [
          { operation: 'add_context', value: 'family' },
          { operation: 'add_context', value: 'masterblox' },
          { operation: 'preserve_existing_content', value: true },
        ],
      },
    });

    const decided = await api(origin, `/api/v1/proposals/${created.proposal.id}/decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        outcome: DecisionOutcome.Approved,
        proposalHash: created.proposal.integrityHash,
        version: created.proposal.version,
      }),
    });
    expect(decided.status).toBe(200);
    expect(await decided.json()).toMatchObject({
      proposal: { status: LifecycleStatus.Approved },
      decision: { outcome: DecisionOutcome.Approved },
    });
    expect(store.listAssignments()).toEqual([]);
    expect(store.listReceipts()).toEqual([]);
    expect(store.listRelations()).toEqual([]);
  });
});

function openStore(): JerichoStore {
  const store = new JerichoStore({ path: ':memory:', key: KEY });
  stores.push(store);
  return store;
}

function proposalStore(store: JerichoStore): ProposalDecisionStore {
  return store as ProposalDecisionStore;
}

function saveVersionedProposal(
  store: JerichoStore,
  overrides: Partial<Proposal> & Pick<Proposal, 'id' | 'kind' | 'summary' | 'body'>,
): VersionedProposal {
  return store.saveProposal({
    proposedByAgentId: 'jericho',
    version: 1,
    status: LifecycleStatus.PendingApproval,
    route: RouteType.HumanApproval,
    risk: RiskLevel.Low,
    createdAt: T0,
    provenance: [{ source: 'test', sourceType: SourceType.Agent, observedAt: T0 }],
    ...overrides,
  } as Proposal) as VersionedProposal;
}

function boundDecision(
  proposal: VersionedProposal,
  outcome: DecisionOutcome.Approved | DecisionOutcome.Rejected,
  id: string,
): ProposalBoundDecision {
  return {
    id,
    proposalId: proposal.id,
    proposalHash: proposal.integrityHash!,
    proposalVersion: proposal.version,
    decidedBy: 'carlos',
    outcome,
    rationale: outcome === DecisionOutcome.Approved ? 'Reviewed and approved' : 'Reviewed and rejected',
    assumptions: [],
    evidenceEventIds: evidenceIds(proposal),
    route: RouteType.HumanApproval,
    risk: proposal.risk,
    decidedAt: T1,
    provenance: [{
      source: 'local:command-center', sourceType: SourceType.User,
      sourceEventId: id, observedAt: T1,
    }],
  } as ProposalBoundDecision;
}

function seedVerifiedEntity(
  store: JerichoStore,
  id: string,
  type: EntityType,
  canonicalName: string,
  eventId: string,
): Entity {
  store.appendEvent(event(eventId));
  return store.upsertEntity({
    id, type, canonicalName, aliases: [], attributes: {},
    status: LifecycleStatus.Active, risk: RiskLevel.Low,
    freshness: { observedAt: T0 },
    provenance: [{
      source: 'test:connector', sourceType: SourceType.Connector,
      sourceEventId: eventId, observedAt: T0,
    }],
    createdAt: T0, updatedAt: T0,
  });
}

function event(id: string): EventEnvelope {
  return {
    id,
    source: 'test:connector', sourceType: SourceType.Connector,
    sourceEventId: id, type: 'test.entity.observed',
    occurredAt: T0, ingestedAt: T0, payload: { id },
    provenance: [{
      source: 'test:connector', sourceType: SourceType.Connector,
      sourceEventId: id, observedAt: T0,
    }],
  };
}

function relationshipProposal(store: JerichoStore, id: string): VersionedProposal {
  return saveVersionedProposal(store, {
    id,
    proposedByAgentId: 'carlos',
    kind: ProposalKind.DataChange,
    summary: 'Relate Paula to Acme',
    body: {
      effect: 'create_relation',
      fromNodeId: 'entity:person-paula', toNodeId: 'entity:company-acme',
      fromEntityId: 'person-paula', toEntityId: 'company-acme',
      relation: RelationType.RelatedTo,
      evidenceEventIds: ['event-paula', 'event-acme'], verified: false,
    },
    provenance: [{
      source: 'local:nucleus', sourceType: SourceType.User,
      sourceEventId: id, observedAt: T0,
    }],
  });
}

function existingRelation(): Relation {
  return {
    id: 'existing-relation',
    fromEntityId: 'person-paula', toEntityId: 'company-acme',
    type: RelationType.RelatedTo, attributes: { source: 'existing' },
    status: LifecycleStatus.Active, risk: RiskLevel.Low,
    freshness: { observedAt: T0 },
    provenance: [{
      source: 'test:connector', sourceType: SourceType.Connector,
      sourceEventId: 'event-paula', observedAt: T0,
    }],
    createdAt: T0, updatedAt: T0,
  };
}

function evidenceIds(proposal: Proposal): string[] {
  return Array.isArray(proposal.body.evidenceEventIds)
    ? proposal.body.evidenceEventIds.filter((value): value is string => typeof value === 'string')
    : [];
}

function api(origin: string, path: string, init: RequestInit): Promise<Response> {
  return fetch(`${origin}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
  });
}
