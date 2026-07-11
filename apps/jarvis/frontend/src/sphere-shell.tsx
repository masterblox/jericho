import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { DecisionOutcome, type CommandCenterApproval, type CommandCenterSnapshot } from '@jericho/shared';

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

  return <SphereApp liveData={liveData} onDirective={captureDirective} />;
}

function projectLiveData(snapshot: CommandCenterSnapshot | undefined, connected: boolean) {
  if (!snapshot) return { connected, tasks: [], signals: [] };
  const approvals = new Map(snapshot.approvals.map((approval) => [approval.missionId, approval]));
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
  };
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
