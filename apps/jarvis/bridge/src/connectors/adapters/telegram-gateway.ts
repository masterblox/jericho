import {
  ConnectorHealthStatus,
  EntityType,
  LifecycleStatus,
  ReceiptStatus,
  RelationType,
  type ActionReceipt,
  type NormalizedCapture,
} from '@jericho/shared';

import type { JerichoStore } from '../../core/store.js';
import {
  ConnectorUnauthorizedError,
  ConnectorUnavailableError,
  type CaptureConnector,
  type ConnectorCapturePage,
  type ConnectorCaptureRequest,
  type ConnectorProbe,
} from '../contracts.js';
import { stableConnectorEvent } from '../normalization.js';

export interface TelegramGatewayUpdate {
  epoch: number;
  sequence: number;
  updateId: string;
  occurredAt: string;
  chat: { id: string; title?: string };
  sender?: { id: string; displayName?: string };
  message: { id: string; text: string };
}

export interface TelegramGatewayTransport {
  fetchUpdates(input: {
    gatewayUrl: string;
    gatewayToken: string;
    partition: string;
    epoch?: number;
    sequence?: number;
    pageToken?: string;
    limit: number;
    signal: AbortSignal;
  }): Promise<{
    status: number;
    updates: TelegramGatewayUpdate[];
    nextPageToken?: string;
    hasMore: boolean;
  }>;
  sendMessage(input: {
    gatewayUrl: string;
    gatewayToken: string;
    recipient: string;
    text: string;
    idempotencyKey: string;
    signal: AbortSignal;
  }): Promise<{ status: number; chatId?: string; messageId?: string }>;
}

export interface TelegramGatewayAdapterOptions {
  gatewayUrl?: string;
  gatewayToken?: string;
  transport: TelegramGatewayTransport;
}

export interface ApprovedTelegramSend {
  assignmentId: string;
  missionPlanHash: string;
  receiptId: string;
  recipient: string;
  text: string;
  now: string;
  signal: AbortSignal;
}

export class TelegramGatewayAdapter implements CaptureConnector {
  readonly descriptor = {
    id: 'telegram',
    adapterVersion: 1,
    cursorSchemaVersion: 1,
    partitions: ['primary'],
    maxBatchSize: 100,
  };

  constructor(private readonly options: TelegramGatewayAdapterOptions) {}

  async probe(_signal: AbortSignal): Promise<ConnectorProbe> {
    if (this.configured) {
      return { status: ConnectorHealthStatus.Healthy, details: { owner: 'hermes-gateway' } };
    }
    return { status: ConnectorHealthStatus.Unavailable, details: { reason: 'missing_gateway_config' } };
  }

  async capture(request: ConnectorCaptureRequest): Promise<ConnectorCapturePage> {
    this.assertConfigured();
    const response = await this.options.transport.fetchUpdates({
      gatewayUrl: this.options.gatewayUrl!,
      gatewayToken: this.options.gatewayToken!,
      partition: request.partition,
      ...(request.cursor ? {
        epoch: request.cursor.epoch,
        sequence: request.cursor.sequence,
        ...(request.cursor.pageToken ? { pageToken: request.cursor.pageToken } : {}),
      } : {}),
      limit: request.limit,
      signal: request.signal,
    });
    if (response.status === 401) throw new ConnectorUnauthorizedError('Telegram gateway unauthorized');
    if (response.status < 200 || response.status >= 300) {
      throw new ConnectorUnavailableError(`Telegram gateway returned ${response.status}`);
    }
    const captures = response.updates.map(normalizeTelegramUpdate);
    const last = response.updates.at(-1);
    return {
      captures,
      failures: [],
      progress: {
        epoch: last?.epoch ?? request.cursor?.epoch ?? 0,
        sequence: last?.sequence ?? request.cursor?.sequence ?? 0,
        ...(response.nextPageToken ? { pageToken: response.nextPageToken } : {}),
      },
      hasMore: response.hasMore,
    };
  }

  async sendApproved(store: JerichoStore, input: ApprovedTelegramSend): Promise<ActionReceipt> {
    this.assertConfigured();
    const assignment = store.getAssignment(input.assignmentId);
    const mission = assignment ? store.getMission(assignment.missionId) : undefined;
    const receipt = store.getReceipt(input.receiptId);
    if (
      !assignment || !mission ||
      (mission.status !== LifecycleStatus.Approved && mission.status !== LifecycleStatus.Active) ||
      mission.planHash !== input.missionPlanHash ||
      assignment.externalAction?.connectorId !== this.descriptor.id ||
      assignment.externalAction.recipient !== input.recipient ||
      assignment.externalAction.destination !== input.recipient ||
      !receipt ||
      receipt.assignmentId !== assignment.id ||
      receipt.missionTaskId !== assignment.missionTaskId ||
      receipt.connectorId !== this.descriptor.id ||
      receipt.destination !== input.recipient ||
      receipt.idempotencyKey !== assignment.externalAction.idempotencyKey
    ) {
      throw new Error('Telegram outbox action is not bound to the approved mission and receipt');
    }
    if (receipt.status === ReceiptStatus.Succeeded && receipt.verified) return receipt;
    if (receipt.status !== ReceiptStatus.Pending || receipt.startedAt) {
      throw new Error('Telegram outbox receipt is uncertain; refusing to resend');
    }

    store.startReceipt(receipt.id, input.now);
    const response = await this.options.transport.sendMessage({
      gatewayUrl: this.options.gatewayUrl!,
      gatewayToken: this.options.gatewayToken!,
      recipient: input.recipient,
      text: input.text,
      idempotencyKey: receipt.idempotencyKey,
      signal: input.signal,
    });
    if (response.status === 401) throw new ConnectorUnauthorizedError('Telegram gateway unauthorized');
    if (
      response.status < 200 || response.status >= 300 ||
      response.chatId !== input.recipient ||
      !response.messageId
    ) {
      throw new Error('Telegram gateway result is uncertain or mismatched');
    }
    return store.completeReceipt(receipt.id, {
      status: ReceiptStatus.Succeeded,
      externalId: `${response.chatId}/${response.messageId}`,
      result: { chatId: response.chatId, messageId: response.messageId },
      verified: true,
      verifiedAt: input.now,
      completedAt: input.now,
      evidenceEventIds: [`telegram:${response.chatId}/${response.messageId}`],
    });
  }

  private get configured(): boolean {
    return Boolean(this.options.gatewayUrl && this.options.gatewayToken);
  }

  private assertConfigured(): void {
    if (!this.configured) {
      throw new ConnectorUnavailableError('Telegram Hermes gateway config is unavailable');
    }
  }
}

function normalizeTelegramUpdate(update: TelegramGatewayUpdate): NormalizedCapture {
  const sourceEventId = `${update.epoch}:${update.sequence}:${update.updateId}`;
  const event = stableConnectorEvent({
    source: 'telegram',
    sourceEventId,
    type: 'telegram.message',
    occurredAt: update.occurredAt,
    payload: {
      chatId: update.chat.id,
      messageId: update.message.id,
      text: update.message.text,
    },
  });
  const identities: NormalizedCapture['identities'] = [{
    connectorId: 'telegram',
    namespace: 'conversation',
    externalId: update.chat.id,
    entityType: EntityType.Conversation,
    ...(update.chat.title ? { displayName: update.chat.title } : {}),
    attributes: {},
    observedAt: update.occurredAt,
    confidence: 1,
    evidenceEventId: event.id,
  }];
  if (update.sender) {
    identities.unshift({
      connectorId: 'telegram',
      namespace: 'user',
      externalId: update.sender.id,
      entityType: EntityType.Person,
      ...(update.sender.displayName ? { displayName: update.sender.displayName } : {}),
      attributes: {},
      observedAt: update.occurredAt,
      confidence: 1,
      evidenceEventId: event.id,
    });
  }
  return {
    event,
    identities,
    relations: update.sender ? [{
      from: { connectorId: 'telegram', namespace: 'user', externalId: update.sender.id },
      to: { connectorId: 'telegram', namespace: 'conversation', externalId: update.chat.id },
      type: RelationType.MemberOf,
      attributes: { role: 'sender' },
      observedAt: update.occurredAt,
      evidenceEventId: event.id,
    }] : [],
  };
}
