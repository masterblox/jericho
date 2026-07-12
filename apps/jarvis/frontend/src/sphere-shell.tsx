import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  CommandCenterMissionStage,
  DecisionOutcome,
  LifecycleStatus,
  type CommandCenterApproval,
  type CommandCenterSnapshot,
} from '@jericho/shared';

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

export function SphereShell({ store, client }: { store: CommandCenterStore; client: CoreClient }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const liveData = useMemo(() => projectLiveData(state.snapshot, state.status === 'ready'), [state]);

  useEffect(() => {
    void client.start();
    return () => client.stop();
  }, [client]);

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

  return <SphereApp liveData={liveData} onDirective={captureDirective} commandActions={{
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

function projectLiveData(snapshot: CommandCenterSnapshot | undefined, connected: boolean) {
  if (!snapshot) return {
    connected, tasks: [], signals: [], missions: [], approvals: [], outcomes: [], paperclip: [],
    fleetStages: emptyFleetStages(),
  };
  const approvals = new Map(snapshot.approvals.map((approval) => [approval.missionId, approval]));
  const taskToMission = new Map(snapshot.missions.flatMap((mission) =>
    mission.taskGraph.map((task) => [task.id, mission.id] as const)));
  const receiptCountByMission = new Map<string, number>();
  for (const receipt of snapshot.receipts) {
    if (!receipt.missionTaskId) continue;
    const missionId = taskToMission.get(receipt.missionTaskId);
    if (missionId) receiptCountByMission.set(missionId, (receiptCountByMission.get(missionId) ?? 0) + 1);
  }
  return {
    connected,
    tasks: snapshot.missions.slice(0, 5).map((mission) => ({
      id: mission.id,
      title: mission.title,
      meta: `${mission.stage} · ${mission.taskGraph.length} steps`,
      agent: mission.agents.map((agent) => agent.agentId).join(' + ') || 'JERICHO',
      status: missionStatus(mission.status, approvals.get(mission.id)),
      age: ageLabel(mission.updatedAt),
      approval: approvalBinding(approvals.get(mission.id)),
    })),
    signals: snapshot.history.slice(0, 5).map((entry) => ({
      id: entry.id,
      time: new Date(entry.occurredAt).toLocaleTimeString('en-GB', { hour12: false }),
      source: entry.actor ?? entry.recordType,
      message: entry.title,
      level: entry.risk === 'critical' || entry.status === 'failed' ? 'critical' : entry.verified ? 'ok' : 'info',
    })),
    missions: snapshot.missions.map((mission) => ({
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
    approvals: snapshot.approvals,
    outcomes: snapshot.outcomes.map((outcome) => ({
      id: outcome.id,
      missionTaskId: outcome.missionTaskId,
      verified: outcome.verified,
      receiptCount: outcome.receiptIds.length,
    })),
    paperclip: snapshot.knowledge?.paperclip ?? [],
    fleetStages: projectFleetStages(snapshot),
  };
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
