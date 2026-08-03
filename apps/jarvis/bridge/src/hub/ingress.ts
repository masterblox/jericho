import {
  HubIngressPort,
  type HubIngressMessage,
} from '@jericho/shared';

export interface HubIngressTransport {
  /** Decode Telegram voice into plaintext. Injected; never live. */
  transcribeVoice?(audioRef: string): Promise<string>;
  /** Decode a QR payload into plaintext. Injected; never live. */
  decodeQr?(payload: string): Promise<string>;
}

export interface AcceptIngressInput {
  id: string;
  port: HubIngressPort;
  receivedAt: string;
  /** Pre-decoded text for telegram_text, or raw voice/QR reference. */
  body: string;
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Normalize Telegram voice/text and QR ingress into a Hub message.
 * Transport adapters are injected fakes only.
 */
export async function acceptHubIngress(
  input: AcceptIngressInput,
  transport: HubIngressTransport = {},
): Promise<HubIngressMessage> {
  let text: string;
  switch (input.port) {
    case HubIngressPort.TelegramText:
      text = input.body.trim();
      break;
    case HubIngressPort.TelegramVoice: {
      if (!transport.transcribeVoice) {
        throw new Error('Telegram voice ingress requires an injected transcribeVoice transport');
      }
      text = (await transport.transcribeVoice(input.body)).trim();
      break;
    }
    case HubIngressPort.Qr: {
      if (!transport.decodeQr) {
        throw new Error('QR ingress requires an injected decodeQr transport');
      }
      text = (await transport.decodeQr(input.body)).trim();
      break;
    }
    default:
      throw new Error(`Unsupported Hub ingress port: ${String(input.port)}`);
  }

  if (!text) {
    throw new Error('Hub ingress produced empty text');
  }

  return {
    id: input.id,
    port: input.port,
    receivedAt: input.receivedAt,
    text,
    metadata: { ...(input.metadata ?? {}) },
  };
}

export const HUB_INGRESS_PORTS: readonly HubIngressPort[] = [
  HubIngressPort.TelegramVoice,
  HubIngressPort.TelegramText,
  HubIngressPort.Qr,
];
