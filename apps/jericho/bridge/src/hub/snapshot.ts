import { createHash } from 'node:crypto';

import type {
  HubAggregationWindow,
  HubAgentStatus,
  HubAlert,
  HubBootAnnouncementPlan,
  HubCommandLogEntry,
  HubConnection,
  HubDemoStream,
  HubMode,
  HubSealedDemoSnapshot,
  HubSnapshot,
  HubWalkthroughEvent,
  HubWhisperProbeResult,
} from '@jericho/shared';

export function buildHubSnapshot(input: {
  generatedAt: string;
  mode: HubMode;
  connection: HubConnection;
  agents: readonly HubAgentStatus[];
  commandLog: readonly HubCommandLogEntry[];
  alerts: readonly HubAlert[];
  totals: { activeAgents: number; queuedTasks: number; opportunities: number };
  bootAnnouncement?: HubBootAnnouncementPlan;
  aggregation?: HubAggregationWindow;
  whisper?: HubWhisperProbeResult;
  demos?: readonly HubSealedDemoSnapshot[];
  walkthroughs?: Record<HubDemoStream, HubWalkthroughEvent[]>;
}): HubSnapshot {
  const snapshot: HubSnapshot = {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    mode: input.mode,
    connection: input.connection,
    agents: input.agents.map((agent) => ({ ...agent })),
    commandLog: input.commandLog.map((entry) => ({ ...entry })),
    alerts: input.alerts.map((alert) => ({ ...alert })),
    totals: { ...input.totals },
    revision: '',
    ...(input.bootAnnouncement ? { bootAnnouncement: structuredClone(input.bootAnnouncement) } : {}),
    ...(input.aggregation ? { aggregation: structuredClone(input.aggregation) } : {}),
    ...(input.whisper ? { whisper: { ...input.whisper } } : {}),
    ...(input.demos
      ? { demos: input.demos.map((demo) => ({ ...demo, payload: { ...demo.payload } })) }
      : {}),
    ...(input.walkthroughs ? { walkthroughs: cloneWalkthroughs(input.walkthroughs) } : {}),
  };
  snapshot.revision = createHash('sha256')
    .update(
      JSON.stringify({
        generatedAt: snapshot.generatedAt,
        mode: snapshot.mode,
        totals: snapshot.totals,
        agentHealth: snapshot.agents.map((agent) => [agent.agentId, agent.health]),
        logIds: snapshot.commandLog.map((entry) => entry.id),
        alertIds: snapshot.alerts.map((alert) => alert.id),
      }),
    )
    .digest('hex')
    .slice(0, 16);
  return snapshot;
}

function cloneWalkthroughs(
  walkthroughs: Record<HubDemoStream, HubWalkthroughEvent[]>,
): Record<HubDemoStream, HubWalkthroughEvent[]> {
  const clone = {} as Record<HubDemoStream, HubWalkthroughEvent[]>;
  for (const [stream, events] of Object.entries(walkthroughs) as Array<
    [HubDemoStream, HubWalkthroughEvent[]]
  >) {
    clone[stream] = events.map((event) => ({ ...event, data: { ...event.data } }));
  }
  return clone;
}
