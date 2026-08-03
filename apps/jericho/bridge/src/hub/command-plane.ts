import {
  HubAgentPresence,
  HubCapability,
  HubDispatchStatus,
  HubEventType,
  HubIngressPort,
  type HubBootSummary,
  type HubCommandRecord,
  type HubDispatchReceipt,
  type HubEvent,
  type HubIngressMessage,
  type HubSealedDemoSnapshot,
  type HubSnapshot,
  type HubWalkthroughEvent,
  type HubWalkthroughStream,
  type HubWhisperProbeResult,
} from '@jericho/shared';

import {
  aggregateHubWindow,
  emptyAggregationSources,
  type HubAggregationSources,
} from './aggregator.js';
import { classifyHubCommand } from './classifier.js';
import { buildWalkthroughStreams, sealHubDemoSnapshot } from './demo.js';
import {
  createTokenDispatchGate,
  HubDispatcher,
  type HubDispatchGate,
} from './dispatch.js';
import { ALL_CAPABILITIES, HubTelemetry } from './heartbeat.js';
import {
  acceptHubIngress,
  HUB_INGRESS_PORTS,
  type AcceptIngressInput,
  type HubIngressTransport,
} from './ingress.js';
import { routeHubCommand } from './router.js';
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
 * In-memory Hub command plane. Uses injected fakes only — no live sends,
 * workspace operations, or wiring into server/runtime/config.
 */
export class HubCommandPlane {
  readonly #now: () => string;
  readonly #localWhisper: LocalWhisperProbe;
  readonly #apiFallback: WhisperApiFallback;
  readonly #ingressTransport: HubIngressTransport;
  readonly #aggregationSources: HubAggregationSources;
  readonly #dispatcher: HubDispatcher;
  readonly #telemetry: HubTelemetry;
  readonly #bootId: string;
  readonly #startedAt: string;
  readonly #commands = new Map<string, HubCommandRecord>();
  readonly #demos: HubSealedDemoSnapshot[] = [];
  readonly #walkthroughs: Record<HubWalkthroughStream, HubWalkthroughEvent[]>;
  readonly #events: HubEvent[] = [];
  #booted = false;
  #bootSummary: HubBootSummary | undefined;
  #whisper: HubWhisperProbeResult | undefined;

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
    this.#telemetry = new HubTelemetry(this.#now);
    this.#bootId = options.bootId ?? `hub-boot-${this.#now()}`;
    this.#startedAt = this.#now();
    this.#walkthroughs = buildWalkthroughStreams(this.#startedAt);
  }

  async boot(): Promise<HubSnapshot> {
    this.#whisper = await probeHubWhisper({
      local: this.#localWhisper,
      apiFallback: this.#apiFallback,
      now: this.#now,
    });
    this.#push({
      type: HubEventType.WhisperProbed,
      at: this.#whisper.probedAt,
      result: { ...this.#whisper },
    });

    for (const capability of ALL_CAPABILITIES) {
      this.#telemetry.recordHeartbeat({
        agentId: `agent:${capability}`,
        capability,
        presence: HubAgentPresence.Online,
        detail: `${capability} capability online`,
      });
    }

    this.#bootSummary = this.#telemetry.buildBootSummary({
      bootId: this.#bootId,
      startedAt: this.#startedAt,
      whisper: this.#whisper,
    });
    this.#booted = true;
    this.#events.push(...this.#telemetry.drainEvents());
    return this.snapshot();
  }

  async ingest(input: AcceptIngressInput): Promise<{
    message: HubIngressMessage;
    command: HubCommandRecord;
    receipt: HubDispatchReceipt;
  }> {
    this.#ensureBooted();
    const message = await acceptHubIngress(input, this.#ingressTransport);
    this.#push({
      type: HubEventType.IngressReceived,
      at: message.receivedAt,
      message: { ...message, metadata: { ...message.metadata } },
    });

    const classification = classifyHubCommand(message.text);
    const routing = routeHubCommand(classification, message.text);
    const commandId = `cmd:${message.id}`;
    this.#push({
      type: HubEventType.CommandClassified,
      at: this.#now(),
      commandId,
      classification: { ...classification, signals: [...classification.signals] },
    });
    this.#push({
      type: HubEventType.CommandRouted,
      at: this.#now(),
      commandId,
      routing: { ...routing },
    });

    const createdAt = this.#now();
    const idempotencyKey = `ingress:${message.id}`;
    const receipt = this.#dispatcher.enqueue({
      idempotencyKey,
      commandId,
      kind: classification.kind,
      capability: routing.capability,
      summary: classification.summary,
      createdAt,
    });
    this.#push({
      type: HubEventType.DispatchUpdated,
      at: receipt.updatedAt,
      receipt: { ...receipt },
    });

    const command: HubCommandRecord = {
      id: commandId,
      kind: classification.kind,
      capability: routing.capability,
      summary: classification.summary,
      ingressPort: message.port,
      status: receipt.status,
      createdAt,
      updatedAt: receipt.updatedAt,
      idempotencyKey,
    };
    this.#commands.set(commandId, command);
    return { message, command, receipt };
  }

  confirm(idempotencyKey: string, confirmationToken: string): HubDispatchReceipt {
    this.#ensureBooted();
    const command = [...this.#commands.values()].find(
      (entry) => entry.idempotencyKey === idempotencyKey,
    );
    if (!command) {
      throw new Error(`Unknown Hub command for key: ${idempotencyKey}`);
    }
    const receipt = this.#dispatcher.confirm({
      idempotencyKey,
      commandId: command.id,
      kind: command.kind,
      capability: command.capability,
      summary: command.summary,
      confirmationToken,
      createdAt: command.createdAt,
    });
    this.#push({
      type: HubEventType.DispatchUpdated,
      at: receipt.updatedAt,
      receipt: { ...receipt },
    });
    command.status = receipt.status;
    command.updatedAt = receipt.updatedAt;
    return receipt;
  }

  sealDemo(input: {
    demoId: string;
    label: string;
    payload: Record<string, string | number | boolean | null>;
  }): HubSealedDemoSnapshot {
    const demo = sealHubDemoSnapshot({
      ...input,
      sealedAt: this.#now(),
    });
    this.#demos.push(demo);
    this.#push({
      type: HubEventType.DemoSealed,
      at: demo.sealedAt,
      demo: { ...demo, payload: { ...demo.payload } },
    });
    return { ...demo, payload: { ...demo.payload } };
  }

  walkthroughs(): Record<HubWalkthroughStream, HubWalkthroughEvent[]> {
    const clone = {} as Record<HubWalkthroughStream, HubWalkthroughEvent[]>;
    for (const [stream, events] of Object.entries(this.#walkthroughs) as Array<
      [HubWalkthroughStream, HubWalkthroughEvent[]]
    >) {
      clone[stream] = events.map((event) => ({ ...event, data: { ...event.data } }));
    }
    return clone;
  }

  async snapshot(): Promise<HubSnapshot> {
    this.#ensureBooted();
    const aggregation = await aggregateHubWindow(this.#aggregationSources, this.#now());
    this.#push({
      type: HubEventType.AggregationReady,
      at: aggregation.until,
      aggregation: structuredClone(aggregation),
    });
    const snapshot = buildHubSnapshot({
      generatedAt: this.#now(),
      boot: this.#bootSummary!,
      commands: [...this.#commands.values()],
      heartbeats: this.#telemetry.listHeartbeats(),
      alerts: this.#telemetry.listAlerts(),
      aggregation,
      demos: this.#demos,
      walkthroughs: this.#walkthroughs,
      whisper: this.#whisper!,
      ingressPorts: HUB_INGRESS_PORTS,
    });
    this.#push({
      type: HubEventType.Snapshot,
      at: snapshot.generatedAt,
      snapshot: structuredClone(snapshot),
    });
    return snapshot;
  }

  drainEvents(): HubEvent[] {
    const events = [...this.#events, ...this.#telemetry.drainEvents()];
    this.#events.length = 0;
    return events;
  }

  get dispatcher(): HubDispatcher {
    return this.#dispatcher;
  }

  get telemetry(): HubTelemetry {
    return this.#telemetry;
  }

  #ensureBooted(): void {
    if (!this.#booted || !this.#bootSummary || !this.#whisper) {
      throw new Error('HubCommandPlane.boot() must run before use');
    }
  }

  #push(event: HubEvent): void {
    this.#events.push(event);
  }
}

export {
  HubCapability,
  HubDispatchStatus,
  HubIngressPort,
};
