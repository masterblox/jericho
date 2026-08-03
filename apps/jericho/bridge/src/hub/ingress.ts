import type { HubCommand, HubCommandSource } from '@jericho/shared';

export interface HubIngressTransport {
  transcribeVoice?(audioRef: string): Promise<string>;
  decodeQr?(payload: string): Promise<string>;
}

export interface AcceptHubCommandInput {
  id: string;
  idempotencyKey: string;
  receivedAt: string;
  source: HubCommandSource;
  body: string;
  transportId: string;
  actorIdHash?: string;
}

/** Normalize Telegram voice/text, QR text, and desktop text into HubCommand. */
export async function acceptHubCommand(
  input: AcceptHubCommandInput,
  transport: HubIngressTransport = {},
): Promise<HubCommand> {
  let text: string;
  switch (input.source) {
    case 'telegram_text':
    case 'desktop_text':
      text = input.body.trim();
      break;
    case 'telegram_voice':
      if (!transport.transcribeVoice) {
        throw new Error('telegram_voice requires an injected transcribeVoice transport');
      }
      text = (await transport.transcribeVoice(input.body)).trim();
      break;
    case 'qr_text':
      if (!transport.decodeQr) {
        throw new Error('qr_text requires an injected decodeQr transport');
      }
      text = (await transport.decodeQr(input.body)).trim();
      break;
    default:
      throw new Error(`Unsupported Hub command source: ${String(input.source)}`);
  }
  if (!text) throw new Error('Hub ingress produced empty text');

  return {
    schemaVersion: 1,
    id: input.id,
    idempotencyKey: input.idempotencyKey,
    receivedAt: input.receivedAt,
    source: input.source,
    text,
    provenance: {
      transportId: input.transportId,
      ...(input.actorIdHash ? { actorIdHash: input.actorIdHash } : {}),
    },
  };
}

export const HUB_COMMAND_SOURCES: readonly HubCommandSource[] = [
  'telegram_voice',
  'telegram_text',
  'qr_text',
  'desktop_text',
];
