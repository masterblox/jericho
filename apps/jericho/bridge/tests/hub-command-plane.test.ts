import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  assertHubEvent,
  assertHubSnapshot,
  HubCapability,
  HubCommandKind,
  HubDispatchStatus,
  HubEventType,
  HubIngressPort,
  HubWalkthroughStream,
  HubWhisperBackend,
  HUB_AGGREGATION_WINDOW_MS,
  type HubAggregateItem,
} from '@jericho/shared';

import {
  aggregateHubWindow,
  buildWalkthroughStreams,
  classifyHubCommand,
  createTokenDispatchGate,
  emptyAggregationSources,
  HubCommandPlane,
  HubDispatcher,
  probeHubWhisper,
  routeHubCommand,
  sealHubDemoSnapshot,
  acceptHubIngress,
} from '../src/hub/index.js';

const NOW = '2026-08-03T12:00:00.000Z';

describe('hub command classification', () => {
  it.each([
    ['Ship the Linear fix tonight', HubCommandKind.Task],
    ['What is the status of PR 16?', HubCommandKind.Query],
    ['Create a new issue for the vault gateway', HubCommandKind.Create],
    ['Give me a brief of the last day', HubCommandKind.Brief],
    ['Run the client demo walkthrough', HubCommandKind.Demo],
  ])('classifies %s as %s', (text, kind) => {
    const result = classifyHubCommand(text);
    expect(result.kind).toBe(kind);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.signals.length).toBeGreaterThan(0);
  });
});

describe('hub capability routing', () => {
  it.each([
    ['implement the bridge fix', HubCapability.Dev],
    ['draft outreach to the prospect', HubCapability.Donald],
    ['schedule my calendar for tomorrow', HubCapability.PA],
    ['design a brand mockup', HubCapability.Iris],
    ['summarize a brief for the board', HubCapability.Jericho],
    ['run the demo showcase', HubCapability.Jericho],
  ])('routes "%s" to %s', (text, capability) => {
    const classification = classifyHubCommand(text);
    expect(routeHubCommand(classification, text).capability).toBe(capability);
  });
});

describe('hub ingress ports', () => {
  it('accepts telegram text directly', async () => {
    const message = await acceptHubIngress({
      id: 'in-1',
      port: HubIngressPort.TelegramText,
      receivedAt: NOW,
      body: '  Fix the router  ',
    });
    expect(message.text).toBe('Fix the router');
    expect(message.port).toBe(HubIngressPort.TelegramText);
  });

  it('uses injected voice and QR transports only', async () => {
    const voice = await acceptHubIngress(
      {
        id: 'in-voice',
        port: HubIngressPort.TelegramVoice,
        receivedAt: NOW,
        body: 'audio://clip-1',
      },
      { transcribeVoice: async (ref) => `voice:${ref}` },
    );
    expect(voice.text).toBe('voice:audio://clip-1');

    const qr = await acceptHubIngress(
      {
        id: 'in-qr',
        port: HubIngressPort.Qr,
        receivedAt: NOW,
        body: 'qr-payload',
      },
      { decodeQr: async (payload) => `decoded:${payload}` },
    );
    expect(qr.text).toBe('decoded:qr-payload');
  });
});

describe('hub whisper probe', () => {
  it('prefers local whisper when available', async () => {
    const result = await probeHubWhisper({
      local: { probe: async () => ({ available: true, detail: 'whisper.cpp ready' }) },
      apiFallback: { configured: true, detail: 'openai whisper' },
      now: () => NOW,
    });
    expect(result.backend).toBe(HubWhisperBackend.Local);
    expect(result.available).toBe(true);
    expect(result.fallbackConfigured).toBe(true);
  });

  it('falls back to configured API when local is down', async () => {
    const result = await probeHubWhisper({
      local: { probe: async () => ({ available: false, detail: 'binary missing' }) },
      apiFallback: { configured: true, detail: 'api ready' },
      now: () => NOW,
    });
    expect(result.backend).toBe(HubWhisperBackend.ApiFallback);
    expect(result.available).toBe(true);
  });

  it('reports unavailable when neither local nor API work', async () => {
    const result = await probeHubWhisper({
      local: { probe: async () => ({ available: false, detail: 'binary missing' }) },
      apiFallback: { configured: false, detail: 'none' },
      now: () => NOW,
    });
    expect(result.backend).toBe(HubWhisperBackend.Unavailable);
    expect(result.available).toBe(false);
  });
});

describe('hub confirmation-gated idempotent dispatch', () => {
  it('holds without confirmation and dispatches once when confirmed', () => {
    const dispatcher = new HubDispatcher(createTokenDispatchGate('yes'), () => NOW);
    const request = {
      idempotencyKey: 'k1',
      commandId: 'cmd-1',
      kind: HubCommandKind.Task,
      capability: HubCapability.Dev,
      summary: 'Fix router',
      createdAt: NOW,
    };
    expect(dispatcher.enqueue(request).status).toBe(HubDispatchStatus.AwaitingConfirmation);
    expect(dispatcher.confirm({ ...request, confirmationToken: 'no' }).status).toBe(
      HubDispatchStatus.AwaitingConfirmation,
    );
    expect(dispatcher.confirm({ ...request, confirmationToken: 'yes' }).status).toBe(
      HubDispatchStatus.Dispatched,
    );
    expect(dispatcher.confirm({ ...request, confirmationToken: 'yes' }).status).toBe(
      HubDispatchStatus.Duplicate,
    );
    expect(dispatcher.enqueue(request).status).toBe(HubDispatchStatus.Duplicate);
  });
});

describe('hub 72-hour aggregation', () => {
  it('aggregates transcript, repo, PR, Linear, opportunity, and task items', async () => {
    const inside = '2026-08-02T12:00:00.000Z';
    const outside = '2026-07-01T12:00:00.000Z';
    const seed: HubAggregateItem[] = [
      item('transcript', 't1', inside),
      item('repo', 'r1', inside),
      item('pr', 'p1', inside),
      item('linear', 'l1', inside),
      item('opportunity', 'o1', inside),
      item('task', 'task-1', inside),
      item('task', 'task-old', outside),
    ];
    const window = await aggregateHubWindow(emptyAggregationSources(seed), NOW);
    expect(window.windowMs).toBe(HUB_AGGREGATION_WINDOW_MS);
    expect(window.counts).toEqual({
      transcript: 1,
      repo: 1,
      pr: 1,
      linear: 1,
      opportunity: 1,
      task: 1,
    });
    expect(window.items).toHaveLength(6);
  });
});

describe('hub sealed demos and walkthrough streams', () => {
  it('seals demos with stable content hashes', () => {
    const first = sealHubDemoSnapshot({
      demoId: 'demo-1',
      sealedAt: NOW,
      label: 'party-trick',
      payload: { step: 1, ready: true },
    });
    const second = sealHubDemoSnapshot({
      demoId: 'demo-1',
      sealedAt: '2026-08-03T13:00:00.000Z',
      label: 'party-trick',
      payload: { ready: true, step: 1 },
    });
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const expected = createHash('sha256')
      .update(JSON.stringify({ demoId: 'demo-1', label: 'party-trick', payload: { ready: true, step: 1 } }))
      .digest('hex');
    expect(first.contentHash).toBe(expected);
  });

  it('exposes three walkthrough streams', () => {
    const streams = buildWalkthroughStreams(NOW);
    expect(Object.keys(streams).sort()).toEqual(
      [HubWalkthroughStream.Brief, HubWalkthroughStream.Command, HubWalkthroughStream.Fleet].sort(),
    );
    for (const stream of Object.values(HubWalkthroughStream)) {
      expect(streams[stream].length).toBeGreaterThan(0);
      expect(streams[stream][0]?.stream).toBe(stream);
    }
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
        item('linear', 'l1', '2026-08-02T13:00:00.000Z'),
      ]),
    });

    const bootSnapshot = await plane.boot();
    expect(() => assertHubSnapshot(bootSnapshot)).not.toThrow();
    expect(bootSnapshot.boot.healthy).toBe(true);
    expect(bootSnapshot.heartbeats).toHaveLength(5);
    expect(bootSnapshot.whisper.backend).toBe(HubWhisperBackend.Local);

    const ingested = await plane.ingest({
      id: 'msg-1',
      port: HubIngressPort.TelegramVoice,
      receivedAt: NOW,
      body: 'audio://1',
    });
    expect(ingested.command.kind).toBe(HubCommandKind.Task);
    expect(ingested.command.capability).toBe(HubCapability.Dev);
    expect(ingested.receipt.status).toBe(HubDispatchStatus.AwaitingConfirmation);

    const confirmed = plane.confirm(ingested.command.idempotencyKey!, 'confirm-me');
    expect(confirmed.status).toBe(HubDispatchStatus.Dispatched);
    expect(plane.confirm(ingested.command.idempotencyKey!, 'confirm-me').status).toBe(
      HubDispatchStatus.Duplicate,
    );

    const demo = plane.sealDemo({
      demoId: 'demo-live',
      label: 'walkthrough',
      payload: { version: 1 },
    });
    expect(demo.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const streams = plane.walkthroughs();
    expect(streams[HubWalkthroughStream.Command]).toHaveLength(3);

    const snapshot = await plane.snapshot();
    expect(() => assertHubSnapshot(snapshot)).not.toThrow();
    expect(snapshot.commands).toHaveLength(1);
    expect(snapshot.demos).toHaveLength(1);
    expect(snapshot.aggregation.counts.transcript).toBe(1);
    expect(snapshot.aggregation.counts.linear).toBe(1);

    const events = plane.drainEvents();
    expect(events.some((event) => event.type === HubEventType.BootSummary)).toBe(true);
    expect(events.some((event) => event.type === HubEventType.Snapshot)).toBe(true);
    for (const event of events) {
      expect(() => assertHubEvent(event)).not.toThrow();
    }
  });
});

function item(
  category: HubAggregateItem['category'],
  id: string,
  occurredAt: string,
): HubAggregateItem {
  return {
    id,
    category,
    title: id,
    occurredAt,
    source: 'fixture',
    summary: `${category} ${id}`,
  };
}
