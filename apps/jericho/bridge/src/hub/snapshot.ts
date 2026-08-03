import { createHash } from 'node:crypto';

import {
  type HubAggregationWindow,
  type HubAgentHeartbeat,
  type HubAlert,
  type HubBootSummary,
  type HubCommandRecord,
  type HubIngressPort,
  type HubSealedDemoSnapshot,
  type HubSnapshot,
  type HubWalkthroughEvent,
  type HubWalkthroughStream,
  type HubWhisperProbeResult,
} from '@jericho/shared';

export function buildHubSnapshot(input: {
  generatedAt: string;
  boot: HubBootSummary;
  commands: readonly HubCommandRecord[];
  heartbeats: readonly HubAgentHeartbeat[];
  alerts: readonly HubAlert[];
  aggregation: HubAggregationWindow;
  demos: readonly HubSealedDemoSnapshot[];
  walkthroughs: Record<HubWalkthroughStream, HubWalkthroughEvent[]>;
  whisper: HubWhisperProbeResult;
  ingressPorts: readonly HubIngressPort[];
}): HubSnapshot {
  const snapshot: HubSnapshot = {
    revision: '',
    generatedAt: input.generatedAt,
    boot: structuredClone(input.boot),
    commands: input.commands.map((command) => ({ ...command })),
    heartbeats: input.heartbeats.map((heartbeat) => ({ ...heartbeat })),
    alerts: input.alerts.map((alert) => ({ ...alert })),
    aggregation: structuredClone(input.aggregation),
    demos: input.demos.map((demo) => ({ ...demo, payload: { ...demo.payload } })),
    walkthroughs: cloneWalkthroughs(input.walkthroughs),
    whisper: { ...input.whisper },
    ingressPorts: [...input.ingressPorts],
  };
  snapshot.revision = revisionFor(snapshot);
  return snapshot;
}

function cloneWalkthroughs(
  walkthroughs: Record<HubWalkthroughStream, HubWalkthroughEvent[]>,
): Record<HubWalkthroughStream, HubWalkthroughEvent[]> {
  const clone = {} as Record<HubWalkthroughStream, HubWalkthroughEvent[]>;
  for (const [stream, events] of Object.entries(walkthroughs) as Array<
    [HubWalkthroughStream, HubWalkthroughEvent[]]
  >) {
    clone[stream] = events.map((event) => ({ ...event, data: { ...event.data } }));
  }
  return clone;
}

function revisionFor(snapshot: Omit<HubSnapshot, 'revision'> & { revision: string }): string {
  const material = {
    generatedAt: snapshot.generatedAt,
    bootId: snapshot.boot.bootId,
    commandIds: snapshot.commands.map((command) => command.id),
    heartbeatSequences: snapshot.heartbeats.map((heartbeat) => [
      heartbeat.agentId,
      heartbeat.sequence,
    ]),
    alertIds: snapshot.alerts.map((alert) => alert.id),
    aggregationCounts: snapshot.aggregation.counts,
    demoHashes: snapshot.demos.map((demo) => demo.contentHash),
  };
  return createHash('sha256').update(JSON.stringify(material)).digest('hex').slice(0, 16);
}
