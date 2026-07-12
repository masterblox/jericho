// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AgentLane,
  CommandCenterActionKind,
  CommandCenterMissionStage,
  CommandCenterTimelineKind,
  CommandCenterVerification,
  ConnectorHealthStatus,
  DecisionOutcome,
  EntityType,
  EscalationReason,
  IntentKind,
  IntentRoute,
  IdentityReviewDisposition,
  IdentityReviewKind,
  LifecycleStatus,
  MissionTaskKind,
  MutationClass,
  NucleusNodeKind,
  ReceiptStatus,
  ProposalKind,
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
    expect(screen.getByRole('heading', { name: 'Jarvis memory' })).toBeTruthy();
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

  it('renders bounded Jarvis vault results without exposing absolute paths', async () => {
    const store = new CommandCenterStore();
    store.replace(populatedSnapshot());
    const searchVault = vi.fn().mockResolvedValue({
      available: true, cached: false, count: 1,
      results: [{ path: 'Projects/Fleet.md', title: 'Fleet', excerpt: 'Mission operating model', score: 0.87 }],
    });
    render(<CommandCenterApp
      store={store}
      client={{ start: vi.fn(), stop: vi.fn(), decideMission: vi.fn(), searchVault }}
      autoStart={false}
    />);

    fireEvent.change(screen.getByLabelText('Search the local Obsidian vault'), { target: { value: 'fleet' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Mission operating model');
    expect(searchVault).toHaveBeenCalledWith('fleet', 6);
    expect(screen.getByText('Projects/Fleet.md')).toBeTruthy();
    expect(document.body.textContent).not.toContain('/Users/');
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

  it('renders exact replay bindings and an evidence-anchored capture pulse', () => {
    const store = new CommandCenterStore();
    const snapshot = populatedSnapshot();
    const mission = snapshot.missions[0];
    mission.timeline = [{
      id: 'capture-source', kind: CommandCenterTimelineKind.Capture,
      occurredAt: snapshot.generatedAt, title: 'telegram.message', recordType: 'event',
      recordId: 'event-source', missionId: mission.id, evidenceEventIds: ['event-source'],
      provenance: [], verified: true, verification: CommandCenterVerification.Integrity,
    }, {
      id: 'route-source', kind: CommandCenterTimelineKind.Route,
      occurredAt: snapshot.generatedAt, title: 'Routed to project', recordType: 'intent',
      recordId: 'intent-source', missionId: mission.id, route: IntentRoute.Project,
      routeRuleId: 'project:multi-step', confidence: 0.91, evidenceEventIds: ['event-source'],
      provenance: [], verified: true, verification: CommandCenterVerification.Integrity,
    }, {
      id: 'approve-source', kind: CommandCenterTimelineKind.Approve,
      occurredAt: snapshot.generatedAt, title: 'Mission approved', recordType: 'decision',
      recordId: 'decision-source', missionId: mission.id, actor: 'carlos',
      reason: 'Approved exact scope', planHash: mission.planHash, planVersion: mission.version,
      evidenceEventIds: ['event-source'], provenance: [], verified: true,
      verification: CommandCenterVerification.Integrity,
    }, {
      id: 'outcome-source', kind: CommandCenterTimelineKind.Outcome,
      occurredAt: snapshot.generatedAt, title: 'Assignment succeeded', recordType: 'assignment',
      recordId: 'assignment-source', missionId: mission.id, artifactRecorded: true,
      evidenceEventIds: ['event-source'], provenance: [], verified: true,
      verification: CommandCenterVerification.Outcome,
    }, {
      id: 'receipt-source', kind: CommandCenterTimelineKind.Receipt,
      occurredAt: snapshot.generatedAt, title: 'send_message: succeeded', recordType: 'receipt',
      recordId: 'receipt-source', missionId: mission.id, evidenceEventIds: ['event-source'],
      provenance: [], verified: true, verification: CommandCenterVerification.Destination,
    }];
    snapshot.nucleus.nodes.push({
      id: 'evidence:event-source', kind: NucleusNodeKind.Evidence,
      recordType: 'event', recordId: 'event-source', label: 'telegram.message',
      updatedAt: snapshot.generatedAt, evidenceEventIds: ['event-source'], verified: true,
    });
    snapshot.nucleus.edges.push({
      id: 'evidence-mission', fromNodeId: 'evidence:event-source', toNodeId: 'node-mission',
      relation: 'supports', evidenceEventIds: ['event-source'], verified: true,
    });
    snapshot.nucleus.activityPulses.push({
      id: 'pulse:capture-source', kind: CommandCenterTimelineKind.Capture,
      occurredAt: snapshot.generatedAt, nodeId: 'evidence:event-source',
      label: 'telegram.message captured', evidenceEventIds: ['event-source'], verified: true,
    });
    store.replace(snapshot);

    const { container } = render(<CommandCenterApp
      store={store}
      client={{ start: vi.fn(), stop: vi.fn(), decideMission: vi.fn() }}
      autoStart={false}
    />);

    expect(screen.getByText('Capture · Integrity verified')).toBeTruthy();
    expect(screen.getByText('Route project · Rule project:multi-step · Confidence 91%')).toBeTruthy();
    expect(screen.getByText(`Plan V${mission.version} · ${mission.planHash}`)).toBeTruthy();
    expect(screen.getByText('Artifact recorded · Outcome verified')).toBeTruthy();
    expect(screen.getByText('Receipt · Destination verified')).toBeTruthy();
    expect([...container.querySelectorAll('.jericho-activity-pulse title')]
      .some((title) => title.textContent === 'telegram.message captured')).toBe(true);
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
    addVerifiedRelationshipEntities(snapshot);
    store.replace(snapshot);

    render(<CommandCenterApp
      store={store}
      client={{ start: vi.fn(), stop: vi.fn(), decideMission: vi.fn() }}
      autoStart={false}
    />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Relationship source' }), {
      target: { value: 'node-person-michael' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Relationship destination' }), {
      target: { value: 'node-org-apl' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Relationship type' }), {
      target: { value: 'supports' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview relationship' }));
    expect(screen.getByText('LOCAL PREVIEW · NOT SAVED')).toBeTruthy();
    expect(screen.getByText('Michael —[supports]→ APL')).toBeTruthy();
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
    expect(screen.queryByText('Deploy bounded Core —[supports]→ DEV')).toBeNull();
    expect(screen.queryByText('LOCAL PREVIEW · NOT SAVED')).toBeNull();
    expect(snapshot.nucleus.edges).toHaveLength(1);
  });

  it('submits exact selected-mission cancellation and relationship proposals to Core', async () => {
    const store = new CommandCenterStore();
    const snapshot = populatedSnapshot();
    addVerifiedRelationshipEntities(snapshot);
    store.replace(snapshot);
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
      target: { value: 'node-person-michael' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Relationship destination' }), {
      target: { value: 'node-org-apl' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview relationship' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit relationship for review' }));
    await waitFor(() => expect(proposeRelationship).toHaveBeenCalledWith({
      fromNodeId: 'node-person-michael', toNodeId: 'node-org-apl', relation: 'related_to',
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

  it('renders persisted Review evidence and submits only an exact safe disposition', async () => {
    const store = new CommandCenterStore();
    const snapshot = populatedSnapshot();
    snapshot.reviewIntents = [{
      id: 'intent-review', eventId: 'event-review', source: 'telegram', sourceType: SourceType.Connector,
      kind: IntentKind.Command, summary: 'Maybe launch the outreach sequence', payload: {},
      status: LifecycleStatus.PendingApproval, route: IntentRoute.Review, routeRuleId: 'safety:low-confidence',
      entityIds: ['person-michael'], commitments: [], claims: [], assumptions: [], deadlines: [],
      affectedPartyIds: ['person-michael'], requiredEvidence: [{ eventId: 'event-review', selector: 'message' }],
      requiredCapabilities: ['sales.outreach'], ambiguityReasons: ['Recipient identity is ambiguous'],
      contradictoryEvidenceEventIds: ['event-conflict'], risk: RiskLevel.High, confidence: 0.42,
      provenance: [{ source: 'telegram', sourceType: SourceType.Connector, sourceEventId: 'tg-44', observedAt: snapshot.generatedAt }],
      createdAt: snapshot.generatedAt, updatedAt: snapshot.generatedAt, integrityHash: 'b'.repeat(64),
    }];
    store.replace(snapshot);
    const decideReviewIntent = vi.fn().mockResolvedValue({});
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<CommandCenterApp
      store={store}
      client={{ start: vi.fn(), stop: vi.fn(), decideMission: vi.fn(), decideReviewIntent }}
      autoStart={false}
    />);

    expect(screen.getByRole('heading', { name: 'Review queue' })).toBeTruthy();
    expect(screen.getByText('Maybe launch the outreach sequence')).toBeTruthy();
    expect(screen.getByText('Confidence 42%')).toBeTruthy();
    expect(screen.getByText('Recipient identity is ambiguous')).toBeTruthy();
    expect(screen.getByText(/event-review.*message/)).toBeTruthy();
    expect(screen.getByText('event-conflict')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reclassify as project' }));

    await waitFor(() => expect(decideReviewIntent).toHaveBeenCalledWith({
      intentId: 'intent-review', intentHash: 'b'.repeat(64), disposition: 'reclassify_project',
      reason: 'Reclassified as project from Jericho Review queue; still requires a new bounded mission approval',
    }));
  });

  it('resolves a source-backed identity review without rendering its private external identifier', async () => {
    const store = new CommandCenterStore();
    const snapshot = populatedSnapshot();
    snapshot.identityReviews = [{
      id: 'identity-review-1',
      failureId: 'capture-failure-1',
      linkId: 'identity-link-1',
      version: 1,
      reviewHash: 'c'.repeat(64),
      kind: IdentityReviewKind.ProposedMerge,
      connectorId: 'telegram',
      namespace: 'user',
      observedEntity: {
        id: 'person-observed', type: EntityType.Person, label: 'Carlos',
        available: true, compatible: true,
      },
      candidateEntities: [
        {
          id: 'person-canonical', type: EntityType.Person, label: 'Carlos Prada',
          available: true, compatible: true,
        },
        {
          id: 'org-carlos', type: EntityType.Organization, label: 'Carlos Holdings',
          available: true, compatible: false,
        },
      ],
      reason: 'Display names and claimed candidates require explicit identity review',
      status: LifecycleStatus.PendingApproval,
      route: RouteType.HumanApproval,
      risk: RiskLevel.Medium,
      evidenceEventIds: ['event-identity'],
      evidence: [{ eventId: 'event-identity', integrityHash: 'd'.repeat(64) }],
      createdAt: snapshot.generatedAt,
      provenance: [{
        source: 'telegram', sourceType: SourceType.Connector,
        sourceEventId: 'event-identity', observedAt: snapshot.generatedAt,
      }],
    }];
    store.replace(snapshot);
    const decideIdentityReview = vi.fn().mockResolvedValue({});
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<CommandCenterApp
      store={store}
      client={{ start: vi.fn(), stop: vi.fn(), decideMission: vi.fn(), decideIdentityReview }}
      autoStart={false}
    />);

    expect(screen.getByText('Identity match · TELEGRAM')).toBeTruthy();
    expect(screen.getByText('Observed: Carlos · person')).toBeTruthy();
    expect(screen.getByText('event-identity')).toBeTruthy();
    expect(screen.queryByText(/raw-private-telegram-id/i)).toBeNull();
    expect((screen.getByRole('button', { name: 'Relink to Carlos Holdings' }) as HTMLButtonElement).disabled)
      .toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Relink to Carlos Prada' }));

    await waitFor(() => expect(decideIdentityReview).toHaveBeenCalledWith({
      failureId: 'capture-failure-1',
      disposition: IdentityReviewDisposition.RelinkCandidate,
      reviewHash: 'c'.repeat(64),
      version: 1,
      targetEntityId: 'person-canonical',
      reason: 'Explicitly relinked the provisional source identity to Carlos Prada',
    }));
  });

  it('renders checkpoint truth and never offers resume when a new immutable plan is required', async () => {
    const store = new CommandCenterStore();
    const snapshot = populatedSnapshot();
    snapshot.proposals.push({
      id: 'checkpoint-1', assignmentId: 'assignment-1', missionTaskId: 'task-plan',
      proposedByAgentId: 'jericho:mission-runner', kind: ProposalKind.Action, summary: 'Mission paused: runtime budget',
      body: {
        checkpoint: true, missionId: 'mission-1', assignmentId: 'assignment-1',
        planHash: 'a'.repeat(64), planVersion: 3, reasons: ['runtime_budget'],
        resumable: false, requiresNewPlan: true,
      },
      status: LifecycleStatus.PendingApproval, route: RouteType.HumanApproval,
      risk: RiskLevel.High, createdAt: snapshot.generatedAt,
      provenance: [{ source: 'local:mission-runner', sourceType: SourceType.System, observedAt: snapshot.generatedAt }],
    });
    store.replace(snapshot);
    const decideCheckpoint = vi.fn().mockResolvedValue({});
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<CommandCenterApp
      store={store}
      client={{ start: vi.fn(), stop: vi.fn(), decideMission: vi.fn(), decideCheckpoint }}
      autoStart={false}
    />);

    expect(screen.getByText('NEW IMMUTABLE PLAN REQUIRED')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resume exact approved plan' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reject checkpoint' }));
    await waitFor(() => expect(decideCheckpoint).toHaveBeenCalledWith({
      proposalId: 'checkpoint-1', planHash: 'a'.repeat(64), version: 3,
      outcome: DecisionOutcome.Rejected,
      reason: 'Rejected checkpoint from Jericho; mission cancellation recorded',
    }));
  });

  it('renders exact generic proposal decisions while keeping drafts and reflection status-only', async () => {
    const store = new CommandCenterStore();
    const snapshot = populatedSnapshot();
    const base = {
      version: 1,
      status: LifecycleStatus.PendingApproval,
      route: RouteType.HumanApproval,
      risk: RiskLevel.Low,
      createdAt: snapshot.generatedAt,
      provenance: [{
        source: 'test', sourceType: SourceType.Agent, observedAt: snapshot.generatedAt,
      }],
    } as const;
    snapshot.proposals.push(
      {
        ...base,
        id: 'proposal-message', proposedByAgentId: 'jericho',
        kind: ProposalKind.Message, summary: 'Draft reply to Paula',
        body: { to: 'Paula', draft: 'Hello' }, integrityHash: 'e'.repeat(64),
      },
      {
        ...base,
        id: 'proposal-reflection', proposedByAgentId: 'jericho-reflection-v1',
        kind: ProposalKind.DataChange, summary: 'Review contradictory decisions',
        body: { kind: 'decision_conflict', autoResolution: false }, integrityHash: 'f'.repeat(64),
      },
      {
        ...base,
        id: 'proposal-relation', proposedByAgentId: 'carlos',
        kind: ProposalKind.DataChange, summary: 'Relate Paula to Acme',
        body: { effect: 'create_relation', verified: false }, integrityHash: 'd'.repeat(64),
      },
      {
        ...base,
        id: 'proposal-decided', proposedByAgentId: 'jericho',
        kind: ProposalKind.Action, summary: 'Already reviewed', body: {},
        status: LifecycleStatus.Approved, integrityHash: 'c'.repeat(64),
      },
    );
    store.replace(snapshot);
    const decideProposal = vi.fn().mockResolvedValue({});
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<CommandCenterApp
      store={store}
      client={{ start: vi.fn(), stop: vi.fn(), decideMission: vi.fn(), decideProposal }}
      autoStart={false}
    />);

    expect(screen.getByRole('button', { name: 'Approve draft' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept reviewed suggestion' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply verified relation' })).toBeTruthy();
    expect(screen.getAllByText(/V1 · [c-f]{64}/)).toHaveLength(4);
    expect(screen.getByText('Already reviewed').closest('article')?.querySelector('button')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Approve draft' }));
    await waitFor(() => expect(decideProposal).toHaveBeenCalledWith({
      proposalId: 'proposal-message', proposalHash: 'e'.repeat(64), version: 1,
      outcome: DecisionOutcome.Approved,
      reason: 'Approved draft status only; external execution still requires an exact bounded mission plan',
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Accept reviewed suggestion' }));
    await waitFor(() => expect(decideProposal).toHaveBeenCalledWith({
      proposalId: 'proposal-reflection', proposalHash: 'f'.repeat(64), version: 1,
      outcome: DecisionOutcome.Approved,
      reason: 'Accepted reflection suggestion as reviewed status only; no memory or graph mutation',
    }));
    expect(JSON.stringify(decideProposal.mock.calls)).not.toMatch(/send_message|deploy|queue|execute/i);
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

function addVerifiedRelationshipEntities(snapshot: CommandCenterSnapshot): void {
  snapshot.nucleus.nodes.push(
    {
      id: 'node-person-michael', kind: NucleusNodeKind.Entity,
      recordType: 'entity', recordId: 'person-michael', label: 'Michael',
      entityType: EntityType.Person, updatedAt: snapshot.generatedAt,
      evidenceEventIds: ['event-message-1'], verified: true,
    },
    {
      id: 'node-org-apl', kind: NucleusNodeKind.Entity,
      recordType: 'entity', recordId: 'org-apl', label: 'APL',
      entityType: EntityType.Organization, updatedAt: snapshot.generatedAt,
      evidenceEventIds: ['event-message-1'], verified: true,
    },
  );
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
