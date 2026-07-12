import {
  ConnectorHealthStatus,
  EntityType,
  MutationClass,
  ReceiptStatus,
  RelationType,
  type ActionReceipt,
  type JsonObject,
  type NormalizedCapture,
} from '@jericho/shared';

import {
  ConnectorUnauthorizedError,
  ConnectorUnavailableError,
  type CaptureConnector,
  type ConnectorCapturePage,
  type ConnectorCaptureRequest,
  type ConnectorProbe,
} from '../contracts.js';
import { stableConnectorEvent } from '../normalization.js';
import type { JerichoStore } from '../../core/store.js';
import {
  appendConnectorDeliveryEvent,
  validateApprovedConnectorSend,
  type ApprovedConnectorExecutionResult,
  type ApprovedConnectorSendInput,
} from '../../orchestration/connector-action-executor.js';

export interface WhatsAppMediaReference {
  reference: string;
  mimeType?: string;
  fileName?: string;
  sha256?: string;
  sizeBytes?: number;
}

export interface WhatsAppGatewayUpdate {
  epoch: number;
  sequence: number;
  updateId: string;
  occurredAt: string;
  kind: 'message.created' | 'message.edited' | 'message.deleted' | 'message.status';
  chat: { id: string; title?: string };
  contact?: { id: string; displayName?: string };
  message: {
    id: string;
    text?: string;
    media?: WhatsAppMediaReference[];
    editedAt?: string;
    deletedFor?: string;
    status?: string;
    statusAt?: string;
  };
}

export interface WhatsAppGatewayTransport {
  probe(input: {
    gatewayUrl: string;
    gatewayToken: string;
    signal: AbortSignal;
  }): Promise<{ status: number }>;
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
    updates: WhatsAppGatewayUpdate[];
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

export interface WhatsAppGatewayAdapterOptions {
  gatewayUrl?: string;
  gatewayToken?: string;
  transport: WhatsAppGatewayTransport;
}

export interface ApprovedWhatsAppSend extends ApprovedConnectorSendInput {}

export class WhatsAppGatewayAdapter implements CaptureConnector {
  readonly descriptor = {
    id: 'whatsapp',
    adapterVersion: 1,
    cursorSchemaVersion: 1,
    partitions: ['primary'],
    maxBatchSize: 100,
  };

  constructor(private readonly options: WhatsAppGatewayAdapterOptions) {}

  async probe(signal: AbortSignal): Promise<ConnectorProbe> {
    if (!this.options.gatewayUrl && !this.options.gatewayToken) {
      return {
        status: ConnectorHealthStatus.Disabled,
        details: { reason: 'not_configured' },
      };
    }
    if (!this.configured) {
      return {
        status: ConnectorHealthStatus.Unavailable,
        details: { reason: 'incomplete_gateway_config' },
      };
    }
    signal.throwIfAborted();
    try {
      const response = await this.options.transport.probe({
        gatewayUrl: this.options.gatewayUrl!,
        gatewayToken: this.options.gatewayToken!,
        signal,
      });
      if (response.status >= 200 && response.status < 300) {
        return {
          status: ConnectorHealthStatus.Healthy,
          details: { owner: 'hermes-gateway' },
        };
      }
      if (response.status === 401 || response.status === 403) {
        return {
          status: ConnectorHealthStatus.Unauthorized,
          details: { reason: 'unauthorized' },
        };
      }
      return {
        status: ConnectorHealthStatus.Unavailable,
        details: { reason: 'gateway_unavailable', status: response.status },
      };
    } catch (error) {
      if (signal.aborted || isAbortError(error)) throw error;
      return {
        status: ConnectorHealthStatus.Unavailable,
        details: { reason: 'gateway_unreachable' },
      };
    }
  }

  async capture(request: ConnectorCaptureRequest): Promise<ConnectorCapturePage> {
    this.assertConfigured();
    request.signal.throwIfAborted();
    let response: Awaited<ReturnType<WhatsAppGatewayTransport['fetchUpdates']>>;
    try {
      response = await this.options.transport.fetchUpdates({
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
    } catch (error) {
      if (request.signal.aborted || isAbortError(error)) throw error;
      throw new ConnectorUnavailableError('WhatsApp gateway unavailable');
    }
    if (response.status === 401 || response.status === 403) {
      throw new ConnectorUnauthorizedError('WhatsApp gateway unauthorized');
    }
    if (response.status < 200 || response.status >= 300) {
      throw new ConnectorUnavailableError(`WhatsApp gateway returned ${response.status}`);
    }
    if (response.hasMore && !response.nextPageToken?.trim()) {
      throw new Error('WhatsApp gateway continuation page is missing its opaque token');
    }
    assertNonRegressivePage(response.updates, request);
    const captures: NormalizedCapture[] = response.updates.map(normalizeWhatsAppUpdate);
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

  async sendApproved(store: JerichoStore, input: ApprovedWhatsAppSend): Promise<ActionReceipt> {
    this.assertConfigured();
    input.signal.throwIfAborted();
    const { receipt } = validateApprovedConnectorSend(store, input, WHATSAPP_BINDING);
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
    input: ApprovedWhatsAppSend,
  ): Promise<ApprovedConnectorExecutionResult> {
    this.assertConfigured();
    input.signal.throwIfAborted();
    const bound = validateApprovedConnectorSend(store, input, WHATSAPP_BINDING);
    const { receipt } = bound;
    if (receipt.status !== ReceiptStatus.Pending || receipt.startedAt) {
      throw new Error('WhatsApp outbox receipt is uncertain; refusing to resend');
    }

    store.startReceipt(receipt.id, input.now);
    let response: Awaited<ReturnType<WhatsAppGatewayTransport['sendMessage']>>;
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
      throw new Error('WhatsApp gateway send is uncertain');
    }
    if (response.status === 401 || response.status === 403) {
      throw new ConnectorUnauthorizedError('WhatsApp gateway unauthorized');
    }
    if (
      response.status < 200 || response.status >= 300 ||
      response.chatId !== input.recipient ||
      !response.messageId
    ) {
      throw new Error('WhatsApp gateway result is uncertain or mismatched');
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
      throw new ConnectorUnavailableError('WhatsApp Hermes gateway config is unavailable');
    }
  }
}

const WHATSAPP_BINDING = {
  connectorId: 'whatsapp',
  action: 'send_message',
  system: 'whatsapp',
  channel: 'whatsapp',
  tool: 'whatsapp.send',
  credentialRef: 'whatsapp-gateway',
  dataScope: 'whatsapp:selected',
  mutationClass: MutationClass.Reversible,
} as const;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function assertNonRegressivePage(
  updates: readonly WhatsAppGatewayUpdate[],
  request: ConnectorCaptureRequest,
): void {
  let epoch = request.cursor?.epoch ?? 0;
  let sequence = request.cursor?.sequence ?? 0;
  for (const update of updates) {
    if (
      !Number.isSafeInteger(update.epoch) || update.epoch < 0 ||
      !Number.isSafeInteger(update.sequence) || update.sequence < 0
    ) {
      throw new Error('WhatsApp gateway returned an invalid cursor position');
    }
    if (update.epoch < epoch || (update.epoch === epoch && update.sequence < sequence)) {
      throw new Error('WhatsApp gateway page would regress the durable cursor');
    }
    epoch = update.epoch;
    sequence = update.sequence;
  }
}

function normalizeWhatsAppUpdate(update: WhatsAppGatewayUpdate): NormalizedCapture {
  const sourceEventId = `${update.epoch}:${update.sequence}:${update.updateId}`;
  const media: JsonObject[] = (update.message.media ?? []).map((item) => ({
    reference: item.reference,
    ...(item.mimeType !== undefined ? { mimeType: item.mimeType } : {}),
    ...(item.fileName !== undefined ? { fileName: item.fileName } : {}),
    ...(item.sha256 !== undefined ? { sha256: item.sha256 } : {}),
    ...(item.sizeBytes !== undefined ? { sizeBytes: item.sizeBytes } : {}),
  }));
  const payload: JsonObject = {
    chatId: update.chat.id,
    messageId: update.message.id,
    ...(update.message.text !== undefined ? { text: update.message.text } : {}),
    ...(media.length > 0 ? { media } : {}),
    ...(update.message.editedAt !== undefined ? { editedAt: update.message.editedAt } : {}),
    ...(update.message.deletedFor !== undefined ? { deletedFor: update.message.deletedFor } : {}),
    ...(update.message.status !== undefined ? { status: update.message.status } : {}),
    ...(update.message.statusAt !== undefined ? { statusAt: update.message.statusAt } : {}),
  };
  const event = stableConnectorEvent({
    source: 'whatsapp',
    sourceEventId,
    type: `whatsapp.${update.kind}`,
    occurredAt: update.occurredAt,
    payload,
  });
  const identities: NormalizedCapture['identities'] = [{
    connectorId: 'whatsapp',
    namespace: 'chat',
    externalId: update.chat.id,
    entityType: EntityType.Conversation,
    ...(update.chat.title ? { displayName: update.chat.title } : {}),
    attributes: {},
    observedAt: update.occurredAt,
    confidence: 1,
    evidenceEventId: event.id,
  }];
  if (update.contact) {
    identities.unshift({
      connectorId: 'whatsapp',
      namespace: 'contact',
      externalId: update.contact.id,
      entityType: EntityType.Person,
      ...(update.contact.displayName ? { displayName: update.contact.displayName } : {}),
      attributes: {},
      observedAt: update.occurredAt,
      confidence: 1,
      evidenceEventId: event.id,
    });
  }
  return {
    event,
    identities,
    relations: update.contact ? [{
      from: {
        connectorId: 'whatsapp',
        namespace: 'contact',
        externalId: update.contact.id,
      },
      to: {
        connectorId: 'whatsapp',
        namespace: 'chat',
        externalId: update.chat.id,
      },
      type: RelationType.MemberOf,
      attributes: { role: 'sender' },
      observedAt: update.occurredAt,
      evidenceEventId: event.id,
    }] : [],
  };
}
