import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AgentLane,
  ConnectorHealthStatus,
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
  type DecisionRecord,
  type IntentEnvelope,
} from '@jericho/shared';

import { JerichoStore } from '../src/core/store.js';
import { CapabilityRegistry } from '../src/orchestration/capability-registry.js';
import { createMissionPlan } from '../src/orchestration/planner.js';
import {
  RoutedArtifactVerifier,
  RoutedAssignmentExecutor,
} from '../src/orchestration/connector-action-executor.js';
import { MissionRunner } from '../src/orchestration/runner.js';
import {
  WhatsAppGatewayAdapter,
  type WhatsAppGatewayTransport,
} from '../src/connectors/adapters/whatsapp-gateway.js';

const T0 = '2026-07-11T00:00:00.000Z';
const T1 = '2026-07-11T00:01:00.000Z';
const KEY = Buffer.alloc(32, 91);
const stores: JerichoStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('WhatsAppGatewayAdapter', () => {
  it('is truthfully disabled or unavailable when Hermes gateway config is missing', async () => {
    const transport = whatsappTransport();
    const disabled = new WhatsAppGatewayAdapter({ transport });
    const incomplete = new WhatsAppGatewayAdapter({
      gatewayUrl: 'https://hermes.internal',
      transport,
    });

    await expect(disabled.probe(signal())).resolves.toMatchObject({
      status: ConnectorHealthStatus.Disabled,
      details: { reason: 'not_configured' },
    });
    await expect(incomplete.probe(signal())).resolves.toMatchObject({
      status: ConnectorHealthStatus.Unavailable,
      details: { reason: 'incomplete_gateway_config' },
    });
    await expect(disabled.capture(request())).rejects.toThrow(/config|disabled|unavailable/i);
    expect(transport.probe).not.toHaveBeenCalled();
    expect(transport.fetchUpdates).not.toHaveBeenCalled();
    expect(transport.sendMessage).not.toHaveBeenCalled();
  });

  it('captures exact message text and stable media references with chat/contact identities', async () => {
    const transport = whatsappTransport();
    transport.fetchUpdates.mockResolvedValue({
      status: 200,
      updates: [{
        epoch: 4,
        sequence: 27,
        updateId: 'wa-update-27',
        occurredAt: T0,
        kind: 'message.created',
        chat: { id: 'wa-chat-1', title: 'Jericho operators' },
        contact: { id: 'wa-contact-carlos', displayName: 'Carlos' },
        message: {
          id: 'wa-message-9',
          text: 'Ship exactly this — no substitutions.',
          media: [{
            reference: 'hermes-media:sha256:abc123',
            mimeType: 'image/jpeg',
            fileName: 'whiteboard.jpg',
            sha256: 'abc123',
            sizeBytes: 42_001,
          }],
        },
      }],
      nextPageToken: 'opaque-page-2',
      hasMore: true,
    });
    const adapter = configuredAdapter(transport);

    const first = await adapter.capture(request());
    const replay = await adapter.capture(request());

    expect(first.progress).toEqual({
      epoch: 4,
      sequence: 27,
      pageToken: 'opaque-page-2',
    });
    expect(replay.captures[0].event).toEqual(first.captures[0].event);
    expect(first.captures[0]).toMatchObject({
      event: {
        source: 'whatsapp',
        sourceEventId: '4:27:wa-update-27',
        type: 'whatsapp.message.created',
        occurredAt: T0,
        ingestedAt: T0,
        payload: {
          chatId: 'wa-chat-1',
          messageId: 'wa-message-9',
          text: 'Ship exactly this — no substitutions.',
          media: [{
            reference: 'hermes-media:sha256:abc123',
            mimeType: 'image/jpeg',
            fileName: 'whiteboard.jpg',
            sha256: 'abc123',
            sizeBytes: 42_001,
          }],
        },
      },
      identities: expect.arrayContaining([
        expect.objectContaining({
          connectorId: 'whatsapp', namespace: 'contact',
          externalId: 'wa-contact-carlos', entityType: EntityType.Person,
        }),
        expect.objectContaining({
          connectorId: 'whatsapp', namespace: 'chat',
          externalId: 'wa-chat-1', entityType: EntityType.Conversation,
        }),
      ]),
      relations: [expect.objectContaining({
        type: RelationType.MemberOf,
        attributes: { role: 'sender' },
      })],
    });
    expect(JSON.stringify(first)).not.toContain('gateway-secret');
  });

  it('retains edits, deletions, and delivery status as distinct immutable evidence events', async () => {
    const transport = whatsappTransport();
    transport.fetchUpdates.mockResolvedValue({
      status: 200,
      updates: [{
        epoch: 4, sequence: 28, updateId: 'wa-edit-28', occurredAt: T0,
        kind: 'message.edited', chat: { id: 'wa-chat-1' },
        contact: { id: 'wa-contact-carlos' },
        message: {
          id: 'wa-message-9', text: 'Corrected exact text',
          editedAt: '2026-07-11T00:00:01.000Z',
        },
      }, {
        epoch: 4, sequence: 29, updateId: 'wa-delete-29', occurredAt: T0,
        kind: 'message.deleted', chat: { id: 'wa-chat-1' },
        message: { id: 'wa-message-9', deletedFor: 'everyone' },
      }, {
        epoch: 4, sequence: 30, updateId: 'wa-status-30', occurredAt: T0,
        kind: 'message.status', chat: { id: 'wa-chat-1' },
        contact: { id: 'wa-contact-carlos' },
        message: {
          id: 'wa-message-9', status: 'read',
          statusAt: '2026-07-11T00:00:02.000Z',
        },
      }],
      hasMore: false,
    });

    const page = await configuredAdapter(transport).capture(request());

    expect(page.captures.map(({ event }) => ({
      type: event.type,
      sourceEventId: event.sourceEventId,
      payload: event.payload,
    }))).toEqual([{
      type: 'whatsapp.message.edited',
      sourceEventId: '4:28:wa-edit-28',
      payload: {
        chatId: 'wa-chat-1', messageId: 'wa-message-9',
        text: 'Corrected exact text', editedAt: '2026-07-11T00:00:01.000Z',
      },
    }, {
      type: 'whatsapp.message.deleted',
      sourceEventId: '4:29:wa-delete-29',
      payload: {
        chatId: 'wa-chat-1', messageId: 'wa-message-9', deletedFor: 'everyone',
      },
    }, {
      type: 'whatsapp.message.status',
      sourceEventId: '4:30:wa-status-30',
      payload: {
        chatId: 'wa-chat-1', messageId: 'wa-message-9', status: 'read',
        statusAt: '2026-07-11T00:00:02.000Z',
      },
    }]);
    expect(new Set(page.captures.map(({ event }) => event.id)).size).toBe(3);
  });

  it('continues an opaque gateway page from the exact durable epoch and sequence cursor', async () => {
    const transport = whatsappTransport();
    transport.fetchUpdates.mockResolvedValue({
      status: 200,
      updates: [{
        epoch: 4, sequence: 28, updateId: 'wa-update-28', occurredAt: T0,
        kind: 'message.created', chat: { id: 'wa-chat-1' },
        message: { id: 'wa-message-10', text: 'Next page' },
      }],
      hasMore: false,
    });
    const cursor = {
      connectorId: 'whatsapp', capability: 'capture' as never, partition: 'primary',
      epoch: 4, sequence: 27, pageToken: 'opaque-page-2', version: 7, updatedAt: T0,
    };

    const page = await configuredAdapter(transport).capture(request({ cursor, limit: 25 }));

    expect(transport.fetchUpdates).toHaveBeenCalledWith(expect.objectContaining({
      partition: 'primary', epoch: 4, sequence: 27,
      pageToken: 'opaque-page-2', limit: 25,
    }));
    expect(page).toMatchObject({
      progress: { epoch: 4, sequence: 28 },
      hasMore: false,
    });
    expect(page.progress).not.toHaveProperty('pageToken');
  });

  it('rejects a gateway page that would regress the durable cursor', async () => {
    const transport = whatsappTransport();
    transport.fetchUpdates.mockResolvedValue({
      status: 200,
      updates: [{
        epoch: 4, sequence: 26, updateId: 'stale-update', occurredAt: T0,
        kind: 'message.created', chat: { id: 'wa-chat-1' },
        message: { id: 'wa-message-stale', text: 'Stale' },
      }],
      hasMore: false,
    });
    const cursor = {
      connectorId: 'whatsapp', capability: 'capture' as never, partition: 'primary',
      epoch: 4, sequence: 27, version: 7, updatedAt: T0,
    };

    await expect(configuredAdapter(transport).capture(request({ cursor })))
      .rejects.toThrow(/cursor|regress|sequence/i);
  });

  it('refuses an ambiguous non-final page without an opaque continuation token', async () => {
    const transport = whatsappTransport();
    transport.fetchUpdates.mockResolvedValue({
      status: 200,
      updates: [{
        epoch: 4, sequence: 31, updateId: 'wa-update-31', occurredAt: T0,
        kind: 'message.created', chat: { id: 'wa-chat-1' },
        message: { id: 'wa-message-31', text: 'More follows' },
      }],
      hasMore: true,
    });

    await expect(configuredAdapter(transport).capture(request()))
      .rejects.toThrow(/page|continuation|token/i);
  });

  it('reports authenticated gateway health without assuming config means healthy', async () => {
    const healthyTransport = whatsappTransport();
    healthyTransport.probe.mockResolvedValue({ status: 204 });
    const unauthorizedTransport = whatsappTransport();
    unauthorizedTransport.probe.mockResolvedValue({ status: 401 });
    const unavailableTransport = whatsappTransport();
    unavailableTransport.probe.mockResolvedValue({ status: 503 });

    await expect(configuredAdapter(healthyTransport).probe(signal())).resolves.toMatchObject({
      status: ConnectorHealthStatus.Healthy,
      details: { owner: 'hermes-gateway' },
    });
    await expect(configuredAdapter(unauthorizedTransport).probe(signal())).resolves.toMatchObject({
      status: ConnectorHealthStatus.Unauthorized,
      details: { reason: 'unauthorized' },
    });
    await expect(configuredAdapter(unavailableTransport).probe(signal())).resolves.toMatchObject({
      status: ConnectorHealthStatus.Unavailable,
      details: { reason: 'gateway_unavailable', status: 503 },
    });
    expect(JSON.stringify([
      await configuredAdapter(healthyTransport).probe(signal()),
      await configuredAdapter(unauthorizedTransport).probe(signal()),
      await configuredAdapter(unavailableTransport).probe(signal()),
    ])).not.toContain('gateway-secret');
  });

  it('honors an aborted signal before any gateway health or capture request', async () => {
    const transport = whatsappTransport();
    const controller = new AbortController();
    const reason = new DOMException('operator cancelled', 'AbortError');
    controller.abort(reason);
    const adapter = configuredAdapter(transport);

    await expect(adapter.probe(controller.signal)).rejects.toBe(reason);
    await expect(adapter.capture(request({ signal: controller.signal }))).rejects.toBe(reason);
    expect(transport.probe).not.toHaveBeenCalled();
    expect(transport.fetchUpdates).not.toHaveBeenCalled();
  });

  it('redacts gateway credentials from capture transport failures', async () => {
    const transport = whatsappTransport();
    transport.fetchUpdates.mockRejectedValue(
      new Error('request failed with credential gateway-secret'),
    );

    const error = await configuredAdapter(transport).capture(request()).catch((cause) => cause);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/gateway.*unavailable/i);
    expect(JSON.stringify(error)).not.toContain('gateway-secret');
    expect((error as Error).message).not.toContain('gateway-secret');
  });

  it('sends only an exact approved WhatsApp receipt and replays it without a second send', async () => {
    const store = approvedWhatsAppStore();
    const transport = whatsappTransport();
    transport.sendMessage.mockResolvedValue({
      status: 200,
      chatId: 'wa-contact-carlos',
      messageId: 'wa-message-sent-1',
    });
    const adapter = configuredAdapter(transport);
    const input = {
      assignmentId: 'wa-assignment-1',
      missionPlanHash: store.getMission('wa-mission-v1')!.planHash,
      receiptId: 'wa-receipt-1',
      recipient: 'wa-contact-carlos',
      text: 'Approved WhatsApp message',
      now: T1,
      signal: signal(),
    };

    const sent = await adapter.sendApproved(store, input);
    const replay = await adapter.sendApproved(store, input);

    expect(sent).toMatchObject({
      status: ReceiptStatus.Succeeded,
      externalId: 'wa-contact-carlos/wa-message-sent-1',
      verified: true,
      result: {
        chatId: 'wa-contact-carlos', messageId: 'wa-message-sent-1',
      },
    });
    expect(replay).toEqual(sent);
    expect(transport.sendMessage).toHaveBeenCalledTimes(1);
    expect(transport.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      recipient: 'wa-contact-carlos',
      text: 'Approved WhatsApp message',
      idempotencyKey: 'whatsapp-send-key',
    }));
  });

  it('exposes a runner-owned execution primitive that starts but does not complete the receipt', async () => {
    const store = approvedWhatsAppStore();
    const transport = whatsappTransport();
    transport.sendMessage.mockResolvedValue({
      status: 200,
      chatId: 'wa-contact-carlos',
      messageId: 'wa-message-runner-1',
    });
    const adapter = configuredAdapter(transport);

    const result = await adapter.executeApproved(store, {
      assignmentId: 'wa-assignment-1',
      missionPlanHash: store.getMission('wa-mission-v1')!.planHash,
      receiptId: 'wa-receipt-1',
      recipient: 'wa-contact-carlos',
      text: 'Approved WhatsApp message',
      now: T1,
      signal: signal(),
    });

    expect(result).toMatchObject({
      externalId: 'wa-contact-carlos/wa-message-runner-1',
      result: { chatId: 'wa-contact-carlos', messageId: 'wa-message-runner-1' },
    });
    expect(result.evidenceEventIds).toHaveLength(1);
    expect(store.getReceipt('wa-receipt-1')).toMatchObject({
      status: ReceiptStatus.Pending,
      startedAt: T1,
      verified: false,
    });
    expect(store.getEvent(result.evidenceEventIds[0])).toMatchObject({
      source: 'whatsapp',
      type: 'whatsapp.message.sent',
      payload: {
        missionId: 'wa-mission-v1',
        assignmentId: 'wa-assignment-1',
        receiptId: 'wa-receipt-1',
        destination: 'wa-contact-carlos',
      },
    });

    const verifier = new RoutedArtifactVerifier(store);
    await expect(verifier.verify({
      assignment: store.getAssignment('wa-assignment-1')!,
      mission: store.getMission('wa-mission-v1')!,
      task: store.getMissionTask('wa-task-1')!,
      artifact: { type: 'receipt', data: result.result },
      requirement: {
        type: 'receipt', description: 'Forged unrelated proof',
        verification: ['tests-pass'], requiredEvidence: ['source-code-report'],
      },
      signal: signal(),
    })).resolves.toEqual({ verified: false, checks: [], evidence: [] });

    const recoveryRunner = new MissionRunner(
      store,
      new RoutedAssignmentExecutor(store, { whatsapp: adapter }, { now: () => T1 }),
      verifier,
      { workerId: 'whatsapp-crash-recovery', leaseMs: 30_000, clock: () => T1 },
    );
    await expect(recoveryRunner.runNext()).resolves.toMatchObject({
      kind: 'checkpoint',
      reasons: [EscalationReason.UncertainExternalAction],
    });
    expect(transport.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('runs an approved WhatsApp send end-to-end with one durable receipt and event', async () => {
    const store = approvedWhatsAppStore(false);
    const transport = whatsappTransport();
    transport.sendMessage.mockResolvedValue({
      status: 200,
      chatId: 'wa-contact-carlos',
      messageId: 'wa-message-production-1',
    });
    const adapter = configuredAdapter(transport);
    const runner = new MissionRunner(
      store,
      new RoutedAssignmentExecutor(store, { whatsapp: adapter }, { now: () => T1 }),
      new RoutedArtifactVerifier(store),
      { workerId: 'whatsapp-production-runner', leaseMs: 30_000, clock: () => T1 },
    );

    await expect(runner.runNext()).resolves.toEqual({
      kind: 'completed', assignmentId: 'wa-assignment-1', reasons: [],
    });
    const receipt = store.getReceiptByIdempotencyKey('whatsapp-send-key');
    expect(receipt).toMatchObject({
      status: ReceiptStatus.Succeeded,
      verified: true,
      externalId: 'wa-contact-carlos/wa-message-production-1',
    });
    expect(receipt?.evidenceEventIds).toHaveLength(1);
    expect(store.getEvent(receipt!.evidenceEventIds[0])).toMatchObject({
      source: 'whatsapp',
      type: 'whatsapp.message.sent',
      status: LifecycleStatus.Succeeded,
    });
    expect(transport.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('rejects any send that differs from the approved recipient or exact text', async () => {
    const store = approvedWhatsAppStore();
    const transport = whatsappTransport();
    const adapter = configuredAdapter(transport);
    const missionPlanHash = store.getMission('wa-mission-v1')!.planHash;

    await expect(adapter.sendApproved(store, {
      assignmentId: 'wa-assignment-1', missionPlanHash, receiptId: 'wa-receipt-1',
      recipient: 'wa-contact-carlos', text: 'Edited after approval', now: T1, signal: signal(),
    })).rejects.toThrow(/approved|bound|receipt/i);
    await expect(adapter.sendApproved(store, {
      assignmentId: 'wa-assignment-1', missionPlanHash, receiptId: 'wa-receipt-1',
      recipient: 'wa-contact-paula', text: 'Approved WhatsApp message', now: T1, signal: signal(),
    })).rejects.toThrow(/approved|bound|receipt/i);

    expect(transport.sendMessage).not.toHaveBeenCalled();
    expect(store.getReceipt('wa-receipt-1')).toMatchObject({ status: ReceiptStatus.Pending });
    expect(store.getReceipt('wa-receipt-1')).not.toHaveProperty('startedAt');
  });

  it('redacts a failed send and leaves its started receipt uncertain instead of retrying', async () => {
    const store = approvedWhatsAppStore();
    const transport = whatsappTransport();
    transport.sendMessage.mockRejectedValue(
      new Error('gateway-secret appeared in a low-level transport failure'),
    );
    const adapter = configuredAdapter(transport);
    const input = {
      assignmentId: 'wa-assignment-1',
      missionPlanHash: store.getMission('wa-mission-v1')!.planHash,
      receiptId: 'wa-receipt-1', recipient: 'wa-contact-carlos',
      text: 'Approved WhatsApp message', now: T1, signal: signal(),
    };

    const error = await adapter.sendApproved(store, input).catch((cause) => cause);
    expect((error as Error).message).toMatch(/uncertain|unavailable/i);
    expect((error as Error).message).not.toContain('gateway-secret');
    await expect(adapter.sendApproved(store, input)).rejects.toThrow(/uncertain|resend/i);
    expect(transport.sendMessage).toHaveBeenCalledTimes(1);
    expect(store.getReceipt('wa-receipt-1')).toMatchObject({
      status: ReceiptStatus.Pending,
      startedAt: T1,
    });
  });
});

function whatsappTransport() {
  return {
    probe: vi.fn<WhatsAppGatewayTransport['probe']>(),
    fetchUpdates: vi.fn<WhatsAppGatewayTransport['fetchUpdates']>(),
    sendMessage: vi.fn<WhatsAppGatewayTransport['sendMessage']>(),
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    partition: 'primary',
    limit: 100,
    observedAt: T0,
    signal: signal(),
    ...overrides,
  };
}

function configuredAdapter(transport: ReturnType<typeof whatsappTransport>) {
  return new WhatsAppGatewayAdapter({
    gatewayUrl: 'https://hermes.internal',
    gatewayToken: 'gateway-secret',
    transport,
  });
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

function approvedWhatsAppStore(reserve = true): JerichoStore {
  const store = new JerichoStore({ path: ':memory:', key: KEY });
  stores.push(store);
  store.saveIntent(whatsAppIntent());
  store.registerAgentCapability(whatsAppCapability());
  const plan = createMissionPlan({
    id: 'wa-mission-v1', seriesId: 'wa-mission-series', version: 1,
    intentId: 'wa-intent-1', title: 'WhatsApp reply', objective: 'Send the approved reply',
    route: RouteType.HumanApproval, risk: RiskLevel.Low,
    deliverables: [{
      id: 'wa-send', description: 'WhatsApp message sent', artifactType: 'receipt', required: true,
    }],
    acceptanceTests: [{
      id: 'wa-receipt', description: 'Receipt verified', verification: 'automatic',
      requiredEvidence: ['delivery'],
    }],
    evidenceEventIds: [], contextSnapshotHash: 'b'.repeat(64),
    taskGraph: [{
      id: 'wa-task-1', kind: MissionTaskKind.Communicate, title: 'Send WhatsApp reply', sequence: 0,
      lane: AgentLane.Angela, selectedAgentId: 'Angela', capabilityIds: ['wa-cap-send'],
      requiredActions: ['send_message'], requiredTools: ['whatsapp.send'], model: 'local',
      maxTokens: 1_000, writableScope: whatsAppPermissions(), dependsOn: [], evidenceEventIds: [],
      expectedArtifact: {
        type: 'receipt', description: 'Delivery',
        verification: ['gateway-acknowledged', 'destination-matched', 'idempotency-bound'],
        requiredEvidence: ['destination-receipt'],
      },
      externalAction: {
        connectorId: 'whatsapp', action: 'send_message', destination: 'wa-contact-carlos',
        idempotencyKey: 'whatsapp-send-key', system: 'whatsapp', channel: 'whatsapp',
        recipient: 'wa-contact-carlos', tool: 'whatsapp.send',
        credentialRef: 'whatsapp-gateway', dataScope: 'whatsapp:selected',
        mutationClass: MutationClass.Reversible,
      },
      input: { text: 'Approved WhatsApp message' }, estimatedCostMicroUsd: 10,
      route: RouteType.Agent, risk: RiskLevel.Low,
    }],
    budget: {
      maxCostMicroUsd: 100, maxRuntimeMs: 60_000,
      maxConcurrency: 1, maxRetriesPerAssignment: 0,
    },
    permissions: whatsAppPermissions(),
    rollback: { strategy: 'delete message', steps: ['Delete'], verification: 'Confirm' },
    escalationConditions: Object.values(EscalationReason),
    provenance: waProvenance(),
  }, new CapabilityRegistry([whatsAppCapability()]), T0);
  store.createMissionPlan(plan);
  store.approveMission(plan.id, plan.planHash, whatsAppDecision());
  store.enqueueAssignment(whatsAppAssignment());
  if (reserve) store.reserveReceipt(whatsAppReceipt());
  return store;
}

function whatsAppIntent(): IntentEnvelope {
  return {
    id: 'wa-intent-1', source: 'test', sourceType: SourceType.User,
    kind: IntentKind.Command, summary: 'WhatsApp reply', payload: {},
    status: LifecycleStatus.Queued, route: IntentRoute.Reply, routeRuleId: 'test',
    entityIds: [], commitments: [], claims: [], assumptions: [], deadlines: [],
    affectedPartyIds: [], requiredEvidence: [], requiredCapabilities: ['send_message'],
    ambiguityReasons: [], contradictoryEvidenceEventIds: [], risk: RiskLevel.Low,
    confidence: 1, provenance: waProvenance(), createdAt: T0, updatedAt: T0,
  };
}

function whatsAppCapability(): AgentCapability {
  return {
    id: 'wa-cap-send', agentId: 'Angela', lane: AgentLane.Angela, name: 'WhatsApp send',
    status: LifecycleStatus.Active, routes: [RouteType.Agent],
    supportedActions: ['send_message'], tools: ['whatsapp.send'],
    modelPolicy: {
      allowedModels: ['local'], preferLocal: true, maxTokensPerAssignment: 2_000,
    },
    writableScope: whatsAppPermissions(), costClass: CostClass.Low,
    mayCreateAssignments: false, maximumRisk: RiskLevel.Medium, metadata: {},
    provenance: waProvenance(), createdAt: T0, updatedAt: T0,
  };
}

function whatsAppAssignment(): Assignment {
  return {
    id: 'wa-assignment-1', missionId: 'wa-mission-v1', missionTaskId: 'wa-task-1',
    agentId: 'Angela', capabilityIds: ['wa-cap-send'], status: LifecycleStatus.Queued,
    route: RouteType.Agent, risk: RiskLevel.Low,
    instructions: { text: 'Approved WhatsApp message' }, evidenceEventIds: [],
    expectedArtifact: {
      type: 'receipt', description: 'Delivery',
      verification: ['gateway-acknowledged', 'destination-matched', 'idempotency-bound'],
      requiredEvidence: ['destination-receipt'],
    },
    externalAction: {
      connectorId: 'whatsapp', action: 'send_message', destination: 'wa-contact-carlos',
      idempotencyKey: 'whatsapp-send-key', system: 'whatsapp', channel: 'whatsapp',
      recipient: 'wa-contact-carlos', tool: 'whatsapp.send',
      credentialRef: 'whatsapp-gateway', dataScope: 'whatsapp:selected',
      mutationClass: MutationClass.Reversible,
    },
    idempotencyKey: 'wa-assignment-key', attempt: 0, maxAttempts: 1,
    availableAt: T1, estimatedCostMicroUsd: 10, assignedAt: T1,
    provenance: waProvenance(T1),
  };
}

function whatsAppReceipt(): ActionReceipt {
  return {
    id: 'wa-receipt-1', assignmentId: 'wa-assignment-1', missionTaskId: 'wa-task-1',
    connectorId: 'whatsapp', action: 'send_message', idempotencyKey: 'whatsapp-send-key',
    destination: 'wa-contact-carlos', status: ReceiptStatus.Pending,
    route: RouteType.Connector, risk: RiskLevel.Low, requestedAt: T1, verified: false,
    evidenceEventIds: [], attempt: 1, provenance: waProvenance(T1),
  };
}

function whatsAppDecision(): DecisionRecord {
  return {
    id: 'wa-decision-1', missionId: 'wa-mission-v1', decidedBy: 'carlos',
    outcome: DecisionOutcome.Approved, rationale: 'Approved', assumptions: [],
    evidenceEventIds: [], route: RouteType.HumanApproval, risk: RiskLevel.Low,
    decidedAt: T1, provenance: waProvenance(T1),
  };
}

function whatsAppPermissions() {
  return {
    allowedTools: ['whatsapp.send'], allowedSystems: ['whatsapp'],
    allowedRepositories: [], allowedChannels: ['whatsapp'],
    allowedRecipients: ['wa-contact-carlos'], allowedCredentialRefs: ['whatsapp-gateway'],
    allowedDataScopes: ['whatsapp:selected'],
    allowedMutationClasses: [MutationClass.ReadOnly, MutationClass.Reversible],
  };
}

function waProvenance(at = T0) {
  return [{ source: 'test', sourceType: SourceType.System, observedAt: at }];
}
