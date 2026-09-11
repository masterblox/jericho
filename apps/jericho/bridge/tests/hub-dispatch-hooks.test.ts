import { describe, expect, it } from 'vitest';

import {
  assertHubDispatchReceipt,
  assertHubEvent,
  assertHubSnapshot,
} from '@jericho/shared';

import {
  classifyHubIntent,
  createTokenDispatchGate,
  emptyAggregationSources,
  HubCommandPlane,
  HubDispatcher,
  planHubDispatch,
} from '../src/hub/index.js';

const NOW = '2026-09-11T12:00:00.000Z';

describe('maestro dispatch-hook intent classification', () => {
  it.each([
    ['dispatch the pumas rebrand to IRIS', 'DISPATCH'],
    ['verify the result of lane 8a7e713', 'VERIFY'],
    ['archive the closed pumas card', 'ARCHIVE'],
    ['ack that cost alert', 'ACK'],
  ] as const)('classifies "%s" as %s', (text, intent) => {
    expect(classifyHubIntent(text).intent).toBe(intent);
  });

  it('does not hijack existing intents', () => {
    expect(classifyHubIntent('Ship the Linear fix tonight').intent).toBe('TASK');
    expect(classifyHubIntent('What is the status of PR 16?').intent).toBe('QUERY');
    expect(classifyHubIntent('Give me a brief of the last 72 hours').intent).toBe('BRIEF');
  });
});

describe('maestro dispatch-hook routing', () => {
  it('requires confirmation for DISPATCH (external effect), plans verify/archive/ack', () => {
    const dispatch = planHubDispatch('c1', classifyHubIntent('dispatch pumas to IRIS'), 'dispatch pumas to IRIS');
    // the dispatch target is routed from text -> IRIS research/design lane
    expect(dispatch.intent).toBe('DISPATCH');
    expect(dispatch.requiresConfirmation).toBe(true);
    expect(dispatch.status).toBe('pending_approval');

    for (const [text, intent] of [
      ['verify lane 8a7e713', 'VERIFY'],
      ['archive the closed card', 'ARCHIVE'],
      ['ack the cost alert', 'ACK'],
    ] as const) {
      const plan = planHubDispatch('c2', classifyHubIntent(text), text);
      expect(plan.intent).toBe(intent);
      expect(plan.requiresConfirmation).toBe(false);
      expect(plan.status).toBe('planned');
      expect(plan.targetAgent).toBe('JERICHO');
    }
  });
});

describe('HubDispatcher maestro lifecycle (dispatch -> verify -> archive)', () => {
  it('runs a full lifecycle with idempotent replays', () => {
    const dispatcher = new HubDispatcher(createTokenDispatchGate('yes'), () => NOW);
    const plan = planHubDispatch('cmd', classifyHubIntent('dispatch pumas to IRIS'), 'dispatch pumas to IRIS');

    let receipt = dispatcher.enqueue(plan, 'idem-full');
    expect(receipt.plan.status).toBe('pending_approval');

    // wrong token keeps it pending; right token dispatches
    expect(dispatcher.dispatch('idem-full', 'no').plan.status).toBe('pending_approval');
    receipt = dispatcher.dispatch('idem-full', 'yes');
    expect(receipt.plan.status).toBe('dispatched');
    expect(dispatcher.dispatch('idem-full', 'yes').replayed).toBe(true);

    // verify binds evidence and moves to verified
    receipt = dispatcher.verify('idem-full', {
      status: 'verified',
      evidence: 'PR #52 merged, checks green',
      at: NOW,
      verifier: 'maestro-verify',
    });
    expect(receipt.plan.status).toBe('verified');
    expect(receipt.verdict?.evidence).toContain('PR #52');
    expect(dispatcher.verify('idem-full', { status: 'verified', evidence: 'x', at: NOW }).replayed).toBe(true);

    // archive closes the terminal receipt
    receipt = dispatcher.archive('idem-full');
    expect(receipt.plan.status).toBe('archived');
    expect(receipt.archivedAt).toBe(NOW);
    expect(dispatcher.archive('idem-full').replayed).toBe(true);
  });

  it('records a failed verdict and cannot be archived before a verdict', () => {
    const dispatcher = new HubDispatcher(createTokenDispatchGate('yes'), () => NOW);
    const plan = planHubDispatch('cmd', classifyHubIntent('dispatch pumas to IRIS'), 'dispatch pumas to IRIS');
    dispatcher.enqueue(plan, 'idem-bad');
    dispatcher.dispatch('idem-bad', 'yes');

    const receipt = dispatcher.verify('idem-bad', {
      status: 'failed',
      evidence: 'lane crashed after 30m (timeout)',
      at: NOW,
    });
    expect(receipt.plan.status).toBe('failed');
    expect(receipt.failureReason).toContain('timeout');

    // a dispatched-but-unverified receipt cannot be archived directly
    dispatcher.enqueue(
      planHubDispatch('cmd2', classifyHubIntent('dispatch openbot to DEV'), 'dispatch openbot'),
      'idem-open',
    );
    dispatcher.dispatch('idem-open', 'yes');
    expect(() => dispatcher.archive('idem-open')).toThrow(/verified\|failed/);
  });

  it('lets a no-confirmation plan dispatch immediately', () => {
    const dispatcher = new HubDispatcher(createTokenDispatchGate('yes'), () => NOW);
    const plan = planHubDispatch('cmd', classifyHubIntent('verify lane 8a7e713'), 'verify lane 8a7e713');
    dispatcher.enqueue(plan, 'idem-noconfirm');
    expect(dispatcher.dispatch('idem-noconfirm').plan.status).toBe('dispatched');
  });

  it('rejects a verdict until the receipt is dispatched', () => {
    const dispatcher = new HubDispatcher(createTokenDispatchGate('yes'), () => NOW);

    const pending = dispatcher.enqueue(
      planHubDispatch('cmd', classifyHubIntent('dispatch pumas to IRIS'), 'dispatch pumas to IRIS'),
      'idem-noverify-yet',
    );
    expect(pending.plan.status).toBe('pending_approval');
    expect(() =>
      dispatcher.verify('idem-noverify-yet', { status: 'verified', evidence: 'PR merged', at: NOW }),
    ).toThrow(/dispatched/);
    expect(() =>
      dispatcher.verify('idem-noverify-yet', { status: 'failed', evidence: 'lane died', at: NOW }),
    ).toThrow(/dispatched/);

    // a no-confirmation plan sits in `planned` before dispatch — also not verifiable
    const planned = dispatcher.enqueue(
      planHubDispatch('cmd2', classifyHubIntent('verify lane 8a7e713'), 'verify lane 8a7e713'),
      'idem-noverify-planned',
    );
    expect(planned.plan.status).toBe('planned');
    expect(() =>
      dispatcher.verify('idem-noverify-planned', { status: 'verified', evidence: 'x', at: NOW }),
    ).toThrow(/dispatched/);
  });

  it('keeps terminal receipts closed on confirmation retries', () => {
    const dispatcher = new HubDispatcher(createTokenDispatchGate('yes'), () => NOW);

    dispatcher.enqueue(
      planHubDispatch('cmd', classifyHubIntent('dispatch pumas to IRIS'), 'dispatch pumas to IRIS'),
      'idem-closed',
    );
    dispatcher.dispatch('idem-closed', 'yes');
    dispatcher.verify('idem-closed', { status: 'verified', evidence: 'PR merged', at: NOW, verifier: 'maestro-verify' });
    dispatcher.archive('idem-closed');

    // replaying confirm() after archive must replay the stored terminal receipt,
    // not rebuild it as `dispatched` and drop the verdict/archive metadata.
    const replay = dispatcher.confirm('idem-closed', 'yes');
    expect(replay.plan.status).toBe('archived');
    expect(replay.archivedAt).toBe(NOW);
    expect(replay.verdict?.evidence).toContain('PR merged');
    expect(replay.replayed).toBe(true);

    // verified-but-not-yet-archived receipts stay closed too
    dispatcher.enqueue(
      planHubDispatch('cmd2', classifyHubIntent('dispatch openbot to DEV'), 'dispatch openbot'),
      'idem-verified',
    );
    dispatcher.dispatch('idem-verified', 'yes');
    dispatcher.verify('idem-verified', { status: 'verified', evidence: 'PR merged', at: NOW });
    const verifiedReplay = dispatcher.confirm('idem-verified', 'yes');
    expect(verifiedReplay.plan.status).toBe('verified');
    expect(verifiedReplay.verdict?.evidence).toContain('PR merged');
    expect(verifiedReplay.replayed).toBe(true);

    // a failed receipt also stays closed on confirm retries
    dispatcher.enqueue(
      planHubDispatch('cmd3', classifyHubIntent('dispatch solver to PA'), 'dispatch solver'),
      'idem-failed',
    );
    dispatcher.dispatch('idem-failed', 'yes');
    dispatcher.verify('idem-failed', { status: 'failed', evidence: 'timeout', at: NOW });
    const failedReplay = dispatcher.confirm('idem-failed', 'yes');
    expect(failedReplay.plan.status).toBe('failed');
    expect(failedReplay.replayed).toBe(true);
  });
});

describe('HubCommandPlane maestro hooks end to end', () => {
  async function buildPlane() {
    const plane = new HubCommandPlane({
      now: () => NOW,
      confirmationToken: 'confirm-me',
      bootId: 'boot-maestro',
      localWhisper: { probe: async () => ({ available: true, detail: 'local ok' }) },
      apiFallback: { configured: false, detail: 'unused' },
      ingressTransport: { transcribeVoice: async () => 'dispatch pumas rebrand to IRIS' },
      aggregationSources: emptyAggregationSources([]),
    });
    await plane.boot();
    return plane;
  }

  it('ingests a dispatch command, confirms, verifies, archives', async () => {
    const plane = await buildPlane();

    const ingested = await plane.ingest({
      id: 'dispatch-1',
      idempotencyKey: 'maestro:pumas-rebrand',
      receivedAt: NOW,
      source: 'telegram_voice',
      body: 'audio://dispatch',
      transportId: 'tg-1',
    });
    expect(ingested.receipt.plan.intent).toBe('DISPATCH');
    expect(ingested.receipt.plan.status).toBe('pending_approval');

    const dispatched = plane.dispatch('maestro:pumas-rebrand', 'confirm-me');
    expect(dispatched.plan.status).toBe('dispatched');

    const verified = plane.verify('maestro:pumas-rebrand', {
      status: 'verified',
      evidence: 'brand-transition branch merged (PR #52), screenshots in artifacts/',
      at: NOW,
      verifier: 'maestro-verify',
    });
    expect(verified.plan.status).toBe('verified');
    expect(() => assertHubDispatchReceipt(verified)).not.toThrow();

    const archived = plane.archive('maestro:pumas-rebrand');
    expect(archived.plan.status).toBe('archived');

    // lifecycle events are WebSocket-ready
    const events = plane.drainEvents();
    const dispatchEvents = events.filter((event) => event.type === 'dispatch');
    expect(dispatchEvents.length).toBe(3);
    for (const event of dispatchEvents) expect(() => assertHubEvent(event)).not.toThrow();
    for (const event of events) expect(() => assertHubEvent(event)).not.toThrow();

    const snapshot = await plane.snapshot();
    expect(() => assertHubSnapshot(snapshot)).not.toThrow();
  });

  it('acks an alert, stamps it, and clears the agent unread counter', async () => {
    const plane = await buildPlane();
    plane.telemetry.raiseAlert({
      id: 'alert-1',
      agentId: 'DONALD',
      priority: 'high',
      category: 'money',
      title: 'cost spike',
      summary: 'cost > 2x 7d avg',
    });
    expect(plane.telemetry.listAgents().find((a) => a.agentId === 'DONALD')?.unreadAlerts).toBe(1);

    const acked = plane.ack('alert-1');
    expect(acked?.acknowledged).toBe(true);
    expect(acked?.acknowledgedAt).toBe(NOW);
    expect(plane.telemetry.listAgents().find((a) => a.agentId === 'DONALD')?.unreadAlerts).toBe(0);

    const events = plane.drainEvents();
    expect(events.filter((event) => event.type === 'ack')).toHaveLength(1);
    for (const event of events) expect(() => assertHubEvent(event)).not.toThrow();
  });
});
