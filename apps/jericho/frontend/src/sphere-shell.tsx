import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  CommandCenterMissionStage,
  DecisionOutcome,
  LifecycleStatus,
  type CommandCenterApproval,
  type CommandCenterSnapshot,
} from '@jericho/shared';

import { CoreClient, CoreRequestError, type CoreHealth } from './core-client';
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
const CODING_AGENT_POLL_MS = 5_000;
const FLEET_OFFLINE: FleetSnapshot = { available: false, agents: [], issues: [] };
const CODING_AGENTS_OFFLINE: CodingAgentSnapshot = { available: false, tasks: [] };

export interface FleetSnapshot {
  available: boolean;
  agents: Array<{ id: string; name: string; role: string; status: string; lastHeartbeatAt: string | null }>;
  issues: Array<{
    id: string; identifier: string; title: string; status: string;
    priority: string | null; assigneeAgentId: string | null;
    createdAt: string | null; completedAt: string | null;
  }>;
}

export interface CodingAgentSnapshot {
  available: boolean;
  tasks: Array<{
    taskId: string;
    workspaceId?: string;
    workspaceName?: string;
    sessionId?: string;
    deepLink?: string;
    lifecycleStatus: string;
    commitSha?: string;
    prUrl?: string;
    errorCode?: string;
  }>;
}

export function SphereShell({
  store,
  client,
  onRecalibrate,
  manageClient = true,
}: {
  store: CommandCenterStore;
  client: CoreClient;
  onRecalibrate?: () => void;
  manageClient?: boolean;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [fleet, setFleet] = useState<FleetSnapshot>(FLEET_OFFLINE);
  const [codingAgents, setCodingAgents] = useState<CodingAgentSnapshot>(CODING_AGENTS_OFFLINE);
  const [health, setHealth] = useState<CoreHealth | undefined>();
  const [healthStatus, setHealthStatus] = useState<'loading' | 'ready' | 'locked' | 'unavailable' | 'degraded'>('loading');
  const liveData = useMemo(
    () => projectLiveData(state.snapshot, state.status === 'ready', fleet, codingAgents),
    [state, fleet, codingAgents],
  );

  useEffect(() => {
    void client.health()
      .then((result) => {
        setHealth(result);
        setHealthStatus(result.ok ? 'ready' : 'degraded');
      })
      .catch((err: unknown) => {
        setHealth(undefined);
        if (err instanceof CoreRequestError && err.status === 401) {
          setHealthStatus('locked');
        } else {
          setHealthStatus('unavailable');
        }
      });
    if (!manageClient) return;
    void client.start();
    return () => client.stop();
  }, [client, manageClient]);

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
    let disposed = false;
    const poll = async () => {
      try {
        const response = await fetch('/api/v1/coding-agents', {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        });
        const body = await response.json() as CodingAgentSnapshot;
        if (!disposed) setCodingAgents(response.ok && Array.isArray(body.tasks) ? body : CODING_AGENTS_OFFLINE);
      } catch {
        if (!disposed) setCodingAgents(CODING_AGENTS_OFFLINE);
      }
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, CODING_AGENT_POLL_MS);
    return () => { disposed = true; clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!manageClient) return;
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
  }, [client, manageClient]);

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

  return <SphereApp liveData={liveData} health={health} healthStatus={healthStatus} onDirective={captureDirective} onVaultSearch={searchVault} onRecalibrate={onRecalibrate} commandActions={{
    searchMemory: (query: string) => client.searchVault(query, 8),
    openMemory: (relativePath: string) => client.openVaultNote(relativePath),
    proposeNoteReorganization: (input: { relativePath: string; title: string }) =>
      client.proposeNoteReorganization(input),
    decideProposal: (input: Parameters<CoreClient['decideProposal']>[0]) => client.decideProposal(input),
    decide: (approval: CommandCenterApproval, outcome: 'approved' | 'rejected') => client.decideMission({
      missionId: approval.missionId,
      planHash: approval.planHash,
      version: approval.version,
      outcome: outcome === 'approved' ? DecisionOutcome.Approved : DecisionOutcome.Rejected,
      reason: `${outcome === 'approved' ? 'Approved' : 'Rejected'} from sphere command overlay`,
    }),
    cancel: (mission: { id: string; planHash: string; version: number }) => client.cancelMission({
      missionId: mission.id,
      planHash: mission.planHash,
      version: mission.version,
      reason: 'Cancelled from sphere command overlay',
    }),
    retain: (missionId: string) => client.retainMission(missionId),
  }} />;
}

function projectLiveData(
  snapshot: CommandCenterSnapshot | undefined,
  connected: boolean,
  fleet: FleetSnapshot,
  codingAgents: CodingAgentSnapshot,
) {
  const missionRecords = snapshot?.missions ?? [];
  const approvals = new Map((snapshot?.approvals ?? []).map((approval) => [approval.missionId, approval]));
  // Halo agents: prefer the live Hermes fleet roster; otherwise the agents
  // attached to persisted missions. Never a fixture roster.
  const fallbackAgents = fleet.available
    ? fleet.agents.map((agent) => ({ id: agent.name, status: haloStatus(agent.status) }))
    : missionAgents(missionRecords);
  const agents = uniqueAgents([
    ...codingAgents.tasks.map((task) => ({
      id: task.workspaceName ?? task.taskId,
      status: codingAgentHaloStatus(task.lifecycleStatus),
    })),
    ...fallbackAgents,
  ]);
  const taskToMission = new Map(missionRecords.flatMap((mission) =>
    mission.taskGraph.map((task) => [task.id, mission.id] as const)));
  const receiptCountByMission = new Map<string, number>();
  for (const receipt of snapshot?.receipts ?? []) {
    if (!receipt.missionTaskId) continue;
    const missionId = taskToMission.get(receipt.missionTaskId);
    if (missionId) receiptCountByMission.set(missionId, (receiptCountByMission.get(missionId) ?? 0) + 1);
  }
  return {
    connected,
    agents,
    fleet: { ...fleet, codingAgents },
    nucleus: {
      nodes: snapshot?.nucleus.nodes.length ?? 0,
      edges: snapshot?.nucleus.edges.length ?? 0,
    },
    tasks: missionRecords.slice(0, 8).map((mission) => ({
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
    signals: (snapshot?.history ?? []).slice(0, 5).map((entry) => ({
      id: entry.id,
      time: new Date(entry.occurredAt).toLocaleTimeString('en-GB', { hour12: false }),
      source: entry.actor ?? entry.recordType,
      message: entry.title,
      level: entry.risk === 'critical' || entry.status === 'failed' ? 'critical' : entry.verified ? 'ok' : 'info',
    })),
    missions: missionRecords.map((mission) => ({
      id: mission.id,
      version: mission.version,
      planHash: mission.planHash,
      title: mission.title,
      objective: mission.objective,
      status: mission.status,
      stage: mission.stage,
      agents: mission.agents.map((agent) => agent.agentId).join(' + '),
      maxCostMicroUsd: mission.budget.limits.maxCostMicroUsd,
      actualCostMicroUsd: mission.budget.actualCostMicroUsd,
      evidenceCount: new Set(mission.timeline.flatMap((entry) => entry.evidenceEventIds)).size,
      receiptCount: receiptCountByMission.get(mission.id) ?? 0,
      active: [LifecycleStatus.Approved, LifecycleStatus.Active, LifecycleStatus.Paused, LifecycleStatus.PendingApproval].includes(mission.status),
      cancellable: [LifecycleStatus.Approved, LifecycleStatus.Active, LifecycleStatus.Paused, LifecycleStatus.PendingApproval].includes(mission.status),
      retainable: mission.status === LifecycleStatus.Succeeded,
      approval: approvals.get(mission.id),
    })),
    approvals: snapshot?.approvals ?? [],
    outcomes: (snapshot?.outcomes ?? []).map((outcome) => ({
      id: outcome.id,
      missionTaskId: outcome.missionTaskId,
      verified: outcome.verified,
      receiptCount: outcome.receiptIds.length,
    })),
    paperclip: snapshot?.knowledge?.paperclip ?? [],
    fleetStages: snapshot ? projectFleetStages(snapshot) : emptyFleetStages(),
  };
}

function uniqueAgents(agents: Array<{ id: string; status: string }>) {
  return [...new Map(agents.map((agent) => [agent.id, agent])).values()];
}

function codingAgentHaloStatus(status: string): string {
  if (['failed', 'timed_out', 'conductor_auth_required', 'incomplete'].includes(status)) return 'degraded';
  if (status === 'cancelled') return 'paused';
  return 'online';
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

function emptyFleetStages() {
  return ['INTAKE', 'INTERPRET', 'APPROVE', 'EXECUTE', 'LEARN'].map((label) => ({ label, count: 0, active: false }));
}

function projectFleetStages(snapshot: CommandCenterSnapshot) {
  const intake = (snapshot.reviewIntents?.length ?? 0) + snapshot.captureFailures.length;
  const interpret = snapshot.missions.filter((mission) => mission.stage === CommandCenterMissionStage.Plan).length;
  const approve = snapshot.approvals.length;
  const execute = snapshot.missions.filter((mission) => mission.stage === CommandCenterMissionStage.Execute).length;
  const learnKinds = new Set(['retain', 'present']);
  const persistedLearning = snapshot.history.filter((entry) => entry.verified && learnKinds.has(entry.kind)).length;
  const learn = persistedLearning
    + (snapshot.knowledge?.projectionReceipts.filter((receipt) => receipt.verified).length ?? 0)
    + (snapshot.knowledge?.evaluations.length ?? 0);
  return [
    { label: 'INTAKE', count: intake, active: intake > 0 },
    { label: 'INTERPRET', count: interpret, active: interpret > 0 },
    { label: 'APPROVE', count: approve, active: approve > 0 },
    { label: 'EXECUTE', count: execute, active: execute > 0 },
    { label: 'LEARN', count: learn, active: learn > 0 },
  ];
}

function approvalBinding(approval: CommandCenterApproval | undefined) {
  return approval ? { missionId: approval.missionId, planHash: approval.planHash, version: approval.version } : undefined;
}

function missionStatus(status: string, approval: CommandCenterApproval | undefined): string {
  if (approval) return 'READY';
  if (status === LifecycleStatus.Failed || status === LifecycleStatus.Cancelled || status === LifecycleStatus.Rejected) return 'BLOCKED';
  return status === LifecycleStatus.Active || status === LifecycleStatus.Succeeded ? 'READY' : 'NEW';
}

function ageLabel(value: string): string {
  const hours = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 3_600_000));
  return hours >= 24 ? `${Math.floor(hours / 24)}D ${hours % 24}H` : `${hours}H`;
}
