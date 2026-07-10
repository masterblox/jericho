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
  type ArtifactRequirement,
  type Assignment,
  type DecisionRecord,
  type EvidenceReference,
  type IntentEnvelope,
  type MissionPermissions,
} from '@jericho/shared';

import { JerichoStore } from '../src/core/store.js';
import { CapabilityRegistry } from '../src/orchestration/capability-registry.js';
import { createMissionPlan } from '../src/orchestration/planner.js';
import {
  MissionRunner,
  type ArtifactVerifier,
  type AssignmentExecutor,
  type ExecutorDescriptor,
  type ExecutorResult,
} from '../src/orchestration/runner.js';

const KEY = Buffer.alloc(32, 91);
const T0 = '2026-07-11T00:00:00.000Z';
const T1 = '2026-07-11T00:01:00.000Z';
const T2 = '2026-07-11T00:02:00.000Z';
const stores: JerichoStore[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const store of stores.splice(0)) store.close();
});

describe('MissionRunner capability and artifact enforcement', () => {
  it('uses an independent verifier, records integer costs, and completes valid work', async () => {
    const requirement = reportRequirement({
      schema: {
        type: 'object',
        required: ['complete'],
        properties: { complete: { type: 'boolean', const: true } },
        additionalProperties: false,
      },
    });
    const store = setup({ requirement });
    store.enqueueAssignment(assignment({ expectedArtifact: requirement }));
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
    const verify = vi.fn<ArtifactVerifier['verify']>().mockResolvedValue(
      verificationFor(requirement),
    );
    const runner = new MissionRunner(
      store,
      executor(execute),
      verifier(verify),
      runnerOptions(),
    );

    const outcome = await runner.runNext();

    expect(outcome.kind).toBe('completed');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(store.getAssignment('assignment-1')).toMatchObject({
      status: LifecycleStatus.Succeeded,
      artifact: {
        type: 'report',
        data: { complete: true },
        verified: true,
        verifierId: 'independent-verifier',
        checks: ['tests-pass'],
        evidence: [{ eventId: 'evt-verification', selector: 'test-report' }],
      },
    });
    expect(store.summarizeMissionCost('mission-v1')).toEqual({
      estimatedMicroUsd: 100,
      actualMicroUsd: 83,
    });
  });

  it.each([
    ['model', { model: 'unregistered-model' }],
    ['tokens', { maxTokens: 5_001 }],
    ['tools', { tools: ['telegram.send', 'root.shell'] }],
    ['scope', {
      writableScope: {
        ...permissions(),
        allowedDataScopes: ['private:all'],
      },
    }],
    ['worker expansion', { mayCreateAssignments: true }],
  ] satisfies Array<[string, Partial<ExecutorDescriptor>]>)('rejects executor %s expansion before invocation', async (_name, descriptorOverride) => {
    const store = setup();
    store.enqueueAssignment(assignment());
    const execute = vi.fn<AssignmentExecutor['execute']>().mockResolvedValue(result());
    const runner = new MissionRunner(
      store,
      executor(execute, descriptorOverride),
      verifier(),
      runnerOptions(),
    );

    const outcome = await runner.runNext();

    expect(outcome.kind).toBe('retrying');
    expect(execute).not.toHaveBeenCalled();
    expect(store.getAssignment('assignment-1')?.status).toBe(LifecycleStatus.Queued);
  });

  it('ignores forged executor verification claims and requires the independent verifier', async () => {
    const store = setup();
    store.enqueueAssignment(assignment());
    const execute = vi.fn<AssignmentExecutor['execute']>().mockResolvedValue({
      ...result(),
      artifact: {
        type: 'report',
        data: { complete: true },
        verified: true,
        checks: ['tests-pass'],
        evidence: [{ eventId: 'forged', selector: 'test-report' }],
      },
    } as ExecutorResult);
    const verify = vi.fn<ArtifactVerifier['verify']>().mockResolvedValue({
      verified: false,
      checks: [],
      evidence: [],
    });
    const runner = new MissionRunner(store, executor(execute), verifier(verify), runnerOptions());

    const outcome = await runner.runNext();

    expect(outcome.kind).toBe('retrying');
    expect(verify).toHaveBeenCalledTimes(1);
    expect(store.getAssignment('assignment-1')?.artifact).toBeUndefined();
  });

  it('rejects an artifact that fails the approved schema even when the verifier approves it', async () => {
    const requirement = reportRequirement({
      schema: {
        type: 'object',
        required: ['complete'],
        properties: { complete: { type: 'boolean', const: true } },
        additionalProperties: false,
      },
    });
    const store = setup({ requirement });
    store.enqueueAssignment(assignment({ expectedArtifact: requirement }));
    const execute = vi.fn<AssignmentExecutor['execute']>().mockResolvedValue(
      result({ artifact: { type: 'report', data: { complete: false } } }),
    );
    const runner = new MissionRunner(store, executor(execute), verifier(), runnerOptions());

    const outcome = await runner.runNext();

    expect(outcome.kind).toBe('retrying');
    expect(store.getAssignment('assignment-1')?.artifact).toBeUndefined();
  });

  it.each([
    [
      'numeric constraint',
      {
        type: 'object',
        required: ['score'],
        properties: { score: { type: 'number', minimum: 1 } },
      },
      { score: 0 },
    ],
    ['unsupported reference', { $ref: '#/$defs/approved' }, { complete: true }],
  ])('fails closed for an artifact schema %s', async (_name, schema, data) => {
    const requirement = reportRequirement({ schema });
    const store = setup({ requirement });
    store.enqueueAssignment(assignment({ expectedArtifact: requirement }));
    const runner = new MissionRunner(
      store,
      executor(vi.fn<AssignmentExecutor['execute']>().mockResolvedValue(
        result({ artifact: { type: 'report', data } }),
      )),
      verifier(undefined, requirement),
      runnerOptions(),
    );

    const outcome = await runner.runNext();

    expect(outcome.kind).toBe('retrying');
    expect(store.getAssignment('assignment-1')?.artifact).toBeUndefined();
  });

  it('requires every approved check and evidence selector from the verifier', async () => {
    const store = setup();
    store.enqueueAssignment(assignment());
    const verify = vi.fn<ArtifactVerifier['verify']>().mockResolvedValue({
      verified: true,
      checks: ['tests-pass'],
      evidence: [{ eventId: 'wrong', selector: 'different-evidence' }],
    });
    const runner = new MissionRunner(store, executor(), verifier(verify), runnerOptions());

    const outcome = await runner.runNext();

    expect(outcome.kind).toBe('retrying');
    expect(store.getAssignment('assignment-1')?.artifact).toBeUndefined();
  });

  it('rejects recursively expanding executor output', async () => {
    const store = setup();
    store.enqueueAssignment(assignment());
    const execute = vi.fn<AssignmentExecutor['execute']>().mockResolvedValue({
      ...result(),
      spawnedAssignments: [{ agentId: 'invented-agent' }],
    } as ExecutorResult);
    const runner = new MissionRunner(store, executor(execute), verifier(), runnerOptions());

    const outcome = await runner.runNext();

    expect(outcome.kind).toBe('retrying');
    expect(store.listAssignments()).toHaveLength(1);
  });
});

describe('MissionRunner external action receipts', () => {
  it('reserves and verifies exactly one external action', async () => {
    const requirement = receiptRequirement();
    const store = setup({ external: true, requirement });
    store.enqueueAssignment(externalAssignment({ expectedArtifact: requirement }));
    const execute = vi.fn<AssignmentExecutor['execute']>().mockResolvedValue(
      result({
        artifact: { type: 'receipt', data: { delivered: true } },
        external: {
          externalId: 'telegram-message-1',
          result: { delivered: true },
          verified: true,
          evidenceEventIds: ['evt-delivery'],
        },
      }),
    );
    const runner = new MissionRunner(
      store,
      executor(execute),
      verifier(undefined, requirement),
      runnerOptions(),
    );

    expect((await runner.runNext()).kind).toBe('completed');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.getReceiptByIdempotencyKey('external-action-key')).toMatchObject({
      assignmentId: 'assignment-1',
      missionTaskId: 'task-1',
      connectorId: 'telegram-gateway',
      action: 'send_message',
      destination: 'person-carlos',
      status: ReceiptStatus.Succeeded,
      verified: true,
      externalId: 'telegram-message-1',
    });
  });

  it('deduplicates an exactly matching verified receipt without reinvoking the executor', async () => {
    const requirement = receiptRequirement();
    const store = setup({ external: true, requirement });
    store.enqueueAssignment(externalAssignment({ expectedArtifact: requirement }));
    succeedReceipt(store, pendingReceipt());
    const execute = vi.fn<AssignmentExecutor['execute']>();
    const runner = new MissionRunner(
      store,
      executor(execute),
      verifier(undefined, requirement),
      runnerOptions(),
    );

    expect((await runner.runNext()).kind).toBe('completed');
    expect(execute).not.toHaveBeenCalled();
    expect(store.getAssignment('assignment-1')?.status).toBe(LifecycleStatus.Succeeded);
  });

  it('checkpoints a mismatched receipt identity even when the key and result are verified', async () => {
    const requirement = receiptRequirement();
    const store = setup({ external: true, requirement });
    store.enqueueAssignment(externalAssignment({ expectedArtifact: requirement }));
    succeedReceipt(store, pendingReceipt({ destination: 'different-destination' }));
    const execute = vi.fn<AssignmentExecutor['execute']>();
    const runner = new MissionRunner(
      store,
      executor(execute),
      verifier(undefined, requirement),
      runnerOptions(),
    );

    const outcome = await runner.runNext();

    expect(outcome).toMatchObject({
      kind: 'checkpoint',
      reasons: [EscalationReason.UncertainExternalAction],
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('checkpoints an uncertain prior action and never invokes the executor', async () => {
    const requirement = receiptRequirement();
    const store = setup({ external: true, requirement });
    store.enqueueAssignment(externalAssignment({ expectedArtifact: requirement }));
    store.reserveReceipt(pendingReceipt());
    const execute = vi.fn<AssignmentExecutor['execute']>();
    const runner = new MissionRunner(
      store,
      executor(execute),
      verifier(undefined, requirement),
      runnerOptions(),
    );

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
    const requirement = receiptRequirement();
    const store = setup({ external: true, requirement });
    expect(() =>
      store.enqueueAssignment(externalAssignment({
        expectedArtifact: requirement,
        externalAction: {
          ...externalSpec(),
          recipient: 'person-not-approved',
          destination: 'person-not-approved',
        },
      })),
    ).toThrow(/approved task definition/i);
  });
});

describe('MissionRunner runtime and cancellation fences', () => {
  it('aborts execution at the real mission deadline and checkpoints without committing output', async () => {
    vi.useFakeTimers();
    const store = setup({ maxRuntimeMs: 100, expectedRuntimeMs: 50 });
    store.enqueueAssignment(assignment({ instructions: { expectedRuntimeMs: 50 } }));
    let executionSignal: AbortSignal | undefined;
    const execute = vi.fn<AssignmentExecutor['execute']>().mockImplementation(
      ({ signal }) => new Promise((resolve) => {
        executionSignal = signal;
        setTimeout(() => resolve(result({
          costs: [{
            id: 'late-cost', category: CostCategory.Model,
            estimatedMicroUsd: 10, actualMicroUsd: 10,
            idempotencyKey: 'late-cost-key',
          }],
        })), 150);
      }),
    );
    const runner = new MissionRunner(
      store,
      executor(execute),
      verifier(),
      runnerOptions({ clock: () => T1 }),
    );

    const running = runner.runNext();
    await vi.advanceTimersByTimeAsync(150);
    const outcome = await running;

    expect(outcome).toMatchObject({
      kind: 'checkpoint',
      reasons: [EscalationReason.RuntimeBudget],
    });
    expect(executionSignal?.aborted).toBe(true);
    expect(store.listCosts('mission-v1')).toEqual([]);
    expect(store.getAssignment('assignment-1')?.status).toBe(LifecycleStatus.Paused);
    expect(store.getAssignment('assignment-1')?.artifact).toBeUndefined();
  });

  it('rechecks elapsed runtime after execution and before verifier, cost, receipt, or artifact commits', async () => {
    const store = setup({ maxRuntimeMs: 100, expectedRuntimeMs: 50 });
    store.enqueueAssignment(assignment({ instructions: { expectedRuntimeMs: 50 } }));
    const verify = vi.fn<ArtifactVerifier['verify']>().mockResolvedValue(
      verificationFor(reportRequirement()),
    );
    const execute = vi.fn<AssignmentExecutor['execute']>().mockResolvedValue(
      result({
        costs: [{
          id: 'overrun-cost', category: CostCategory.Model,
          estimatedMicroUsd: 10, actualMicroUsd: 10,
          idempotencyKey: 'overrun-cost-key',
        }],
      }),
    );
    const clock = sequenceClock(T1, new Date(Date.parse(T1) + 101).toISOString());
    const runner = new MissionRunner(
      store,
      executor(execute),
      verifier(verify),
      runnerOptions({ clock }),
    );

    const outcome = await runner.runNext();

    expect(outcome).toMatchObject({
      kind: 'checkpoint',
      reasons: [EscalationReason.RuntimeBudget],
    });
    expect(verify).not.toHaveBeenCalled();
    expect(store.listCosts('mission-v1')).toEqual([]);
    expect(store.getAssignment('assignment-1')?.artifact).toBeUndefined();
  });

  it('observes durable cancellation during execution, aborts the worker, and commits nothing', async () => {
    vi.useFakeTimers();
    const store = setup();
    store.enqueueAssignment(assignment());
    let executionSignal: AbortSignal | undefined;
    const execute = vi.fn<AssignmentExecutor['execute']>().mockImplementation(
      ({ signal }) => new Promise((resolve) => {
        executionSignal = signal;
        setTimeout(() => resolve(result({
          costs: [{
            id: 'cancelled-cost', category: CostCategory.Model,
            estimatedMicroUsd: 10, actualMicroUsd: 10,
            idempotencyKey: 'cancelled-cost-key',
          }],
        })), 500);
      }),
    );
    const verify = vi.fn<ArtifactVerifier['verify']>();
    const runner = new MissionRunner(
      store,
      executor(execute),
      verifier(verify),
      runnerOptions({ clock: () => T2, cancellationPollMs: 25 }),
    );

    const running = runner.runNext();
    store.requestMissionCancellation('mission-v1', 'Carlos cancelled', T2);
    await vi.advanceTimersByTimeAsync(500);
    const outcome = await running;

    expect(outcome.kind).toBe('cancelled');
    expect(executionSignal?.aborted).toBe(true);
    expect(verify).not.toHaveBeenCalled();
    expect(store.listCosts('mission-v1')).toEqual([]);
    expect(store.getAssignment('assignment-1')?.status).toBe(LifecycleStatus.Cancelled);
    expect(store.getAssignment('assignment-1')?.artifact).toBeUndefined();
  });
});

interface SetupOptions {
  external?: boolean;
  requirement?: ArtifactRequirement;
  maxRuntimeMs?: number;
  expectedRuntimeMs?: number;
}

function setup(options: SetupOptions = {}): JerichoStore {
  const external = options.external ?? false;
  const requirement = options.requirement ?? (external ? receiptRequirement() : reportRequirement());
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
      deliverables: [{ id: 'deliverable', description: 'Verified result', artifactType: requirement.type, required: true }],
      acceptanceTests: [{ id: 'acceptance', description: 'Artifact verified', verification: 'automatic', requiredEvidence: [...requirement.requiredEvidence] }],
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
          requiredActions: external ? ['work.execute', 'send_message'] : ['work.execute'],
          requiredTools: ['telegram.send'],
          model: 'local',
          maxTokens: 5_000,
          writableScope: permissions(),
          dependsOn: [],
          evidenceEventIds: [],
          expectedArtifact: requirement,
          ...(external ? { externalAction: externalSpec() } : {}),
          input: { expectedRuntimeMs: options.expectedRuntimeMs ?? 1_000 },
          estimatedCostMicroUsd: 1_000,
          route: RouteType.Agent,
          risk: RiskLevel.Low,
        },
      ],
      budget: { maxCostMicroUsd: 10_000, maxRuntimeMs: options.maxRuntimeMs ?? 600_000, maxConcurrency: 1, maxRetriesPerAssignment: 1 },
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
    supportedActions: ['work.execute', 'send_message'], tools: ['telegram.send'],
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
    evidenceEventIds: [], expectedArtifact: reportRequirement(),
    idempotencyKey: 'assignment-key-1', attempt: 0, maxAttempts: 2,
    availableAt: T1, estimatedCostMicroUsd: 1_000, assignedAt: T1,
    provenance: provenance(T1), ...overrides,
  };
}

function externalAssignment(overrides: Partial<Assignment> = {}): Assignment {
  return assignment({
    expectedArtifact: receiptRequirement(),
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

function reportRequirement(overrides: Partial<ArtifactRequirement> = {}): ArtifactRequirement {
  return {
    type: 'report', description: 'Verified report', verification: ['tests-pass'],
    requiredEvidence: ['test-report'], ...overrides,
  };
}

function receiptRequirement(): ArtifactRequirement {
  return {
    type: 'receipt', description: 'Verified delivery',
    verification: ['destination-verified'], requiredEvidence: ['delivery-receipt'],
  };
}

function result(overrides: Partial<ExecutorResult> = {}): ExecutorResult {
  return {
    artifact: { type: 'report', data: { complete: true } },
    costs: [],
    ...overrides,
  };
}

function executor(
  execute: AssignmentExecutor['execute'] = vi.fn<AssignmentExecutor['execute']>().mockResolvedValue(result()),
  overrides: Partial<ExecutorDescriptor> = {},
): AssignmentExecutor {
  return {
    descriptor: {
      model: 'local',
      maxTokens: 5_000,
      tools: ['telegram.send'],
      writableScope: permissions(),
      mayCreateAssignments: false,
      ...overrides,
    },
    execute,
  };
}

function verifier(
  verify?: ArtifactVerifier['verify'],
  requirement: ArtifactRequirement = reportRequirement(),
): ArtifactVerifier {
  return {
    id: 'independent-verifier',
    verify: verify ?? vi.fn<ArtifactVerifier['verify']>().mockResolvedValue(
      verificationFor(requirement),
    ),
  };
}

function verificationFor(requirement: ArtifactRequirement) {
  return {
    verified: true,
    checks: [...requirement.verification],
    evidence: requirement.requiredEvidence.map((selector, index): EvidenceReference => ({
      eventId: index === 0 ? 'evt-verification' : `evt-verification-${index}`,
      selector,
    })),
  };
}

function pendingReceipt(overrides: Partial<ActionReceipt> = {}): ActionReceipt {
  return {
    id: 'receipt-pending', assignmentId: 'assignment-1', missionTaskId: 'task-1',
    connectorId: 'telegram-gateway', action: 'send_message',
    idempotencyKey: 'external-action-key', destination: 'person-carlos',
    status: ReceiptStatus.Pending, route: RouteType.Connector, risk: RiskLevel.Low,
    requestedAt: T1, verified: false, evidenceEventIds: [], attempt: 1,
    provenance: provenance(T1), ...overrides,
  };
}

function succeedReceipt(store: JerichoStore, receipt: ActionReceipt): void {
  store.reserveReceipt(receipt);
  store.completeReceipt(receipt.id, {
    status: ReceiptStatus.Succeeded,
    externalId: 'telegram-message-existing',
    result: { delivered: true },
    verified: true,
    verifiedAt: T1,
    completedAt: T1,
    evidenceEventIds: ['evt-existing-receipt'],
  });
}

function decision(): DecisionRecord {
  return {
    id: 'decision-1', missionId: 'mission-v1', decidedBy: 'carlos',
    outcome: DecisionOutcome.Approved, rationale: 'Approved', assumptions: [],
    evidenceEventIds: [], route: RouteType.HumanApproval, risk: RiskLevel.Low,
    decidedAt: T1, provenance: provenance(T1),
  };
}

function permissions(): MissionPermissions {
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

function runnerOptions(overrides: Partial<{
  workerId: string;
  leaseMs: number;
  clock: () => string;
  retryDelayMs: number;
  cancellationPollMs: number;
}> = {}) {
  return { workerId: 'runner', leaseMs: 30_000, clock: () => T2, ...overrides };
}

function sequenceClock(...values: string[]): () => string {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}
