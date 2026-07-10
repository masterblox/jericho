import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AgentLane,
  CostCategory,
  CostClass,
  DecisionOutcome,
  EscalationReason,
  IntentKind,
  IntentRoute,
  LifecycleStatus,
  MissionTaskKind,
  MutationClass,
  ReceiptStatus,
  RiskLevel,
  RouteType,
  SourceType,
  type ActionReceipt,
  type AgentCapability,
  type Assignment,
  type DecisionRecord,
  type IntentEnvelope,
} from '@jericho/shared';

import { JerichoStore } from '../src/core/store.js';
import { CapabilityRegistry } from '../src/orchestration/capability-registry.js';
import { createMissionPlan } from '../src/orchestration/planner.js';
import {
  MissionRunner,
  type AssignmentExecutor,
  type ExecutorResult,
} from '../src/orchestration/runner.js';

const KEY = Buffer.alloc(32, 91);
const T0 = '2026-07-11T00:00:00.000Z';
const T1 = '2026-07-11T00:01:00.000Z';
const T2 = '2026-07-11T00:02:00.000Z';
const stores: JerichoStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('MissionRunner', () => {
  it('requires a structured verified artifact, records integer costs, and completes work', async () => {
    const store = setup();
    store.enqueueAssignment(assignment());
    const execute = vi.fn<AssignmentExecutor['execute']>().mockResolvedValue(
      result({
        costs: [
          {
            id: 'cost-run-1',
            category: CostCategory.Model,
            estimatedMicroUsd: 100,
            actualMicroUsd: 83,
            idempotencyKey: 'cost-run-key-1',
            provider: 'local',
          },
        ],
      }),
    );
    const runner = new MissionRunner(store, { execute }, runnerOptions());

    const outcome = await runner.runNext();

    expect(outcome.kind).toBe('completed');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.getAssignment('assignment-1')).toMatchObject({
      status: LifecycleStatus.Succeeded,
      artifact: { type: 'report', verified: true },
    });
    expect(store.summarizeMissionCost('mission-v1')).toEqual({
      estimatedMicroUsd: 100,
      actualMicroUsd: 83,
    });
  });

  it('rejects unverified or recursively expanding executor output', async () => {
    const store = setup();
    store.enqueueAssignment(assignment());
    const execute = vi.fn<AssignmentExecutor['execute']>().mockResolvedValue({
      ...result(),
      spawnedAssignments: [{ agentId: 'invented-agent' }],
    } as ExecutorResult);
    const runner = new MissionRunner(store, { execute }, runnerOptions());

    const outcome = await runner.runNext();

    expect(outcome.kind).toBe('retrying');
    expect(store.getAssignment('assignment-1')?.status).toBe(LifecycleStatus.Queued);
    expect(store.listAssignments()).toHaveLength(1);
  });

  it('reserves and verifies one external action, then deduplicates the same action key without reinvoking', async () => {
    const store = setup(true);
    store.enqueueAssignment(externalAssignment());
    store.enqueueAssignment(externalAssignment({
      id: 'assignment-2',
      idempotencyKey: 'assignment-key-2',
    }));
    const execute = vi.fn<AssignmentExecutor['execute']>().mockResolvedValue(
      result({
        artifact: {
          type: 'receipt',
          data: { delivered: true },
          verified: true,
          checks: ['destination-verified'],
          evidenceEventIds: ['evt-delivery'],
        },
        external: {
          externalId: 'telegram-message-1',
          result: { delivered: true },
          verified: true,
          evidenceEventIds: ['evt-delivery'],
        },
      }),
    );
    const runner = new MissionRunner(store, { execute }, runnerOptions());

    expect((await runner.runNext()).kind).toBe('completed');
    expect((await runner.runNext()).kind).toBe('completed');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.getReceiptByIdempotencyKey('external-action-key')).toMatchObject({
      status: ReceiptStatus.Succeeded,
      verified: true,
      externalId: 'telegram-message-1',
    });
  });

  it('checkpoints an uncertain prior action and never invokes the executor', async () => {
    const store = setup(true);
    store.enqueueAssignment(externalAssignment());
    store.reserveReceipt(pendingReceipt());
    const execute = vi.fn<AssignmentExecutor['execute']>();
    const runner = new MissionRunner(store, { execute }, runnerOptions());

    const outcome = await runner.runNext();

    expect(outcome).toMatchObject({
      kind: 'checkpoint',
      reasons: [EscalationReason.UncertainExternalAction],
    });
    expect(execute).not.toHaveBeenCalled();
    expect(store.getAssignment('assignment-1')?.status).toBe(LifecycleStatus.Paused);
    expect(store.getMission('mission-v1')?.status).toBe(LifecycleStatus.Paused);
  });

  it('rejects scope-expanded assignments before a worker can invoke them', () => {
    const store = setup(true);
    expect(() =>
      store.enqueueAssignment(externalAssignment({
        externalAction: {
          ...externalAssignment().externalAction!,
          recipient: 'person-not-approved',
          destination: 'person-not-approved',
        },
      })),
    ).toThrow(/approved task definition/i);
  });
});

function setup(external = false): JerichoStore {
  const store = new JerichoStore({ path: ':memory:', key: KEY });
  stores.push(store);
  store.saveIntent(intent());
  store.registerAgentCapability(capability());
  const plan = createMissionPlan(
    {
      id: 'mission-v1',
      seriesId: 'mission-series',
      version: 1,
      intentId: 'intent-1',
      title: 'Execute safely',
      objective: 'Execute approved work',
      route: RouteType.HumanApproval,
      risk: RiskLevel.Low,
      deliverables: [{ id: 'deliverable', description: 'Verified result', artifactType: 'report', required: true }],
      acceptanceTests: [{ id: 'acceptance', description: 'Artifact verified', verification: 'automatic', requiredEvidence: ['runner'] }],
      evidenceEventIds: [],
      contextSnapshotHash: 'a'.repeat(64),
      taskGraph: [
        {
          id: 'task-1',
          kind: MissionTaskKind.Execute,
          title: 'Execute',
          sequence: 0,
          lane: AgentLane.Dev,
          selectedAgentId: 'dev-agent',
          capabilityIds: ['cap-dev'],
          requiredActions: ['work.execute'],
          dependsOn: [],
          evidenceEventIds: [],
          expectedArtifact: external
            ? { type: 'receipt', description: 'Verified delivery', verification: ['destination-verified'] }
            : { type: 'report', description: 'Verified report', verification: ['tests-pass'] },
          ...(external ? { externalAction: externalSpec() } : {}),
          input: {},
          estimatedCostMicroUsd: 1_000,
          route: RouteType.Agent,
          risk: RiskLevel.Low,
        },
      ],
      budget: { maxCostMicroUsd: 10_000, maxRuntimeMs: 600_000, maxConcurrency: 1, maxRetriesPerAssignment: 1 },
      permissions: permissions(),
      rollback: { strategy: 'revert', steps: ['Revert'], verification: 'Verify' },
      escalationConditions: Object.values(EscalationReason),
      provenance: provenance(),
    },
    new CapabilityRegistry([capability()]),
    T0,
  );
  store.createMissionPlan(plan);
  store.approveMission('mission-v1', plan.planHash, decision());
  return store;
}

function intent(): IntentEnvelope {
  return {
    id: 'intent-1', source: 'test', sourceType: SourceType.User,
    kind: IntentKind.Command, summary: 'Execute', payload: {},
    status: LifecycleStatus.Queued, route: IntentRoute.Project,
    routeRuleId: 'test', entityIds: [], commitments: [], claims: [], assumptions: [],
    deadlines: [], affectedPartyIds: [], requiredEvidence: [],
    requiredCapabilities: ['work.execute'], ambiguityReasons: [],
    contradictoryEvidenceEventIds: [], risk: RiskLevel.Low, confidence: 1,
    provenance: provenance(), createdAt: T0, updatedAt: T0,
  };
}

function capability(): AgentCapability {
  return {
    id: 'cap-dev', agentId: 'dev-agent', lane: AgentLane.Dev, name: 'Execute work',
    status: LifecycleStatus.Active, routes: [RouteType.Agent],
    supportedActions: ['work.execute'], tools: ['telegram.send'],
    modelPolicy: { allowedModels: ['local'], preferLocal: true, maxTokensPerAssignment: 10_000 },
    writableScope: permissions(), costClass: CostClass.Standard,
    mayCreateAssignments: false, maximumRisk: RiskLevel.High, metadata: {},
    provenance: provenance(), createdAt: T0, updatedAt: T0,
  };
}

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: 'assignment-1', missionId: 'mission-v1', missionTaskId: 'task-1',
    agentId: 'dev-agent', capabilityIds: ['cap-dev'], status: LifecycleStatus.Queued,
    route: RouteType.Agent, risk: RiskLevel.Low, instructions: { expectedRuntimeMs: 1_000 },
    evidenceEventIds: [],
    expectedArtifact: { type: 'report', description: 'Verified report', verification: ['tests-pass'] },
    idempotencyKey: 'assignment-key-1', attempt: 0, maxAttempts: 2,
    availableAt: T1, estimatedCostMicroUsd: 1_000, assignedAt: T1,
    provenance: provenance(T1), ...overrides,
  };
}

function externalAssignment(overrides: Partial<Assignment> = {}): Assignment {
  return assignment({
    expectedArtifact: { type: 'receipt', description: 'Verified delivery', verification: ['destination-verified'] },
    externalAction: externalSpec(),
    ...overrides,
  });
}

function externalSpec() {
  return {
    connectorId: 'telegram-gateway', action: 'send_message',
    destination: 'person-carlos', idempotencyKey: 'external-action-key',
    system: 'telegram-gateway', channel: 'telegram', recipient: 'person-carlos',
    tool: 'telegram.send', credentialRef: 'telegram-primary',
    dataScope: 'telegram:selected', mutationClass: MutationClass.Reversible,
  };
}

function result(overrides: Partial<ExecutorResult> = {}): ExecutorResult {
  return {
    artifact: {
      type: 'report', data: { complete: true }, verified: true,
      checks: ['tests-pass'], evidenceEventIds: ['evt-result'],
    },
    costs: [],
    ...overrides,
  };
}

function pendingReceipt(): ActionReceipt {
  return {
    id: 'receipt-pending', assignmentId: 'assignment-1', missionTaskId: 'task-1',
    connectorId: 'telegram-gateway', action: 'send_message',
    idempotencyKey: 'external-action-key', destination: 'person-carlos',
    status: ReceiptStatus.Pending, route: RouteType.Connector, risk: RiskLevel.Low,
    requestedAt: T1, verified: false, evidenceEventIds: [], attempt: 1,
    provenance: provenance(T1),
  };
}

function decision(): DecisionRecord {
  return {
    id: 'decision-1', missionId: 'mission-v1', decidedBy: 'carlos',
    outcome: DecisionOutcome.Approved, rationale: 'Approved', assumptions: [],
    evidenceEventIds: [], route: RouteType.HumanApproval, risk: RiskLevel.Low,
    decidedAt: T1, provenance: provenance(T1),
  };
}

function permissions() {
  return {
    allowedTools: ['telegram.send'], allowedSystems: ['telegram-gateway'],
    allowedRepositories: [], allowedChannels: ['telegram'],
    allowedRecipients: ['person-carlos'], allowedCredentialRefs: ['telegram-primary'],
    allowedDataScopes: ['telegram:selected'],
    allowedMutationClasses: [MutationClass.ReadOnly, MutationClass.Reversible],
  };
}

function provenance(at = T0) {
  return [{ source: 'test', sourceType: SourceType.System, observedAt: at }];
}

function runnerOptions() {
  return { workerId: 'runner', leaseMs: 30_000, clock: () => T2 };
}
