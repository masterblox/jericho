import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import {
  CommandCenterMissionStage,
  DecisionOutcome,
  LifecycleStatus,
  RelationType,
  type ActionDescriptor,
  type CommandCenterApproval,
  type CommandCenterEntityCard,
  type CommandCenterMission,
  type CommandCenterSnapshot,
  type CommandCenterTimelineEntry,
} from '@jericho/shared';

import type { CommandCenterStore } from './command-center-store';
import type {
  MissionCancellationInput,
  MissionDecisionInput,
  RelationshipProposalInput,
  RetentionResult,
} from './core-client';
import {
  JERICHO_APPROVAL_GESTURE_EVENT,
  JERICHO_CANCEL_PENDING_EVENT,
  JERICHO_NUCLEUS_CAMERA_EVENT,
  JERICHO_NUCLEUS_DEPTH_EVENT,
  type ApprovalGestureDetail,
  type CancelPendingDetail,
  type NucleusCameraDetail,
  type NucleusDepthDetail,
} from './gesture-events';

export interface CommandCenterClientPort {
  start(): Promise<void>;
  stop(): void;
  decideMission(input: MissionDecisionInput): Promise<unknown>;
  cancelMission?(input: MissionCancellationInput): Promise<unknown>;
  retainMission?(missionId: string): Promise<RetentionResult>;
  proposeRelationship?(input: RelationshipProposalInput): Promise<unknown>;
}

export interface CommandCenterAppProps {
  store: CommandCenterStore;
  client: CommandCenterClientPort;
  autoStart?: boolean;
}

const PIPELINE = [
  'Capture', 'Understand', 'Route', 'Plan',
  'Approve', 'Execute', 'Retain', 'Present',
] as const;

type MobileTab = 'today' | 'communications' | 'nucleus' | 'approvals';
const RELATIONSHIP_TYPES = [
  RelationType.RelatedTo,
  RelationType.DependsOn,
  RelationType.AssignedTo,
  RelationType.Supports,
] as const;

interface RelationshipDraft {
  fromNodeId: string;
  toNodeId: string;
  relation: RelationType;
}

export function CommandCenterApp({
  store,
  client,
  autoStart = true,
}: CommandCenterAppProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const snapshot = state.snapshot;
  const [selectedMissionId, setSelectedMissionId] = useState<string>();
  const [mobileTab, setMobileTab] = useState<MobileTab>('today');
  const [decisionError, setDecisionError] = useState<string>();
  const [decidingAction, setDecidingAction] = useState<string>();
  const [operationMessage, setOperationMessage] = useState<string>();
  const decisionInFlight = useRef(false);
  const operationInFlight = useRef(false);
  const submittedGestureDecisions = useRef(new Set<string>());

  useEffect(() => {
    if (!autoStart) return;
    void client.start();
    return () => client.stop();
  }, [autoStart, client]);

  useEffect(() => {
    if (!snapshot?.missions.length) {
      setSelectedMissionId(undefined);
      return;
    }
    if (!snapshot.missions.some((mission) => mission.id === selectedMissionId)) {
      setSelectedMissionId(snapshot.missions[0].id);
    }
  }, [selectedMissionId, snapshot]);

  const decide = useCallback(async (
    approval: CommandCenterApproval,
    action: ActionDescriptor,
    source: 'button' | 'gesture' = 'button',
  ) => {
    if (!action.enabled || decisionInFlight.current) return;
    if (source === 'button' && action.requiresConfirmation && !window.confirm(`${action.label}: ${approval.title}?`)) return;
    const gestureKey = `${approval.missionId}:${action.payload.planHash}:${action.payload.version}:${action.payload.outcome}`;
    if (source === 'gesture' && submittedGestureDecisions.current.has(gestureKey)) return;
    if (source === 'gesture') submittedGestureDecisions.current.add(gestureKey);
    decisionInFlight.current = true;
    setDecisionError(undefined);
    setDecidingAction(action.id);
    try {
      await client.decideMission({
        missionId: approval.missionId,
        outcome: action.payload.outcome,
        planHash: action.payload.planHash,
        version: action.payload.version,
        reason: source === 'gesture'
          ? `${action.payload.outcome === DecisionOutcome.Approved ? 'Approved' : 'Rejected'} by held gesture in Jericho command center`
          : action.payload.outcome === DecisionOutcome.Approved
            ? 'Approved from Jericho command center'
            : 'Rejected from Jericho command center',
      });
    } catch (error) {
      if (source === 'gesture') submittedGestureDecisions.current.delete(gestureKey);
      setDecisionError(error instanceof Error ? error.message : 'Decision failed');
    } finally {
      decisionInFlight.current = false;
      setDecidingAction(undefined);
    }
  }, [client]);

  useEffect(() => {
    const onApprovalGesture = (event: Event) => {
      const detail = (event as CustomEvent<ApprovalGestureDetail>).detail;
      const outcome = detail?.outcome;
      if (outcome !== DecisionOutcome.Approved && outcome !== DecisionOutcome.Rejected) return;
      const approval = snapshot?.approvals[0];
      if (
        !approval
        || detail.missionId !== approval.missionId
        || detail.planHash !== approval.planHash
        || detail.version !== approval.version
      ) return;
      const action = approval.actions.find((candidate) =>
        candidate.payload.outcome === outcome
        && candidate.payload.planHash === detail.planHash
        && candidate.payload.version === detail.version);
      if (approval && action) void decide(approval, action, 'gesture');
    };
    document.addEventListener(JERICHO_APPROVAL_GESTURE_EVENT, onApprovalGesture);
    return () => document.removeEventListener(JERICHO_APPROVAL_GESTURE_EVENT, onApprovalGesture);
  }, [decide, snapshot]);

  const selectedMission = snapshot?.missions.find((mission) => mission.id === selectedMissionId)
    ?? snapshot?.missions[0];

  const cancelSelectedMission = useCallback(async (source: CancelPendingDetail['source']) => {
    if (!selectedMission || !client.cancelMission || operationInFlight.current) return;
    if (
      source === 'keyboard'
      && !window.confirm(`Cancel selected mission: ${selectedMission.title}?`)
    ) return;
    operationInFlight.current = true;
    setOperationMessage(undefined);
    try {
      await client.cancelMission({
        missionId: selectedMission.id,
        planHash: selectedMission.planHash,
        version: selectedMission.version,
        reason: source === 'both-open-palms'
          ? 'Cancelled by held both-open-palms gesture in Jericho command center'
          : 'Cancelled from Jericho command center',
      });
      setOperationMessage('Mission cancellation recorded');
    } catch (error) {
      setOperationMessage(error instanceof Error ? error.message : 'Mission cancellation failed');
    } finally {
      operationInFlight.current = false;
    }
  }, [client, selectedMission]);

  useEffect(() => {
    const onCancel = (event: Event) => {
      const source = (event as CustomEvent<CancelPendingDetail>).detail?.source;
      if (source === 'keyboard' || source === 'both-open-palms') {
        void cancelSelectedMission(source);
      }
    };
    document.addEventListener(JERICHO_CANCEL_PENDING_EVENT, onCancel);
    return () => document.removeEventListener(JERICHO_CANCEL_PENDING_EVENT, onCancel);
  }, [cancelSelectedMission]);

  const retainSelectedMission = useCallback(async () => {
    if (!selectedMission || !client.retainMission || operationInFlight.current) return;
    operationInFlight.current = true;
    setOperationMessage(undefined);
    try {
      const result = await client.retainMission(selectedMission.id);
      setOperationMessage(`Retained in ${result.relativePath} · ${result.status}`);
    } catch (error) {
      setOperationMessage(error instanceof Error ? error.message : 'Mission retention failed');
    } finally {
      operationInFlight.current = false;
    }
  }, [client, selectedMission]);

  const proposeRelationship = useCallback(async (draft: RelationshipDraft) => {
    if (!client.proposeRelationship || operationInFlight.current) return;
    operationInFlight.current = true;
    setOperationMessage(undefined);
    try {
      await client.proposeRelationship(draft);
      setOperationMessage('Relationship submitted for review');
    } catch (error) {
      setOperationMessage(error instanceof Error ? error.message : 'Relationship proposal failed');
      throw error;
    } finally {
      operationInFlight.current = false;
    }
  }, [client]);

  if (!snapshot) {
    return (
      <main className="jericho-shell jericho-shell--waiting" id="main">
        <section className="jericho-system-state" aria-live="polite">
          <span className="jericho-eyebrow">LOCAL INTELLIGENCE / CORE</span>
          <h1>Waiting for Jericho Core</h1>
          <p>{state.error ?? 'Establishing the private command channel.'}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="jericho-shell" id="main">
      <a className="jericho-skip-link" href="#jericho-nucleus">Skip to Nucleus</a>
      <header className="jericho-masthead">
        <div>
          <span className="jericho-eyebrow">PRIVATE INTELLIGENCE OS / OPERATOR BAY</span>
          <h1>JERICHO</h1>
        </div>
        <div className="jericho-core-status" aria-live="polite">
          <span className={`jericho-status-light jericho-status-light--${state.status}`} />
          <span>{state.status}</span>
          <span>REV {snapshot.lastChangeSequence.toString().padStart(4, '0')}</span>
          <time dateTime={snapshot.generatedAt}>{compactTime(snapshot.generatedAt)}</time>
          <button
            type="button"
            className="jericho-cancel-pending"
            onClick={() => document.dispatchEvent(new CustomEvent(JERICHO_CANCEL_PENDING_EVENT, {
              detail: { source: 'keyboard' },
            }))}
          >
            Cancel pending
          </button>
        </div>
      </header>

      {state.status !== 'ready' && (
        <div className="jericho-connection-banner" role="status">
          {state.error ?? 'Refreshing verified Core state'}
        </div>
      )}

      <nav className="jericho-mobile-tabs" aria-label="Command center sections">
        {(['today', 'communications', 'nucleus', 'approvals'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            aria-pressed={mobileTab === tab}
            onClick={() => setMobileTab(tab)}
          >
            {titleCase(tab)}
          </button>
        ))}
      </nav>

      <div className="jericho-bay-grid" data-mobile-tab={mobileTab}>
        <aside className="jericho-bay jericho-bay--left jericho-mobile-panel">
          <div className="jericho-mobile-section jericho-mobile-section--today">
            <Section title="Today" count={snapshot.today.taskIds.length + snapshot.today.commitmentIds.length}>
              <p className="jericho-date">{snapshot.today.date}</p>
              <EntityList items={rankByIds(snapshot.tasks, snapshot.today.taskIds)} empty="No verified items" />
              <Subsection title="Commitments">
                <EntityList items={rankByIds(snapshot.commitments, snapshot.today.commitmentIds)} empty="No verified items" />
              </Subsection>
            </Section>
          </div>

          <div className="jericho-mobile-section jericho-mobile-section--communications">
            <Section title="Communications" count={snapshot.communications.length}>
              <EntityList items={snapshot.communications} empty="No verified items" />
              <Subsection title="People">
                <EntityList items={snapshot.people} empty="No verified items" />
              </Subsection>
            </Section>
          </div>
        </aside>

        <section className="jericho-bay jericho-bay--center jericho-mobile-panel">
          <MissionContext mission={selectedMission} />
          {selectedMission?.status === LifecycleStatus.Succeeded && client.retainMission && (
            <button type="button" className="jericho-retain-mission" onClick={() => void retainSelectedMission()}>
              Retain verified mission
            </button>
          )}
          {operationMessage && <p className="jericho-operation-message" role="status">{operationMessage}</p>}
          <Pipeline mission={selectedMission} />
          <Nucleus
            snapshot={snapshot}
            selectedMission={selectedMission}
            onSelectMission={setSelectedMissionId}
            onProposeRelationship={client.proposeRelationship ? proposeRelationship : undefined}
          />
          <MissionTimeline mission={selectedMission} />
        </section>

        <aside className="jericho-bay jericho-bay--right jericho-mobile-panel">
          <Section title="Proposals" count={snapshot.proposals.length}>
            {snapshot.proposals.length ? snapshot.proposals.map((proposal) => (
              <article className="jericho-proposal-row" key={proposal.id}>
                <div><strong>{proposal.summary}</strong><span>{proposal.proposedByAgentId} · {proposal.kind}</span></div>
                <div><span>{proposal.route}</span><span>{proposal.risk} risk</span><Status value={proposal.status} /></div>
              </article>
            )) : <EmptyState />}
          </Section>

          <Section title="Approvals" count={snapshot.approvals.length} priority>
            {snapshot.approvals.length ? snapshot.approvals.map((approval, index) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                active={index === 0}
                decidingAction={decidingAction}
                onDecision={(action) => void decide(approval, action)}
              />
            )) : <EmptyState />}
            {decisionError && <p className="jericho-error" role="alert">{decisionError}</p>}
          </Section>

          <Section title="Active assignments" count={snapshot.activeAssignments.length}>
            {snapshot.activeAssignments.length ? snapshot.activeAssignments.map((assignment) => (
              <article className="jericho-run-row" key={assignment.id}>
                <strong>{assignment.agentId.toUpperCase()}</strong>
                <span>{assignment.missionTaskId}</span>
                <Status value={assignment.status} />
              </article>
            )) : <EmptyState />}
          </Section>

          <Section title="Outcomes / receipts" count={snapshot.outcomes.length + snapshot.receipts.length}>
            {snapshot.outcomes.map((outcome) => (
              <article className="jericho-run-row" key={outcome.id}>
                <strong>{outcome.verified ? 'VERIFIED' : 'PENDING'}</strong>
                <span>{outcome.missionTaskId}</span>
                <Status value={outcome.status} />
              </article>
            ))}
            {snapshot.receipts.map((receipt) => (
              <article className="jericho-run-row" key={receipt.id}>
                <strong>{receipt.connectorId ?? 'LOCAL'}</strong>
                <span>{receipt.destination}</span>
                <Status value={receipt.status} />
              </article>
            ))}
            {!snapshot.outcomes.length && !snapshot.receipts.length && <EmptyState />}
          </Section>
        </aside>
      </div>
    </main>
  );
}

function Section({
  title,
  count,
  priority = false,
  children,
}: {
  title: string;
  count?: number;
  priority?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`jericho-section${priority ? ' jericho-section--priority' : ''}`}>
      <div className="jericho-section-heading">
        <h2>{title}</h2>
        {count !== undefined && <span>{count.toString().padStart(2, '0')}</span>}
      </div>
      {children}
    </section>
  );
}

function Subsection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="jericho-subsection"><h3>{title}</h3>{children}</section>;
}

function EntityList({ items, empty }: { items: CommandCenterEntityCard[]; empty: string }) {
  if (!items.length) return <EmptyState label={empty} />;
  return (
    <ol className="jericho-entity-list">
      {items.map((item) => (
        <li key={item.id} tabIndex={0} data-gesture-target={`entity:${item.id}`}>
          <span className="jericho-rank">{item.rank.toString().padStart(2, '0')}</span>
          <span><strong>{item.label}</strong><small>{item.entityType} · {freshness(item.updatedAt)}</small></span>
          {item.status && <Status value={item.status} />}
        </li>
      ))}
    </ol>
  );
}

function MissionContext({ mission }: { mission?: CommandCenterMission }) {
  return (
    <section className="jericho-context-plate">
      <span className="jericho-eyebrow">ACTIVE CONTEXT</span>
      {mission ? (
        <>
          <div className="jericho-context-title">
            <div><h2>{mission.title}</h2><p>{mission.objective}</p></div>
            <Status value={mission.status} />
          </div>
          <div className="jericho-hash-line">
            <span>V{mission.version}</span><code>{mission.planHash.slice(0, 12)}</code>
            <span>{mission.risk} risk</span>
          </div>
        </>
      ) : <EmptyState />}
    </section>
  );
}

function Pipeline({ mission }: { mission?: CommandCenterMission }) {
  const active = mission ? pipelineIndex(mission.stage) : -1;
  return (
    <section className="jericho-pipeline" aria-label="Mission pipeline">
      <div className="jericho-section-heading"><h2>Mission pipeline</h2><span>08 STAGES</span></div>
      <ol>
        {PIPELINE.map((stage, index) => (
          <li key={stage} className={index < active ? 'complete' : index === active ? 'active' : ''}>
            <span>{(index + 1).toString().padStart(2, '0')}</span><strong>{stage}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Nucleus({
  snapshot,
  selectedMission,
  onSelectMission,
  onProposeRelationship,
}: {
  snapshot: CommandCenterSnapshot;
  selectedMission?: CommandCenterMission;
  onSelectMission: (id: string) => void;
  onProposeRelationship?: (draft: RelationshipDraft) => Promise<void>;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const allNodes = useMemo(
    () => snapshot.nucleus.nodes.filter((node) => node.verified === true),
    [snapshot.nucleus.nodes],
  );
  const verifiedEdges = useMemo(() => {
    const nodeIds = new Set(allNodes.map((node) => node.id));
    return snapshot.nucleus.edges.filter((edge) =>
      edge.verified === true && nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId));
  }, [allNodes, snapshot.nucleus.edges]);
  const [semanticDepth, setSemanticDepth] = useState(2);
  const [cameraOffset, setCameraOffset] = useState({ x: 0, y: 0 });
  const [cameraClutched, setCameraClutched] = useState(false);
  const [relationshipFrom, setRelationshipFrom] = useState<string>();
  const [relationshipTo, setRelationshipTo] = useState<string>();
  const [relationshipType, setRelationshipType] = useState<RelationType>(RelationType.RelatedTo);
  const [relationshipDraft, setRelationshipDraft] = useState<RelationshipDraft>();
  const [relationshipSubmitting, setRelationshipSubmitting] = useState(false);
  const dragSource = useRef<string | undefined>(undefined);
  const rootNodeId = allNodes.find((node) =>
    node.recordType === 'mission' && node.recordId === selectedMission?.id)?.id ?? allNodes[0]?.id;
  const visibleIds = useMemo(
    () => semanticNeighborhood(rootNodeId, semanticDepth, allNodes.map((node) => node.id), verifiedEdges),
    [allNodes, rootNodeId, semanticDepth, verifiedEdges],
  );
  const nodes = useMemo(
    () => allNodes.filter((node) => visibleIds.has(node.id)),
    [allNodes, visibleIds],
  );
  const positions = useMemo(() => new Map(nodes.map((node, index) => [
    node.id,
    nodePosition(index, nodes.length),
  ])), [nodes]);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = verifiedEdges.filter((edge) =>
    nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId));
  const selectedFrom = relationshipFrom ?? allNodes[0]?.id ?? '';
  const selectedTo = relationshipTo
    ?? allNodes.find((node) => node.id !== selectedFrom)?.id
    ?? '';

  const previewRelationship = useCallback((fromNodeId: string, toNodeId: string) => {
    if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return;
    setRelationshipFrom(fromNodeId);
    setRelationshipTo(toNodeId);
    setRelationshipDraft({ fromNodeId, toNodeId, relation: relationshipType });
  }, [relationshipType]);

  useEffect(() => {
    const onDepth = (event: Event) => {
      const delta = (event as CustomEvent<NucleusDepthDetail>).detail?.delta;
      if (delta !== -1 && delta !== 1) return;
      setSemanticDepth((current) => clamp(current + delta, 0, 4));
    };
    const onCamera = (event: Event) => {
      const detail = (event as CustomEvent<NucleusCameraDetail>).detail;
      if (!detail) return;
      if (detail.phase === 'start') setCameraClutched(true);
      if (detail.phase === 'move') {
        setCameraOffset((current) => ({
          x: clamp(current.x + detail.delta.x, -240, 240),
          y: clamp(current.y + detail.delta.y, -160, 160),
        }));
      }
      if (detail.phase === 'end') setCameraClutched(false);
    };
    const onCancel = () => {
      dragSource.current = undefined;
      setRelationshipDraft(undefined);
      setCameraClutched(false);
    };
    document.addEventListener(JERICHO_NUCLEUS_DEPTH_EVENT, onDepth);
    document.addEventListener(JERICHO_NUCLEUS_CAMERA_EVENT, onCamera);
    document.addEventListener(JERICHO_CANCEL_PENDING_EVENT, onCancel);
    return () => {
      document.removeEventListener(JERICHO_NUCLEUS_DEPTH_EVENT, onDepth);
      document.removeEventListener(JERICHO_NUCLEUS_CAMERA_EVENT, onCamera);
      document.removeEventListener(JERICHO_CANCEL_PENDING_EVENT, onCancel);
    };
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const onDragStart = (event: Event) => {
      const source = nucleusNodeId((event as CustomEvent).detail?.targetId);
      if (source) dragSource.current = source;
    };
    const onDragEnd = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        point?: { x: number; y: number };
        cancelled?: boolean;
      } | undefined;
      const source = dragSource.current;
      dragSource.current = undefined;
      if (!source || detail?.cancelled || !detail?.point) return;
      const destination = nucleusNodeAtPoint(document, detail.point);
      if (destination) previewRelationship(source, destination);
    };
    section.addEventListener('jericho:drag-start', onDragStart);
    section.addEventListener('jericho:drag-end', onDragEnd);
    return () => {
      section.removeEventListener('jericho:drag-start', onDragStart);
      section.removeEventListener('jericho:drag-end', onDragEnd);
    };
  }, [previewRelationship]);

  useEffect(() => {
    if (!relationshipDraft) return;
    setRelationshipDraft((current) => current ? { ...current, relation: relationshipType } : current);
  }, [relationshipType]);

  const draftFrom = relationshipDraft ? positions.get(relationshipDraft.fromNodeId) : undefined;
  const draftTo = relationshipDraft ? positions.get(relationshipDraft.toNodeId) : undefined;
  return (
    <section className="jericho-nucleus" id="jericho-nucleus" ref={sectionRef}>
      <div className="jericho-section-heading"><h2>Nucleus</h2><span>VERIFIED GRAPH · D{semanticDepth}</span></div>
      <div className="jericho-nucleus-toolbar" aria-label="Nucleus keyboard controls">
        <div role="group" aria-label="Semantic graph depth">
          <button type="button" aria-label="Decrease semantic depth" disabled={semanticDepth === 0} onClick={() => setSemanticDepth((depth) => Math.max(0, depth - 1))}>Depth −</button>
          <output aria-live="polite">Semantic depth {semanticDepth}</output>
          <button type="button" aria-label="Increase semantic depth" disabled={semanticDepth === 4} onClick={() => setSemanticDepth((depth) => Math.min(4, depth + 1))}>Depth +</button>
        </div>
        <div role="group" aria-label="Graph camera">
          <button type="button" aria-label="Pan graph left" onClick={() => setCameraOffset((point) => ({ ...point, x: point.x - 24 }))}>←</button>
          <button type="button" aria-label="Pan graph up" onClick={() => setCameraOffset((point) => ({ ...point, y: point.y - 24 }))}>↑</button>
          <button type="button" aria-label="Reset graph camera" onClick={() => setCameraOffset({ x: 0, y: 0 })}>Center</button>
          <button type="button" aria-label="Pan graph down" onClick={() => setCameraOffset((point) => ({ ...point, y: point.y + 24 }))}>↓</button>
          <button type="button" aria-label="Pan graph right" onClick={() => setCameraOffset((point) => ({ ...point, x: point.x + 24 }))}>→</button>
        </div>
      </div>
      <div
        className={`jericho-nucleus-viewport${cameraClutched ? ' is-clutched' : ''}`}
        data-jericho-nucleus-space="true"
      >
      {!nodes.length ? <EmptyState /> : (
        <svg viewBox="0 0 720 390" role="group" aria-label="Verified semantic and activity graph">
          <defs>
            <radialGradient id="jericho-node-glow"><stop offset="0" stopColor="#c7fbff" /><stop offset="1" stopColor="#4fd6de" /></radialGradient>
          </defs>
          <g transform={`translate(${cameraOffset.x} ${cameraOffset.y})`}>
          {edges.map((edge) => {
            const from = positions.get(edge.fromNodeId)!;
            const to = positions.get(edge.toNodeId)!;
            return <line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="jericho-nucleus-edge" />;
          })}
          {draftFrom && draftTo && (
            <line
              x1={draftFrom.x}
              y1={draftFrom.y}
              x2={draftTo.x}
              y2={draftTo.y}
              className="jericho-nucleus-edge jericho-nucleus-edge--draft"
            />
          )}
          {snapshot.nucleus.activityPulses.filter((pulse) => pulse.verified && pulse.nodeId && nodeIds.has(pulse.nodeId)).map((pulse) => {
            const point = positions.get(pulse.nodeId!)!;
            return <circle key={pulse.id} cx={point.x} cy={point.y} r="28" className="jericho-activity-pulse"><title>{pulse.label}</title></circle>;
          })}
          {nodes.map((node) => {
            const point = positions.get(node.id)!;
            const selected = node.recordType === 'mission' && node.recordId === selectedMission?.id;
            return (
              <g
                key={node.id}
                className={`jericho-nucleus-node${selected ? ' selected' : ''}`}
                role="button"
                tabIndex={0}
                data-gesture-target={`nucleus:${node.id}`}
                data-gesture-draggable="true"
                data-jericho-nucleus-node={node.id}
                aria-label={`${node.label}, ${node.kind}`}
                onClick={() => node.recordType === 'mission' && onSelectMission(node.recordId)}
                onKeyDown={(event) => {
                  if ((event.key === 'Enter' || event.key === ' ') && node.recordType === 'mission') {
                    event.preventDefault();
                    onSelectMission(node.recordId);
                  }
                }}
              >
                <circle cx={point.x} cy={point.y} r={selected ? 23 : 17} />
                <text x={point.x} y={point.y + 38} textAnchor="middle">{node.label}</text>
              </g>
            );
          })}
          </g>
        </svg>
      )}
      </div>
      <form className="jericho-relationship-draft" onSubmit={(event) => {
        event.preventDefault();
        previewRelationship(selectedFrom, selectedTo);
      }}>
        <span>LOCAL RELATIONSHIP WORKBENCH</span>
        <label>From<select aria-label="Relationship source" value={selectedFrom} onChange={(event) => setRelationshipFrom(event.target.value)}>
          {allNodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
        </select></label>
        <label>Type<select aria-label="Relationship type" value={relationshipType} onChange={(event) => setRelationshipType(event.target.value as RelationType)}>
          {RELATIONSHIP_TYPES.map((relation) => <option key={relation} value={relation}>{relation.replaceAll('_', ' ')}</option>)}
        </select></label>
        <label>To<select aria-label="Relationship destination" value={selectedTo} onChange={(event) => setRelationshipTo(event.target.value)}>
          {allNodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
        </select></label>
        <button type="submit" disabled={!selectedFrom || !selectedTo || selectedFrom === selectedTo}>Preview relationship</button>
      </form>
      {relationshipDraft && (
        <aside className="jericho-relationship-preview" aria-live="polite">
          <strong>LOCAL PREVIEW · NOT SAVED</strong>
          <span>{nodeLabel(allNodes, relationshipDraft.fromNodeId)} —[{relationshipDraft.relation}]→ {nodeLabel(allNodes, relationshipDraft.toNodeId)}</span>
          {onProposeRelationship && (
            <button
              type="button"
              disabled={relationshipSubmitting}
              onClick={() => {
                setRelationshipSubmitting(true);
                void onProposeRelationship(relationshipDraft)
                  .then(() => setRelationshipDraft(undefined))
                  .catch(() => undefined)
                  .finally(() => setRelationshipSubmitting(false));
              }}
            >
              {relationshipSubmitting ? 'Submitting…' : 'Submit relationship for review'}
            </button>
          )}
          <button type="button" onClick={() => setRelationshipDraft(undefined)}>Discard preview</button>
        </aside>
      )}
    </section>
  );
}

function MissionTimeline({ mission }: { mission?: CommandCenterMission }) {
  return (
    <section className="jericho-timeline">
      <div className="jericho-section-heading"><h2>Mission timeline</h2><span>{mission?.timeline.length ?? 0}</span></div>
      {!mission?.timeline.length ? <EmptyState /> : (
        <ol>
          {mission.timeline.map((entry: CommandCenterTimelineEntry) => (
            <li key={entry.id}>
              <time dateTime={entry.occurredAt}>{compactTime(entry.occurredAt)}</time>
              <div><strong>{entry.title}</strong><span>{entry.actor ?? 'Unknown actor'}</span></div>
              <p>{entry.reason ?? 'Unknown reason'}</p>
              <p className="jericho-provenance">
                {entry.provenance.length
                  ? entry.provenance.map(formatProvenance).join('; ')
                  : 'Unknown provenance'}
              </p>
              <div className="jericho-evidence">{entry.evidenceEventIds.map((id) => <code key={id}>{id}</code>)}</div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ApprovalCard({
  approval,
  active,
  decidingAction,
  onDecision,
}: {
  approval: CommandCenterApproval;
  active: boolean;
  decidingAction?: string;
  onDecision: (action: ActionDescriptor) => void;
}) {
  return (
    <article
      className="jericho-approval-card"
      data-gesture-target={`approval:${approval.id}`}
      data-jericho-active-approval={active ? 'true' : undefined}
      data-jericho-approval-mission-id={active ? approval.missionId : undefined}
      data-jericho-approval-plan-hash={active ? approval.planHash : undefined}
      data-jericho-approval-version={active ? approval.version : undefined}
    >
      <div className="jericho-approval-title"><div><span>{approval.risk} RISK</span><h3>{approval.title}</h3></div><strong>V{approval.version}</strong></div>
      <p>{approval.objective}</p>
      <dl>
        <div><dt>Plan hash</dt><dd><code>{approval.planHash}</code></dd></div>
        <div><dt>Systems</dt><dd>{approval.affectedSystems.join(', ') || 'None'}</dd></div>
        <div><dt>Parties</dt><dd>{approval.affectedParties.map((party) => party.label ?? party.entityId).join(', ') || 'None'}</dd></div>
        <div><dt>External actions</dt><dd>{approval.externalActions.map(formatExternalAction).join('; ') || 'None'}</dd></div>
        <div><dt>Agents</dt><dd>{approval.agents.map((agent) => `${agent.agentId} / ${agent.lane} / ${agent.capabilityIds.join('+')}`).join('; ') || 'None'}</dd></div>
        <div><dt>Cost</dt><dd>max {formatCost(approval.cost.maximumMicroUsd)} · planned {formatCost(approval.cost.plannedMicroUsd)} · actual {formatCost(approval.cost.actualMicroUsd)}</dd></div>
        <div><dt>Runtime</dt><dd>max {formatDuration(approval.time.maximumRuntimeMs)} · elapsed {formatDuration(approval.time.elapsedRuntimeMs)}</dd></div>
        <div><dt>Bounds</dt><dd>concurrency {approval.budget.maxConcurrency} · retries {approval.budget.maxRetriesPerAssignment}</dd></div>
        <div><dt>Deliverables</dt><dd><ul>{approval.deliverables.map((deliverable) => (
          <li key={deliverable.id}><strong>{deliverable.description}</strong><span>{deliverable.artifactType} · {deliverable.required ? 'required' : 'optional'}</span></li>
        ))}</ul></dd></div>
        <div><dt>Task graph</dt><dd><ol>{approval.taskGraph.map((task) => (
          <li key={task.id}>
            <p>{task.title} · depends on: {task.dependsOn.join(', ') || 'none'}</p>
            <p>actions: {task.requiredActions.join(', ') || 'none'} · tools: {task.requiredTools.join(', ') || 'none'} · model: {task.model} · max tokens: {task.maxTokens}</p>
            <p>writable scope: {formatPermissionScope(task.writableScope)}</p>
          </li>
        ))}</ol></dd></div>
        <div><dt>Permissions</dt><dd>
          <p>Tools: {approval.permissions.allowedTools.join(', ') || 'None'}</p>
          <p>Repositories: {formatRepositories(approval.permissions.allowedRepositories)}</p>
          <p>Channels: {approval.permissions.allowedChannels.join(', ') || 'None'}</p>
          <p>Recipients: {approval.permissions.allowedRecipients.join(', ') || 'None'}</p>
          <p>Credentials: {approval.permissions.allowedCredentialRefs.join(', ') || 'None'}</p>
          <p>Data scopes: {approval.permissions.allowedDataScopes.join(', ') || 'None'}</p>
          <p>Mutations: {formatEnumList(approval.permissions.allowedMutationClasses)}</p>
        </dd></div>
        <div><dt>Escalations</dt><dd>Escalations: {formatEnumList(approval.escalationConditions)}</dd></div>
        <div><dt>Rollback</dt><dd>{approval.rollback.strategy} · {approval.rollback.steps.join(' → ') || 'No steps'} · verify: {approval.rollback.verification}</dd></div>
        <div><dt>Acceptance</dt><dd>{approval.acceptanceTests.map((test) => `${test.description} [${test.verification}; evidence: ${test.requiredEvidence.join(', ') || 'none'}]`).join('; ') || 'None'}</dd></div>
      </dl>
      <div className="jericho-action-row">
        {approval.actions.map((action) => (
          <button
            type="button"
            key={action.id}
            disabled={!action.enabled || decidingAction === action.id}
            title={!action.enabled ? action.disabledReason : undefined}
            onClick={() => onDecision(action)}
          >
            {decidingAction === action.id ? 'Recording…' : action.label}
          </button>
        ))}
      </div>
    </article>
  );
}

function Status({ value }: { value: string }) {
  return <span className={`jericho-status jericho-status--${value}`}>{value.replaceAll('_', ' ')}</span>;
}

function EmptyState({ label = 'No verified items' }: { label?: string }) {
  return <p className="jericho-empty">{label}</p>;
}

function rankByIds(items: CommandCenterEntityCard[], ids: string[]) {
  const positions = new Map(ids.map((id, index) => [id, index]));
  return items.filter((item) => positions.has(item.id)).sort((a, b) => positions.get(a.id)! - positions.get(b.id)!);
}

function pipelineIndex(stage: CommandCenterMissionStage): number {
  switch (stage) {
    case CommandCenterMissionStage.Plan: return 3;
    case CommandCenterMissionStage.Approve: return 4;
    case CommandCenterMissionStage.Execute: return 5;
    case CommandCenterMissionStage.Present: return 7;
    case CommandCenterMissionStage.Review: return 2;
  }
}

function nodePosition(index: number, count: number) {
  if (count === 1) return { x: 360, y: 190 };
  const angle = (-Math.PI / 2) + (index / count) * Math.PI * 2;
  const radiusX = 230 + (index % 2) * 34;
  const radiusY = 118 + ((index + 1) % 2) * 18;
  return { x: 360 + Math.cos(angle) * radiusX, y: 190 + Math.sin(angle) * radiusY };
}

function semanticNeighborhood(
  rootNodeId: string | undefined,
  depth: number,
  nodeIds: string[],
  edges: CommandCenterSnapshot['nucleus']['edges'],
): Set<string> {
  if (!rootNodeId) return new Set();
  const known = new Set(nodeIds);
  if (!known.has(rootNodeId)) return new Set();
  const adjacency = new Map<string, Set<string>>();
  for (const nodeId of known) adjacency.set(nodeId, new Set());
  for (const edge of edges) {
    adjacency.get(edge.fromNodeId)?.add(edge.toNodeId);
    adjacency.get(edge.toNodeId)?.add(edge.fromNodeId);
  }
  const visible = new Set([rootNodeId]);
  let frontier = [rootNodeId];
  for (let level = 0; level < depth && frontier.length; level += 1) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      for (const adjacent of adjacency.get(nodeId) ?? []) {
        if (visible.has(adjacent)) continue;
        visible.add(adjacent);
        next.push(adjacent);
      }
    }
    frontier = next;
  }
  return visible;
}

function nucleusNodeId(targetId: unknown): string | undefined {
  if (typeof targetId !== 'string' || !targetId.startsWith('nucleus:')) return undefined;
  const nodeId = targetId.slice('nucleus:'.length);
  return nodeId || undefined;
}

function nucleusNodeAtPoint(ownerDocument: Document, point: { x: number; y: number }): string | undefined {
  if (typeof ownerDocument.elementsFromPoint !== 'function') return undefined;
  for (const element of ownerDocument.elementsFromPoint(point.x, point.y)) {
    const node = element.closest<SVGElement>('[data-jericho-nucleus-node]');
    const nodeId = node?.dataset.jerichoNucleusNode;
    if (nodeId) return nodeId;
  }
  return undefined;
}

function nodeLabel(
  nodes: CommandCenterSnapshot['nucleus']['nodes'],
  nodeId: string,
): string {
  return nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function compactTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—';
}

function freshness(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? compactTime(value) : 'unknown';
}

function titleCase(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function formatCost(value: number) {
  return `$${(value / 1_000_000).toFixed(4)}`;
}

function formatDuration(value: number) {
  if (value < 60_000) return `${Math.ceil(value / 1_000)} sec`;
  return `${Math.ceil(value / 60_000)} min`;
}

function formatExternalAction(action: CommandCenterApproval['externalActions'][number]) {
  const scope = action.recipient ?? action.repository ?? action.destination;
  return `${action.connectorId}:${action.action} → ${scope} [${action.mutationClass}]`;
}

function formatRepositories(repositories: CommandCenterApproval['permissions']['allowedRepositories']) {
  return repositories.map((grant) =>
    `${grant.repository}: ${grant.writablePaths.join(', ') || 'no writable paths'} [${formatEnumList(grant.mutationClasses)}]`,
  ).join('; ') || 'None';
}

function formatPermissionScope(scope: CommandCenterApproval['permissions']) {
  return [
    `tools ${scope.allowedTools.join(', ') || 'none'}`,
    `repositories ${formatRepositories(scope.allowedRepositories)}`,
    `channels ${scope.allowedChannels.join(', ') || 'none'}`,
    `recipients ${scope.allowedRecipients.join(', ') || 'none'}`,
    `credentials ${scope.allowedCredentialRefs.join(', ') || 'none'}`,
    `data ${scope.allowedDataScopes.join(', ') || 'none'}`,
    `mutations ${formatEnumList(scope.allowedMutationClasses)}`,
  ].join(' · ');
}

function formatEnumList(values: readonly string[]) {
  return values.map((value) => value.replaceAll('_', ' ')).join(', ') || 'None';
}

function formatProvenance(item: CommandCenterTimelineEntry['provenance'][number]) {
  const actor = item.actorId ? ` · actor ${item.actorId}` : '';
  const event = item.sourceEventId ? ` · event ${item.sourceEventId}` : '';
  return `${item.source} (${item.sourceType})${actor}${event}`;
}
