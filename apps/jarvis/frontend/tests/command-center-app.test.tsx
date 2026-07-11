// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AgentLane,
  CommandCenterActionKind,
  CommandCenterMissionStage,
  CommandCenterTimelineKind,
  ConnectorHealthStatus,
  DecisionOutcome,
  EntityType,
  EscalationReason,
  LifecycleStatus,
  MissionTaskKind,
  MutationClass,
  NucleusNodeKind,
  ReceiptStatus,
  RiskLevel,
  RouteType,
  SourceType,
  type CommandCenterSnapshot,
} from '@jericho/shared';

import { CommandCenterApp } from '../src/command-center-app';
import { CommandCenterStore } from '../src/command-center-store';
import {
  JERICHO_APPROVAL_GESTURE_EVENT,
  JERICHO_CANCEL_PENDING_EVENT,
} from '../src/gesture-events';
import {
  JERICHO_NUCLEUS_CAMERA_EVENT,
  JERICHO_NUCLEUS_DEPTH_EVENT,
} from '../src/gesture-events';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CommandCenterApp', () => {
  it('renders all operator bays from verified Core data, never legacy fixtures, and submits exact approval scope', async () => {
    const store = new CommandCenterStore();
    store.replace(populatedSnapshot());
    const decideMission = vi.fn().mockResolvedValue({});
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<CommandCenterApp store={store} client={{ start: vi.fn(), stop: vi.fn(), decideMission }} autoStart={false} />);

    expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Communications' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Mission pipeline' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Nucleus' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Approvals' })).toBeTruthy();
    expect(screen.getByText('Reply to Michael')).toBeTruthy();
    expect(screen.getAllByText('Deploy bounded Core').length).toBeGreaterThan(0);
    expect(screen.queryByText('Pull open Paperclip issues')).toBeNull();
    expect(screen.queryByText('draft an email')).toBeNull();

    expect(screen.getByText('Carlos')).toBeTruthy();
    expect(screen.getByText('Scope checked against approved evidence')).toBeTruthy();
    expect(screen.getByText('event-plan-1')).toBeTruthy();
    expect(screen.getAllByText('DEV').length).toBeGreaterThan(0);
    expect(screen.queryByText('Unverified fiction')).toBeNull();
    expect(screen.getByText(/telegram:send_message → Michael \[reversible\]/)).toBeTruthy();
    expect(screen.getByText(/Revert commit/)).toBeTruthy();
    expect(screen.getByText(/automatic; evidence: build/)).toBeTruthy();
    expect(screen.getByText('Release artifact')).toBeTruthy();
    expect(screen.getByText(/Verify and prepare.*depends on: none/i)).toBeTruthy();
    expect(screen.getAllByText(/tools: git, telegram\.send/i)).toHaveLength(2);
    expect(screen.getByText(/concurrency 2.*retries 1/i)).toBeTruthy();
    expect(screen.getAllByText(/jericho.*apps\/jarvis/i)).toHaveLength(2);
    expect(screen.getAllByText(/channels.*telegram/i)).toHaveLength(2);
    expect(screen.getAllByText(/credentials.*telegram-primary/i)).toHaveLength(2);
    expect(screen.getByText(/data scopes.*telegram:selected/i)).toBeTruthy();
    expect(screen.getAllByText(/mutations.*read only.*reversible/i)).toHaveLength(2);
    expect(screen.getByText(/escalations.*cost budget.*new recipient/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Approve bounded mission' }));
    expect(decideMission).toHaveBeenCalledWith({
      missionId: 'mission-1',
      outcome: DecisionOutcome.Approved,
      planHash: 'a'.repeat(64),
      version: 3,
      reason: 'Approved from Jericho command center',
    });
  });

  it('uses a semantic approval gesture once with the displayed plan scope and no second confirmation', async () => {
    const store = new CommandCenterStore();
    store.replace(populatedSnapshot());
    const decideMission = vi.fn().mockResolvedValue({});
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<CommandCenterApp store={store} client={{ start: vi.fn(), stop: vi.fn(), decideMission }} autoStart={false} />);
    const activeApproval = screen.getByText('a'.repeat(64)).closest('article');
    expect(activeApproval?.dataset.jerichoActiveApproval).toBe('true');

    act(() => {
      document.dispatchEvent(new CustomEvent(JERICHO_APPROVAL_GESTURE_EVENT, {
        detail: {
          outcome: DecisionOutcome.Approved,
          missionId: 'mission-1',
          planHash: 'a'.repeat(64),
          version: 3,
        },
      }));
    });
    await waitFor(() => expect(decideMission).toHaveBeenCalledTimes(1));
    expect(decideMission).toHaveBeenCalledWith({
      missionId: 'mission-1',
      outcome: DecisionOutcome.Approved,
      planHash: 'a'.repeat(64),
      version: 3,
      reason: 'Approved by held gesture in Jericho command center',
    });
    expect(confirm).not.toHaveBeenCalled();

    act(() => {
      document.dispatchEvent(new CustomEvent(JERICHO_APPROVAL_GESTURE_EVENT, {
        detail: {
          outcome: DecisionOutcome.Approved,
          missionId: 'mission-1',
          planHash: 'a'.repeat(64),
          version: 3,
        },
      }));
    });
    expect(decideMission).toHaveBeenCalledTimes(1);
  });

  it('ignores a held approval gesture bound to a stale plan version or hash', () => {
    const store = new CommandCenterStore();
    store.replace(populatedSnapshot());
    const decideMission = vi.fn();

    render(<CommandCenterApp
      store={store}
      client={{ start: vi.fn(), stop: vi.fn(), decideMission }}
      autoStart={false}
    />);

    act(() => {
      document.dispatchEvent(new CustomEvent(JERICHO_APPROVAL_GESTURE_EVENT, {
        detail: {
          outcome: DecisionOutcome.Approved,
          missionId: 'mission-1',
          planHash: 'b'.repeat(64),
          version: 2,
        },
      }));
    });

    expect(decideMission).not.toHaveBeenCalled();
  });

  it('renders missing timeline attribution explicitly without inventing an actor', () => {
    const store = new CommandCenterStore();
    store.replace(populatedSnapshot());

    render(<CommandCenterApp
      store={store}
      client={{ start: vi.fn(), stop: vi.fn(), decideMission: vi.fn() }}
      autoStart={false}
    />);

    expect(screen.getByText('Unknown actor')).toBeTruthy();
    expect(screen.getByText('Unknown reason')).toBeTruthy();
    expect(screen.getByText('Unknown provenance')).toBeTruthy();
    expect(screen.queryByText('Jericho')).toBeNull();
  });

  it('applies semantic BFS depth and camera controls only to the local Nucleus view', () => {
    const store = new CommandCenterStore();
    const snapshot = populatedSnapshot();
    const at = snapshot.generatedAt;
    snapshot.nucleus.nodes.push({
      id: 'node-research', kind: NucleusNodeKind.Agent, recordType: 'agent', recordId: 'research',
      label: 'Research', updatedAt: at, evidenceEventIds: ['event-plan-1'], verified: true,
    });
    snapshot.nucleus.edges.push({
      id: 'edge-research', fromNodeId: 'node-research', toNodeId: 'node-dev', relation: 'supports',
      evidenceEventIds: ['event-plan-1'], verified: true,
    });
    store.replace(snapshot);

    const { container } = render(<CommandCenterApp
      store={store}
      client={{ start: vi.fn(), stop: vi.fn(), decideMission: vi.fn() }}
      autoStart={false}
    />);
    expect(screen.getByLabelText('Research, agent')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Decrease semantic depth' }));
    expect(screen.queryByLabelText('Research, agent')).toBeNull();
    expect(screen.getByText('Semantic depth 1')).toBeTruthy();

    act(() => document.dispatchEvent(new CustomEvent(JERICHO_NUCLEUS_DEPTH_EVENT, {
      detail: { delta: 1 },
    })));
    expect(screen.getByLabelText('Research, agent')).toBeTruthy();

    act(() => document.dispatchEvent(new CustomEvent(JERICHO_NUCLEUS_CAMERA_EVENT, {
      detail: { phase: 'start', point: { x: 300, y: 200 } },
    })));
    expect(container.querySelector('.jericho-nucleus-viewport')?.classList.contains('is-clutched')).toBe(true);
    act(() => document.dispatchEvent(new CustomEvent(JERICHO_NUCLEUS_CAMERA_EVENT, {
      detail: { phase: 'end', cancelled: false },
    })));
    expect(container.querySelector('.jericho-nucleus-viewport')?.classList.contains('is-clutched')).toBe(false);
  });

  it('previews typed relationships locally from keyboard or gesture and never mutates verified truth', () => {
    const store = new CommandCenterStore();
    const snapshot = populatedSnapshot();
    store.replace(snapshot);

    render(<CommandCenterApp
      store={store}
      client={{ start: vi.fn(), stop: vi.fn(), decideMission: vi.fn() }}
      autoStart={false}
    />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Relationship source' }), {
      target: { value: 'node-dev' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Relationship destination' }), {
      target: { value: 'node-mission' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Relationship type' }), {
      target: { value: 'supports' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview relationship' }));
    expect(screen.getByText('LOCAL PREVIEW · NOT SAVED')).toBeTruthy();
    expect(screen.getByText('DEV —[supports]→ Deploy bounded Core')).toBeTruthy();
    expect(snapshot.nucleus.edges).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel pending' }));
    expect(screen.queryByText('LOCAL PREVIEW · NOT SAVED')).toBeNull();

    const source = screen.getByLabelText('Deploy bounded Core, mission');
    const destination = screen.getByLabelText('DEV, agent');
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn().mockReturnValue([destination]),
    });
    act(() => source.dispatchEvent(new CustomEvent('jericho:drag-start', {
      bubbles: true,
      detail: { targetId: 'nucleus:node-mission', point: { x: 100, y: 100 } },
    })));
    act(() => source.dispatchEvent(new CustomEvent('jericho:drag-end', {
      bubbles: true,
      detail: { targetId: 'nucleus:node-mission', point: { x: 200, y: 200 }, cancelled: false },
    })));
    expect(screen.getByText('Deploy bounded Core —[supports]→ DEV')).toBeTruthy();
    expect(snapshot.nucleus.edges).toHaveLength(1);
  });

  it('submits exact selected-mission cancellation and relationship proposals to Core', async () => {
    const store = new CommandCenterStore();
    store.replace(populatedSnapshot());
    const cancelMission = vi.fn().mockResolvedValue({});
    const proposeRelationship = vi.fn().mockResolvedValue({});
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<CommandCenterApp
      store={store}
      client={{
        start: vi.fn(), stop: vi.fn(), decideMission: vi.fn(),
        cancelMission, proposeRelationship,
      }}
      autoStart={false}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel pending' }));
    await waitFor(() => expect(cancelMission).toHaveBeenCalledWith({
      missionId: 'mission-1', planHash: 'a'.repeat(64), version: 3,
      reason: 'Cancelled from Jericho command center',
    }));
    cancelMission.mockClear();
    confirm.mockClear();
    act(() => document.dispatchEvent(new CustomEvent(JERICHO_CANCEL_PENDING_EVENT, {
      detail: { source: 'both-open-palms' },
    })));
    await waitFor(() => expect(cancelMission).toHaveBeenCalledWith({
      missionId: 'mission-1', planHash: 'a'.repeat(64), version: 3,
      reason: 'Cancelled by held both-open-palms gesture in Jericho command center',
    }));
    expect(confirm).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('combobox', { name: 'Relationship source' }), {
      target: { value: 'node-dev' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Relationship destination' }), {
      target: { value: 'node-mission' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview relationship' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit relationship for review' }));
    await waitFor(() => expect(proposeRelationship).toHaveBeenCalledWith({
      fromNodeId: 'node-dev', toNodeId: 'node-mission', relation: 'related_to',
    }));
    expect(store.getSnapshot().snapshot?.nucleus.edges).toHaveLength(1);
  });

  it('retains only a succeeded mission through the verified Core writer', async () => {
    const store = new CommandCenterStore();
    const snapshot = populatedSnapshot();
    snapshot.missions[0].status = LifecycleStatus.Succeeded;
    snapshot.missions[0].stage = CommandCenterMissionStage.Present;
    store.replace(snapshot);
    const retainMission = vi.fn().mockResolvedValue({
      relativePath: 'Jericho/Missions/mission-1.md', status: 'created',
    });

    render(<CommandCenterApp
      store={store}
      client={{ start: vi.fn(), stop: vi.fn(), decideMission: vi.fn(), retainMission }}
      autoStart={false}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Retain verified mission' }));

    await waitFor(() => expect(retainMission).toHaveBeenCalledWith('mission-1'));
    expect(screen.getByText('Retained in Jericho/Missions/mission-1.md · created')).toBeTruthy();
  });

  it('renders honest loading, unavailable, disconnected, and empty states without fabricated fallback data', () => {
    const store = new CommandCenterStore();
    const client = { start: vi.fn(), stop: vi.fn(), decideMission: vi.fn() };
    const view = render(<CommandCenterApp store={store} client={client} autoStart={false} />);
    expect(screen.getByText('Waiting for Jericho Core')).toBeTruthy();

    act(() => store.unavailable('Core offline'));
    expect(screen.getByText('Core offline')).toBeTruthy();
    act(() => store.replace(emptyCommandCenter()));
    expect(screen.getAllByText('No verified items').length).toBeGreaterThan(0);
    act(() => store.disconnected('Live updates disconnected'));
    expect(screen.getByText('Live updates disconnected')).toBeTruthy();
    view.unmount();
  });
});

function emptyCommandCenter(): CommandCenterSnapshot {
  return {
    revision: 'empty', generatedAt: '2026-07-11T00:00:00.000Z',
    today: { date: '2026-07-11', taskIds: [], commitmentIds: [], activeMissionIds: [], pendingApprovalIds: [] },
    tasks: [], communications: [], people: [], commitments: [], missions: [], approvals: [], proposals: [],
    activeAssignments: [], outcomes: [], receipts: [], history: [], connectors: [],
    captureFailures: [], lastChangeSequence: 0,
    nucleus: { nodes: [], edges: [], activityPulses: [] },
  };
}

function populatedSnapshot(): CommandCenterSnapshot {
  const at = '2026-07-11T09:00:00.000Z';
  const provenance = [{ source: 'test', sourceType: SourceType.System, observedAt: at }];
  const snapshot = emptyCommandCenter();
  return {
    ...snapshot,
    revision: 'revision-7', lastChangeSequence: 7, generatedAt: at,
    today: {
      date: '2026-07-11', taskIds: ['task-entity'], commitmentIds: ['commitment-1'],
      activeMissionIds: [], pendingApprovalIds: ['approval-mission-1'],
    },
    tasks: [{
      id: 'task-entity', entityType: EntityType.Task, label: 'Reply to Michael', rank: 1,
      status: LifecycleStatus.Active, risk: RiskLevel.Low, confidence: 0.98,
      freshness: { observedAt: at }, evidenceEventIds: ['event-message-1'],
      attributes: { state: 'Todo' }, updatedAt: at,
    }],
    communications: [{
      id: 'conversation-1', entityType: EntityType.Conversation, label: 'Michael · APL', rank: 1,
      status: LifecycleStatus.Active, risk: RiskLevel.Low, confidence: 0.95,
      freshness: { observedAt: at }, evidenceEventIds: ['event-message-1'], attributes: {}, updatedAt: at,
    }],
    people: [{
      id: 'person-michael', entityType: EntityType.Person, label: 'Michael', rank: 1,
      freshness: { observedAt: at }, evidenceEventIds: ['event-message-1'], attributes: {}, updatedAt: at,
    }],
    commitments: [{
      id: 'commitment-1', entityType: EntityType.Commitment, label: 'Reply before noon', rank: 1,
      status: LifecycleStatus.Active, freshness: { observedAt: at },
      evidenceEventIds: ['event-message-1'], attributes: {}, updatedAt: at,
    }],
    missions: [{
      id: 'mission-1', seriesId: 'mission-series', version: 3, planHash: 'a'.repeat(64),
      title: 'Deploy bounded Core', objective: 'Ship verified Core safely',
      status: LifecycleStatus.PendingApproval, stage: CommandCenterMissionStage.Approve,
      risk: RiskLevel.Medium,
      taskGraph: [{
        id: 'task-plan', title: 'Verify and prepare', status: LifecycleStatus.Queued,
        sequence: 0, dependsOn: [], lane: AgentLane.Dev, agentId: 'dev',
        capabilityIds: ['cap-dev'], estimatedCostMicroUsd: 500,
        expectedArtifact: { type: 'report', description: 'Verified build', verification: ['tests'], requiredEvidence: ['build'] },
      }],
      agents: [{ taskId: 'task-plan', agentId: 'dev', lane: AgentLane.Dev, capabilityIds: ['cap-dev'] }],
      budget: {
        limits: { maxCostMicroUsd: 2_000, maxRuntimeMs: 900_000, maxConcurrency: 2, maxRetriesPerAssignment: 1 },
        plannedCostMicroUsd: 500, recordedEstimatedCostMicroUsd: 500,
        actualCostMicroUsd: 0, elapsedRuntimeMs: 0, activeAssignments: 0, assignmentAttempts: 0,
      },
      acceptanceTests: [{ id: 'tests', description: 'All tests pass', verification: 'automatic', requiredEvidence: ['build'] }],
      escalationConditions: [EscalationReason.CostBudget],
      timeline: [{
        id: 'timeline-plan', kind: CommandCenterTimelineKind.Mission, occurredAt: at,
        title: 'Plan proposed', recordType: 'mission', recordId: 'mission-1', missionId: 'mission-1',
        status: LifecycleStatus.PendingApproval, evidenceEventIds: ['event-plan-1'], verified: true,
        actor: 'Carlos', reason: 'Scope checked against approved evidence',
        provenance,
      }, {
        id: 'timeline-receipt', kind: CommandCenterTimelineKind.Receipt, occurredAt: at,
        title: 'Receipt pending', recordType: 'receipt', recordId: 'receipt-pending', missionId: 'mission-1',
        status: ReceiptStatus.Pending, evidenceEventIds: [], verified: false, provenance: [],
      }],
      createdAt: at, updatedAt: at,
    }],
    approvals: [{
      id: 'approval-mission-1', missionId: 'mission-1', planHash: 'a'.repeat(64), version: 3,
      title: 'Deploy bounded Core', objective: 'Ship verified Core safely', risk: RiskLevel.Medium,
      affectedParties: [{ entityId: 'person-michael', label: 'Michael', entityType: EntityType.Person }],
      affectedSystems: ['github'],
      externalActions: [{
        connectorId: 'telegram', action: 'send_message', destination: 'chat:michael',
        recipient: 'Michael', idempotencyKey: 'send-michael-1', mutationClass: MutationClass.Reversible,
      }],
      agents: [{ taskId: 'task-plan', agentId: 'dev', lane: AgentLane.Dev, capabilityIds: ['cap-dev'] }],
      cost: { maximumMicroUsd: 2_000, plannedMicroUsd: 500, actualMicroUsd: 0 },
      time: { maximumRuntimeMs: 900_000, elapsedRuntimeMs: 0 },
      acceptanceTests: [{ id: 'tests', description: 'All tests pass', verification: 'automatic', requiredEvidence: ['build'] }],
      rollback: { strategy: 'revert', steps: ['Revert commit'], verification: 'Tests pass' },
      deliverables: [{ id: 'release', description: 'Release artifact', artifactType: 'bundle', required: true }],
      taskGraph: [{
        id: 'task-plan', kind: MissionTaskKind.Execute, title: 'Verify and prepare', sequence: 0,
        lane: AgentLane.Dev, selectedAgentId: 'dev', capabilityIds: ['cap-dev'],
        requiredActions: ['code.test'], requiredTools: ['git', 'telegram.send'], model: 'local', maxTokens: 5_000,
        writableScope: {
          allowedTools: ['git'], allowedSystems: ['github'],
          allowedRepositories: [{
            repository: 'jericho', writablePaths: ['apps/jarvis'],
            mutationClasses: [MutationClass.ReadOnly, MutationClass.Reversible],
          }],
          allowedChannels: ['telegram'], allowedRecipients: ['person-michael'],
          allowedCredentialRefs: ['telegram-primary'], allowedDataScopes: ['telegram:selected'],
          allowedMutationClasses: [MutationClass.ReadOnly, MutationClass.Reversible],
        },
        dependsOn: [], evidenceEventIds: ['event-plan-1'],
        expectedArtifact: {
          type: 'report', description: 'Verified build', verification: ['tests'], requiredEvidence: ['build'],
        },
        input: {}, estimatedCostMicroUsd: 500, route: RouteType.Agent, risk: RiskLevel.Low,
      }],
      budget: { maxCostMicroUsd: 2_000, maxRuntimeMs: 900_000, maxConcurrency: 2, maxRetriesPerAssignment: 1 },
      permissions: {
        allowedTools: ['git', 'telegram.send'], allowedSystems: ['github'],
        allowedRepositories: [{
          repository: 'jericho', writablePaths: ['apps/jarvis'],
          mutationClasses: [MutationClass.ReadOnly, MutationClass.Reversible],
        }],
        allowedChannels: ['telegram'], allowedRecipients: ['person-michael'],
        allowedCredentialRefs: ['telegram-primary'], allowedDataScopes: ['telegram:selected'],
        allowedMutationClasses: [MutationClass.ReadOnly, MutationClass.Reversible],
      },
      escalationConditions: [EscalationReason.CostBudget, EscalationReason.NewRecipient],
      actions: [{
        id: 'approve-mission-1', kind: CommandCenterActionKind.ApproveMission,
        label: 'Approve bounded mission', targetType: 'mission', targetId: 'mission-1',
        method: 'POST', endpoint: '/api/v1/missions/mission-1/decisions', enabled: true,
        requiresConfirmation: true,
        payload: { outcome: DecisionOutcome.Approved, planHash: 'a'.repeat(64), version: 3 },
      }],
    }],
    activeAssignments: [{
      id: 'assignment-1', missionId: 'mission-1', missionTaskId: 'task-plan', agentId: 'dev',
      capabilityIds: ['cap-dev'], status: LifecycleStatus.Active, route: RouteType.Agent,
      risk: RiskLevel.Low, instructions: {}, evidenceEventIds: ['event-plan-1'],
      expectedArtifact: { type: 'report', description: 'Verified build', verification: ['tests'], requiredEvidence: ['build'] },
      idempotencyKey: 'assignment-key', attempt: 1, maxAttempts: 2, availableAt: at,
      estimatedCostMicroUsd: 500, assignedAt: at, provenance,
    }],
    outcomes: [{
      id: 'outcome-1', missionId: 'mission-1', missionTaskId: 'task-plan',
      assignmentId: 'assignment-1', status: LifecycleStatus.Active,
      evidenceEventIds: ['event-plan-1'], receiptIds: [], verified: false,
    }],
    receipts: [{
      id: 'receipt-1', assignmentId: 'assignment-1', missionTaskId: 'task-plan',
      action: 'prepare', idempotencyKey: 'receipt-key', destination: 'local',
      status: ReceiptStatus.Pending, route: RouteType.Local, risk: RiskLevel.Low,
      requestedAt: at, verified: false, evidenceEventIds: ['event-plan-1'], attempt: 1, provenance,
    }],
    history: [],
    connectors: [{
      connectorId: 'linear', status: ConnectorHealthStatus.Healthy, checkedAt: at,
      consecutiveFailures: 0, freshness: { observedAt: at }, capabilities: [], details: {}, provenance,
    }],
    nucleus: {
      nodes: [
        {
          id: 'node-mission', kind: NucleusNodeKind.Mission, recordType: 'mission', recordId: 'mission-1',
          label: 'Deploy bounded Core', status: LifecycleStatus.PendingApproval,
          risk: RiskLevel.Medium, updatedAt: at, evidenceEventIds: ['event-plan-1'], verified: true,
        },
        {
          id: 'node-dev', kind: NucleusNodeKind.Agent, recordType: 'agent', recordId: 'dev',
          label: 'DEV', updatedAt: at, evidenceEventIds: ['event-plan-1'], verified: true,
        },
        {
          id: 'node-fiction', kind: NucleusNodeKind.Entity, recordType: 'entity', recordId: 'fiction',
          label: 'Unverified fiction', updatedAt: at, evidenceEventIds: [], verified: false,
        } as never,
      ],
      edges: [{
        id: 'edge-agent', fromNodeId: 'node-dev', toNodeId: 'node-mission', relation: 'assigned_to',
        evidenceEventIds: ['event-plan-1'], verified: true,
      }],
      activityPulses: [{
        id: 'pulse-plan', kind: CommandCenterTimelineKind.Mission, occurredAt: at,
        nodeId: 'node-mission', label: 'Plan proposed', evidenceEventIds: ['event-plan-1'], verified: true,
      }],
    },
  };
}
