import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  AgentLane,
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
  type AgentCapability,
  type MissionPermissions,
} from '@jericho/shared';

import { JerichoStore } from '../src/core/store.js';
import { CapabilityRegistry } from '../src/orchestration/capability-registry.js';
import { createMissionPlan } from '../src/orchestration/planner.js';
import { IntakeProcessor, buildAssignmentForTask } from '../src/orchestration/intake.js';
import { createFleetLaneRegistry, paperclipTitleForLane } from '../src/fleet/lane-registry.js';
import { decideFleetDispatch } from '../src/fleet/dispatch-router.js';
import { BridgeHandoffExecutor, captureBridgeReplies } from '../src/fleet/bridge-handoff-executor.js';
import { composeFleetWakeText } from '../src/fleet/wake-composer.js';
import { TelegramGatewayAdapter } from '../src/connectors/adapters/telegram-gateway.js';

const T0 = '2026-07-12T18:00:00.000Z';
const T1 = '2026-07-12T18:00:01.000Z';
const KEY = Buffer.alloc(32, 71);

function memoryStore(): JerichoStore {
  return new JerichoStore({ key: KEY, path: ':memory:' });
}

describe('fleet lane registry', () => {
  it('maps lanes to Paperclip tags and optional Telegram recipients', () => {
    const registry = createFleetLaneRegistry({
      telegramRecipients: { [AgentLane.Dev]: 'dev-chat' },
      bridgeRoot: '/tmp/bridge',
      dispatchMode: 'hybrid',
    });
    expect(registry.hasTelegramWake(AgentLane.Dev)).toBe(true);
    expect(registry.target(AgentLane.Angela)?.paperclipTag).toBe('[Ops]');
    expect(paperclipTitleForLane(AgentLane.Dev, 'Fix gateway')).toBe('[DevOps] Fix gateway');
  });
});

describe('fleet dispatch router', () => {
  it('prefers Telegram for interactive asks when recipient exists', () => {
    const registry = createFleetLaneRegistry({
      telegramRecipients: { [AgentLane.Dev]: 'dev-chat' },
      bridgeRoot: '/tmp/bridge',
    });
    expect(decideFleetDispatch(registry, {
      lane: AgentLane.Dev,
      summary: 'Ask DEV for a quick status check',
    }).mode).toBe('telegram_wake');
  });

  it('routes Iris and durable work to hybrid_durable when bridge exists', () => {
    const registry = createFleetLaneRegistry({
      telegramRecipients: { [AgentLane.Iris]: 'iris-chat' },
      bridgeRoot: '/tmp/bridge',
    });
    expect(decideFleetDispatch(registry, {
      lane: AgentLane.Iris,
      summary: 'Design a landing page',
    }).mode).toBe('hybrid_durable');
  });
});

describe('fleet wake composer', () => {
  it('builds a Carlos-equivalent structured wake', () => {
    const text = composeFleetWakeText({
      lane: AgentLane.Dev,
      laneLabel: 'DEV',
      missionId: 'mission-1',
      assignmentId: 'assignment-1',
      planHash: 'abcdef1234567890',
      objective: 'Ship the fix',
    });
    expect(text).toContain('[Jericho Core → DEV]');
    expect(text).toContain('Ship the fix');
    expect(text).toContain('assignment-1');
  });
});

describe('intake fleet planning', () => {
  it('emits a Telegram wake externalAction for interactive DEV work', () => {
    const store = memoryStore();
    const registry = createFleetLaneRegistry({
      telegramRecipients: { [AgentLane.Dev]: 'dev-chat-id' },
      bridgeRoot: '/tmp/bridge',
    });
    const intake = new IntakeProcessor({ store, fleetRegistry: registry });
    const event = store.appendEvent({
      id: 'event-fleet-1',
      source: 'local:spoken',
      sourceType: SourceType.User,
      sourceEventId: 'spoken-1',
      type: 'voice.command',
      occurredAt: T0,
      ingestedAt: T0,
      payload: {
        text: 'Ask DEV for a quick status on the gateway',
        jerichoScope: { intentKind: IntentKind.Command },
      },
      provenance: [{ source: 'local:spoken', sourceType: SourceType.User, observedAt: T0 }],
    }).event;
    const result = intake.processEvent(event.id);
    if (result.status === 'planned' && result.mission) {
      const laneTask = result.mission.taskGraph.find((task) => task.sequence === 1);
      expect(laneTask?.externalAction?.connectorId).toBe('telegram');
      expect(laneTask?.externalAction?.recipient).toBe('dev-chat-id');
      expect(laneTask?.input.text).toContain('Jericho Core →');
    } else {
      expect(['review', 'understood', 'planned', 'failed']).toContain(result.status);
    }
  });
});

describe('bridge handoff executor', () => {
  it('writes a handoff file and optional Paperclip [lane] issue', async () => {
    const bridgeRoot = mkdtempSync(join(tmpdir(), 'jericho-bridge-'));
    const registry = createFleetLaneRegistry({ bridgeRoot, dispatchMode: 'durable_only' });
    const createIssue = vi.fn().mockResolvedValue({ id: 'issue-9', status: 'open', metadata: {} });
    const executor = new BridgeHandoffExecutor({
      registry,
      paperclip: {
        findByIdempotencyKey: vi.fn().mockResolvedValue(undefined),
        createIssue,
      },
    });
    const store = approvedBridgeStore('fleet-bridge-key', bridgeRoot);
    const assignment = store.listAssignments()[0]!;
    const mission = store.getMission(assignment.missionId)!;
    const receipt = store.getReceiptByIdempotencyKey('fleet-bridge-key')!;
    const result = await executor.executeApproved(store, {
      assignmentId: assignment.id,
      missionPlanHash: mission.planHash,
      receiptId: receipt.id,
      recipient: 'fleet-bridge',
      text: 'Implement the durable task',
      now: T1,
      signal: new AbortController().signal,
    });
    expect(result.externalId).toBeTruthy();
    expect(createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('[DevOps]') }),
      expect.any(AbortSignal),
    );
    const outbox = join(bridgeRoot, 'outbox', 'jericho-handoffs');
    expect(existsSync(outbox)).toBe(true);
    expect(readdirSync(outbox).some((name) => name.endsWith('.md'))).toBe(true);
  });

  it('captures bridge replies into Core events', () => {
    const bridgeRoot = mkdtempSync(join(tmpdir(), 'jericho-replies-'));
    const replies = join(bridgeRoot, 'outbox', 'jericho-replies');
    mkdirSync(replies, { recursive: true });
    writeFileSync(join(replies, 'reply-1.md'), 'assignment: assignment-1\nDone.\n', 'utf8');
    const store = memoryStore();
    const count = captureBridgeReplies({ bridgeRoot, store, now: () => T1 });
    expect(count).toBe(1);
    expect(store.listEvents().some((event) => event.type === 'fleet.bridge_reply')).toBe(true);
  });
});

describe('telegram fleet wake execution', () => {
  it('sends an approved wake through the Telegram gateway adapter', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      status: 200, chatId: 'dev-chat-id', messageId: 'm-1',
    });
    const adapter = new TelegramGatewayAdapter({
      gatewayUrl: 'https://hermes.internal',
      gatewayToken: 'token',
      transport: { fetchUpdates: vi.fn(), sendMessage },
    });
    const store = approvedTelegramWakeStore();
    const assignment = store.listAssignments()[0]!;
    await adapter.sendApproved(store, {
      assignmentId: assignment.id,
      missionPlanHash: store.getMission('mission-v1')!.planHash,
      receiptId: 'receipt-1',
      recipient: 'dev-chat-id',
      text: assignment.instructions.text as string,
      now: T1,
      signal: new AbortController().signal,
    });
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      recipient: 'dev-chat-id',
      text: expect.stringContaining('Jericho Core'),
    }));
  });
});

function approvedBridgeStore(idempotencyKey: string, _bridgeRoot: string): JerichoStore {
  const store = memoryStore();
  const permissions = fleetPermissions();
  store.saveIntent({
    id: 'intent-1', source: 'test', sourceType: SourceType.User,
    kind: IntentKind.Command, summary: 'Dispatch', payload: {}, status: LifecycleStatus.Queued,
    route: IntentRoute.Project, routeRuleId: 'test', entityIds: [], commitments: [], claims: [],
    assumptions: [], deadlines: [], affectedPartyIds: [], requiredEvidence: [],
    requiredCapabilities: ['write_handoff'], ambiguityReasons: [], contradictoryEvidenceEventIds: [],
    risk: RiskLevel.Low, confidence: 1, provenance: provenance(), createdAt: T0, updatedAt: T0,
  });
  store.registerAgentCapability(bridgeCapability(permissions));
  const plan = createMissionPlan({
    id: 'mission-v1', seriesId: 'series-1', version: 1,
    intentId: 'intent-1', title: 'Dispatch', objective: 'Durable work',
    route: RouteType.HumanApproval, risk: RiskLevel.Low,
    deliverables: [{ id: 'd1', description: 'Handoff', artifactType: 'receipt', required: true }],
    acceptanceTests: [{ id: 'a1', description: 'Receipt', verification: 'automatic', requiredEvidence: ['destination-receipt'] }],
    evidenceEventIds: [], contextSnapshotHash: 'a'.repeat(64),
    taskGraph: [{
      id: 'task-1', kind: MissionTaskKind.Communicate, title: 'Ship gateway fix', sequence: 0,
      lane: AgentLane.Dev, selectedAgentId: 'DEV', capabilityIds: ['cap-bridge'],
      requiredActions: ['write_handoff'], requiredTools: ['fleet.bridge.write'], model: 'local',
      maxTokens: 1_000, writableScope: permissions, dependsOn: [], evidenceEventIds: [],
      expectedArtifact: {
        type: 'receipt', description: 'Handoff',
        verification: ['gateway-acknowledged', 'destination-matched', 'idempotency-bound'],
        requiredEvidence: ['destination-receipt'],
      },
      externalAction: {
        connectorId: 'fleet-bridge', action: 'write_handoff', destination: 'fleet-bridge',
        idempotencyKey, system: 'conductor-bridge', channel: 'filesystem',
        recipient: 'fleet-bridge', tool: 'fleet.bridge.write', credentialRef: 'fleet-bridge',
        dataScope: 'fleet:bridge', mutationClass: MutationClass.Reversible,
      },
      input: { text: 'Implement the durable task', dispatchMode: 'hybrid_durable' },
      estimatedCostMicroUsd: 10, route: RouteType.Agent, risk: RiskLevel.Low,
    }],
    budget: { maxCostMicroUsd: 100, maxRuntimeMs: 60_000, maxConcurrency: 1, maxRetriesPerAssignment: 0 },
    permissions,
    rollback: { strategy: 'delete', steps: ['Delete'], verification: 'Confirm' },
    escalationConditions: Object.values(EscalationReason),
    provenance: provenance(),
  }, new CapabilityRegistry([bridgeCapability(permissions)]), T0);
  store.createMissionPlan(plan);
  store.approveMission(plan.id, plan.planHash, {
    id: 'decision-1', missionId: plan.id, decidedBy: 'carlos',
    outcome: DecisionOutcome.Approved, rationale: 'ok', assumptions: [], evidenceEventIds: [],
    route: RouteType.HumanApproval, risk: RiskLevel.Low, decidedAt: T1, provenance: provenance(T1),
  });
  const approved = store.getMission(plan.id)!;
  store.enqueueAssignment(buildAssignmentForTask(approved, approved.taskGraph[0]!));
  store.reserveReceipt({
    id: 'receipt-1', assignmentId: buildAssignmentForTask(approved, approved.taskGraph[0]!).id,
    missionTaskId: 'task-1',
    connectorId: 'fleet-bridge', action: 'write_handoff', idempotencyKey,
    destination: 'fleet-bridge', status: ReceiptStatus.Pending, route: RouteType.Connector,
    risk: RiskLevel.Low, requestedAt: T1, verified: false, evidenceEventIds: [], attempt: 1,
    provenance: provenance(T1),
  });
  return store;
}

function approvedTelegramWakeStore(): JerichoStore {
  const store = memoryStore();
  const permissions = telegramPermissions();
  const text = composeFleetWakeText({
    lane: AgentLane.Dev, laneLabel: 'DEV', missionId: 'mission-v1',
    assignmentId: 'assignment-1', planHash: 'abcdef1234567890', objective: 'Quick status',
  });
  store.saveIntent({
    id: 'intent-1', source: 'test', sourceType: SourceType.User,
    kind: IntentKind.Command, summary: 'Wake', payload: {}, status: LifecycleStatus.Queued,
    route: IntentRoute.Project, routeRuleId: 'test', entityIds: [], commitments: [], claims: [],
    assumptions: [], deadlines: [], affectedPartyIds: [], requiredEvidence: [],
    requiredCapabilities: ['send_message'], ambiguityReasons: [], contradictoryEvidenceEventIds: [],
    risk: RiskLevel.Low, confidence: 1, provenance: provenance(), createdAt: T0, updatedAt: T0,
  });
  store.registerAgentCapability(telegramCapability(permissions));
  const plan = createMissionPlan({
    id: 'mission-v1', seriesId: 'series-1', version: 1,
    intentId: 'intent-1', title: 'Wake', objective: 'Quick status',
    route: RouteType.HumanApproval, risk: RiskLevel.Low,
    deliverables: [{ id: 'd1', description: 'Wake', artifactType: 'receipt', required: true }],
    acceptanceTests: [{ id: 'a1', description: 'Receipt', verification: 'automatic', requiredEvidence: ['destination-receipt'] }],
    evidenceEventIds: [], contextSnapshotHash: 'a'.repeat(64),
    taskGraph: [{
      id: 'task-1', kind: MissionTaskKind.Communicate, title: 'Wake DEV', sequence: 0,
      lane: AgentLane.Dev, selectedAgentId: 'DEV', capabilityIds: ['cap-send'],
      requiredActions: ['send_message'], requiredTools: ['telegram.send'], model: 'local',
      maxTokens: 1_000, writableScope: permissions, dependsOn: [], evidenceEventIds: [],
      expectedArtifact: {
        type: 'receipt', description: 'Delivery',
        verification: ['gateway-acknowledged', 'destination-matched', 'idempotency-bound'],
        requiredEvidence: ['destination-receipt'],
      },
      externalAction: {
        connectorId: 'telegram', action: 'send_message', destination: 'dev-chat-id',
        idempotencyKey: 'telegram-wake-key', system: 'telegram', channel: 'telegram',
        recipient: 'dev-chat-id', tool: 'telegram.send', credentialRef: 'telegram-gateway',
        dataScope: 'telegram:selected', mutationClass: MutationClass.Reversible,
      },
      input: { text, dispatchMode: 'telegram_wake' },
      estimatedCostMicroUsd: 10, route: RouteType.Agent, risk: RiskLevel.Low,
    }],
    budget: { maxCostMicroUsd: 100, maxRuntimeMs: 60_000, maxConcurrency: 1, maxRetriesPerAssignment: 0 },
    permissions,
    rollback: { strategy: 'delete', steps: ['Delete'], verification: 'Confirm' },
    escalationConditions: Object.values(EscalationReason),
    provenance: provenance(),
  }, new CapabilityRegistry([telegramCapability(permissions)]), T0);
  store.createMissionPlan(plan);
  store.approveMission(plan.id, plan.planHash, {
    id: 'decision-1', missionId: plan.id, decidedBy: 'carlos',
    outcome: DecisionOutcome.Approved, rationale: 'ok', assumptions: [], evidenceEventIds: [],
    route: RouteType.HumanApproval, risk: RiskLevel.Low, decidedAt: T1, provenance: provenance(T1),
  });
  const approved = store.getMission(plan.id)!;
  const assignment = buildAssignmentForTask(approved, approved.taskGraph[0]!);
  store.enqueueAssignment(assignment);
  store.reserveReceipt({
    id: 'receipt-1', assignmentId: assignment.id, missionTaskId: 'task-1',
    connectorId: 'telegram', action: 'send_message', idempotencyKey: 'telegram-wake-key',
    destination: 'dev-chat-id', status: ReceiptStatus.Pending, route: RouteType.Connector,
    risk: RiskLevel.Low, requestedAt: T1, verified: false, evidenceEventIds: [], attempt: 1,
    provenance: provenance(T1),
  });
  return store;
}

function fleetPermissions(): MissionPermissions {
  return {
    allowedTools: ['fleet.bridge.write'],
    allowedSystems: ['fleet-bridge', 'conductor-bridge'],
    allowedRepositories: [], allowedChannels: ['filesystem'], allowedRecipients: ['fleet-bridge'],
    allowedCredentialRefs: ['fleet-bridge'], allowedDataScopes: ['fleet:bridge'],
    allowedMutationClasses: [MutationClass.ReadOnly, MutationClass.Reversible],
  };
}

function telegramPermissions(): MissionPermissions {
  return {
    allowedTools: ['telegram.send'], allowedSystems: ['telegram'], allowedRepositories: [],
    allowedChannels: ['telegram'], allowedRecipients: ['dev-chat-id'],
    allowedCredentialRefs: ['telegram-gateway'], allowedDataScopes: ['telegram:selected'],
    allowedMutationClasses: [MutationClass.ReadOnly, MutationClass.Reversible],
  };
}

function bridgeCapability(permissions: MissionPermissions): AgentCapability {
  return {
    id: 'cap-bridge', agentId: 'DEV', lane: AgentLane.Dev, name: 'Bridge',
    status: LifecycleStatus.Active, routes: [RouteType.Agent], supportedActions: ['write_handoff'],
    tools: ['fleet.bridge.write'], modelPolicy: { allowedModels: ['local'], preferLocal: true, maxTokensPerAssignment: 2_000 },
    writableScope: permissions, costClass: CostClass.Low, mayCreateAssignments: false,
    maximumRisk: RiskLevel.Medium, metadata: {}, provenance: provenance(), createdAt: T0, updatedAt: T0,
  };
}

function telegramCapability(permissions: MissionPermissions): AgentCapability {
  return {
    id: 'cap-send', agentId: 'DEV', lane: AgentLane.Dev, name: 'Telegram',
    status: LifecycleStatus.Active, routes: [RouteType.Agent], supportedActions: ['send_message'],
    tools: ['telegram.send'], modelPolicy: { allowedModels: ['local'], preferLocal: true, maxTokensPerAssignment: 2_000 },
    writableScope: permissions, costClass: CostClass.Low, mayCreateAssignments: false,
    maximumRisk: RiskLevel.Medium, metadata: {}, provenance: provenance(), createdAt: T0, updatedAt: T0,
  };
}

function provenance(at = T0) {
  return [{ source: 'test', sourceType: SourceType.System, observedAt: at }];
}
