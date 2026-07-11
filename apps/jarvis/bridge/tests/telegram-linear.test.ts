import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AgentLane,
  ConnectorHealthStatus,
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
import { ConnectorUnauthorizedError } from '../src/connectors/contracts.js';
import {
  TelegramGatewayAdapter,
  type TelegramGatewayTransport,
} from '../src/connectors/adapters/telegram-gateway.js';
import {
  LinearAdapter,
  type LinearTransport,
} from '../src/connectors/adapters/linear.js';

const KEY = Buffer.alloc(32, 52);
const T0 = '2026-07-11T00:00:00.000Z';
const T1 = '2026-07-11T00:01:00.000Z';
const stores: JerichoStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('TelegramGatewayAdapter', () => {
  it('is unavailable without sole-owner Hermes gateway config and never calls transport', async () => {
    const transport = telegramTransport();
    const adapter = new TelegramGatewayAdapter({ transport });

    expect(await adapter.probe(new AbortController().signal)).toMatchObject({
      status: ConnectorHealthStatus.Unavailable,
    });
    await expect(adapter.capture(request())).rejects.toThrow(/gateway.*config|unavailable/i);
    expect(transport.fetchUpdates).not.toHaveBeenCalled();
  });

  it('pulls normalized paginated gateway events with stable epoch/sequence identity', async () => {
    const transport = telegramTransport();
    transport.fetchUpdates.mockResolvedValue({
      status: 200,
      updates: [{
        epoch: 7,
        sequence: 42,
        updateId: 'update-42',
        occurredAt: T0,
        chat: { id: 'chat-1', title: 'Jericho' },
        sender: { id: 'user-1', displayName: 'Carlos' },
        message: { id: 'message-1', text: 'Ship it' },
      }],
      nextPageToken: 'next-page',
      hasMore: true,
    });
    const adapter = new TelegramGatewayAdapter({
      gatewayUrl: 'https://hermes.internal',
      gatewayToken: 'gateway-token',
      transport,
    });

    const first = await adapter.capture(request());
    const replay = await adapter.capture(request({ observedAt: T1 }));

    expect(first.progress).toEqual({ epoch: 7, sequence: 42, pageToken: 'next-page' });
    expect(first.captures[0].event).toEqual(replay.captures[0].event);
    expect(first.captures[0]).toMatchObject({
      event: {
        source: 'telegram',
        sourceEventId: '7:42:update-42',
        payload: { chatId: 'chat-1', messageId: 'message-1', text: 'Ship it' },
      },
      identities: expect.arrayContaining([
        expect.objectContaining({ namespace: 'user', externalId: 'user-1' }),
        expect.objectContaining({ namespace: 'conversation', externalId: 'chat-1' }),
      ]),
      relations: [expect.objectContaining({ attributes: { role: 'sender' } })],
    });
  });

  it('maps gateway 401 to Unauthorized', async () => {
    const transport = telegramTransport();
    transport.fetchUpdates.mockResolvedValue({ status: 401, updates: [], hasMore: false });
    const adapter = new TelegramGatewayAdapter({
      gatewayUrl: 'https://hermes.internal', gatewayToken: 'bad', transport,
    });
    await expect(adapter.capture(request())).rejects.toBeInstanceOf(ConnectorUnauthorizedError);
  });

  it('sends only a mission-bound reserved outbox receipt and never resends uncertain work', async () => {
    const store = approvedTelegramStore();
    const transport = telegramTransport();
    transport.sendMessage.mockResolvedValue({ status: 200, chatId: 'person-carlos', messageId: 'message-99' });
    const adapter = new TelegramGatewayAdapter({
      gatewayUrl: 'https://hermes.internal', gatewayToken: 'gateway-token', transport,
    });

    const receipt = await adapter.sendApproved(store, {
      assignmentId: 'assignment-1',
      missionPlanHash: store.getMission('mission-v1')!.planHash,
      receiptId: 'receipt-1',
      recipient: 'person-carlos',
      text: 'Approved message',
      now: T1,
      signal: new AbortController().signal,
    });
    expect(receipt).toMatchObject({
      status: ReceiptStatus.Succeeded,
      externalId: 'person-carlos/message-99',
      verified: true,
    });
    expect(transport.sendMessage).toHaveBeenCalledTimes(1);

    const replay = await adapter.sendApproved(store, {
      assignmentId: 'assignment-1',
      missionPlanHash: store.getMission('mission-v1')!.planHash,
      receiptId: 'receipt-1',
      recipient: 'person-carlos', text: 'Approved message', now: T1,
      signal: new AbortController().signal,
    });
    expect(replay.status).toBe(ReceiptStatus.Succeeded);
    expect(transport.sendMessage).toHaveBeenCalledTimes(1);

    const uncertainStore = approvedTelegramStore('uncertain');
    uncertainStore.startReceipt('receipt-uncertain', T1);
    await expect(adapter.sendApproved(uncertainStore, {
      assignmentId: 'assignment-1',
      missionPlanHash: uncertainStore.getMission('mission-v1')!.planHash,
      receiptId: 'receipt-uncertain', recipient: 'person-carlos',
      text: 'Do not resend', now: T1, signal: new AbortController().signal,
    })).rejects.toThrow(/uncertain|started|resend/i);
    expect(transport.sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe('LinearAdapter', () => {
  it('uses read-only paginated GraphQL with watermark overlap and stable dedupe IDs', async () => {
    const transport = linearTransport();
    transport.queryIssues
      .mockResolvedValueOnce({
        status: 200,
        issues: [{
          id: 'LIN-1', identifier: 'JER-1', title: 'Build core',
          state: 'Todo', updatedAt: T0,
          project: { id: 'project-1', name: 'Jericho' },
          assignee: { id: 'user-1', name: 'Carlos' },
        }],
        pageInfo: { hasNextPage: true, endCursor: 'page-2' },
      })
      .mockResolvedValueOnce({
        status: 200,
        issues: [],
        pageInfo: { hasNextPage: false },
      });
    const adapter = new LinearAdapter({ apiKey: 'linear-key', transport, overlapMs: 60_000 });
    const first = await adapter.capture(request());
    const second = await adapter.capture(request({
      cursor: {
        connectorId: 'linear', capability: 'capture' as never, partition: 'primary',
        epoch: 1, sequence: 1, version: 1, pageToken: 'page-2',
        watermark: T0, updatedAt: T1,
      },
    }));

    expect(first.captures[0].event.sourceEventId).toBe('LIN-1:2026-07-11T00:00:00.000Z');
    expect(first.captures[0].event.type).toBe('linear.issue.updated');
    expect(first.progress).toMatchObject({ pageToken: 'page-2', watermark: T0 });
    expect(second.hasMore).toBe(false);
    expect(transport.queryIssues).toHaveBeenNthCalledWith(2, expect.objectContaining({
      after: 'page-2',
      updatedAfter: '2026-07-10T23:59:00.000Z',
    }));
    expect(Object.hasOwn(transport, 'mutate')).toBe(false);
  });

  it('maps Linear 401 to Unauthorized without producing captures', async () => {
    const transport = linearTransport();
    transport.queryIssues.mockResolvedValue({
      status: 401, issues: [], pageInfo: { hasNextPage: false },
    });
    const adapter = new LinearAdapter({ apiKey: 'bad', transport });
    await expect(adapter.capture(request())).rejects.toBeInstanceOf(ConnectorUnauthorizedError);
  });
});

function telegramTransport() {
  return {
    fetchUpdates: vi.fn<TelegramGatewayTransport['fetchUpdates']>(),
    sendMessage: vi.fn<TelegramGatewayTransport['sendMessage']>(),
  };
}

function linearTransport() {
  return { queryIssues: vi.fn<LinearTransport['queryIssues']>() };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    partition: 'primary', limit: 100, observedAt: T0,
    signal: new AbortController().signal,
    ...overrides,
  } as never;
}

function approvedTelegramStore(receiptKind: 'fresh' | 'uncertain' = 'fresh'): JerichoStore {
  const store = new JerichoStore({ path: ':memory:', key: KEY });
  stores.push(store);
  store.saveIntent(intent());
  store.registerAgentCapability(capability());
  const plan = createMissionPlan({
    id: 'mission-v1', seriesId: 'mission-series', version: 1,
    intentId: 'intent-1', title: 'Reply', objective: 'Send approved reply',
    route: RouteType.HumanApproval, risk: RiskLevel.Low,
    deliverables: [{ id: 'send', description: 'Message sent', artifactType: 'receipt', required: true }],
    acceptanceTests: [{ id: 'receipt', description: 'Receipt verified', verification: 'automatic', requiredEvidence: ['delivery'] }],
    evidenceEventIds: [], contextSnapshotHash: 'a'.repeat(64),
    taskGraph: [{
      id: 'task-1', kind: MissionTaskKind.Communicate, title: 'Send', sequence: 0,
      lane: AgentLane.Angela, selectedAgentId: 'angela', capabilityIds: ['cap-send'],
      requiredActions: ['send_message'], requiredTools: ['telegram.send'], model: 'local',
      maxTokens: 1_000, writableScope: permissions(), dependsOn: [], evidenceEventIds: [],
      expectedArtifact: { type: 'receipt', description: 'Delivery', verification: ['verified'], requiredEvidence: ['delivery'] },
      externalAction: {
        connectorId: 'telegram', action: 'send_message', destination: 'person-carlos',
        idempotencyKey: 'telegram-send-key', system: 'telegram', channel: 'telegram',
        recipient: 'person-carlos', tool: 'telegram.send', credentialRef: 'telegram-gateway',
        dataScope: 'telegram:selected', mutationClass: MutationClass.Reversible,
      },
      input: { text: 'Approved message' }, estimatedCostMicroUsd: 10,
      route: RouteType.Agent, risk: RiskLevel.Low,
    }],
    budget: { maxCostMicroUsd: 100, maxRuntimeMs: 60_000, maxConcurrency: 1, maxRetriesPerAssignment: 0 },
    permissions: permissions(),
    rollback: { strategy: 'delete message', steps: ['Delete'], verification: 'Confirm' },
    escalationConditions: Object.values(EscalationReason),
    provenance: provenance(),
  }, new CapabilityRegistry([capability()]), T0);
  store.createMissionPlan(plan);
  store.approveMission(plan.id, plan.planHash, decision());
  store.enqueueAssignment(assignment());
  store.reserveReceipt(receipt(receiptKind === 'uncertain' ? 'receipt-uncertain' : 'receipt-1'));
  return store;
}

function intent(): IntentEnvelope {
  return {
    id: 'intent-1', source: 'test', sourceType: SourceType.User,
    kind: IntentKind.Command, summary: 'Reply', payload: {}, status: LifecycleStatus.Queued,
    route: IntentRoute.Reply, routeRuleId: 'test', entityIds: [], commitments: [], claims: [],
    assumptions: [], deadlines: [], affectedPartyIds: [], requiredEvidence: [],
    requiredCapabilities: ['send_message'], ambiguityReasons: [], contradictoryEvidenceEventIds: [],
    risk: RiskLevel.Low, confidence: 1, provenance: provenance(), createdAt: T0, updatedAt: T0,
  };
}

function capability(): AgentCapability {
  return {
    id: 'cap-send', agentId: 'angela', lane: AgentLane.Angela, name: 'Telegram send',
    status: LifecycleStatus.Active, routes: [RouteType.Agent], supportedActions: ['send_message'],
    tools: ['telegram.send'], modelPolicy: { allowedModels: ['local'], preferLocal: true, maxTokensPerAssignment: 2_000 },
    writableScope: permissions(), costClass: CostClass.Low, mayCreateAssignments: false,
    maximumRisk: RiskLevel.Medium, metadata: {}, provenance: provenance(), createdAt: T0, updatedAt: T0,
  };
}

function assignment(): Assignment {
  return {
    id: 'assignment-1', missionId: 'mission-v1', missionTaskId: 'task-1', agentId: 'angela',
    capabilityIds: ['cap-send'], status: LifecycleStatus.Queued, route: RouteType.Agent,
    risk: RiskLevel.Low, instructions: { text: 'Approved message' }, evidenceEventIds: [],
    expectedArtifact: { type: 'receipt', description: 'Delivery', verification: ['verified'], requiredEvidence: ['delivery'] },
    externalAction: {
      connectorId: 'telegram', action: 'send_message', destination: 'person-carlos',
      idempotencyKey: 'telegram-send-key', system: 'telegram', channel: 'telegram',
      recipient: 'person-carlos', tool: 'telegram.send', credentialRef: 'telegram-gateway',
      dataScope: 'telegram:selected', mutationClass: MutationClass.Reversible,
    },
    idempotencyKey: 'assignment-key', attempt: 0, maxAttempts: 1,
    availableAt: T1, estimatedCostMicroUsd: 10, assignedAt: T1, provenance: provenance(T1),
  };
}

function receipt(id: string): ActionReceipt {
  return {
    id, assignmentId: 'assignment-1', missionTaskId: 'task-1', connectorId: 'telegram',
    action: 'send_message', idempotencyKey: 'telegram-send-key', destination: 'person-carlos',
    status: ReceiptStatus.Pending, route: RouteType.Connector, risk: RiskLevel.Low,
    requestedAt: T1, verified: false, evidenceEventIds: [], attempt: 1, provenance: provenance(T1),
  };
}

function decision(): DecisionRecord {
  return {
    id: 'decision-1', missionId: 'mission-v1', decidedBy: 'carlos',
    outcome: DecisionOutcome.Approved, rationale: 'Approved', assumptions: [], evidenceEventIds: [],
    route: RouteType.HumanApproval, risk: RiskLevel.Low, decidedAt: T1, provenance: provenance(T1),
  };
}

function permissions() {
  return {
    allowedTools: ['telegram.send'], allowedSystems: ['telegram'], allowedRepositories: [],
    allowedChannels: ['telegram'], allowedRecipients: ['person-carlos'],
    allowedCredentialRefs: ['telegram-gateway'], allowedDataScopes: ['telegram:selected'],
    allowedMutationClasses: [MutationClass.ReadOnly, MutationClass.Reversible],
  };
}

function provenance(at = T0) {
  return [{ source: 'test', sourceType: SourceType.System, observedAt: at }];
}
