import {
  HUB_AGENT_IDS,
  type HubAgentId,
  type HubAgentStatus,
  type HubAlert,
  type HubCommandLogEntry,
  type HubEvent,
  type HubHealth,
  type HubMode,
} from '@jericho/shared';

/** Ordered Hub event bus for authenticated WebSocket-ready payloads. */
export class HubEventBus {
  #sequence = 0;
  readonly #events: HubEvent[] = [];

  nextSequence(): number {
    this.#sequence += 1;
    return this.#sequence;
  }

  publish(event: HubEvent): HubEvent {
    const sequenced = {
      ...event,
      sequence: event.sequence > 0 ? event.sequence : this.nextSequence(),
    } as HubEvent;
    this.#events.push(structuredClone(sequenced));
    return structuredClone(sequenced);
  }

  drain(): HubEvent[] {
    const events = this.#events.map((event) => structuredClone(event));
    this.#events.length = 0;
    return events;
  }

  peek(): HubEvent[] {
    return this.#events.map((event) => structuredClone(event));
  }
}

export class HubTelemetry {
  readonly #agents = new Map<HubAgentId, HubAgentStatus>();
  readonly #alerts: HubAlert[] = [];
  readonly #log: HubCommandLogEntry[] = [];
  readonly #bus: HubEventBus;
  readonly #now: () => string;
  #mode: HubMode = 'live';

  constructor(bus: HubEventBus, now: () => string = () => new Date().toISOString()) {
    this.#bus = bus;
    this.#now = now;
    for (const agentId of HUB_AGENT_IDS) {
      this.#agents.set(agentId, {
        agentId,
        health: 'green',
        currentTask: null,
        lastOutputAt: null,
        unreadAlerts: 0,
      });
    }
  }

  setMode(mode: HubMode): void {
    this.#mode = mode;
    this.#bus.publish({ type: 'mode', sequence: 0, mode });
  }

  get mode(): HubMode {
    return this.#mode;
  }

  recordHeartbeat(input: {
    agentId: HubAgentId;
    health: HubHealth;
    currentTask: string | null;
  }): HubAgentStatus {
    const status: HubAgentStatus = {
      agentId: input.agentId,
      health: input.health,
      currentTask: input.currentTask,
      lastOutputAt: this.#now(),
      unreadAlerts: this.#alerts.filter(
        (alert) => alert.agentId === input.agentId && !alert.acknowledged,
      ).length,
    };
    this.#agents.set(input.agentId, status);
    this.#bus.publish({ type: 'agent_status', sequence: 0, status });
    return { ...status };
  }

  appendCommandLog(entry: Omit<HubCommandLogEntry, 'occurredAt'> & { occurredAt?: string }): HubCommandLogEntry {
    const full: HubCommandLogEntry = {
      ...entry,
      occurredAt: entry.occurredAt ?? this.#now(),
    };
    this.#log.push(full);
    this.#bus.publish({ type: 'command_log', sequence: 0, entry: full });
    return { ...full };
  }

  raiseAlert(alert: Omit<HubAlert, 'occurredAt' | 'acknowledged'> & {
    occurredAt?: string;
    acknowledged?: boolean;
  }): HubAlert {
    const full: HubAlert = {
      ...alert,
      occurredAt: alert.occurredAt ?? this.#now(),
      acknowledged: alert.acknowledged ?? false,
    };
    this.#alerts.push(full);
    const agent = this.#agents.get(full.agentId);
    if (agent) {
      agent.unreadAlerts = this.#alerts.filter(
        (item) => item.agentId === full.agentId && !item.acknowledged,
      ).length;
      this.#agents.set(full.agentId, agent);
    }
    this.#bus.publish({ type: 'alert', sequence: 0, alert: full });
    return { ...full };
  }

  listAgents(): HubAgentStatus[] {
    return HUB_AGENT_IDS.map((id) => ({ ...this.#agents.get(id)! }));
  }

  listAlerts(): HubAlert[] {
    return [...this.#alerts]
      .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
      .map((alert) => ({ ...alert }));
  }

  listCommandLog(): HubCommandLogEntry[] {
    return this.#log.map((entry) => ({ ...entry }));
  }

  totals(queuedTasks: number, opportunities: number): {
    activeAgents: number;
    queuedTasks: number;
    opportunities: number;
  } {
    return {
      activeAgents: this.listAgents().filter((agent) => agent.health !== 'offline').length,
      queuedTasks,
      opportunities,
    };
  }
}

function priorityRank(priority: HubAlert['priority']): number {
  switch (priority) {
    case 'critical':
      return 0;
    case 'high':
      return 1;
    case 'normal':
      return 2;
    case 'low':
      return 3;
  }
}
