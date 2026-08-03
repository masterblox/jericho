import {
  HubAlertSeverity,
  HubAgentPresence,
  HubCapability,
  HubEventType,
  type HubAgentHeartbeat,
  type HubAlert,
  type HubBootSummary,
  type HubEvent,
  type HubIngressPort,
  type HubWhisperProbeResult,
} from '@jericho/shared';

import { HUB_INGRESS_PORTS } from './ingress.js';

const ALL_CAPABILITIES: readonly HubCapability[] = [
  HubCapability.Dev,
  HubCapability.Donald,
  HubCapability.PA,
  HubCapability.Iris,
  HubCapability.Jericho,
];

/**
 * Track agent heartbeats, raise alerts, and assemble boot summaries.
 */
export class HubTelemetry {
  readonly #heartbeats = new Map<string, HubAgentHeartbeat>();
  readonly #alerts: HubAlert[] = [];
  readonly #events: HubEvent[] = [];
  readonly #now: () => string;
  #sequence = 0;

  constructor(now: () => string = () => new Date().toISOString()) {
    this.#now = now;
  }

  recordHeartbeat(input: {
    agentId: string;
    capability: HubCapability;
    presence: HubAgentPresence;
    detail: string;
  }): HubAgentHeartbeat {
    const previous = this.#heartbeats.get(input.agentId);
    const heartbeat: HubAgentHeartbeat = {
      agentId: input.agentId,
      capability: input.capability,
      presence: input.presence,
      lastSeenAt: this.#now(),
      sequence: (previous?.sequence ?? -1) + 1,
      detail: input.detail,
    };
    this.#heartbeats.set(input.agentId, heartbeat);
    this.#push({
      type: HubEventType.AgentHeartbeat,
      at: heartbeat.lastSeenAt,
      heartbeat: { ...heartbeat },
    });
    return { ...heartbeat };
  }

  raiseAlert(input: {
    id: string;
    severity: HubAlertSeverity;
    code: string;
    message: string;
    relatedCommandId?: string;
  }): HubAlert {
    const alert: HubAlert = {
      id: input.id,
      severity: input.severity,
      raisedAt: this.#now(),
      code: input.code,
      message: input.message,
      ...(input.relatedCommandId ? { relatedCommandId: input.relatedCommandId } : {}),
    };
    this.#alerts.push(alert);
    this.#push({
      type: HubEventType.AlertRaised,
      at: alert.raisedAt,
      alert: { ...alert },
    });
    return { ...alert };
  }

  buildBootSummary(input: {
    bootId: string;
    startedAt: string;
    whisper: HubWhisperProbeResult;
    ingressPorts?: readonly HubIngressPort[];
    capabilities?: readonly HubCapability[];
  }): HubBootSummary {
    const readyAt = this.#now();
    const alerts = this.#alerts.map((alert) => ({ ...alert }));
    const boot: HubBootSummary = {
      bootId: input.bootId,
      startedAt: input.startedAt,
      readyAt,
      whisper: { ...input.whisper },
      ingressPorts: [...(input.ingressPorts ?? HUB_INGRESS_PORTS)],
      capabilities: [...(input.capabilities ?? ALL_CAPABILITIES)],
      alerts,
      healthy:
        input.whisper.available &&
        !alerts.some((alert) => alert.severity === HubAlertSeverity.Critical),
    };
    this.#push({
      type: HubEventType.BootSummary,
      at: readyAt,
      boot: structuredClone(boot),
    });
    return structuredClone(boot);
  }

  listHeartbeats(): HubAgentHeartbeat[] {
    return [...this.#heartbeats.values()].map((heartbeat) => ({ ...heartbeat }));
  }

  listAlerts(): HubAlert[] {
    return this.#alerts.map((alert) => ({ ...alert }));
  }

  drainEvents(): HubEvent[] {
    const events = [...this.#events];
    this.#events.length = 0;
    return events;
  }

  peekEvents(): HubEvent[] {
    return this.#events.map((event) => structuredClone(event));
  }

  #push(event: HubEvent): void {
    this.#sequence += 1;
    void this.#sequence;
    this.#events.push(event);
  }
}

export { ALL_CAPABILITIES };
