import { describe, expect, it } from 'vitest';

import {
  AgentLane,
  CostClass,
  EscalationReason,
  LifecycleStatus,
  MissionTaskKind,
  MutationClass,
  RiskLevel,
  RouteType,
  SourceType,
  type AgentCapability,
  type MissionPlan,
  type MissionTaskDefinition,
} from '@jericho/shared';

import { CapabilityRegistry } from '../src/orchestration/capability-registry.js';
import { computeMissionPlanHash } from '../src/orchestration/mission-hash.js';
import { createMissionPlan, type MissionPlanInput } from '../src/orchestration/planner.js';
import { evaluateMissionAction } from '../src/orchestration/policy.js';

const now = '2026-07-11T01:00:00.000Z';

describe('bounded mission planning', () => {
  it('builds a self-contained, immutable-hash mission with an acyclic registered graph', () => {
    const plan = createMissionPlan(planInput(), registry(), now);

    expect(plan.status).toBe(LifecycleStatus.PendingApproval);
    expect(plan.taskGraph).toHaveLength(2);
    expect(plan.selectedAgents).toEqual([
      { taskId: 'task-research', agentId: 'research-agent', lane: AgentLane.Researcher, capabilityIds: ['cap-research'] },
      { taskId: 'task-code', agentId: 'dev-agent', lane: AgentLane.Dev, capabilityIds: ['cap-code'] },
    ]);
    expect(plan.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.planHash).toBe(computeMissionPlanHash(plan));
  });

  it('hashes definition fields canonically and excludes lifecycle-only changes', () => {
    const plan = createMissionPlan(planInput(), registry(), now);
    const reordered = {
      ...plan,
      permissions: {
        ...plan.permissions,
        allowedRepositories: plan.permissions.allowedRepositories.map((grant) => ({
          mutationClasses: grant.mutationClasses,
          writablePaths: grant.writablePaths,
          repository: grant.repository,
        })),
      },
      status: LifecycleStatus.Active,
      updatedAt: '2026-07-11T02:00:00.000Z',
    };
    expect(computeMissionPlanHash(reordered)).toBe(plan.planHash);
    expect(computeMissionPlanHash({ ...plan, objective: 'A different objective' })).not.toBe(plan.planHash);
    expect(
      computeMissionPlanHash({
        ...plan,
        taskGraph: plan.taskGraph.map((task, index) =>
          index === 0 ? { ...task, requiredActions: ['research.web', 'research.private'] } : task,
        ),
      }),
    ).not.toBe(plan.planHash);
  });

  it('rejects cycles and unknown or mismatched capabilities', () => {
    const cyclic = planInput();
    cyclic.taskGraph[0] = { ...cyclic.taskGraph[0], dependsOn: ['task-code'] };
    expect(() => createMissionPlan(cyclic, registry(), now)).toThrow(/cycle/i);

    const unknown = planInput();
    unknown.taskGraph[1] = { ...unknown.taskGraph[1], capabilityIds: ['cap-invented'] };
    expect(() => createMissionPlan(unknown, registry(), now)).toThrow(/cap-invented/);

    const recursive = planInput();
    recursive.taskGraph[1] = {
      ...recursive.taskGraph[1],
      requiredActions: ['spawn.unrestricted'],
    };
    expect(() => createMissionPlan(recursive, registry(), now)).toThrow(/unrestricted/i);
  });

  it('rejects tools, models, writable scopes, and worker expansion outside registered capabilities', () => {
    const unknownTool = planInput();
    unknownTool.taskGraph[1] = {
      ...unknownTool.taskGraph[1],
      requiredTools: ['root.shell'],
    };
    expect(() => createMissionPlan(unknownTool, registry(), now)).toThrow(/tool|root\.shell/i);

    const model = planInput();
    model.taskGraph[1] = { ...model.taskGraph[1], model: 'unregistered-model' };
    expect(() => createMissionPlan(model, registry(), now)).toThrow(/model/i);

    const repository = planInput();
    repository.taskGraph[1] = {
      ...repository.taskGraph[1],
      writableScope: {
        ...repository.taskGraph[1].writableScope,
        allowedRepositories: [{
          repository: 'jericho',
          writablePaths: ['private/secrets'],
          mutationClasses: [MutationClass.Reversible],
        }],
      },
    };
    expect(() => createMissionPlan(repository, registry(), now)).toThrow(/scope|repository|writable/i);

    const data = planInput();
    data.taskGraph[0] = {
      ...data.taskGraph[0],
      writableScope: {
        ...data.taskGraph[0].writableScope,
        allowedDataScopes: ['private:all'],
      },
    };
    expect(() => createMissionPlan(data, registry(), now)).toThrow(/scope|data/i);

    const expandingCapability = capability(
      'cap-code',
      'dev-agent',
      AgentLane.Dev,
      ['code.edit', 'code.test'],
    );
    expandingCapability.mayCreateAssignments = true;
    expect(() =>
      createMissionPlan(
        planInput(),
        new CapabilityRegistry([
          capability('cap-research', 'research-agent', AgentLane.Researcher, ['research.web']),
          expandingCapability,
        ]),
        now,
      ),
    ).toThrow(/create assignments|worker expansion|delegate/i);
  });
});

describe('one-approval mission policy', () => {
  it('allows a preapproved external action inside every bound', () => {
    const plan = approvedPlan();
    expect(
      evaluateMissionAction(plan, usage(), {
        objective: plan.objective,
        acceptanceTestIds: plan.acceptanceTests.map((test) => test.id),
        estimatedCostMicroUsd: 5_000,
        expectedRuntimeMs: 5_000,
        retryCount: 0,
        activeAssignments: 1,
        tool: 'telegram.send',
        system: 'telegram-gateway',
        channel: 'telegram',
        recipient: 'person-carlos',
        repository: 'jericho',
        credentialRef: 'telegram-primary',
        dataScope: 'telegram:selected-chats',
        mutationClass: MutationClass.Reversible,
        contradictoryEvidenceEventIds: [],
      }),
    ).toEqual({ kind: 'allow', reasons: [] });
  });

  it.each([
    ['cost', { estimatedCostMicroUsd: 900_001 }, EscalationReason.CostBudget],
    ['runtime', { expectedRuntimeMs: 600_001 }, EscalationReason.RuntimeBudget],
    ['runtime exact boundary', { expectedRuntimeMs: 590_000 }, EscalationReason.RuntimeBudget],
    ['concurrency', { activeAssignments: 3 }, EscalationReason.ConcurrencyBudget],
    ['retry', { retryCount: 2 }, EscalationReason.RetryBudget],
    ['recipient', { recipient: 'person-new' }, EscalationReason.NewRecipient],
    ['system', { system: 'new-system' }, EscalationReason.NewSystem],
    ['repository', { repository: 'other-repo' }, EscalationReason.RepositoryExpansion],
    ['credential', { credentialRef: 'new-secret' }, EscalationReason.CredentialExpansion],
    ['data', { dataScope: 'all-private-data' }, EscalationReason.DataExpansion],
    ['objective', { objective: 'Expanded objective' }, EscalationReason.ObjectiveChange],
    ['tests', { acceptanceTestIds: ['different-test'] }, EscalationReason.AcceptanceTestChange],
    ['destructive', { mutationClass: MutationClass.Destructive }, EscalationReason.DestructiveMutation],
    ['production', { mutationClass: MutationClass.Production }, EscalationReason.ProductionMutation],
    ['contradiction', { contradictoryEvidenceEventIds: ['evt-conflict'] }, EscalationReason.ContradictoryEvidence],
  ])('checkpoints %s expansion', (_name, override, expected) => {
    const plan = approvedPlan();
    const result = evaluateMissionAction(plan, usage(), {
      objective: plan.objective,
      acceptanceTestIds: plan.acceptanceTests.map((test) => test.id),
      estimatedCostMicroUsd: 5_000,
      expectedRuntimeMs: 5_000,
      retryCount: 0,
      activeAssignments: 1,
      tool: 'telegram.send',
      system: 'telegram-gateway',
      channel: 'telegram',
      recipient: 'person-carlos',
      repository: 'jericho',
      credentialRef: 'telegram-primary',
      dataScope: 'telegram:selected-chats',
      mutationClass: MutationClass.Reversible,
      contradictoryEvidenceEventIds: [],
      ...override,
    });
    expect(result.kind).toBe('checkpoint');
    expect(result.reasons).toContain(expected);
  });

  it('denies execution before the exact plan version is approved', () => {
    const result = evaluateMissionAction(
      createMissionPlan(planInput(), registry(), now),
      usage(),
      {
        objective: 'Ship verified Jericho work',
        acceptanceTestIds: ['test-1'],
        estimatedCostMicroUsd: 1,
        expectedRuntimeMs: 1,
        retryCount: 0,
        activeAssignments: 0,
        mutationClass: MutationClass.ReadOnly,
        contradictoryEvidenceEventIds: [],
      },
    );
    expect(result.kind).toBe('deny');
  });
});

function registry(): CapabilityRegistry {
  return new CapabilityRegistry([capability('cap-research', 'research-agent', AgentLane.Researcher, ['research.web']), capability('cap-code', 'dev-agent', AgentLane.Dev, ['code.edit', 'code.test'])]);
}

function capability(
  id: string,
  agentId: string,
  lane: AgentLane,
  supportedActions: string[],
): AgentCapability {
  return {
    id,
    agentId,
    lane,
    name: id,
    status: LifecycleStatus.Active,
    routes: [RouteType.Agent],
    supportedActions,
    tools: ['git', 'web'],
    modelPolicy: {
      allowedModels: ['local', 'strong'],
      preferredModel: 'local',
      preferLocal: true,
      maxTokensPerAssignment: 20_000,
    },
    writableScope: permissions(),
    costClass: CostClass.Standard,
    mayCreateAssignments: false,
    maximumRisk: RiskLevel.High,
    metadata: {},
    provenance: [{ source: 'test', sourceType: SourceType.System, observedAt: now }],
    createdAt: now,
    updatedAt: now,
  };
}

function task(
  id: string,
  lane: AgentLane,
  selectedAgentId: string,
  capabilityIds: string[],
  requiredActions: string[],
  sequence: number,
  dependsOn: string[],
): MissionTaskDefinition {
  return {
    id,
    kind: lane === AgentLane.Researcher ? MissionTaskKind.Research : MissionTaskKind.Execute,
    title: id,
    sequence,
    lane,
    selectedAgentId,
    capabilityIds,
    requiredActions,
    dependsOn,
    evidenceEventIds: ['evt-1'],
    expectedArtifact: {
      type: 'report',
      description: 'Verified report',
      verification: ['tests-pass'],
      requiredEvidence: ['test-report'],
    },
    requiredTools: lane === AgentLane.Researcher ? ['web'] : ['git'],
    model: 'local',
    maxTokens: 5_000,
    writableScope: permissions(),
    input: {},
    estimatedCostMicroUsd: 100_000,
    route: RouteType.Agent,
    risk: RiskLevel.Low,
  };
}

function planInput(): MissionPlanInput {
  return {
    id: 'mission-v1',
    seriesId: 'mission-series',
    version: 1,
    intentId: 'intent-1',
    title: 'Ship Jericho',
    objective: 'Ship verified Jericho work',
    route: RouteType.HumanApproval,
    risk: RiskLevel.Low,
    deliverables: [{ id: 'deliverable-1', description: 'Working engine', artifactType: 'code', required: true }],
    acceptanceTests: [{ id: 'test-1', description: 'Tests pass', verification: 'automatic', requiredEvidence: ['test-report'] }],
    evidenceEventIds: ['evt-1'],
    contextSnapshotHash: 'a'.repeat(64),
    taskGraph: [
      task('task-research', AgentLane.Researcher, 'research-agent', ['cap-research'], ['research.web'], 0, []),
      task('task-code', AgentLane.Dev, 'dev-agent', ['cap-code'], ['code.edit', 'code.test'], 1, ['task-research']),
    ],
    budget: { maxCostMicroUsd: 1_000_000, maxRuntimeMs: 600_000, maxConcurrency: 2, maxRetriesPerAssignment: 1 },
    permissions: permissions(),
    rollback: { strategy: 'git revert', steps: ['Revert commit'], verification: 'Tests pass after revert' },
    escalationConditions: Object.values(EscalationReason),
    provenance: [{ source: 'test', sourceType: SourceType.System, observedAt: now }],
  };
}

function permissions() {
  return {
    allowedTools: ['git', 'web', 'telegram.send'],
    allowedSystems: ['telegram-gateway'],
    allowedRepositories: [{ repository: 'jericho', writablePaths: ['apps/jericho'], mutationClasses: [MutationClass.ReadOnly, MutationClass.Reversible] }],
    allowedChannels: ['telegram'],
    allowedRecipients: ['person-carlos'],
    allowedCredentialRefs: ['telegram-primary'],
    allowedDataScopes: ['telegram:selected-chats'],
    allowedMutationClasses: [MutationClass.ReadOnly, MutationClass.Reversible],
  };
}

function approvedPlan(): MissionPlan {
  const plan = createMissionPlan(planInput(), registry(), now);
  return {
    ...plan,
    status: LifecycleStatus.Approved,
    approvalDecisionId: 'decision-1',
    approvedAt: now,
  };
}

function usage() {
  return { actualCostMicroUsd: 100_000, elapsedRuntimeMs: 10_000, activeAssignments: 1, retryCount: 0 };
}
