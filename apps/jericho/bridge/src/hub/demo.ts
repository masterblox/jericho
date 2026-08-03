import { createHash } from 'node:crypto';

import {
  HubWalkthroughStream,
  type HubSealedDemoSnapshot,
  type HubWalkthroughEvent,
} from '@jericho/shared';

/**
 * Seal a demo snapshot with a content-addressed SHA-256 hash.
 * Sealing is pure and side-effect free.
 */
export function sealHubDemoSnapshot(input: {
  demoId: string;
  sealedAt: string;
  label: string;
  payload: Record<string, string | number | boolean | null>;
}): HubSealedDemoSnapshot {
  const canonical = JSON.stringify({
    demoId: input.demoId,
    label: input.label,
    payload: sortKeys(input.payload),
  });
  const contentHash = createHash('sha256').update(canonical).digest('hex');
  return {
    demoId: input.demoId,
    sealedAt: input.sealedAt,
    contentHash,
    label: input.label,
    payload: { ...input.payload },
  };
}

/**
 * Build the three sealed walkthrough event streams: command, fleet, and brief.
 */
export function buildWalkthroughStreams(
  startedAt: string,
): Record<HubWalkthroughStream, HubWalkthroughEvent[]> {
  return {
    [HubWalkthroughStream.Command]: [
      event(HubWalkthroughStream.Command, 0, startedAt, 'ingress', 'Command walkthrough armed', {
        port: 'telegram_text',
      }),
      event(HubWalkthroughStream.Command, 1, offset(startedAt, 1_000), 'classify', 'Command classified as TASK', {
        kind: 'TASK',
      }),
      event(HubWalkthroughStream.Command, 2, offset(startedAt, 2_000), 'confirm', 'Awaiting confirmation gate', {
        gated: true,
      }),
    ],
    [HubWalkthroughStream.Fleet]: [
      event(HubWalkthroughStream.Fleet, 0, startedAt, 'heartbeat', 'Fleet heartbeats projected', {
        agents: 5,
      }),
      event(HubWalkthroughStream.Fleet, 1, offset(startedAt, 1_500), 'route', 'Capability route selected', {
        capability: 'DEV',
      }),
      event(HubWalkthroughStream.Fleet, 2, offset(startedAt, 3_000), 'dispatch', 'Confirmation-gated dispatch ready', {
        status: 'awaiting_confirmation',
      }),
    ],
    [HubWalkthroughStream.Brief]: [
      event(HubWalkthroughStream.Brief, 0, startedAt, 'window', '72-hour aggregation window opened', {
        windowHours: 72,
      }),
      event(HubWalkthroughStream.Brief, 1, offset(startedAt, 2_000), 'aggregate', 'Signals collected for brief', {
        categories: 6,
      }),
      event(HubWalkthroughStream.Brief, 2, offset(startedAt, 4_000), 'ready', 'Brief walkthrough complete', {
        ready: true,
      }),
    ],
  };
}

function event(
  stream: HubWalkthroughStream,
  sequence: number,
  at: string,
  kind: string,
  message: string,
  data: Record<string, string | number | boolean | null>,
): HubWalkthroughEvent {
  return { stream, sequence, at, kind, message, data };
}

function offset(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function sortKeys(
  payload: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> {
  const sorted: Record<string, string | number | boolean | null> = {};
  for (const key of Object.keys(payload).sort()) {
    sorted[key] = payload[key]!;
  }
  return sorted;
}
