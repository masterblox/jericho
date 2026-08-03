import { afterEach, describe, expect, it } from 'vitest';

import {
  AgentLane,
  CommandCenterActionKind,
  CommandCenterMissionStage,
  CommandCenterTimelineKind,
  CommandCenterVerification,
  CostCategory,
  CostClass,
  DecisionOutcome,
  EntityType,
  EscalationReason,
  IntentKind,
  IntentRoute,
  LifecycleStatus,
  MissionTaskKind,
  MutationClass,
  ReceiptStatus,
  RelationType,
  RiskLevel,
  RouteType,
  SourceType,
  type ActionReceipt,
  type AgentCapability,
  type Assignment,
  type Entity,
  type IntentEnvelope,
  type MissionPlan,
  type MissionDecisionResponse,
  type MissionTaskDefinition,
  type Provenance,
  type CommandCenterSnapshot,
} from '@jericho/shared';

import { buildCommandCenterSnapshot } from '../src/command-center.js';
import { JerichoStore } from '../src/core/store.js';
import { CapabilityRegistry } from '../src/orchestration/capability-registry.js';
import { IntakeProcessor } from '../src/orchestration/intake.js';
import { createMissionPlan, type MissionPlanInput } from '../src/orchestration/planner.js';
import { createJerichoServer } from '../src/server.js';

const KEY = Buffer.alloc(32, 91);
const NOW = '2026-07-11T08:30:00.000Z';
const stores: JerichoStore[] = [];
const servers: Array<{ close(): Promise<void> }> = [];
const TOKEN = 'command-center-token';

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const store of stores.splice(0)) store.close();
});

describe('command-center truth projection', () => {
  it('replays the immutable mission lifecycle and anchors every capture pulse to evidence truth', () => {
    const store = openStore();
    seedTruth(store);
    store.saveIntent(intent('intent-replay'));
    const mission = plan('mission-replay', 'intent-replay', [
      task('replay-task', 0, []),
    ]);
    store.createMissionPlan(mission);
    store.approveMission(mission.id, mission.planHash, {
      id: 'decision-replay', missionId: mission.id, decidedBy: 'carlos',
      outcome: DecisionOutcome.Approved, rationale: 'Approved the exact replay plan',
      assumptions: [], evidenceEventIds: ['event-command'], route: RouteType.HumanApproval,
      risk: RiskLevel.Low, decidedAt: '2026-07-11T08:05:00.000Z',
      provenance: provenance('carlos', 'event-command'),
    });
    store.enqueueAssignment(assignment('assignment-replay', mission, mission.taskGraph[0]));
    const [leased] = store.leaseReadyAssignments({
      workerId: 'replay-worker', now: '2026-07-11T08:11:00.000Z', leaseMs: 300_000, limit: 1,
    });
    store.completeAssignment(
      leased.id,
      leased.leaseToken!,
      { kind: 'report', verified: true, evidence: [{ eventId: 'event-command' }] },
      '2026-07-11T08:12:00.000Z',
    );
    store.reserveReceipt({
      ...receipt(), id: 'receipt-replay', assignmentId: leased.id,
      missionTaskId: mission.taskGraph[0].id, idempotencyKey: 'receipt-replay-key',
      requestedAt: '2026-07-11T08:13:00.000Z',
    });
    store.startReceipt('receipt-replay', '2026-07-11T08:13:30.000Z');
    store.completeReceipt('receipt-replay', {
      status: ReceiptStatus.Succeeded, externalId: 'destination-replay', verified: true,
      verifiedAt: '2026-07-11T08:14:00.000Z', completedAt: '2026-07-11T08:14:00.000Z',
      evidenceEventIds: ['event-command'], result: { delivered: true },
    });
    store.appendEvent({
      id: 'event-retention-replay', source: 'jericho:retention', sourceType: SourceType.System,
      sourceEventId: `retention:${mission.id}:${mission.planHash}`,
      type: 'jericho.retention.completed', occurredAt: '2026-07-11T08:15:00.000Z',
      ingestedAt: '2026-07-11T08:15:00.000Z',
      payload: {
        missionId: mission.id, planHash: mission.planHash,
        relativePath: 'Jericho/Missions/mission-replay.md', status: 'created',
      },
      provenance: [{
        source: 'jericho:retention', sourceType: SourceType.System,
        sourceEventId: `retention:${mission.id}:${mission.planHash}`,
        observedAt: '2026-07-11T08:15:00.000Z',
      }],
    });

    const snapshot = buildCommandCenterSnapshot(store, NOW);
    const replay = snapshot.missions.find((candidate) => candidate.id === mission.id)!;

    expect(replay.timeline.map((entry) => entry.kind)).toEqual([
      CommandCenterTimelineKind.Capture,
      CommandCenterTimelineKind.Understand,
      CommandCenterTimelineKind.Route,
      CommandCenterTimelineKind.Plan,
      CommandCenterTimelineKind.Approve,
      CommandCenterTimelineKind.Execute,
      CommandCenterTimelineKind.Execute,
      CommandCenterTimelineKind.Outcome,
      CommandCenterTimelineKind.Present,
      CommandCenterTimelineKind.Receipt,
      CommandCenterTimelineKind.Receipt,
      CommandCenterTimelineKind.Receipt,
      CommandCenterTimelineKind.Retain,
    ]);
    expect(replay.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: CommandCenterTimelineKind.Capture, recordId: 'event-command',
        missionId: mission.id, verification: CommandCenterVerification.Integrity,
      }),
      expect.objectContaining({
        kind: CommandCenterTimelineKind.Understand, recordId: 'intent-replay',
        confidence: 1, risk: RiskLevel.Medium,
      }),
      expect.objectContaining({
        kind: CommandCenterTimelineKind.Route, recordId: 'intent-replay',
        route: IntentRoute.Project, routeRuleId: 'project-rule', confidence: 1,
      }),
      expect.objectContaining({
        kind: CommandCenterTimelineKind.Plan, recordId: mission.id,
        planHash: mission.planHash, planVersion: mission.version,
      }),
      expect.objectContaining({
        kind: CommandCenterTimelineKind.Approve, recordId: 'decision-replay',
        actor: 'carlos', reason: 'Approved the exact replay plan',
        planHash: mission.planHash, planVersion: mission.version,
      }),
      expect.objectContaining({
        kind: CommandCenterTimelineKind.Outcome, recordId: leased.id,
        artifactRecorded: true, verification: CommandCenterVerification.Outcome,
      }),
      expect.objectContaining({
        kind: CommandCenterTimelineKind.Receipt, recordId: 'receipt-replay',
        status: ReceiptStatus.Succeeded,
        verification: CommandCenterVerification.Destination,
      }),
      expect.objectContaining({
        kind: CommandCenterTimelineKind.Present, recordId: mission.id,
        status: LifecycleStatus.Succeeded,
      }),
      expect.objectContaining({
        kind: CommandCenterTimelineKind.Retain, recordId: 'event-retention-replay',
        missionId: mission.id, verification: CommandCenterVerification.Integrity,
      }),
    ]));

    expect(snapshot.nucleus.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'evidence:event-command', recordType: 'event' }),
      expect.objectContaining({ id: 'intent:intent-replay', recordType: 'intent' }),
    ]));
    expect(snapshot.nucleus.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNodeId: 'evidence:event-command', toNodeId: 'intent:intent-replay',
      }),
      expect.objectContaining({
        fromNodeId: 'intent:intent-replay', toNodeId: `mission:${mission.id}`,
      }),
    ]));
    const capturePulse = snapshot.nucleus.activityPulses.find((pulse) =>
      pulse.id.includes('event-command') && pulse.kind === CommandCenterTimelineKind.Capture);
    expect(capturePulse).toMatchObject({
      nodeId: 'evidence:event-command', verified: true,
    });
    expect(snapshot.nucleus.nodes.some((node) => node.id === capturePulse?.nodeId)).toBe(true);
    expect(replay.timeline.find((entry) => entry.recordId === 'decision-replay')).not.toHaveProperty(
      'verification',
      CommandCenterVerification.Destination,
    );
  });

  it('exposes persisted Review intents without projecting them as missions', () => {
    const store = openStore();
    store.saveIntent({
      ...intent('intent-review'),
      route: IntentRoute.Review,
      routeRuleId: 'safety:low-confidence',
      status: LifecycleStatus.PendingApproval,
      confidence: 0.4,
    });

    const snapshot = buildCommandCenterSnapshot(store, NOW);

    expect(snapshot.reviewIntents).toEqual([
      expect.objectContaining({
        id: 'intent-review',
        route: IntentRoute.Review,
        status: LifecycleStatus.PendingApproval,
        routeRuleId: 'safety:low-confidence',
      }),
    ]);
    expect(snapshot.missions).toEqual([]);
  });

  it('returns a typed, revisioned empty snapshot without fixture activity', () => {
    const store = openStore();

    const snapshot: CommandCenterSnapshot = buildCommandCenterSnapshot(store, NOW);

    expect(snapshot).toEqual(expect.objectContaining({
      revision: expect.stringMatching(/^[a-f0-9]{64}$/),
      generatedAt: NOW,
      today: {
        date: '2026-07-11',
        taskIds: [],
        commitmentIds: [],
        activeMissionIds: [],
        pendingApprovalIds: [],
      },
      communications: [],
      people: [],
      commitments: [],
      missions: [],
      approvals: [],
      activeAssignments: [],
      outcomes: [],
      receipts: [],
      history: [],
      connectors: [],
      nucleus: { nodes: [], edges: [], activityPulses: [] },
    }));
    expect(CommandCenterActionKind.ApproveMission).toBe('approve_mission');
  });

  it('projects only persisted command-center truth, bounded approvals, and verified Nucleus activity', () => {
    const store = openStore();
    seedTruth(store);

    const snapshot = buildCommandCenterSnapshot(store, NOW);

    expect(snapshot.today).toEqual({
      date: '2026-07-11',
      taskIds: ['entity-task'],
      commitmentIds: ['entity-commitment'],
      activeMissionIds: ['mission-active'],
      pendingApprovalIds: ['mission-pending'],
    });
    expect(snapshot.tasks[0]).toMatchObject({
      id: 'entity-task', entityType: EntityType.Task, label: 'Review Jericho',
      status: LifecycleStatus.Active, evidenceEventIds: ['event-command'],
    });
    expect(snapshot.communications[0]).toMatchObject({
      id: 'entity-conversation', label: 'Telegram: Paula', rank: 1,
    });
    expect(snapshot.people[0]).toMatchObject({ id: 'entity-person', label: 'Paula' });
    expect(snapshot.commitments[0]).toMatchObject({ id: 'entity-commitment' });

    const pendingMission = snapshot.missions.find((mission) => mission.id === 'mission-pending')!;
    expect(pendingMission).toMatchObject({
      version: 1,
      planHash: store.getMission('mission-pending')!.planHash,
      status: LifecycleStatus.PendingApproval,
      stage: CommandCenterMissionStage.Approve,
      taskGraph: [{
        id: 'pending-task', status: LifecycleStatus.Queued, dependsOn: [],
        agentId: 'dev-agent', capabilityIds: ['cap-dev'],
      }],
      agents: [{ taskId: 'pending-task', agentId: 'dev-agent', lane: AgentLane.Dev }],
      acceptanceTests: [{ id: 'acceptance', description: 'Tests pass' }],
      escalationConditions: [EscalationReason.CostBudget, EscalationReason.NewRecipient],
    });

    const activeMission = snapshot.missions.find((mission) => mission.id === 'mission-active')!;
    expect(activeMission).toMatchObject({
      stage: CommandCenterMissionStage.Execute,
      budget: {
        limits: { maxCostMicroUsd: 5_000, maxRuntimeMs: 3_600_000 },
        plannedCostMicroUsd: 300,
        recordedEstimatedCostMicroUsd: 75,
        actualCostMicroUsd: 50,
        activeAssignments: 1,
        assignmentAttempts: 2,
      },
    });

    expect(snapshot.approvals).toHaveLength(1);
    expect(snapshot.approvals[0]).toMatchObject({
      missionId: 'mission-pending',
      planHash: store.getMission('mission-pending')!.planHash,
      version: 1,
      affectedParties: [{ entityId: 'entity-person', label: 'Paula', entityType: EntityType.Person }],
      affectedSystems: ['telegram-gateway'],
      externalActions: [{ connectorId: 'telegram-gateway', destination: 'entity-person' }],
      cost: { maximumMicroUsd: 5_000, plannedMicroUsd: 100, actualMicroUsd: 0 },
      time: { maximumRuntimeMs: 3_600_000, elapsedRuntimeMs: 0 },
      acceptanceTests: [{ id: 'acceptance', description: 'Tests pass' }],
      rollback: { strategy: 'revert', steps: ['Revert commit'] },
      deliverables: [{
        id: 'deliverable', description: 'Verified result', artifactType: 'report', required: true,
      }],
      taskGraph: [{
        id: 'pending-task', dependsOn: [], requiredActions: ['send_message'],
        requiredTools: ['telegram.send'], model: 'local', maxTokens: 5_000,
        writableScope: permissions(),
      }],
      budget: {
        maxCostMicroUsd: 5_000, maxRuntimeMs: 3_600_000,
        maxConcurrency: 2, maxRetriesPerAssignment: 1,
      },
      permissions: permissions(),
      escalationConditions: [EscalationReason.CostBudget, EscalationReason.NewRecipient],
      risk: RiskLevel.Medium,
    });
    expect(snapshot.approvals[0].actions).toEqual([
      expect.objectContaining({
        kind: CommandCenterActionKind.ApproveMission,
        endpoint: '/api/v1/missions/mission-pending/decisions',
        payload: {
          outcome: DecisionOutcome.Approved,
          planHash: store.getMission('mission-pending')!.planHash,
          version: 1,
        },
        enabled: true,
      }),
      expect.objectContaining({
        kind: CommandCenterActionKind.RejectMission,
        payload: expect.objectContaining({ outcome: DecisionOutcome.Rejected }),
        enabled: true,
      }),
    ]);

    expect(snapshot.activeAssignments.map((assignment) => assignment.id)).toEqual(['assignment-b']);
    expect(snapshot.outcomes).toContainEqual(expect.objectContaining({
      assignmentId: 'assignment-a',
      status: LifecycleStatus.Succeeded,
      artifact: { kind: 'verified-report' },
      receiptIds: ['receipt-a'],
      verified: true,
    }));
    expect(snapshot.receipts).toContainEqual(expect.objectContaining({
      id: 'receipt-a', status: ReceiptStatus.Succeeded, verified: true,
    }));
    expect(snapshot.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'capture', recordId: 'event-command', verified: true }),
      expect.objectContaining({
        kind: CommandCenterTimelineKind.Approve, missionId: 'mission-active', verified: true,
        actor: 'carlos', reason: 'Bounded work approved', evidenceEventIds: ['event-command'],
      }),
      expect.objectContaining({ kind: 'outcome', recordId: 'assignment-a', verified: true }),
      expect.objectContaining({ kind: 'receipt', recordId: 'receipt-a', verified: true }),
    ]));
    expect(snapshot.nucleus.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'entity:entity-person', verified: true }),
      expect.objectContaining({ id: 'mission:mission-pending', verified: true }),
      expect.objectContaining({ id: 'agent:dev-agent', verified: true }),
      expect.objectContaining({ id: 'assignment:assignment-a', verified: true }),
      expect.objectContaining({ id: 'receipt:receipt-a', verified: true }),
    ]));
    expect(snapshot.nucleus.edges).toContainEqual(expect.objectContaining({
      id: 'relation:relation-person-conversation',
      fromNodeId: 'entity:entity-person',
      toNodeId: 'entity:entity-conversation',
      verified: true,
    }));
    expect(snapshot.nucleus.activityPulses.length).toBeGreaterThan(0);
    expect(buildCommandCenterSnapshot(store, '2026-07-11T08:31:00.000Z').revision)
      .toBe(snapshot.revision);
  });

  it('keeps encrypted receipt integrity distinct from destination verification', () => {
    const store = openStore();
    seedTruth(store);
    store.reserveReceipt({
      ...receipt(),
      id: 'receipt-pending',
      assignmentId: 'assignment-a',
      missionTaskId: 'active-task-a',
      idempotencyKey: 'receipt-pending-key',
    });

    const snapshot = buildCommandCenterSnapshot(store, NOW);

    expect(store.getReceipt('receipt-pending')?.integrityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.outcomes.find((outcome) => outcome.assignmentId === 'assignment-a')).toMatchObject({
      verified: false,
    });
    expect(snapshot.history.find((entry) =>
      entry.recordId === 'assignment-a' && entry.kind === CommandCenterTimelineKind.Outcome,
    )).toMatchObject({
      kind: 'outcome', verified: false,
    });
    expect(snapshot.history.find((entry) => entry.recordId === 'receipt-pending')).toMatchObject({
      kind: 'receipt', verified: false,
    });
    expect(snapshot.nucleus.nodes).not.toContainEqual(expect.objectContaining({
      id: 'receipt:receipt-pending',
    }));
    expect(snapshot.nucleus.activityPulses).not.toContainEqual(expect.objectContaining({
      id: 'pulse:receipt:receipt-pending',
    }));
    expect(snapshot.nucleus.activityPulses).not.toContainEqual(expect.objectContaining({
      id: 'pulse:outcome:assignment-a',
    }));
  });

  it('projects exact record provenance without synthesizing actor or reason', () => {
    const store = openStore();
    seedTruth(store);

    const snapshot = buildCommandCenterSnapshot(store, NOW);
    const capture = snapshot.history.find((entry) => entry.recordId === 'event-command')!;
    const receiptEntry = snapshot.history.find((entry) =>
      entry.recordId === 'receipt-a' && entry.verified,
    )!;

    expect(capture.actor).toBeUndefined();
    expect(capture.reason).toBeUndefined();
    expect(capture.provenance).toEqual(provenance('telegram', 'event-command'));
    expect(receiptEntry.actor).toBeUndefined();
    expect(receiptEntry.reason).toBeUndefined();
    expect(receiptEntry.provenance).toEqual(provenance('runner'));
  });

  it('binds mission decisions to the exact pending plan hash and version', () => {
    const store = openStore();
    seedTruth(store);
    const mission = store.getMission('mission-pending')!;

    expect(() => store.decideMission(
      mission.id,
      mission.planHash,
      2,
      decision('decision-wrong-version', DecisionOutcome.Approved),
    )).toThrow(/version/i);
    expect(() => store.decideMission(
      mission.id,
      '0'.repeat(64),
      mission.version,
      decision('decision-wrong-hash', DecisionOutcome.Approved),
    )).toThrow(/hash/i);
    expect(() => store.decideMission(
      mission.id,
      mission.planHash,
      mission.version,
      decision('decision-forged-binding', DecisionOutcome.Approved, {
        planHash: '1'.repeat(64), planVersion: mission.version,
      }),
    )).toThrow(/binding|hash/i);

    expect(store.getMission(mission.id)?.status).toBe(LifecycleStatus.PendingApproval);
    expect(store.listDecisions(mission.id)).toEqual([]);

    const approved = store.decideMission(
      mission.id,
      mission.planHash,
      mission.version,
      decision('decision-approved', DecisionOutcome.Approved),
    );
    expect(approved).toMatchObject({
      status: LifecycleStatus.Approved,
      approvalDecisionId: 'decision-approved',
      planHash: mission.planHash,
      version: mission.version,
    });
    expect(store.listDecisions(mission.id)[0]).toMatchObject({
      id: 'decision-approved', outcome: DecisionOutcome.Approved,
      planHash: mission.planHash, planVersion: mission.version,
    });
    expect(() => store.decideMission(
      mission.id,
      mission.planHash,
      mission.version,
      decision('decision-repeat', DecisionOutcome.Rejected),
    )).toThrow(/pending/i);
    expect(store.listDecisions(mission.id)).toHaveLength(1);
  });

  it('persists an exact rejection without executing or mutating the immutable plan', () => {
    const store = openStore();
    seedTruth(store);
    const mission = store.getMission('mission-pending')!;

    const rejected = store.decideMission(
      mission.id,
      mission.planHash,
      mission.version,
      decision('decision-rejected', DecisionOutcome.Rejected),
    );

    expect(rejected).toMatchObject({
      status: LifecycleStatus.Rejected,
      planHash: mission.planHash,
      version: mission.version,
    });
    expect(rejected.approvalDecisionId).toBeUndefined();
    expect(store.listDecisions(mission.id)[0]).toMatchObject({
      id: 'decision-rejected', outcome: DecisionOutcome.Rejected,
      planHash: mission.planHash, planVersion: mission.version,
    });
    expect(store.listAssignments({ missionId: mission.id })).toEqual([]);
    expect(store.listReceipts().filter((receipt) =>
      receipt.assignmentId && store.getAssignment(receipt.assignmentId)?.missionId === mission.id,
    )).toEqual([]);
  });

  it('serves the typed snapshot and authenticates exact-hash mission decisions', async () => {
    const store = openStore();
    seedTruth(store);
    const mission = store.getMission('mission-pending')!;
    const url = await startServer(store, () => 'api-decision-approved');

    const snapshotResponse = await api(url, '/api/v1/command-center');
    expect(snapshotResponse.status).toBe(200);
    expect(snapshotResponse.headers.get('content-security-policy')).toContain(
      "script-src 'self' 'wasm-unsafe-eval'",
    );
    expect(await snapshotResponse.json()).toMatchObject({
      revision: expect.stringMatching(/^[a-f0-9]{64}$/), generatedAt: NOW,
      approvals: [{ missionId: mission.id, planHash: mission.planHash, version: mission.version }],
      nucleus: { nodes: expect.any(Array), edges: expect.any(Array), activityPulses: expect.any(Array) },
    });

    expect((await fetch(`${url}/api/v1/missions/${mission.id}/decisions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).status).toBe(401);
    expect((await api(url, `/api/v1/missions/${mission.id}/decisions`, {
      method: 'POST', body: JSON.stringify({
        outcome: DecisionOutcome.Approved, planHash: mission.planHash,
        version: mission.version, decidedBy: 'forged',
      }),
    })).status).toBe(400);
    expect((await api(url, `/api/v1/missions/${mission.id}/decisions`, {
      method: 'POST', body: JSON.stringify({
        outcome: DecisionOutcome.Approved, planHash: mission.planHash,
        version: mission.version + 1,
      }),
    })).status).toBe(409);
    expect(store.listDecisions(mission.id)).toEqual([]);

    const response = await api(url, `/api/v1/missions/${mission.id}/decisions`, {
      method: 'POST', body: JSON.stringify({
        outcome: DecisionOutcome.Approved, planHash: mission.planHash,
        version: mission.version, reason: 'Proceed within the shown bounds',
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as MissionDecisionResponse;
    expect(body).toMatchObject({
      decision: {
        id: 'api-decision-approved', outcome: DecisionOutcome.Approved,
        planHash: mission.planHash, planVersion: mission.version,
        rationale: 'Proceed within the shown bounds',
      },
      mission: { id: mission.id, status: LifecycleStatus.Approved },
      snapshot: { approvals: [] },
    });
    expect(store.listAssignments({ missionId: mission.id })).toEqual([
      expect.objectContaining({
        missionId: mission.id,
        missionTaskId: 'pending-task',
        agentId: 'dev-agent',
        capabilityIds: ['cap-dev'],
        status: LifecycleStatus.Queued,
        instructions: mission.taskGraph[0].input,
        evidenceEventIds: mission.taskGraph[0].evidenceEventIds,
        maxAttempts: mission.budget.maxRetriesPerAssignment + 1,
      }),
    ]);
    expect((await api(url, `/api/v1/missions/${mission.id}/decisions`, {
      method: 'POST', body: JSON.stringify({
        outcome: DecisionOutcome.Rejected, planHash: mission.planHash, version: mission.version,
      }),
    })).status).toBe(409);
    expect(store.listDecisions(mission.id)).toHaveLength(1);
  });

  it('rejects a mission through the authenticated API without executing it', async () => {
    const store = openStore();
    seedTruth(store);
    const mission = store.getMission('mission-pending')!;
    const url = await startServer(store, () => 'api-decision-rejected');

    const response = await api(url, `/api/v1/missions/${mission.id}/decisions`, {
      method: 'POST', body: JSON.stringify({
        outcome: DecisionOutcome.Rejected, planHash: mission.planHash,
        version: mission.version, reason: 'Change the acceptance test',
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      decision: { id: 'api-decision-rejected', outcome: DecisionOutcome.Rejected },
      mission: { id: mission.id, status: LifecycleStatus.Rejected, stage: CommandCenterMissionStage.Review },
      snapshot: { approvals: [] },
    });
    expect(store.listAssignments({ missionId: mission.id })).toEqual([]);
  });

  it('disposes a persisted Review intent by exact hash without authorizing connector input', async () => {
    const store = openStore();
    store.appendEvent({
      id: 'event-review-api', source: 'telegram', sourceType: SourceType.Connector,
      sourceEventId: 'telegram:review-api', type: 'telegram.message',
      occurredAt: '2026-07-11T08:00:00.000Z', ingestedAt: '2026-07-11T08:00:01.000Z',
      payload: { text: 'Maybe launch the outreach sequence' },
      provenance: provenance('telegram', 'telegram:review-api'),
    });
    const stored = store.saveIntent({
      ...intent('intent-review-api'),
      eventId: 'event-review-api',
      status: LifecycleStatus.PendingApproval,
      route: IntentRoute.Review,
      routeRuleId: 'safety:low-confidence',
      confidence: 0.41,
      ambiguityReasons: ['Recipient identity is ambiguous'],
    });
    const url = await startServer(store, () => 'review-decision-api');

    expect((await fetch(`${url}/api/v1/review-intents/${stored.id}/decisions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).status).toBe(401);
    expect((await api(url, `/api/v1/review-intents/${stored.id}/decisions`, {
      method: 'POST', body: JSON.stringify({
        disposition: 'reclassify_project', intentHash: '0'.repeat(64),
      }),
    })).status).toBe(409);
    expect(store.listDecisions()).toEqual([]);

    const response = await api(url, `/api/v1/review-intents/${stored.id}/decisions`, {
      method: 'POST', body: JSON.stringify({
        disposition: 'reclassify_project', intentHash: stored.integrityHash,
        reason: 'Treat as a project, but require a bounded plan approval',
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      decision: {
        id: 'review-decision-api', intentId: stored.id, intentHash: stored.integrityHash,
        outcome: DecisionOutcome.Superseded,
      },
      originalIntent: { id: stored.id, route: IntentRoute.Review, confidence: 0.41 },
      derivedIntent: {
        route: IntentRoute.Project, status: LifecycleStatus.Active,
        confidence: 0.41, payload: expect.objectContaining({ reviewDecisionId: 'review-decision-api' }),
      },
      mission: {
        status: LifecycleStatus.PendingApproval,
        planHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        version: 1,
      },
      snapshot: { reviewIntents: [], approvals: [expect.any(Object)] },
    });
    expect(store.getIntent(stored.id)).toMatchObject({
      route: IntentRoute.Review, confidence: 0.41, ambiguityReasons: ['Recipient identity is ambiguous'],
    });
    expect(store.listMissions()).toEqual([
      expect.objectContaining({ status: LifecycleStatus.PendingApproval, version: 1 }),
    ]);
    expect(store.listAssignments()).toEqual([]);
  });

  it('dismisses an exact Review intent without creating derived work', async () => {
    const store = openStore();
    const stored = store.saveIntent({
      ...intent('intent-review-dismiss'),
      status: LifecycleStatus.PendingApproval,
      route: IntentRoute.Review,
      routeRuleId: 'safety:ambiguous',
      confidence: 0.33,
    });
    const url = await startServer(store, () => 'review-dismiss-decision');

    const response = await api(url, `/api/v1/review-intents/${stored.id}/decisions`, {
      method: 'POST', body: JSON.stringify({
        disposition: 'dismiss', intentHash: stored.integrityHash,
        reason: 'No action is intended',
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      decision: {
        id: 'review-dismiss-decision', intentId: stored.id,
        intentHash: stored.integrityHash, outcome: DecisionOutcome.Rejected,
      },
      originalIntent: { id: stored.id, confidence: 0.33 },
      snapshot: { reviewIntents: [] },
    });
    expect(store.listIntents({ route: IntentRoute.Project })).toEqual([]);
    expect(store.listMissions()).toEqual([]);
  });

  it('rejects a bound non-resumable checkpoint and never expands the approved plan', async () => {
    const store = openStore();
    store.registerAgentCapability(capability());
    store.saveIntent(intent('intent-checkpoint-api'));
    const mission = plan('mission-checkpoint-api', 'intent-checkpoint-api', [task('checkpoint-task', 0, [])]);
    store.createMissionPlan(mission);
    store.approveMission(mission.id, mission.planHash, {
      ...decision('checkpoint-plan-approval', DecisionOutcome.Approved),
      missionId: mission.id,
    });
    store.enqueueAssignment(assignment('checkpoint-assignment', mission, mission.taskGraph[0]));
    const [leased] = store.leaseReadyAssignments({
      workerId: 'checkpoint-worker', now: '2026-07-11T08:10:00.000Z', leaseMs: 60_000, limit: 1,
    });
    store.pauseAssignmentForCheckpoint(
      leased.id, leased.leaseToken!, [EscalationReason.RuntimeBudget], '2026-07-11T08:10:01.000Z',
    );
    const checkpoint = store.listProposals()[0]!;
    expect(checkpoint).toMatchObject({
      status: LifecycleStatus.PendingApproval,
      body: { resumable: false, requiresNewPlan: true },
    });
    const url = await startServer(store, () => 'checkpoint-decision-api');

    expect((await api(url, `/api/v1/checkpoints/${checkpoint.id}/decisions`, {
      method: 'POST', body: JSON.stringify({
        outcome: DecisionOutcome.Approved, planHash: mission.planHash, version: mission.version,
      }),
    })).status).toBe(409);
    expect(store.getProposal(checkpoint.id)?.status).toBe(LifecycleStatus.PendingApproval);
    expect(store.getAssignment(leased.id)?.status).toBe(LifecycleStatus.Paused);

    const rejected = await api(url, `/api/v1/checkpoints/${checkpoint.id}/decisions`, {
      method: 'POST', body: JSON.stringify({
        outcome: DecisionOutcome.Rejected, planHash: mission.planHash, version: mission.version,
        reason: 'A new immutable plan is required',
      }),
    });
    expect(rejected.status).toBe(200);
    expect(await rejected.json()).toMatchObject({
      proposal: { id: checkpoint.id, status: LifecycleStatus.Rejected },
      assignment: { id: leased.id, status: LifecycleStatus.Cancelled },
      requiresNewPlan: true,
    });
    expect(store.getMission(mission.id)).toMatchObject({
      planHash: mission.planHash, version: mission.version, status: LifecycleStatus.Cancelled,
    });
    expect(store.getMissionTask(leased.missionTaskId)?.status).toBe(LifecycleStatus.Cancelled);
    expect(store.listProposals(LifecycleStatus.PendingApproval)).toEqual([]);
    expect(store.listAssignments()).toHaveLength(1);
  });
});

function openStore(): JerichoStore {
  const store = new JerichoStore({ path: ':memory:', key: KEY });
  stores.push(store);
  return store;
}

function seedTruth(store: JerichoStore): void {
  store.appendEvent({
    id: 'event-command', source: 'telegram', sourceType: SourceType.Connector,
    sourceEventId: 'telegram:1', type: 'telegram.message',
    occurredAt: '2026-07-11T08:00:00.000Z', ingestedAt: '2026-07-11T08:00:01.000Z',
    payload: { text: 'Please review Jericho' }, provenance: provenance('telegram', 'event-command'),
  });
  for (const entity of [
    makeEntity('entity-task', EntityType.Task, 'Review Jericho', {
      dueAt: NOW,
    }, LifecycleStatus.Active),
    makeEntity('entity-conversation', EntityType.Conversation, 'Telegram: Paula', {
      priority: 10, unreadCount: 2,
    }),
    makeEntity('entity-person', EntityType.Person, 'Paula', {}),
    makeEntity('entity-commitment', EntityType.Commitment, 'Send Paula the review', {
      dueAt: NOW,
    }, LifecycleStatus.Active),
  ]) store.upsertEntity(entity);
  store.upsertRelation({
    id: 'relation-person-conversation', fromEntityId: 'entity-person',
    toEntityId: 'entity-conversation', type: RelationType.RelatedTo,
    attributes: {}, confidence: 1,
    freshness: { observedAt: '2026-07-11T08:00:00.000Z' },
    provenance: provenance('telegram', 'event-command'),
    createdAt: '2026-07-11T08:00:00.000Z', updatedAt: '2026-07-11T08:00:00.000Z',
  });

  store.registerAgentCapability(capability());
  store.saveIntent(intent('intent-pending'));
  store.saveIntent(intent('intent-active'));
  const pending = plan('mission-pending', 'intent-pending', [
    task('pending-task', 0, [], true),
  ], RiskLevel.Medium);
  store.createMissionPlan(pending);

  const active = plan('mission-active', 'intent-active', [
    task('active-task-a', 0, []),
    task('active-task-b', 1, []),
  ]);
  store.createMissionPlan(active);
  store.approveMission(active.id, active.planHash, {
    id: 'decision-active', missionId: active.id, decidedBy: 'carlos',
    outcome: DecisionOutcome.Approved, rationale: 'Bounded work approved',
    assumptions: [], evidenceEventIds: ['event-command'], route: RouteType.HumanApproval,
    risk: RiskLevel.Low, decidedAt: '2026-07-11T08:05:00.000Z',
    provenance: provenance('carlos', 'event-command'),
  });
  store.recordCost({
    id: 'cost-active', missionId: active.id, category: CostCategory.Model,
    estimatedMicroUsd: 75, actualMicroUsd: 50, idempotencyKey: 'cost-active-key',
    incurredAt: '2026-07-11T08:15:00.000Z', provenance: provenance('runner'),
  });
  store.enqueueAssignment(assignment('assignment-a', active, active.taskGraph[0]));
  store.enqueueAssignment(assignment('assignment-b', active, active.taskGraph[1]));
  const leased = store.leaseReadyAssignments({
    workerId: 'worker-1', now: '2026-07-11T08:10:00.000Z', leaseMs: 3_600_000, limit: 2,
  });
  const first = leased.find((item) => item.id === 'assignment-a')!;
  store.completeAssignment(first.id, first.leaseToken!, { kind: 'verified-report' }, '2026-07-11T08:20:00.000Z');
  store.reserveReceipt(receipt());
  store.startReceipt('receipt-a', '2026-07-11T08:21:00.000Z');
  store.completeReceipt('receipt-a', {
    status: ReceiptStatus.Succeeded, externalId: 'telegram-message-9', verified: true,
    verifiedAt: '2026-07-11T08:22:00.000Z', completedAt: '2026-07-11T08:22:00.000Z',
    evidenceEventIds: ['event-command'], result: { delivered: true },
  });
}

function makeEntity(
  id: string,
  type: EntityType,
  canonicalName: string,
  attributes: Entity['attributes'],
  status?: LifecycleStatus,
): Entity {
  return {
    id, type, canonicalName, aliases: [], attributes,
    ...(status ? { status } : {}), confidence: 1,
    freshness: { observedAt: '2026-07-11T08:00:00.000Z' },
    provenance: provenance('telegram', 'event-command'),
    createdAt: '2026-07-11T08:00:00.000Z', updatedAt: '2026-07-11T08:00:00.000Z',
  };
}

function provenance(source = 'test', sourceEventId?: string): Provenance[] {
  return [{
    source, sourceType: source === 'carlos' ? SourceType.User : SourceType.System,
    ...(sourceEventId ? { sourceEventId } : {}), observedAt: '2026-07-11T08:00:00.000Z',
  }];
}

function permissions() {
  return {
    allowedTools: ['git', 'telegram.send'], allowedSystems: ['telegram-gateway'],
    allowedRepositories: [{
      repository: 'jericho', writablePaths: ['apps/jericho'],
      mutationClasses: [MutationClass.ReadOnly, MutationClass.Reversible],
    }],
    allowedChannels: ['telegram'], allowedRecipients: ['entity-person'],
    allowedCredentialRefs: ['telegram-primary'], allowedDataScopes: ['telegram:selected'],
    allowedMutationClasses: [MutationClass.ReadOnly, MutationClass.Reversible],
  };
}

function capability(): AgentCapability {
  return {
    id: 'cap-dev', agentId: 'dev-agent', lane: AgentLane.Dev, name: 'Develop safely',
    status: LifecycleStatus.Active, routes: [RouteType.Agent],
    supportedActions: ['code.test', 'send_message'], tools: ['git', 'telegram.send'],
    modelPolicy: { allowedModels: ['local'], preferredModel: 'local', preferLocal: true, maxTokensPerAssignment: 5_000 },
    writableScope: permissions(), costClass: CostClass.Local, mayCreateAssignments: false,
    maximumRisk: RiskLevel.Medium, metadata: {}, lastVerifiedAt: '2026-07-11T08:00:00.000Z',
    provenance: provenance(), createdAt: '2026-07-11T08:00:00.000Z', updatedAt: '2026-07-11T08:00:00.000Z',
  };
}

function intent(id: string): IntentEnvelope {
  return {
    id, source: 'telegram', sourceType: SourceType.Connector, kind: IntentKind.Goal,
    summary: 'Ship verified work', payload: {}, status: LifecycleStatus.Active,
    route: IntentRoute.Project, routeRuleId: 'project-rule', entityIds: ['entity-person'],
    commitments: [], claims: [], assumptions: [], deadlines: [],
    affectedPartyIds: ['entity-person'], requiredEvidence: [{ eventId: 'event-command' }],
    requiredCapabilities: ['cap-dev'], ambiguityReasons: [], contradictoryEvidenceEventIds: [],
    risk: RiskLevel.Medium, confidence: 1, provenance: provenance('telegram', 'event-command'),
    createdAt: '2026-07-11T08:00:00.000Z', updatedAt: '2026-07-11T08:00:00.000Z',
  };
}

function task(
  id: string,
  sequence: number,
  dependsOn: string[],
  external = false,
): MissionTaskDefinition {
  return {
    id, kind: MissionTaskKind.Execute, title: `Execute ${id}`, sequence,
    lane: AgentLane.Dev, selectedAgentId: 'dev-agent', capabilityIds: ['cap-dev'],
    requiredActions: external ? ['send_message'] : ['code.test'],
    requiredTools: external ? ['telegram.send'] : ['git'], model: 'local', maxTokens: 5_000,
    writableScope: permissions(), dependsOn, evidenceEventIds: ['event-command'],
    expectedArtifact: {
      type: 'report', description: 'Verified report', verification: ['tests-pass'],
      requiredEvidence: ['event-command'],
    },
    ...(external ? { externalAction: {
      connectorId: 'telegram-gateway', action: 'send_message', destination: 'entity-person',
      idempotencyKey: 'pending-send', system: 'telegram-gateway', channel: 'telegram',
      recipient: 'entity-person', credentialRef: 'telegram-primary', dataScope: 'telegram:selected',
      tool: 'telegram.send', mutationClass: MutationClass.Reversible,
    } } : {}),
    input: { objective: id }, estimatedCostMicroUsd: external ? 100 : sequence === 0 ? 100 : 200,
    route: RouteType.Agent, risk: external ? RiskLevel.Medium : RiskLevel.Low,
  };
}

function plan(
  id: string,
  intentId: string,
  taskGraph: MissionTaskDefinition[],
  risk = RiskLevel.Low,
): MissionPlan {
  const input: MissionPlanInput = {
    id, seriesId: `${id}-series`, version: 1, intentId, title: `Mission ${id}`,
    objective: 'Ship verified work', route: RouteType.HumanApproval, risk,
    deliverables: [{ id: 'deliverable', description: 'Verified result', artifactType: 'report', required: true }],
    acceptanceTests: [{ id: 'acceptance', description: 'Tests pass', verification: 'automatic', requiredEvidence: ['event-command'] }],
    evidenceEventIds: ['event-command'], contextSnapshotHash: 'a'.repeat(64), taskGraph,
    budget: { maxCostMicroUsd: 5_000, maxRuntimeMs: 3_600_000, maxConcurrency: 2, maxRetriesPerAssignment: 1 },
    permissions: permissions(), rollback: { strategy: 'revert', steps: ['Revert commit'], verification: 'Tests pass' },
    escalationConditions: [EscalationReason.CostBudget, EscalationReason.NewRecipient],
    provenance: provenance(),
  };
  return createMissionPlan(input, new CapabilityRegistry([capability()]), '2026-07-11T08:00:00.000Z');
}

function assignment(id: string, mission: MissionPlan, definition: MissionTaskDefinition): Assignment {
  return {
    id, missionId: mission.id, missionTaskId: definition.id, agentId: definition.selectedAgentId,
    capabilityIds: definition.capabilityIds, status: LifecycleStatus.Queued,
    route: definition.route, risk: definition.risk, instructions: definition.input,
    evidenceEventIds: definition.evidenceEventIds, expectedArtifact: definition.expectedArtifact,
    ...(definition.externalAction ? { externalAction: definition.externalAction } : {}),
    idempotencyKey: `${id}-key`, attempt: 0, maxAttempts: 2,
    availableAt: '2026-07-11T08:10:00.000Z', estimatedCostMicroUsd: definition.estimatedCostMicroUsd,
    assignedAt: '2026-07-11T08:10:00.000Z', provenance: provenance('runner'),
  };
}

function receipt(): ActionReceipt {
  return {
    id: 'receipt-a', assignmentId: 'assignment-a', missionTaskId: 'active-task-a',
    connectorId: 'telegram-gateway', action: 'send_message', idempotencyKey: 'receipt-a-key',
    destination: 'entity-person', status: ReceiptStatus.Pending, route: RouteType.Connector,
    risk: RiskLevel.Low, requestedAt: '2026-07-11T08:20:30.000Z', verified: false,
    evidenceEventIds: ['event-command'], attempt: 1, provenance: provenance('runner'),
  };
}

function decision(
  id: string,
  outcome: DecisionOutcome.Approved | DecisionOutcome.Rejected,
  binding: { planHash?: string; planVersion?: number } = {},
) {
  return {
    id, missionId: 'mission-pending', decidedBy: 'carlos', outcome,
    ...binding,
    rationale: outcome === DecisionOutcome.Approved ? 'Approved in command center' : 'Rejected in command center',
    assumptions: [], evidenceEventIds: ['event-command'], route: RouteType.HumanApproval,
    risk: RiskLevel.Medium, decidedAt: NOW, provenance: provenance('carlos', 'event-command'),
  };
}

async function startServer(store: JerichoStore, decisionIdFactory: () => string): Promise<string> {
  const intake = new IntakeProcessor({ store });
  const server = createJerichoServer({
    store, apiToken: TOKEN, host: '127.0.0.1', geminiApiKey: undefined,
    clock: () => NOW, decisionIdFactory, intake,
  });
  servers.push(server);
  const address = await server.listen(0);
  return `http://127.0.0.1:${address.port}`;
}

function api(url: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${url}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}
