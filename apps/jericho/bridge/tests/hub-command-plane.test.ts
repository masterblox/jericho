import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  assertHubEvent,
  assertHubSnapshot,
  HUB_AGGREGATION_WINDOW_MS,
  type HubContextItem,
} from '@jericho/shared';

import {
  aggregateHubWindow,
  buildBootAnnouncementPlan,
  buildWalkthroughStreams,
  classifyHubIntent,
  createTokenDispatchGate,
  emptyAggregationSources,
  HubCommandPlane,
  HubDispatcher,
  planHubDispatch,
  probeHubWhisper,
  sealHubDemoSnapshot,
  acceptHubCommand,
  HUB_CAPABILITY_REGISTRY,
} from '../src/hub/index.js';

const NOW = '2026-08-03T12:00:00.000Z';

describe('hub intent classification', () => {
  it.each([
    ['Ship the Linear fix tonight', 'TASK'],
    ['What is the status of PR 16?', 'QUERY'],
    ['Create workspace for the vault gateway', 'CREATE'],
    ['Give me a brief of the last 72 hours', 'BRIEF'],
    ['Enter demo mode for the client', 'DEMO'],
  ] as const)('classifies %s as %s', (text, intent) => {
    expect(classifyHubIntent(text).intent).toBe(intent);
  });

  it('holds ambiguous text at low confidence', () => {
    expect(classifyHubIntent('hmm maybe later').confidence).toBeLessThan(0.65);
  });
});

describe('hub capability routing', () => {
  it('registers five agent capabilities', () => {
    expect(HUB_CAPABILITY_REGISTRY.map((item) => item.agentId)).toEqual([
      'DEV',
      'DONALD',
      'PA',
      'IRIS',
      'JERICHO',
    ]);
  });

  it.each([
    ['implement the bridge fix', 'DEV'],
    ['extract opportunity from the lead', 'DONALD'],
    ['schedule my calendar for tomorrow', 'PA'],
    ['research competitive intel report', 'IRIS'],
    ['prepare the morning brief', 'JERICHO'],
  ] as const)('routes "%s" toward %s', (text, agent) => {
    const classification = classifyHubIntent(text);
    expect(planHubDispatch('cmd-1', classification, text).targetAgent).toBe(agent);
  });

  it('requires confirmation for TASK and CREATE mutations', () => {
    const task = planHubDispatch('c1', classifyHubIntent('fix the deploy regression'));
    const create = planHubDispatch('c2', classifyHubIntent('Create workspace for research'));
    expect(task.requiresConfirmation).toBe(true);
    expect(create.requiresConfirmation).toBe(true);
    expect(task.status).toBe('pending_approval');
  });
});

describe('hub ingress ports', () => {
  it('accepts all four sources through injected transports', async () => {
    const text = await acceptHubCommand({
      id: '1',
      idempotencyKey: 'k1',
      receivedAt: NOW,
      source: 'telegram_text',
      body: ' status please ',
      transportId: 'tg-1',
    });
    expect(text.text).toBe('status please');

    const voice = await acceptHubCommand(
      {
        id: '2',
        idempotencyKey: 'k2',
        receivedAt: NOW,
        source: 'telegram_voice',
        body: 'audio://1',
        transportId: 'tg-2',
      },
      { transcribeVoice: async () => 'implement github fix' },
    );
    expect(voice.text).toBe('implement github fix');

    const qr = await acceptHubCommand(
      {
        id: '3',
        idempotencyKey: 'k3',
        receivedAt: NOW,
        source: 'qr_text',
        body: 'raw',
        transportId: 'qr-1',
      },
      { decodeQr: async () => 'show me opportunities' },
    );
    expect(qr.source).toBe('qr_text');

    const desktop = await acceptHubCommand({
      id: '4',
      idempotencyKey: 'k4',
      receivedAt: NOW,
      source: 'desktop_text',
      body: 'brief me',
      transportId: 'desk-1',
    });
    expect(desktop.source).toBe('desktop_text');
  });
});

describe('hub whisper probe', () => {
  it('prefers local then configured API fallback', async () => {
    const local = await probeHubWhisper({
      local: { probe: async () => ({ available: true, detail: 'local ok' }) },
      apiFallback: { configured: true, detail: 'api' },
      now: () => NOW,
    });
    expect(local.backend).toBe('local');

    const fallback = await probeHubWhisper({
      local: { probe: async () => ({ available: false, detail: 'missing' }) },
      apiFallback: { configured: true, detail: 'api ready' },
      now: () => NOW,
    });
    expect(fallback.backend).toBe('api_fallback');
  });
});

describe('hub confirmation-gated idempotent dispatch', () => {
  it('dispatches once after confirmation and replays duplicates', () => {
    const dispatcher = new HubDispatcher(createTokenDispatchGate('yes'), () => NOW);
    const plan = planHubDispatch('cmd', classifyHubIntent('fix the deploy'), 'fix the deploy');
    const first = dispatcher.enqueue(plan, 'idem-1');
    expect(first.plan.status).toBe('pending_approval');
    expect(dispatcher.confirm('idem-1', 'no').plan.status).toBe('pending_approval');
    expect(dispatcher.confirm('idem-1', 'yes').plan.status).toBe('dispatched');
    expect(dispatcher.confirm('idem-1', 'yes').replayed).toBe(true);
    expect(dispatcher.enqueue(plan, 'idem-1').replayed).toBe(true);
  });
});

describe('hub 72-hour aggregation', () => {
  it('aggregates categories, ranks opportunities, and degrades failures', async () => {
    const inside = '2026-08-02T12:00:00.000Z';
    const seed: HubContextItem[] = [
      item('transcript', 't1', inside),
      item('repo', 'r1', inside),
      item('pr', 'p1', inside),
      item('linear', 'l1', inside),
      item('opportunity', 'o-low', inside, 1),
      item('opportunity', 'o-high', inside, 9),
      item('task', 'task-1', inside),
      item('heartbeat', 'hb1', inside),
    ];
    const sources = emptyAggregationSources(seed);
    const original = sources.listRepos;
    sources.listRepos = async () => {
      throw new Error('boom');
    };
    void original;
    const window = await aggregateHubWindow(sources, NOW);
    expect(window.windowMs).toBe(HUB_AGGREGATION_WINDOW_MS);
    expect(window.degradedProviders).toContain('repos');
    expect(window.counts.opportunity).toBe(2);
    const opportunities = window.items.filter((entry) => entry.category === 'opportunity');
    expect(opportunities[0]?.id).toBe('o-high');
  });
});

describe('hub sealed demos and walkthrough streams', () => {
  it('seals demos and exposes three walkthrough streams', () => {
    const first = sealHubDemoSnapshot({
      demoId: 'd1',
      sealedAt: NOW,
      label: 'demo',
      payload: { step: 1, ready: true },
    });
    const second = sealHubDemoSnapshot({
      demoId: 'd1',
      sealedAt: '2026-08-03T13:00:00.000Z',
      label: 'demo',
      payload: { ready: true, step: 1 },
    });
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.contentHash).toBe(
      createHash('sha256')
        .update(JSON.stringify({ demoId: 'd1', label: 'demo', payload: { ready: true, step: 1 } }))
        .digest('hex'),
    );

    const streams = buildWalkthroughStreams(NOW);
    expect(Object.keys(streams).sort()).toEqual(['competitor', 'deploy_fix', 'morning_brief']);
  });

  it('builds an idempotent boot announcement plan without sending', () => {
    const plan = buildBootAnnouncementPlan({
      bootId: 'boot-1',
      createdAt: NOW,
      totals: { activeAgents: 5, queuedTasks: 2, opportunities: 1 },
    });
    expect(plan.channel).toBe('telegram');
    expect(plan.idempotencyKey).toBe('boot-announce:boot-1');
    expect(plan.text).toContain('Agents 5');
  });
});

describe('hub command plane snapshot and events', () => {
  it('boots, ingests, confirms, and emits WebSocket-ready contracts', async () => {
    const plane = new HubCommandPlane({
      now: () => NOW,
      confirmationToken: 'confirm-me',
      bootId: 'boot-1',
      localWhisper: { probe: async () => ({ available: true, detail: 'local ok' }) },
      apiFallback: { configured: false, detail: 'unused' },
      ingressTransport: {
        transcribeVoice: async () => 'implement the github pr fix',
      },
      aggregationSources: emptyAggregationSources([
        item('transcript', 't1', '2026-08-02T12:00:00.000Z'),
        item('task', 'task-1', '2026-08-02T13:00:00.000Z'),
        item('opportunity', 'o1', '2026-08-02T14:00:00.000Z', 5),
      ]),
    });

    const boot = await plane.boot();
    expect(() => assertHubSnapshot(boot)).not.toThrow();
    expect(boot.schemaVersion).toBe(1);
    expect(boot.agents).toHaveLength(5);
    expect(boot.bootAnnouncement?.idempotencyKey).toBe('boot-announce:boot-1');
    expect(plane.planBootAnnouncement(boot.totals).idempotencyKey).toBe('boot-announce:boot-1');

    const ingested = await plane.ingest({
      id: 'msg-1',
      idempotencyKey: 'ingress:msg-1',
      receivedAt: NOW,
      source: 'telegram_voice',
      body: 'audio://1',
      transportId: 'tg-1',
    });
    expect(ingested.receipt.plan.intent).toBe('TASK');
    expect(ingested.receipt.plan.targetAgent).toBe('DEV');
    expect(ingested.receipt.plan.status).toBe('pending_approval');

    expect(plane.confirm('ingress:msg-1', 'confirm-me').plan.status).toBe('dispatched');
    expect(plane.confirm('ingress:msg-1', 'confirm-me').replayed).toBe(true);

    plane.sealDemo({ demoId: 'demo-1', label: 'walkthrough', payload: { version: 1 } });
    const demoSnapshot = plane.enterDemo();
    expect(demoSnapshot.mode).toBe('demo');
    expect(plane.walkthroughs().competitor.length).toBeGreaterThan(0);
    expect(plane.exitDemo().mode).toBe('live');

    const snapshot = await plane.snapshot();
    expect(() => assertHubSnapshot(snapshot)).not.toThrow();
    expect(snapshot.aggregation?.counts.transcript).toBe(1);

    const events = plane.drainEvents();
    expect(events.some((event) => event.type === 'snapshot')).toBe(true);
    for (const event of events) expect(() => assertHubEvent(event)).not.toThrow();
  });
});

function item(
  category: HubContextItem['category'],
  id: string,
  occurredAt: string,
  signal?: number,
): HubContextItem {
  return {
    id,
    category,
    title: id,
    occurredAt,
    source: 'fixture',
    summary: `${category} ${id}`,
    ...(signal !== undefined ? { signal } : {}),
  };
}
