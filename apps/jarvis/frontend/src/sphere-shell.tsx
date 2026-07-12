import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { DecisionOutcome, LifecycleStatus, type CommandCenterApproval, type CommandCenterSnapshot } from '@jericho/shared';

import { CoreClient } from './core-client';
import { CommandCenterStore } from './command-center-store';
import {
  JERICHO_APPROVAL_GESTURE_EVENT,
  JERICHO_CANCEL_PENDING_EVENT,
  type ApprovalGestureDetail,
} from './gesture-events';
import SphereApp from './sphere/App.jsx';
import './sphere/styles/tokens.css';
import './sphere/styles/base.css';
import './sphere/styles/scene.css';

const FLEET_POLL_MS = 30_000;
const FLEET_OFFLINE: FleetSnapshot = { available: false, agents: [], issues: [] };

export interface FleetSnapshot {
  available: boolean;
  agents: Array<{ id: string; name: string; role: string; status: string; lastHeartbeatAt: string | null }>;
  issues: Array<{
    id: string; identifier: string; title: string; status: string;
    priority: string | null; assigneeAgentId: string | null;
    createdAt: string | null; completedAt: string | null;
  }>;
}

export function SphereShell({ store, client }: { store: CommandCenterStore; client: CoreClient }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [fleet, setFleet] = useState<FleetSnapshot>(FLEET_OFFLINE);
  const liveData = useMemo(
    () => projectLiveData(state.snapshot, state.status === 'ready', fleet),
    [state, fleet],
  );

  useEffect(() => {
    void client.start();
    return () => client.stop();
  }, [client]);

  // Fleet projection: the bridge proxies the Paperclip board read-only and
  // fails closed, so a 503 here is an honest "fleet offline", not an error.
  useEffect(() => {
    let disposed = false;
    const poll = async () => {
      try {
        const response = await fetch('/api/v1/fleet', {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        });
        const body = await response.json() as FleetSnapshot;
        if (!disposed) setFleet(response.ok && body.available ? body : FLEET_OFFLINE);
      } catch {
        if (!disposed) setFleet(FLEET_OFFLINE);
      }
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, FLEET_POLL_MS);
    return () => { disposed = true; clearInterval(timer); };
  }, []);

  useEffect(() => {
    const decide = (event: Event) => {
      const detail = (event as CustomEvent<ApprovalGestureDetail>).detail;
      if (!detail) return;
      void client.decideMission({
        missionId: detail.missionId,
        planHash: detail.planHash,
        version: detail.version,
        outcome: detail.outcome === 'approved' ? DecisionOutcome.Approved : DecisionOutcome.Rejected,
        reason: 'Held gesture from the active exact-plan approval',
      });
    };
    const cancel = () => {
      const active = document.querySelector<HTMLElement>('[data-jericho-active-approval="true"]');
      const missionId = active?.dataset.jerichoApprovalMissionId;
      const planHash = active?.dataset.jerichoApprovalPlanHash;
      const version = Number(active?.dataset.jerichoApprovalVersion);
      if (!missionId || !planHash || !Number.isSafeInteger(version)) return;
      void client.cancelMission({ missionId, planHash, version, reason: 'Both-open-palms cancellation' });
    };
    document.addEventListener(JERICHO_APPROVAL_GESTURE_EVENT, decide);
    document.addEventListener(JERICHO_CANCEL_PENDING_EVENT, cancel);
    return () => {
      document.removeEventListener(JERICHO_APPROVAL_GESTURE_EVENT, decide);
      document.removeEventListener(JERICHO_CANCEL_PENDING_EVENT, cancel);
    };
  }, [client]);

  const captureDirective = useCallback(async (directive: string) => {
    const occurredAt = new Date().toISOString();
    const response = await fetch('/api/v1/captures', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        kind: 'manual',
        sourceEventId: `sphere:${crypto.randomUUID()}`,
        occurredAt,
        payload: { text: directive },
      }),
    });
    if (!response.ok) throw new Error('Directive capture failed');
  }, []);

  // BRAIN search: bounded BM25 query against the vault gateway via the bridge.
  const searchVault = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return { available: true, count: 0, results: [] };
    const response = await fetch(
      `/api/v1/obsidian/search?q=${encodeURIComponent(trimmed)}&limit=5`,
      { credentials: 'same-origin', headers: { accept: 'application/json' } },
    );
    return await response.json() as {
      available: boolean;
      count: number;
      results: Array<{ path: string; title: string; excerpt: string; score: number }>;
    };
  }, []);

  return <SphereApp liveData={liveData} onDirective={captureDirective} onVaultSearch={searchVault} />;
}

function projectLiveData(
  snapshot: CommandCenterSnapshot | undefined,
  connected: boolean,
  fleet: FleetSnapshot,
) {
  const missions = snapshot?.missions ?? [];
  const approvals = new Map((snapshot?.approvals ?? []).map((approval) => [approval.missionId, approval]));
  // Halo agents: prefer the live Hermes fleet roster; otherwise the agents
  // attached to persisted missions. Never a fixture roster.
  const agents = fleet.available
    ? fleet.agents.map((agent) => ({ id: agent.name, status: haloStatus(agent.status) }))
    : missionAgents(missions);
  return {
    connected,
    agents,
    fleet,
    nucleus: {
      nodes: snapshot?.nucleus.nodes.length ?? 0,
      edges: snapshot?.nucleus.edges.length ?? 0,
    },
    tasks: missions.slice(0, 8).map((mission) => ({
      id: mission.id,
      title: mission.title,
      stage: mission.stage,
      meta: `${mission.stage} · ${mission.taskGraph.length} steps`,
      agent: mission.agents.map((agent) => agent.agentId).join(' + ') || 'JERICHO',
      status: missionStatus(mission.status, approvals.get(mission.id)),
      done: mission.status === LifecycleStatus.Succeeded || mission.status === LifecycleStatus.Archived,
      age: ageLabel(mission.updatedAt),
      approval: approvalBinding(approvals.get(mission.id)),
    })),
  };
}

function missionAgents(missions: CommandCenterSnapshot['missions']) {
  const agentStatus = new Map<string, string>();
  for (const mission of missions) {
    const blocked = mission.status === LifecycleStatus.Failed
      || mission.status === LifecycleStatus.Cancelled
      || mission.status === LifecycleStatus.Rejected;
    for (const agent of mission.agents) {
      const current = agentStatus.get(agent.agentId);
      agentStatus.set(agent.agentId, blocked || current === 'degraded' ? 'degraded' : 'online');
    }
  }
  return [...agentStatus].map(([id, status]) => ({ id, status }));
}

function haloStatus(fleetStatus: string): string {
  if (fleetStatus === 'error' || fleetStatus === 'stale') return 'degraded';
  if (fleetStatus === 'paused') return 'paused';
  return 'online';
}

function approvalBinding(approval: CommandCenterApproval | undefined) {
  return approval ? { missionId: approval.missionId, planHash: approval.planHash, version: approval.version } : undefined;
}

function missionStatus(status: string, approval: CommandCenterApproval | undefined): string {
  if (approval) return 'READY';
  if (status === 'failed' || status === 'blocked' || status === 'cancelled') return 'BLOCKED';
  return status === 'executing' || status === 'completed' ? 'READY' : 'NEW';
}

function ageLabel(value: string): string {
  const hours = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 3_600_000));
  return hours >= 24 ? `${Math.floor(hours / 24)}D ${hours % 24}H` : `${hours}H`;
}
