import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  AgentLane,
  CostClass,
  CostCategory,
  DecisionOutcome,
  EscalationReason,
  IntentKind,
  IntentRoute,
  LifecycleStatus,
  MissionTaskKind,
  MutationClass,
  PreferenceScope,
  ProposalKind,
  ReceiptStatus,
  RiskLevel,
  RouteType,
  SourceType,
  type ActionReceipt,
  type AgentCapability,
  type Assignment,
  type CostRecord,
  type DecisionRecord,
  type IntentEnvelope,
  type MissionPlan,
  type PreferenceChange,
  type Proposal,
} from '@jericho/shared';

import { JerichoStore } from '../src/core/store.js';
import { CapabilityRegistry } from '../src/orchestration/capability-registry.js';
import { createMissionPlan, type MissionPlanInput } from '../src/orchestration/planner.js';

const KEY = Buffer.alloc(32, 73);
const T0 = '2026-07-11T00:00:00.000Z';
const T1 = '2026-07-11T00:01:00.000Z';
const T2 = '2026-07-11T00:02:00.000Z';
const T3 = '2026-07-11T00:03:00.000Z';
const openStores: JerichoStore[] = [];
const tempDirectories: string[] = [];

afterEach(() => {
  for (const store of openStores.splice(0)) store.close();
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('orchestration truth records', () => {
  it('persists intents, capabilities, proposals, preferences, decisions, receipts, and costs', () => {
    const store = openStore();
    const intent = store.saveIntent(makeIntent());
    const capability = store.registerAgentCapability(makeCapability());
    const codeCapability = store.registerAgentCapability(capabilities()[1]);
    const plan = store.createMissionPlan(makePlan());
    const proposal = store.saveProposal(makeProposal());
    const preference = store.savePreferenceChange(makePreference());
    const decision = store.appendDecision(makeDecision({ outcome: DecisionOutcome.Deferred }));
    const receipt = store.reserveReceipt(makeReceipt());
    const cost = store.recordCost(makeCost());

    expect(store.getIntent(intent.id)).toEqual(intent);
    expect(store.listIntents()).toEqual([intent]);
    expect(store.getAgentCapability(capability.id)).toEqual(capability);
    expect(store.listAgentCapabilities()).toEqual([codeCapability, capability]);
    expect(store.getMission(plan.id)).toEqual(plan);
    expect(store.listMissionTasks(plan.id)).toHaveLength(2);
    expect(store.getProposal(proposal.id)).toEqual(proposal);
    expect(store.listProposals()).toEqual([proposal]);
    expect(store.getPreferenceChange(preference.id)).toEqual(preference);
    expect(store.listPreferenceChanges()).toEqual([preference]);
    expect(store.getDecision(decision.id)).toEqual(decision);
    expect(store.listDecisions()).toEqual([decision]);
    expect(store.getReceipt(receipt.id)).toEqual(receipt);
    expect(store.getReceiptByIdempotencyKey(receipt.idempotencyKey)).toEqual(receipt);
    expect(store.listReceipts()).toEqual([receipt]);
    expect(store.getCost(cost.id)).toEqual(cost);
    expect(store.listCosts(plan.id)).toEqual([cost]);
    expect(store.summarizeMissionCost(plan.id)).toEqual({ estimatedMicroUsd: 10, actualMicroUsd: 7 });
  });

  it('keeps approved plan definitions immutable, binds approval to the expected hash, and retains revisions across restart', () => {
    const path = temporaryDatabasePath();
    const store = openStore(path);
    seedMission(store);
    const plan = store.getMission('mission-v1')!;

    expect(() =>
      store.approveMission(plan.id, '0'.repeat(64), makeDecision()),
    ).toThrow(/hash/i);
    expect(store.listDecisions()).toEqual([]);

    const approved = store.approveMission(plan.id, plan.planHash, makeDecision());
    expect(approved).toMatchObject({
      status: LifecycleStatus.Approved,
      approvalDecisionId: 'decision-1',
      approvedAt: T1,
      planHash: plan.planHash,
    });
    expect(store.listDecisions()[0].planHash).toBe(plan.planHash);

    expect(() =>
      store.createMissionPlan({
        ...approved,
        objective: 'Silently changed objective',
      }),
    ).toThrow(/immutable|conflict/i);

    const revisionTasks = makePlan().taskGraph.map((task) => ({
      ...task,
      id: `${task.id}-v2`,
      dependsOn: task.dependsOn.map((dependency) => `${dependency}-v2`),
    }));
    const revision = makePlan({
      id: 'mission-v2',
      version: 2,
      supersedesPlanId: plan.id,
      objective: 'Explicitly revised objective',
      taskGraph: revisionTasks,
    });
    store.createMissionPlan(revision);
    store.close();

    const reopened = openStore(path);
    expect(reopened.getMission('mission-v1')?.objective).toBe(plan.objective);
    expect(reopened.getMission('mission-v2')?.objective).toBe('Explicitly revised objective');
    expect(reopened.listMissions({ seriesId: 'mission-series' }).map((item) => item.version)).toEqual([2, 1]);
  });

  it('authenticates orchestration projections and encrypted bodies', () => {
    const path = temporaryDatabasePath();
    const store = openStore(path);
    seedApprovedMission(store);
    store.enqueueAssignment(makeAssignment());
    store.close();

    const database = new DatabaseSync(path);
    const row = database.prepare('SELECT body FROM assignments WHERE id = ?').get('assignment-research');
    expect(Buffer.from(row?.body as Uint8Array).includes(Buffer.from('private instructions'))).toBe(false);
    database.prepare('UPDATE assignments SET status = ? WHERE id = ?').run(LifecycleStatus.Succeeded, 'assignment-research');
    database.close();

    const reopened = openStore(path);
    expect(() => reopened.getAssignment('assignment-research')).toThrow(/authentication|projection/i);
  });
});

describe('durable assignment queue', () => {
  it('leases only dependency-ready work and advances the DAG after verified completion', () => {
    const store = openStore();
    const plan = seedApprovedMission(store);
    store.enqueueAssignment(makeAssignment());
    store.enqueueAssignment(makeAssignment({
      id: 'assignment-code',
      missionTaskId: 'task-code',
      agentId: 'dev-agent',
      capabilityIds: ['cap-code'],
      idempotencyKey: 'assignment-code-key',
      expectedArtifact: { type: 'code', description: 'Code', verification: ['tests-pass'] },
    }));

    const first = store.leaseReadyAssignments({ workerId: 'worker-a', now: T1, leaseMs: 120_000, limit: 4 });
    expect(first.map((item) => item.id)).toEqual(['assignment-research']);
    store.completeAssignment(first[0].id, first[0].leaseToken!, { type: 'report', verified: true }, T2);

    const second = store.leaseReadyAssignments({ workerId: 'worker-a', now: T2, leaseMs: 120_000, limit: 4 });
    expect(second.map((item) => item.id)).toEqual(['assignment-code']);
    expect(store.getMission(plan.id)?.status).toBe(LifecycleStatus.Active);
  });

  it('enforces per-mission concurrency and lease fencing after expiry', () => {
    const store = openStore();
    seedApprovedMission(store, { maxConcurrency: 1 });
    store.enqueueAssignment(makeAssignment());
    // A second assignment for the same ready task is legal but cannot lease concurrently.
    store.enqueueAssignment(makeAssignment({ id: 'assignment-research-2', idempotencyKey: 'assignment-research-key-2' }));

    const first = store.leaseReadyAssignments({ workerId: 'worker-old', now: T1, leaseMs: 1_000, limit: 2 });
    expect(first).toHaveLength(1);
    const oldToken = first[0].leaseToken!;
    const reacquired = store.leaseReadyAssignments({ workerId: 'worker-new', now: T2, leaseMs: 10_000, limit: 1 });
    expect(reacquired[0].leaseToken).not.toBe(oldToken);
    expect(reacquired[0].attempt).toBe(2);
    expect(() =>
      store.completeAssignment(reacquired[0].id, oldToken, { type: 'report' }, T3),
    ).toThrow(/lease|fencing/i);
  });

  it('retries only within the approved limit and supports queued and active cancellation', () => {
    const store = openStore();
    seedApprovedMission(store, { maxRetriesPerAssignment: 1, maxConcurrency: 2 });
    store.enqueueAssignment(makeAssignment());
    const [active] = store.leaseReadyAssignments({ workerId: 'worker', now: T1, leaseMs: 120_000, limit: 1 });

    const retrying = store.failAssignment(active.id, active.leaseToken!, { message: 'temporary' }, T2, T2);
    expect(retrying.status).toBe(LifecycleStatus.Queued);
    const [retried] = store.leaseReadyAssignments({ workerId: 'worker', now: T2, leaseMs: 120_000, limit: 1 });
    const terminal = store.failAssignment(retried.id, retried.leaseToken!, { message: 'again' }, T3, T3);
    expect(terminal.status).toBe(LifecycleStatus.Failed);

    store.enqueueAssignment(makeAssignment({ id: 'assignment-cancel-active', idempotencyKey: 'cancel-active', assignedAt: T3, availableAt: T3 }));
    store.enqueueAssignment(makeAssignment({ id: 'assignment-cancel-queued', idempotencyKey: 'cancel-queued', assignedAt: T3, availableAt: T3 }));
    const [otherActive] = store.leaseReadyAssignments({ workerId: 'worker', now: T3, leaseMs: 10_000, limit: 1 });
    store.requestMissionCancellation('mission-v1', 'Carlos cancelled', T3);
    expect(store.getAssignment('assignment-cancel-queued')?.status).toBe(LifecycleStatus.Cancelled);
    expect(store.getAssignment(otherActive.id)?.cancelRequestedAt).toBe(T3);
    const cancelled = store.acknowledgeAssignmentCancellation(otherActive.id, otherActive.leaseToken!, T3);
    expect(cancelled.status).toBe(LifecycleStatus.Cancelled);
  });
});

describe('receipt idempotency', () => {
  it('returns the same reservation and rejects a conflicting use of its key', () => {
    const store = openStore();
    const receipt = store.reserveReceipt(makeReceipt());
    expect(store.reserveReceipt(makeReceipt({ id: 'receipt-other' }))).toEqual(receipt);
    expect(() =>
      store.reserveReceipt(makeReceipt({ id: 'receipt-other', destination: 'new-recipient' })),
    ).toThrow(/idempotency/i);

    const completed = store.completeReceipt(receipt.id, {
      status: ReceiptStatus.Succeeded,
      externalId: 'telegram-message-10',
      result: { delivered: true },
      verified: true,
      verifiedAt: T2,
      completedAt: T2,
      evidenceEventIds: ['evt-delivery'],
    });
    expect(completed).toMatchObject({ verified: true, externalId: 'telegram-message-10' });
  });
});

function openStore(path = ':memory:'): JerichoStore {
  const store = new JerichoStore({ path, key: KEY });
  openStores.push(store);
  return store;
}

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'jericho-orchestration-'));
  tempDirectories.push(directory);
  return join(directory, 'jericho.db');
}

function provenance(at = T0) {
  return [{ source: 'test', sourceType: SourceType.System, observedAt: at }];
}

function makeIntent(overrides: Partial<IntentEnvelope> = {}): IntentEnvelope {
  return {
    id: 'intent-1',
    source: 'voice',
    sourceType: SourceType.User,
    kind: IntentKind.Goal,
    summary: 'Ship verified work',
    payload: {},
    status: LifecycleStatus.Queued,
    route: IntentRoute.Project,
    routeRuleId: 'classifier:validated-suggestion',
    entityIds: [],
    commitments: [],
    claims: [],
    assumptions: [],
    deadlines: [],
    affectedPartyIds: [],
    requiredEvidence: [],
    requiredCapabilities: ['code.edit'],
    ambiguityReasons: [],
    contradictoryEvidenceEventIds: [],
    risk: RiskLevel.Low,
    confidence: 0.95,
    provenance: provenance(),
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function makeCapability(overrides: Partial<AgentCapability> = {}): AgentCapability {
  return {
    id: 'cap-research',
    agentId: 'research-agent',
    lane: AgentLane.Researcher,
    name: 'Research web',
    status: LifecycleStatus.Active,
    routes: [RouteType.Agent],
    supportedActions: ['research.web'],
    tools: ['web'],
    modelPolicy: { allowedModels: ['local'], preferLocal: true, maxTokensPerAssignment: 10_000 },
    writableScope: permissions(),
    costClass: CostClass.Standard,
    mayCreateAssignments: false,
    maximumRisk: RiskLevel.High,
    metadata: {},
    provenance: provenance(),
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function capabilities() {
  const research = makeCapability();
  const code = makeCapability({
    id: 'cap-code',
    agentId: 'dev-agent',
    lane: AgentLane.Dev,
    name: 'Code safely',
    supportedActions: ['code.edit', 'code.test'],
    tools: ['git'],
  });
  return [research, code];
}

function makePlan(overrides: Partial<MissionPlanInput> = {}): MissionPlan {
  const input: MissionPlanInput = {
    id: 'mission-v1',
    seriesId: 'mission-series',
    version: 1,
    intentId: 'intent-1',
    title: 'Ship Jericho',
    objective: 'Ship verified Jericho work',
    route: RouteType.HumanApproval,
    risk: RiskLevel.Low,
    deliverables: [{ id: 'deliverable', description: 'Engine', artifactType: 'code', required: true }],
    acceptanceTests: [{ id: 'test', description: 'All tests pass', verification: 'automatic', requiredEvidence: ['test-report'] }],
    evidenceEventIds: [],
    contextSnapshotHash: 'a'.repeat(64),
    taskGraph: [
      {
        id: 'task-research',
        kind: MissionTaskKind.Research,
        title: 'Research',
        sequence: 0,
        lane: AgentLane.Researcher,
        selectedAgentId: 'research-agent',
        capabilityIds: ['cap-research'],
        requiredActions: ['research.web'],
        dependsOn: [],
        evidenceEventIds: [],
        expectedArtifact: { type: 'report', description: 'Report', verification: ['source-check'] },
        input: {},
        estimatedCostMicroUsd: 100,
        route: RouteType.Agent,
        risk: RiskLevel.Low,
      },
      {
        id: 'task-code',
        kind: MissionTaskKind.Execute,
        title: 'Code',
        sequence: 1,
        lane: AgentLane.Dev,
        selectedAgentId: 'dev-agent',
        capabilityIds: ['cap-code'],
        requiredActions: ['code.edit', 'code.test'],
        dependsOn: ['task-research'],
        evidenceEventIds: [],
        expectedArtifact: { type: 'code', description: 'Code', verification: ['tests-pass'] },
        input: {},
        estimatedCostMicroUsd: 200,
        route: RouteType.Agent,
        risk: RiskLevel.Low,
      },
    ],
    budget: { maxCostMicroUsd: 10_000, maxRuntimeMs: 600_000, maxConcurrency: 2, maxRetriesPerAssignment: 1 },
    permissions: permissions(),
    rollback: { strategy: 'revert', steps: ['Revert'], verification: 'Tests pass' },
    escalationConditions: Object.values(EscalationReason),
    provenance: provenance(),
    ...overrides,
  };
  return createMissionPlan(input, new CapabilityRegistry(capabilities()), T0);
}

function permissions() {
  return {
    allowedTools: ['git', 'web', 'telegram.send'],
    allowedSystems: ['telegram-gateway'],
    allowedRepositories: [{ repository: 'jericho', writablePaths: ['apps/jarvis'], mutationClasses: [MutationClass.ReadOnly, MutationClass.Reversible] }],
    allowedChannels: ['telegram'],
    allowedRecipients: ['person-carlos'],
    allowedCredentialRefs: ['telegram-primary'],
    allowedDataScopes: ['telegram:selected'],
    allowedMutationClasses: [MutationClass.ReadOnly, MutationClass.Reversible],
  };
}

function seedMission(store: JerichoStore): MissionPlan {
  store.saveIntent(makeIntent());
  for (const capability of capabilities()) store.registerAgentCapability(capability);
  return store.createMissionPlan(makePlan());
}

function seedApprovedMission(store: JerichoStore, budget: Partial<MissionPlan['budget']> = {}): MissionPlan {
  store.saveIntent(makeIntent());
  for (const capability of capabilities()) store.registerAgentCapability(capability);
  const plan = makePlan({ budget: { ...makePlan().budget, ...budget } });
  store.createMissionPlan(plan);
  return store.approveMission(plan.id, plan.planHash, makeDecision());
}

function makeDecision(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    id: 'decision-1',
    missionId: 'mission-v1',
    decidedBy: 'carlos',
    outcome: DecisionOutcome.Approved,
    rationale: 'Approved bounded mission',
    assumptions: [],
    evidenceEventIds: [],
    route: RouteType.HumanApproval,
    risk: RiskLevel.Low,
    decidedAt: T1,
    provenance: provenance(T1),
    ...overrides,
  };
}

function makeAssignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: 'assignment-research',
    missionId: 'mission-v1',
    missionTaskId: 'task-research',
    agentId: 'research-agent',
    capabilityIds: ['cap-research'],
    status: LifecycleStatus.Queued,
    route: RouteType.Agent,
    risk: RiskLevel.Low,
    instructions: { note: 'private instructions' },
    evidenceEventIds: [],
    expectedArtifact: { type: 'report', description: 'Report', verification: ['source-check'] },
    idempotencyKey: 'assignment-research-key',
    attempt: 0,
    maxAttempts: 2,
    availableAt: T1,
    estimatedCostMicroUsd: 100,
    assignedAt: T1,
    provenance: provenance(T1),
    ...overrides,
  };
}

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 'proposal-1',
    proposedByAgentId: 'research-agent',
    kind: ProposalKind.Plan,
    summary: 'Review plan',
    body: {},
    status: LifecycleStatus.PendingApproval,
    route: RouteType.HumanApproval,
    risk: RiskLevel.Low,
    createdAt: T0,
    provenance: provenance(),
    ...overrides,
  };
}

function makePreference(overrides: Partial<PreferenceChange> = {}): PreferenceChange {
  return {
    id: 'preference-1',
    scope: PreferenceScope.User,
    key: 'voice.concise',
    nextValue: true,
    status: LifecycleStatus.PendingApproval,
    route: RouteType.HumanApproval,
    risk: RiskLevel.Low,
    source: 'conversation',
    sourceType: SourceType.User,
    changedAt: T0,
    provenance: provenance(),
    ...overrides,
  };
}

function makeReceipt(overrides: Partial<ActionReceipt> = {}): ActionReceipt {
  return {
    id: 'receipt-1',
    connectorId: 'telegram-gateway',
    action: 'send_message',
    idempotencyKey: 'telegram-send-1',
    destination: 'person-carlos',
    status: ReceiptStatus.Pending,
    route: RouteType.Connector,
    risk: RiskLevel.Low,
    requestedAt: T0,
    verified: false,
    evidenceEventIds: [],
    attempt: 1,
    provenance: provenance(),
    ...overrides,
  };
}

function makeCost(overrides: Partial<CostRecord> = {}): CostRecord {
  return {
    id: 'cost-1',
    missionId: 'mission-v1',
    category: CostCategory.Model,
    estimatedMicroUsd: 10,
    actualMicroUsd: 7,
    idempotencyKey: 'cost-key-1',
    incurredAt: T0,
    provenance: provenance(),
    ...overrides,
  };
}
