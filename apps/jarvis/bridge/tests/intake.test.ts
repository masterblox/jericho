import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AgentLane,
  CaptureFailureKind,
  CostClass,
  DecisionOutcome,
  IntentRoute,
  LifecycleStatus,
  MutationClass,
  RiskLevel,
  RouteType,
  SourceType,
  type AgentCapability,
  type DecisionRecord,
  type EventEnvelope,
  type MissionPermissions,
} from '@jericho/shared';

import { JerichoStore } from '../src/core/store.js';
import {
  BUILT_IN_CAPABILITY_IDS,
  IntakeProcessor,
  buildAssignmentForTask,
} from '../src/orchestration/intake.js';

const KEY = Buffer.alloc(32, 67);
const T0 = '2026-07-11T06:00:00.000Z';
const stores: JerichoStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('production intake pipeline', () => {
  it('seeds one versioned built-in capability per lane without overwriting an existing version', () => {
    const store = openStore();
    const existing = capability(BUILT_IN_CAPABILITY_IDS[AgentLane.Dev], AgentLane.Dev, 'Custom DEV v1');
    existing.agentId = 'DEV';
    existing.supportedActions = ['lane.dev.plan'];
    store.registerAgentCapability(existing);

    new IntakeProcessor({ store });
    new IntakeProcessor({ store });

    expect(store.listAgentCapabilities()).toHaveLength(6);
    expect(new Set(store.listAgentCapabilities().map((item) => item.lane))).toEqual(new Set([
      AgentLane.Dev,
      AgentLane.Angela,
      AgentLane.Donald,
      AgentLane.Iris,
      AgentLane.Researcher,
      AgentLane.Analyst,
    ]));
    expect(store.getAgentCapability(existing.id)?.name).toBe('Custom DEV v1');
  });

  it('fails visibly when an existing built-in version is incompatible with its lane contract', () => {
    const store = openStore();
    store.registerAgentCapability(
      capability(BUILT_IN_CAPABILITY_IDS[AgentLane.Dev], AgentLane.Dev, 'Incompatible DEV v1'),
    );

    expect(() => new IntakeProcessor({ store })).toThrow(
      /builtin\.dev\.v2.*incompatible/i,
    );
  });

  it('registers the new scoped capability version without rewriting a legacy v1 record', () => {
    const store = openStore();
    const legacy = capability('builtin.dev.v1', AgentLane.Dev, 'Legacy DEV v1');
    legacy.agentId = 'DEV';
    legacy.supportedActions = ['lane.dev.plan'];
    store.registerAgentCapability(legacy);
    const configured: MissionPermissions = {
      ...safePermissions(),
      allowedRepositories: [{
        repository: 'jericho', writablePaths: ['apps/jarvis'],
        mutationClasses: [MutationClass.Reversible],
      }],
      allowedMutationClasses: [MutationClass.ReadOnly, MutationClass.Reversible],
    };

    new IntakeProcessor({ store, missionPermissions: configured });

    expect(store.getAgentCapability('builtin.dev.v1')?.name).toBe('Legacy DEV v1');
    expect(store.getAgentCapability(BUILT_IN_CAPABILITY_IDS[AgentLane.Dev])).toMatchObject({
      id: expect.stringMatching(/\.v2$/),
      metadata: { builtInVersion: 2 },
    });
  });

  it('turns one direct Carlos project capture into one deterministic high-confidence intent and bounded plan', () => {
    const store = openStore();
    const event = store.commitLocalCapture(localProject('spoken-project')).event;
    const processor = new IntakeProcessor({ store });

    const first = processor.processEvent(event.id);
    const replay = processor.processEvent(event.id);

    expect(first).toMatchObject({ status: 'planned' });
    expect(replay).toMatchObject({
      status: 'planned',
      intent: { id: first.intent?.id },
      mission: { id: first.mission?.id, planHash: first.mission?.planHash },
    });
    expect(first.intent).toMatchObject({
      eventId: event.id,
      source: 'local:spoken',
      route: IntentRoute.Project,
      status: LifecycleStatus.Active,
      confidence: expect.any(Number),
      requiredEvidence: [{ eventId: event.id, integrityHash: event.integrityHash }],
    });
    expect(first.intent!.confidence).toBeGreaterThanOrEqual(0.95);
    expect(first.mission).toMatchObject({
      intentId: first.intent!.id,
      status: LifecycleStatus.PendingApproval,
      evidenceEventIds: [event.id],
      budget: {
        maxCostMicroUsd: expect.any(Number),
        maxRuntimeMs: expect.any(Number),
        maxConcurrency: 1,
        maxRetriesPerAssignment: 1,
      },
      permissions: safePermissions(),
      taskGraph: [
        expect.objectContaining({
          lane: AgentLane.Researcher, selectedAgentId: 'Researcher', dependsOn: [],
        }),
        expect.objectContaining({ lane: AgentLane.Dev, selectedAgentId: 'DEV' }),
      ],
    });
    expect(first.mission!.taskGraph[1].dependsOn).toEqual([first.mission!.taskGraph[0].id]);
    expect(first.mission!.contextSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.listIntents()).toHaveLength(1);
    expect(store.listMissions()).toHaveLength(1);
    expect(store.listAssignments()).toEqual([]);
  });

  it('uses explicit configured grants while keeping the unconfigured default read-only and empty', () => {
    const store = openStore();
    const event = store.commitLocalCapture(localProject('configured-project', {
      jerichoScope: { repository: 'jericho' },
    })).event;
    const permissions: MissionPermissions = {
      ...safePermissions(),
      allowedTools: ['git'],
      allowedRepositories: [{
        repository: 'jericho',
        writablePaths: ['apps/jarvis'],
        mutationClasses: [MutationClass.ReadOnly],
      }],
    };
    const processor = new IntakeProcessor({ store, missionPermissions: permissions });

    const result = processor.processEvent(event.id);

    expect(result.mission?.permissions).toEqual(permissions);
    expect(result.mission?.taskGraph[1]).toMatchObject({
      requiredTools: ['git'],
      writableScope: permissions,
    });
    expect(result.mission?.taskGraph[0].writableScope.allowedRepositories).toEqual([{
      repository: 'jericho',
      writablePaths: [],
      mutationClasses: [],
    }]);
  });

  it('never grants a configured repository without an explicit direct-capture selector', () => {
    const store = openStore();
    const event = store.commitLocalCapture(localProject('unselected-project')).event;
    const configured: MissionPermissions = {
      ...safePermissions(),
      allowedTools: ['git'],
      allowedRepositories: [{
        repository: 'jericho',
        writablePaths: ['apps/jarvis'],
        mutationClasses: [MutationClass.Reversible],
      }],
      allowedMutationClasses: [MutationClass.ReadOnly, MutationClass.Reversible],
    };

    const result = new IntakeProcessor({ store, missionPermissions: configured }).processEvent(event.id);

    expect(result).toMatchObject({ status: 'planned' });
    expect(result.mission?.permissions.allowedRepositories).toEqual([]);
    expect(result.mission?.permissions.allowedMutationClasses).toEqual([MutationClass.ReadOnly]);
    expect(result.mission?.taskGraph.every(
      (task) => task.writableScope.allowedRepositories.length === 0,
    )).toBe(true);
  });

  it('routes an unknown repository selector to Review instead of widening scope or planning', () => {
    const store = openStore();
    const event = store.commitLocalCapture(localProject('unknown-repository', {
      jerichoScope: { repository: 'not-configured' },
    })).event;
    const configured: MissionPermissions = {
      ...safePermissions(),
      allowedRepositories: [{
        repository: 'jericho', writablePaths: ['apps/jarvis'],
        mutationClasses: [MutationClass.Reversible],
      }],
      allowedMutationClasses: [MutationClass.ReadOnly, MutationClass.Reversible],
    };

    const result = new IntakeProcessor({ store, missionPermissions: configured }).processEvent(event.id);

    expect(result).toMatchObject({
      status: 'review',
      intent: {
        route: IntentRoute.Review,
        routeRuleId: 'safety:low-confidence',
        ambiguityReasons: [expect.stringMatching(/repository.*not-configured.*not configured/i)],
      },
    });
    expect(store.listMissions()).toEqual([]);
  });

  it('persists low-confidence and contradictory captures as Review and never plans them', () => {
    const store = openStore();
    const processor = new IntakeProcessor({ store });
    const uncertain = store.appendEvent(connectorProject('uncertain', {
      confidence: 0.4,
    })).event;
    const contradictory = store.commitLocalCapture(localProject('contradictory', {
      contradictoryEvidenceEventIds: ['event-conflict'],
    })).event;

    const lowConfidence = processor.processEvent(uncertain.id);
    const conflict = processor.processEvent(contradictory.id);

    expect(lowConfidence).toMatchObject({
      status: 'review',
      intent: {
        route: IntentRoute.Review,
        routeRuleId: 'safety:low-confidence',
        status: LifecycleStatus.PendingApproval,
      },
    });
    expect(conflict).toMatchObject({
      status: 'review',
      intent: {
        route: IntentRoute.Review,
        routeRuleId: 'safety:contradiction',
        status: LifecycleStatus.PendingApproval,
      },
    });
    expect(store.listMissions()).toEqual([]);
  });

  it('retains immutable truth and exposes a retryable processing failure when classification fails', () => {
    const store = openStore();
    const event = store.commitLocalCapture(localProject('classifier-failure')).event;
    const processor = new IntakeProcessor({
      store,
      classifier: () => { throw new Error('classifier unavailable'); },
    });

    const result = processor.processEvent(event.id);

    expect(result).toMatchObject({
      status: 'failed',
      failure: {
        kind: CaptureFailureKind.Processing,
        sourceEventId: event.sourceEventId,
        retryable: true,
        status: LifecycleStatus.PendingApproval,
        route: RouteType.HumanApproval,
        details: { stage: 'intake', eventId: event.id },
      },
    });
    expect(store.getEvent(event.id)).toBeDefined();
    expect(store.listIntents()).toEqual([]);
    expect(store.listCaptureFailures(event.source)).toHaveLength(1);
  });

  it('recovers unprocessed events and completes a partial exact assignment enqueue without duplicates', () => {
    const store = openStore();
    const event = store.commitLocalCapture(localProject('recovery-project')).event;
    const processor = new IntakeProcessor({ store });

    expect(processor.recover()).toMatchObject({ planned: 1 });
    const mission = store.listMissions()[0];
    const approved = store.approveMission(mission.id, mission.planHash, approval(mission.id));
    store.enqueueAssignment(buildAssignmentForTask(approved, approved.taskGraph[0]));

    const recovered = processor.recover();
    const replay = processor.recover();

    expect(recovered).toMatchObject({ queued: 1, failed: 0 });
    expect(replay).toMatchObject({ queued: 0, failed: 0 });
    expect(store.listAssignments({ missionId: approved.id })).toHaveLength(approved.taskGraph.length);
    for (const task of approved.taskGraph) {
      expect(store.listAssignments({ missionTaskId: task.id })).toEqual([
        expect.objectContaining({
          ...buildAssignmentForTask(approved, task),
          integrityHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]);
    }
    expect(store.getEvent(event.id)).toBeDefined();
  });

  it('recovers a project whose intent committed before a transient plan persistence failure', () => {
    const store = openStore();
    const event = store.commitLocalCapture(localProject('partial-plan')).event;
    const processor = new IntakeProcessor({ store });
    const createMission = vi.spyOn(store, 'createMissionPlan')
      .mockImplementationOnce(() => { throw new Error('transient plan persistence failure'); });

    expect(processor.processEvent(event.id)).toMatchObject({ status: 'failed' });
    expect(store.listIntents()).toHaveLength(1);
    expect(store.listMissions()).toEqual([]);
    createMission.mockRestore();

    expect(processor.recover()).toMatchObject({ planned: 1, failed: 0 });
    expect(store.listMissions()).toHaveLength(1);
  });
});

function openStore(): JerichoStore {
  const store = new JerichoStore({ path: ':memory:', key: KEY });
  stores.push(store);
  return store;
}

function localProject(sourceEventId: string, payload: Record<string, unknown> = {}): EventEnvelope {
  return {
    id: `local:${sourceEventId}`,
    source: 'local:spoken',
    sourceType: SourceType.User,
    sourceEventId,
    type: 'local.capture.spoken',
    occurredAt: T0,
    ingestedAt: T0,
    payload: {
      text: 'Build a multi-step project for Jericho',
      requiredCapabilities: ['code.repo'],
      ...payload,
    },
    provenance: [{
      source: 'local:spoken', sourceType: SourceType.User,
      sourceEventId, observedAt: T0,
    }],
  };
}

function connectorProject(
  sourceEventId: string,
  overrides: Partial<EventEnvelope> = {},
): EventEnvelope {
  return {
    id: `connector:${sourceEventId}`,
    source: 'fixture',
    sourceType: SourceType.Connector,
    sourceEventId,
    type: 'fixture.project',
    occurredAt: T0,
    ingestedAt: T0,
    payload: { text: 'Build a multi-step project', requiredCapabilities: ['code.repo'] },
    provenance: [{ source: 'fixture', sourceType: SourceType.Connector, sourceEventId, observedAt: T0 }],
    ...overrides,
  };
}

function safePermissions(): MissionPermissions {
  return {
    allowedTools: [],
    allowedSystems: [],
    allowedRepositories: [],
    allowedChannels: [],
    allowedRecipients: [],
    allowedCredentialRefs: [],
    allowedDataScopes: [],
    allowedMutationClasses: [MutationClass.ReadOnly],
  };
}

function capability(id: string, lane: AgentLane, name: string): AgentCapability {
  return {
    id,
    agentId: `custom-${lane}`,
    lane,
    name,
    status: LifecycleStatus.Active,
    routes: [RouteType.Agent],
    supportedActions: ['custom.read'],
    tools: [],
    modelPolicy: {
      allowedModels: ['local'], preferredModel: 'local', preferLocal: true,
      maxTokensPerAssignment: 8_000,
    },
    writableScope: safePermissions(),
    costClass: CostClass.Local,
    mayCreateAssignments: false,
    maximumRisk: RiskLevel.Critical,
    metadata: { builtInVersion: id.endsWith('.v1') ? 1 : 2 },
    provenance: [{ source: 'test', sourceType: SourceType.System, observedAt: T0 }],
    createdAt: T0,
    updatedAt: T0,
  };
}

function approval(missionId: string): DecisionRecord {
  return {
    id: `decision:${missionId}`,
    missionId,
    decidedBy: 'carlos',
    outcome: DecisionOutcome.Approved,
    rationale: 'Approved exact intake plan',
    assumptions: [],
    evidenceEventIds: [],
    route: RouteType.HumanApproval,
    risk: RiskLevel.Low,
    decidedAt: T0,
    provenance: [{
      source: 'local:command-center', sourceType: SourceType.User,
      actorId: 'carlos', observedAt: T0,
    }],
  };
}
