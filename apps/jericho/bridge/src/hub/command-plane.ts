import {
  HUB_AGENT_IDS,
  type HubCommand,
  type HubDemoStream,
  type HubDispatchReceipt,
  type HubEvent,
  type HubMode,
  type HubSealedDemoSnapshot,
  type HubSnapshot,
  type HubWalkthroughEvent,
  type HubWhisperProbeResult,
} from '@jericho/shared';

import {
  aggregateHubWindow,
  emptyAggregationSources,
  type HubAggregationSources,
} from './aggregator.js';
import { classifyHubIntent } from './classifier.js';
import {
  buildBootAnnouncementPlan,
  buildWalkthroughStreams,
  sealHubDemoSnapshot,
} from './demo.js';
import {
  createTokenDispatchGate,
  HubDispatcher,
  type HubDispatchGate,
} from './dispatch.js';
import { HubEventBus, HubTelemetry } from './heartbeat.js';
import {
  acceptHubCommand,
  type AcceptHubCommandInput,
  type HubIngressTransport,
} from './ingress.js';
import { planHubDispatch } from './router.js';
import { buildHubSnapshot } from './snapshot.js';
import {
  probeHubWhisper,
  type LocalWhisperProbe,
  type WhisperApiFallback,
} from './whisper.js';

export interface HubCommandPlaneOptions {
  now?: () => string;
  localWhisper: LocalWhisperProbe;
  apiFallback: WhisperApiFallback;
  ingressTransport?: HubIngressTransport;
  aggregationSources?: HubAggregationSources;
  confirmationToken: string;
  dispatchGate?: HubDispatchGate;
  bootId?: string;
}

/**
 * In-memory Hub command plane. Injected fakes only — no live sends, workspace
 * operations, or wiring into server/runtime/config.
 */
export class HubCommandPlane {
  readonly #now: () => string;
  readonly #localWhisper: LocalWhisperProbe;
  readonly #apiFallback: WhisperApiFallback;
  readonly #ingressTransport: HubIngressTransport;
  readonly #aggregationSources: HubAggregationSources;
  readonly #dispatcher: HubDispatcher;
  readonly #bus = new HubEventBus();
  readonly #telemetry: HubTelemetry;
  readonly #bootId: string;
  readonly #demos: HubSealedDemoSnapshot[] = [];
  readonly #walkthroughs: Record<HubDemoStream, HubWalkthroughEvent[]>;
  readonly #commands = new Map<string, HubCommand>();
  readonly #bootAnnouncements = new Map<string, ReturnType<typeof buildBootAnnouncementPlan>>();
  #booted = false;
  #whisper: HubWhisperProbeResult | undefined;
  #bootAnnouncement: ReturnType<typeof buildBootAnnouncementPlan> | undefined;

  constructor(options: HubCommandPlaneOptions) {
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#localWhisper = options.localWhisper;
    this.#apiFallback = options.apiFallback;
    this.#ingressTransport = options.ingressTransport ?? {};
    this.#aggregationSources = options.aggregationSources ?? emptyAggregationSources();
    this.#dispatcher = new HubDispatcher(
      options.dispatchGate ?? createTokenDispatchGate(options.confirmationToken),
      this.#now,
    );
    this.#telemetry = new HubTelemetry(this.#bus, this.#now);
    this.#bootId = options.bootId ?? `hub-boot-${this.#now()}`;
    this.#walkthroughs = buildWalkthroughStreams(this.#now());
  }

  async boot(): Promise<HubSnapshot> {
    this.#whisper = await probeHubWhisper({
      local: this.#localWhisper,
      apiFallback: this.#apiFallback,
      now: this.#now,
    });

    for (const agentId of HUB_AGENT_IDS) {
      this.#telemetry.recordHeartbeat({
        agentId,
        health: 'green',
        currentTask: null,
      });
    }

    const aggregation = await aggregateHubWindow(this.#aggregationSources, this.#now());
    const totals = this.#telemetry.totals(
      aggregation.counts.task,
      aggregation.counts.opportunity,
    );
    this.#bootAnnouncement = this.planBootAnnouncement(totals);
    this.#booted = true;
    return this.snapshot(aggregation);
  }

  planBootAnnouncement(totals: {
    activeAgents: number;
    queuedTasks: number;
    opportunities: number;
  }): ReturnType<typeof buildBootAnnouncementPlan> {
    const existing = this.#bootAnnouncements.get(this.#bootId);
    if (existing) return structuredClone(existing);
    const plan = buildBootAnnouncementPlan({
      bootId: this.#bootId,
      createdAt: this.#now(),
      totals,
    });
    this.#bootAnnouncements.set(this.#bootId, plan);
    return structuredClone(plan);
  }

  async ingest(input: AcceptHubCommandInput): Promise<{
    command: HubCommand;
    receipt: HubDispatchReceipt;
  }> {
    this.#ensureBooted();
    const command = await acceptHubCommand(input, this.#ingressTransport);
    this.#commands.set(command.id, command);
    this.#telemetry.appendCommandLog({
      id: `log:${command.id}:received`,
      agentId: 'JERICHO',
      phase: 'received',
      summary: `Received from ${command.source}`,
    });

    const classification = classifyHubIntent(command.text);
    this.#telemetry.appendCommandLog({
      id: `log:${command.id}:classified`,
      agentId: 'JERICHO',
      phase: 'classified',
      summary: `${classification.intent} (${classification.confidence})`,
    });

    const plan = planHubDispatch(command.id, classification, command.text);
    this.#telemetry.appendCommandLog({
      id: `log:${command.id}:planned`,
      agentId: plan.targetAgent ?? 'JERICHO',
      phase: 'planned',
      summary: plan.summary,
    });

    const receipt = this.#dispatcher.enqueue(plan, command.idempotencyKey);
    if (receipt.plan.status === 'pending_approval') {
      this.#telemetry.appendCommandLog({
        id: `log:${command.id}:pending`,
        agentId: plan.targetAgent ?? 'JERICHO',
        phase: 'planned',
        summary: 'Awaiting confirmation',
      });
    }
    return { command, receipt };
  }

  confirm(idempotencyKey: string, confirmationToken: string): HubDispatchReceipt {
    this.#ensureBooted();
    const receipt = this.#dispatcher.confirm(idempotencyKey, confirmationToken);
    if (receipt.plan.status === 'dispatched') {
      this.#telemetry.appendCommandLog({
        id: `log:${receipt.commandId}:dispatched`,
        agentId: receipt.plan.targetAgent ?? 'JERICHO',
        phase: 'dispatched',
        summary: receipt.plan.summary,
      });
    }
    return receipt;
  }

  enterDemo(): HubSnapshot {
    this.#ensureBooted();
    this.#telemetry.setMode('demo');
    // DEMO never constructs live providers — sealed streams only.
    return this.snapshotSync();
  }

  exitDemo(): HubSnapshot {
    this.#ensureBooted();
    this.#telemetry.setMode('live');
    return this.snapshotSync();
  }

  sealDemo(input: {
    demoId: string;
    label: string;
    payload: Record<string, string | number | boolean | null>;
  }): HubSealedDemoSnapshot {
    const demo = sealHubDemoSnapshot({ ...input, sealedAt: this.#now() });
    this.#demos.push(demo);
    return { ...demo, payload: { ...demo.payload } };
  }

  walkthroughs(): Record<HubDemoStream, HubWalkthroughEvent[]> {
    const clone = {} as Record<HubDemoStream, HubWalkthroughEvent[]>;
    for (const [stream, events] of Object.entries(this.#walkthroughs) as Array<
      [HubDemoStream, HubWalkthroughEvent[]]
    >) {
      clone[stream] = events.map((event) => ({ ...event, data: { ...event.data } }));
    }
    return clone;
  }

  async snapshot(aggregation?: Awaited<ReturnType<typeof aggregateHubWindow>>): Promise<HubSnapshot> {
    this.#ensureBooted();
    const window = aggregation ?? (await aggregateHubWindow(this.#aggregationSources, this.#now()));
    return this.#publishSnapshot(window);
  }

  snapshotSync(): HubSnapshot {
    this.#ensureBooted();
    return this.#publishSnapshot({
      windowMs: 72 * 60 * 60 * 1000,
      since: this.#now(),
      until: this.#now(),
      items: [],
      counts: {
        transcript: 0,
        repo: 0,
        pr: 0,
        linear: 0,
        opportunity: 0,
        task: 0,
        heartbeat: 0,
      },
      degradedProviders: [],
    });
  }

  drainEvents(): HubEvent[] {
    return this.#bus.drain();
  }

  get mode(): HubMode {
    return this.#telemetry.mode;
  }

  get dispatcher(): HubDispatcher {
    return this.#dispatcher;
  }

  get telemetry(): HubTelemetry {
    return this.#telemetry;
  }

  #publishSnapshot(
    aggregation: Awaited<ReturnType<typeof aggregateHubWindow>>,
  ): HubSnapshot {
    const totals = this.#telemetry.totals(
      aggregation.counts.task,
      aggregation.counts.opportunity,
    );
    const snapshot = buildHubSnapshot({
      generatedAt: this.#now(),
      mode: this.#telemetry.mode,
      connection: aggregation.degradedProviders.length ? 'degraded' : 'connected',
      agents: this.#telemetry.listAgents(),
      commandLog: this.#telemetry.listCommandLog(),
      alerts: this.#telemetry.listAlerts(),
      totals,
      bootAnnouncement: this.#bootAnnouncement,
      aggregation,
      whisper: this.#whisper,
      demos: this.#demos,
      walkthroughs: this.#walkthroughs,
    });
    this.#bus.publish({ type: 'snapshot', sequence: 0, snapshot });
    return snapshot;
  }

  #ensureBooted(): void {
    if (!this.#booted || !this.#whisper) {
      throw new Error('HubCommandPlane.boot() must run before use');
    }
  }
}
