import {
  ConnectorHealthStatus,
  EntityType,
  MutationClass,
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
import {
  appendConnectorDeliveryEvent,
  validateApprovedConnectorSend,
  type ApprovedConnectorExecutionResult,
  type ApprovedConnectorSendInput,
} from '../../orchestration/connector-action-executor.js';

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

export interface ApprovedTelegramSend extends ApprovedConnectorSendInput {}

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
    const { receipt } = validateApprovedConnectorSend(store, input, TELEGRAM_BINDING);
    if (receipt.status === ReceiptStatus.Succeeded && receipt.verified) return receipt;
    const executed = await this.executeApproved(store, input);
    return store.completeReceipt(receipt.id, {
      status: ReceiptStatus.Succeeded,
      externalId: executed.externalId,
      result: executed.result,
      verified: true,
      verifiedAt: input.now,
      completedAt: input.now,
      evidenceEventIds: executed.evidenceEventIds,
    });
  }

  async executeApproved(
    store: JerichoStore,
    input: ApprovedTelegramSend,
  ): Promise<ApprovedConnectorExecutionResult> {
    this.assertConfigured();
    input.signal.throwIfAborted();
    const bound = validateApprovedConnectorSend(store, input, TELEGRAM_BINDING);
    const { receipt } = bound;
    if (receipt.status !== ReceiptStatus.Pending || receipt.startedAt) {
      throw new Error('Telegram outbox receipt is uncertain; refusing to resend');
    }
    store.startReceipt(receipt.id, input.now);
    let response: Awaited<ReturnType<TelegramGatewayTransport['sendMessage']>>;
    try {
      response = await this.options.transport.sendMessage({
        gatewayUrl: this.options.gatewayUrl!,
        gatewayToken: this.options.gatewayToken!,
        recipient: input.recipient,
        text: input.text,
        idempotencyKey: receipt.idempotencyKey,
        signal: input.signal,
      });
    } catch (error) {
      if (input.signal.aborted || isAbortError(error)) throw error;
      throw new Error('Telegram gateway send is uncertain');
    }
    if (response.status === 401 || response.status === 403) {
      throw new ConnectorUnauthorizedError('Telegram gateway unauthorized');
    }
    if (
      response.status < 200 || response.status >= 300 ||
      response.chatId !== input.recipient ||
      !response.messageId
    ) {
      throw new Error('Telegram gateway result is uncertain or mismatched');
    }
    const result = { chatId: response.chatId, messageId: response.messageId };
    const externalId = `${response.chatId}/${response.messageId}`;
    const event = appendConnectorDeliveryEvent(store, {
      connectorId: this.descriptor.id,
      ...bound,
      recipient: input.recipient,
      text: input.text,
      externalId,
      result,
      occurredAt: input.now,
    });
    return { externalId, result, evidenceEventIds: [event.id] };
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

const TELEGRAM_BINDING = {
  connectorId: 'telegram',
  action: 'send_message',
  system: 'telegram',
  channel: 'telegram',
  tool: 'telegram.send',
  credentialRef: 'telegram-gateway',
  dataScope: 'telegram:selected',
  mutationClass: MutationClass.Reversible,
} as const;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
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
