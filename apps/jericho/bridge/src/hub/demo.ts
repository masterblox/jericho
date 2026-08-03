import { createHash } from 'node:crypto';

import type {
  HubBootAnnouncementPlan,
  HubDemoStream,
  HubSealedDemoSnapshot,
  HubWalkthroughEvent,
} from '@jericho/shared';

/** Seal a demo snapshot. DEMO must never construct live providers. */
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
  return {
    demoId: input.demoId,
    sealedAt: input.sealedAt,
    contentHash: createHash('sha256').update(canonical).digest('hex'),
    label: input.label,
    payload: { ...input.payload },
  };
}

/** Three sealed walkthrough streams: competitor, deploy-fix, morning-brief. */
export function buildWalkthroughStreams(
  startedAt: string,
): Record<HubDemoStream, HubWalkthroughEvent[]> {
  return {
    competitor: [
      event('competitor', 0, startedAt, 'open', 'Competitor scan narration armed', {
        sanitized: true,
      }),
      event('competitor', 1, offset(startedAt, 1_000), 'signal', 'Placeholder competitive signal', {
        rank: 1,
      }),
      event('competitor', 2, offset(startedAt, 2_000), 'close', 'Competitor walkthrough complete', {
        ready: true,
      }),
    ],
    deploy_fix: [
      event('deploy_fix', 0, startedAt, 'detect', 'Deploy regression placeholder', {
        sanitized: true,
      }),
      event('deploy_fix', 1, offset(startedAt, 1_500), 'route', 'Routed to DEV capability', {
        agent: 'DEV',
      }),
      event('deploy_fix', 2, offset(startedAt, 3_000), 'confirm', 'Confirmation gate shown', {
        gated: true,
      }),
    ],
    morning_brief: [
      event('morning_brief', 0, startedAt, 'window', '72-hour brief window opened', {
        windowHours: 72,
      }),
      event('morning_brief', 1, offset(startedAt, 2_000), 'totals', 'Sanitized totals prepared', {
        agents: 5,
      }),
      event('morning_brief', 2, offset(startedAt, 4_000), 'ready', 'Morning brief complete', {
        ready: true,
      }),
    ],
  };
}

/** Idempotent Telegram boot-announcement plan — never a live send. */
export function buildBootAnnouncementPlan(input: {
  bootId: string;
  createdAt: string;
  totals: { activeAgents: number; queuedTasks: number; opportunities: number };
}): HubBootAnnouncementPlan {
  const idempotencyKey = `boot-announce:${input.bootId}`;
  const text = [
    'Jericho Hub online.',
    `Agents ${input.totals.activeAgents}.`,
    `Queued ${input.totals.queuedTasks}.`,
    `Opportunities ${input.totals.opportunities}.`,
  ].join(' ');
  return {
    bootId: input.bootId,
    idempotencyKey,
    channel: 'telegram',
    text,
    totals: { ...input.totals },
    createdAt: input.createdAt,
  };
}

function event(
  stream: HubDemoStream,
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
  for (const key of Object.keys(payload).sort()) sorted[key] = payload[key]!;
  return sorted;
}
