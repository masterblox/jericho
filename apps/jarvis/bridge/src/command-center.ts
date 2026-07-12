import { createHash } from 'node:crypto';

import {
  CommandCenterActionKind,
  CommandCenterMissionStage,
  CommandCenterTimelineKind,
  CommandCenterVerification,
  ChangeLogKind,
  DecisionOutcome,
  EntityType,
  IntentRoute,
  LifecycleStatus,
  NucleusNodeKind,
  ReceiptStatus,
  RelationType,
  type ActionDescriptor,
  type ActionReceipt,
  type AgentCapability,
  type Assignment,
  type CommandCenterApproval,
  type CommandCenterEntityCard,
  type CommandCenterMission,
  type CommandCenterNucleus,
  type CommandCenterOutcome,
  type CommandCenterSnapshot,
  type CommandCenterTimelineEntry,
  type ChangeLog,
  type CaptureFailure,
  type Entity,
  type EventEnvelope,
  type IntentEnvelope,
  type MissionPlan,
  type MissionTask,
  type NucleusNode,
  type Provenance,
} from '@jericho/shared';

import type { JerichoStore } from './core/store.js';
import { FleetKnowledgeService } from './knowledge/fleet-knowledge.js';

const ACTIVE_MISSION_STATUSES = new Set<LifecycleStatus>([
  LifecycleStatus.Approved,
  LifecycleStatus.Active,
  LifecycleStatus.Paused,
]);
const ACTIVE_ASSIGNMENT_STATUSES = new Set<LifecycleStatus>([
  LifecycleStatus.Queued,
  LifecycleStatus.Active,
  LifecycleStatus.Paused,
]);
const TERMINAL_ASSIGNMENT_STATUSES = new Set<LifecycleStatus>([
  LifecycleStatus.Succeeded,
  LifecycleStatus.Failed,
  LifecycleStatus.Cancelled,
]);

export function buildCommandCenterSnapshot(
  store: JerichoStore,
  generatedAt: string,
): CommandCenterSnapshot {
  const entities = store.listEntities();
  const relations = store.listRelations();
  const events = store.listEvents({ limit: 10_000 });
  const missions = store.listMissions();
  const missionTasks = new Map(
    missions.map((mission) => [mission.id, store.listMissionTasks(mission.id)]),
  );
  const capabilities = store.listAgentCapabilities();
  const assignments = store.listAssignments();
  const receipts = store.listReceipts();
  const proposals = store.listProposals();
  const decisions = store.listDecisions();
  const intents = store.listIntents();
  const changes = store.listChangeLog({ limit: 10_000 });
  const connectors = store.listConnectorHealth();
  const captureFailures = store.listCaptureFailures().map(redactIdentityReviewCandidate);
  const identityReviews = store.listIdentityReviews();
  const disposedReviewIntentIds = new Set(
    decisions.flatMap((decision) => decision.intentId ? [decision.intentId] : []),
  );
  const reviewIntents = intents.filter((intent) => intent.route === IntentRoute.Review)
    .filter((intent) => !disposedReviewIntentIds.has(intent.id));
  const costs = new Map(missions.map((mission) => [mission.id, store.listCosts(mission.id)]));
  const knownEventIds = new Set(events.map((event) => event.id));
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const fleetKnowledge = new FleetKnowledgeService(store);
  const knowledge = {
    packages: fleetKnowledge.listPackages(),
    projections: fleetKnowledge.listProjections(),
    projectionReceipts: fleetKnowledge.listProjectionReceipts(),
    indexes: fleetKnowledge.listIndexes(),
    evaluations: fleetKnowledge.listEvaluations(),
    paperclip: fleetKnowledge.listPaperclip(),
  };

  const tasks = rankCards(
    entities.filter((entity) => entity.type === EntityType.Task),
    knownEventIds,
  );
  const communications = rankCards(
    entities.filter((entity) => entity.type === EntityType.Conversation),
    knownEventIds,
    true,
  );
  const people = rankCards(
    entities.filter((entity) => entity.type === EntityType.Person),
    knownEventIds,
  );
  const commitments = rankCards(
    entities.filter((entity) => entity.type === EntityType.Commitment),
    knownEventIds,
  );

  const history = buildHistory(events, intents, missions, assignments, receipts, decisions, changes);
  const projectedMissions = missions.map((mission) => projectMission(
    mission,
    missionTasks.get(mission.id) ?? [],
    assignments.filter((assignment) => assignment.missionId === mission.id),
    costs.get(mission.id) ?? [],
    history.filter((entry) => entry.missionId === mission.id),
    generatedAt,
  ));
  const missionById = new Map(projectedMissions.map((mission) => [mission.id, mission]));
  const approvals = missions
    .filter((mission) => mission.status === LifecycleStatus.PendingApproval)
    .map((mission) => projectApproval(
      store,
      mission,
      missionById.get(mission.id)!,
      entityById,
    ));
  const activeAssignments = assignments.filter((assignment) =>
    ACTIVE_ASSIGNMENT_STATUSES.has(assignment.status));
  const outcomes = buildOutcomes(assignments, receipts);
  const nucleus = buildNucleus(
    entities,
    relations,
    events,
    intents,
    missions,
    capabilities,
    assignments,
    receipts,
    history,
    missionTasks,
    knownEventIds,
  );
  const source = {
    entities,
    relations,
    events,
    missions,
    missionTasks: [...missionTasks.values()],
    capabilities,
    assignments,
    receipts,
    proposals,
    decisions,
    intents,
    changes,
    connectors,
    captureFailures,
    identityReviews,
    reviewIntents,
    costs: [...costs.values()],
    knowledge,
    lastChangeSequence: store.getLatestChangeSequence(),
  };

  return {
    revision: createHash('sha256').update(JSON.stringify(source)).digest('hex'),
    generatedAt,
    today: {
      date: generatedAt.slice(0, 10),
      taskIds: dueOn(tasks, generatedAt.slice(0, 10)),
      commitmentIds: dueOn(commitments, generatedAt.slice(0, 10)),
      activeMissionIds: missions
        .filter((mission) => ACTIVE_MISSION_STATUSES.has(mission.status))
        .map((mission) => mission.id),
      pendingApprovalIds: approvals.map((approval) => approval.missionId),
    },
    tasks,
    communications,
    people,
    commitments,
    missions: projectedMissions,
    approvals,
    proposals,
    activeAssignments,
    outcomes,
    receipts,
    history,
    connectors,
    captureFailures,
    identityReviews,
    reviewIntents,
    lastChangeSequence: source.lastChangeSequence,
    nucleus,
    knowledge,
  };
}

function redactIdentityReviewCandidate(failure: CaptureFailure): CaptureFailure {
  if (!failure.reviewCandidate) return failure;
  const { reviewCandidate: _privateReviewCandidate, ...safeFailure } = failure;
  return safeFailure;
}

function rankCards(
  entities: Entity[],
  knownEventIds: ReadonlySet<string>,
  communications = false,
): CommandCenterEntityCard[] {
  return entities
    .sort((left, right) => {
      if (communications) {
        const priority = cardPriority(right) - cardPriority(left);
        if (priority !== 0) return priority;
      }
      return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
    })
    .map((entity, index) => ({
      id: entity.id,
      entityType: entity.type,
      label: entity.canonicalName,
      rank: index + 1,
      ...(entity.status ? { status: entity.status } : {}),
      ...(entity.risk ? { risk: entity.risk } : {}),
      ...(entity.confidence !== undefined ? { confidence: entity.confidence } : {}),
      freshness: entity.freshness,
      evidenceEventIds: evidenceFromProvenance(entity.provenance, knownEventIds),
      attributes: entity.attributes,
      updatedAt: entity.updatedAt,
    }));
}

function cardPriority(entity: Entity): number {
  return numericAttribute(entity, 'priority') * 100 + numericAttribute(entity, 'unreadCount');
}

function numericAttribute(entity: Entity, key: string): number {
  const value = entity.attributes[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function dueOn(cards: CommandCenterEntityCard[], date: string): string[] {
  return cards.filter((card) => {
    const dueAt = card.attributes.dueAt ?? card.attributes.scheduledAt;
    return typeof dueAt === 'string' && dueAt.slice(0, 10) === date && !isTerminal(card.status);
  }).map((card) => card.id);
}

function projectMission(
  mission: MissionPlan,
  tasks: MissionTask[],
  assignments: Assignment[],
  costs: ReturnType<JerichoStore['listCosts']>,
  timeline: CommandCenterTimelineEntry[],
  generatedAt: string,
): CommandCenterMission {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const recordedEstimatedCostMicroUsd = costs.reduce(
    (total, cost) => total + cost.estimatedMicroUsd,
    0,
  );
  const actualCostMicroUsd = costs.reduce((total, cost) => total + cost.actualMicroUsd, 0);
  const runtimeEnd = mission.completedAt ?? generatedAt;
  return {
    id: mission.id,
    seriesId: mission.seriesId,
    version: mission.version,
    planHash: mission.planHash,
    title: mission.title,
    objective: mission.objective,
    status: mission.status,
    stage: missionStage(mission.status),
    risk: mission.risk,
    ...(mission.confidence !== undefined ? { confidence: mission.confidence } : {}),
    taskGraph: mission.taskGraph.map((definition) => ({
      id: definition.id,
      title: definition.title,
      status: taskById.get(definition.id)?.status ?? LifecycleStatus.Queued,
      sequence: definition.sequence,
      dependsOn: [...definition.dependsOn],
      lane: definition.lane,
      agentId: definition.selectedAgentId,
      capabilityIds: [...definition.capabilityIds],
      estimatedCostMicroUsd: definition.estimatedCostMicroUsd,
      expectedArtifact: definition.expectedArtifact,
      ...(definition.externalAction ? { externalAction: definition.externalAction } : {}),
    })),
    agents: mission.selectedAgents,
    budget: {
      limits: mission.budget,
      plannedCostMicroUsd: mission.taskGraph.reduce(
        (total, task) => total + task.estimatedCostMicroUsd,
        0,
      ),
      recordedEstimatedCostMicroUsd,
      actualCostMicroUsd,
      elapsedRuntimeMs: mission.startedAt
        ? Math.max(0, Date.parse(runtimeEnd) - Date.parse(mission.startedAt))
        : 0,
      activeAssignments: assignments.filter((assignment) =>
        ACTIVE_ASSIGNMENT_STATUSES.has(assignment.status)).length,
      assignmentAttempts: assignments.reduce((total, assignment) => total + assignment.attempt, 0),
    },
    acceptanceTests: mission.acceptanceTests,
    escalationConditions: mission.escalationConditions,
    timeline,
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
  };
}

function projectApproval(
  store: JerichoStore,
  mission: MissionPlan,
  projected: CommandCenterMission,
  entityById: ReadonlyMap<string, Entity>,
): CommandCenterApproval {
  const intent = store.getIntent(mission.intentId);
  const externalActions = mission.taskGraph.flatMap((task) =>
    task.externalAction ? [task.externalAction] : []);
  const affectedSystems = new Set(mission.permissions.allowedSystems);
  const affectedPartyIds = new Set([
    ...(intent?.affectedPartyIds ?? []),
    ...mission.permissions.allowedRecipients,
  ]);
  for (const action of externalActions) {
    affectedSystems.add(action.system ?? action.connectorId);
    if (action.recipient) affectedPartyIds.add(action.recipient);
  }
  return {
    id: `approval:${mission.id}:${mission.version}`,
    missionId: mission.id,
    planHash: mission.planHash,
    version: mission.version,
    title: mission.title,
    objective: mission.objective,
    risk: mission.risk,
    affectedParties: [...affectedPartyIds].map((entityId) => {
      const entity = entityById.get(entityId);
      return {
        entityId,
        ...(entity ? { label: entity.canonicalName, entityType: entity.type } : {}),
      };
    }),
    affectedSystems: [...affectedSystems].sort(),
    externalActions,
    deliverables: mission.deliverables,
    taskGraph: mission.taskGraph,
    agents: mission.selectedAgents,
    budget: mission.budget,
    permissions: mission.permissions,
    escalationConditions: mission.escalationConditions,
    cost: {
      maximumMicroUsd: mission.budget.maxCostMicroUsd,
      plannedMicroUsd: projected.budget.plannedCostMicroUsd,
      actualMicroUsd: projected.budget.actualCostMicroUsd,
    },
    time: {
      maximumRuntimeMs: mission.budget.maxRuntimeMs,
      elapsedRuntimeMs: projected.budget.elapsedRuntimeMs,
    },
    acceptanceTests: mission.acceptanceTests,
    rollback: mission.rollback,
    actions: approvalActions(mission),
  };
}

function approvalActions(mission: MissionPlan): ActionDescriptor[] {
  const endpoint = `/api/v1/missions/${encodeURIComponent(mission.id)}/decisions`;
  return [
    {
      id: `${mission.id}:${mission.version}:approve`,
      kind: CommandCenterActionKind.ApproveMission,
      label: 'Approve mission',
      targetType: 'mission',
      targetId: mission.id,
      method: 'POST',
      endpoint,
      enabled: true,
      requiresConfirmation: true,
      payload: {
        outcome: DecisionOutcome.Approved,
        planHash: mission.planHash,
        version: mission.version,
      },
    },
    {
      id: `${mission.id}:${mission.version}:reject`,
      kind: CommandCenterActionKind.RejectMission,
      label: 'Reject mission',
      targetType: 'mission',
      targetId: mission.id,
      method: 'POST',
      endpoint,
      enabled: true,
      requiresConfirmation: true,
      payload: {
        outcome: DecisionOutcome.Rejected,
        planHash: mission.planHash,
        version: mission.version,
      },
    },
  ];
}

function buildOutcomes(
  assignments: Assignment[],
  receipts: ReturnType<JerichoStore['listReceipts']>,
): CommandCenterOutcome[] {
  return assignments.filter((assignment) => TERMINAL_ASSIGNMENT_STATUSES.has(assignment.status))
    .map((assignment) => {
      const relatedReceipts = receiptsForAssignment(receipts, assignment);
      return {
        id: `outcome:${assignment.id}`,
        missionId: assignment.missionId,
        missionTaskId: assignment.missionTaskId,
        assignmentId: assignment.id,
        status: assignment.status,
        ...(assignment.artifact !== undefined ? { artifact: assignment.artifact } : {}),
        ...(assignment.completedAt ? { completedAt: assignment.completedAt } : {}),
        evidenceEventIds: unique([
          ...assignment.evidenceEventIds,
          ...relatedReceipts.flatMap((receipt) => receipt.evidenceEventIds),
        ]),
        receiptIds: relatedReceipts.map((receipt) => receipt.id),
        verified: verifiedOutcome(assignment, relatedReceipts),
      };
    });
}

function buildHistory(
  events: EventEnvelope[],
  intents: IntentEnvelope[],
  missions: MissionPlan[],
  assignments: Assignment[],
  receipts: ReturnType<JerichoStore['listReceipts']>,
  decisions: ReturnType<JerichoStore['listDecisions']>,
  changes: ChangeLog[],
): CommandCenterTimelineEntry[] {
  const entries: CommandCenterTimelineEntry[] = [];
  const missionById = new Map(missions.map((mission) => [mission.id, mission]));
  const intentById = new Map(intents.map((intent) => [intent.id, intent]));
  const assignmentById = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  const receiptById = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  const missionsByIntent = groupBy(missions, (mission) => mission.intentId);
  const missionsByEvidence = new Map<string, Set<string>>();
  for (const mission of missions) {
    const intent = intentById.get(mission.intentId);
    for (const eventId of unique([
      ...mission.evidenceEventIds,
      ...(intent?.eventId ? [intent.eventId] : []),
      ...(intent?.requiredEvidence.map((evidence) => evidence.eventId) ?? []),
      ...(intent?.contradictoryEvidenceEventIds ?? []),
    ])) {
      const linked = missionsByEvidence.get(eventId) ?? new Set<string>();
      linked.add(mission.id);
      missionsByEvidence.set(eventId, linked);
    }
  }
  for (const event of events) {
    const linkedMissionIds = new Set(missionsByEvidence.get(event.id) ?? []);
    const payloadMissionId = missionIdFromPayload(event.payload);
    if (payloadMissionId && missionById.has(payloadMissionId)) linkedMissionIds.add(payloadMissionId);
    const scopes: Array<string | undefined> = linkedMissionIds.size
      ? [...linkedMissionIds].sort()
      : [undefined];
    const retained = event.type === 'jericho.retention.completed' && Boolean(payloadMissionId);
    for (const missionId of scopes) {
      const actor = actorFromProvenance(event.provenance);
      entries.push({
        id: `${retained ? 'retain' : 'capture'}:${event.id}${missionId ? `:mission:${missionId}` : ''}`,
        kind: retained ? CommandCenterTimelineKind.Retain : CommandCenterTimelineKind.Capture,
        occurredAt: event.occurredAt,
        title: retained ? 'Mission retained' : event.type,
        recordType: 'event',
        recordId: event.id,
        ...(missionId ? { missionId } : {}),
        ...(event.status ? { status: event.status } : {}),
        ...(actor ? { actor } : {}),
        evidenceEventIds: [event.id],
        provenance: event.provenance,
        verified: Boolean(event.integrityHash),
        verification: event.integrityHash
          ? CommandCenterVerification.Integrity
          : CommandCenterVerification.NotVerified,
      });
    }
  }
  for (const intent of intents) {
    const linkedMissions = missionsByIntent.get(intent.id) ?? [];
    const scopes: Array<MissionPlan | undefined> = linkedMissions.length
      ? linkedMissions
      : [undefined];
    const evidenceEventIds = intentEvidenceEventIds(intent);
    const actor = actorFromProvenance(intent.provenance);
    for (const mission of scopes) {
      const suffix = mission ? `:mission:${mission.id}` : '';
      const common = {
        recordType: 'intent',
        recordId: intent.id,
        ...(mission ? { missionId: mission.id } : {}),
        ...(actor ? { actor } : {}),
        summary: intent.summary,
        risk: intent.risk,
        confidence: intent.confidence,
        evidenceEventIds,
        provenance: intent.provenance,
        verified: Boolean(intent.integrityHash),
        verification: intent.integrityHash
          ? CommandCenterVerification.Integrity
          : CommandCenterVerification.NotVerified,
      } as const;
      entries.push({
        ...common,
        id: `understand:${intent.id}${suffix}`,
        kind: CommandCenterTimelineKind.Understand,
        occurredAt: intent.createdAt,
        title: 'Intent classified',
      });
      entries.push({
        ...common,
        id: `route:${intent.id}${suffix}`,
        kind: CommandCenterTimelineKind.Route,
        occurredAt: intent.updatedAt,
        title: `Routed to ${intent.route}`,
        route: intent.route,
        routeRuleId: intent.routeRuleId,
      });
    }
  }
  for (const mission of missions) {
    const actor = actorFromProvenance(mission.provenance);
    entries.push({
      id: `mission:${mission.id}:planned`,
      kind: CommandCenterTimelineKind.Plan,
      occurredAt: mission.createdAt,
      title: mission.title,
      recordType: 'mission',
      recordId: mission.id,
      missionId: mission.id,
      status: LifecycleStatus.PendingApproval,
      ...(actor ? { actor } : {}),
      planHash: mission.planHash,
      planVersion: mission.version,
      evidenceEventIds: mission.evidenceEventIds,
      provenance: mission.provenance,
      verified: Boolean(mission.integrityHash),
      verification: mission.integrityHash
        ? CommandCenterVerification.Integrity
        : CommandCenterVerification.NotVerified,
    });
    if (mission.status === LifecycleStatus.Succeeded && mission.completedAt) {
      entries.push({
        id: `mission:${mission.id}:present`,
        kind: CommandCenterTimelineKind.Present,
        occurredAt: mission.completedAt,
        title: `Mission ${mission.status}`,
        recordType: 'mission',
        recordId: mission.id,
        missionId: mission.id,
        status: mission.status,
        planHash: mission.planHash,
        planVersion: mission.version,
        evidenceEventIds: mission.evidenceEventIds,
        provenance: [],
        verified: Boolean(mission.integrityHash),
        verification: mission.integrityHash
          ? CommandCenterVerification.Integrity
          : CommandCenterVerification.NotVerified,
      });
    }
  }
  for (const decision of decisions) {
    const mission = decision.missionId ? missionById.get(decision.missionId) : undefined;
    const decisionSubject = decision.proposalId
      ? 'Proposal'
      : decision.identityReviewId
        ? 'Identity review'
        : decision.intentId
          ? 'Intent review'
          : 'Mission';
    const planDecision = Boolean(
      mission && !decision.proposalId &&
      (decision.outcome === DecisionOutcome.Approved || decision.outcome === DecisionOutcome.Rejected) &&
      decision.planHash === mission.planHash && decision.planVersion === mission.version,
    );
    entries.push({
      id: `decision:${decision.id}`,
      kind: planDecision ? CommandCenterTimelineKind.Approve : CommandCenterTimelineKind.Decision,
      occurredAt: decision.decidedAt,
      title: `${decisionSubject} ${decision.outcome}`,
      recordType: 'decision',
      recordId: decision.id,
      ...(decision.missionId ? { missionId: decision.missionId } : {}),
      actor: decision.decidedBy,
      reason: decision.rationale,
      ...(decision.planHash ? { planHash: decision.planHash } : {}),
      ...(decision.planVersion ? { planVersion: decision.planVersion } : {}),
      evidenceEventIds: decision.evidenceEventIds,
      provenance: decision.provenance,
      verified: Boolean(decision.integrityHash),
      verification: decision.integrityHash
        ? CommandCenterVerification.Integrity
        : CommandCenterVerification.NotVerified,
    });
  }
  const assignmentChanges = groupBy(
    changes.filter((change) =>
      change.kind === ChangeLogKind.AssignmentChanged && assignmentById.has(change.recordId)),
    (change) => change.recordId,
  );
  for (const assignment of assignments) {
    const lifecycle = assignmentChanges.get(assignment.id) ?? [];
    if (!lifecycle.length) {
      entries.push(projectCurrentAssignment(assignment, receipts));
      continue;
    }
    for (const change of lifecycle) {
      const status = lifecycleStatusFromChange(change);
      if (!status) continue;
      const terminal = TERMINAL_ASSIGNMENT_STATUSES.has(status);
      const currentTerminal = terminal && assignment.status === status;
      const outcomeVerified = currentTerminal && verifiedOutcome(
        assignment,
        receiptsForAssignment(receipts, assignment),
      );
      entries.push({
        id: currentTerminal
          ? `outcome:${assignment.id}`
          : `assignment:${assignment.id}:change:${change.sequence}`,
        kind: terminal ? CommandCenterTimelineKind.Outcome : CommandCenterTimelineKind.Execute,
        occurredAt: change.changedAt,
        title: `Assignment ${status}`,
        recordType: 'assignment',
        recordId: assignment.id,
        missionId: assignment.missionId,
        status,
        agentId: assignment.agentId,
        ...(currentTerminal && assignment.cancelReason ? { reason: assignment.cancelReason } : {}),
        ...(currentTerminal && assignment.artifact !== undefined ? { artifactRecorded: true } : {}),
        evidenceEventIds: assignment.evidenceEventIds,
        provenance: [],
        verified: terminal ? outcomeVerified : Boolean(change.integrityHash),
        verification: terminal
          ? outcomeVerified
            ? CommandCenterVerification.Outcome
            : CommandCenterVerification.NotVerified
          : change.integrityHash
            ? CommandCenterVerification.Integrity
            : CommandCenterVerification.NotVerified,
      });
    }
  }
  const receiptChanges = groupBy(
    changes.filter((change) =>
      change.kind === ChangeLogKind.ReceiptChanged && receiptById.has(change.recordId)),
    (change) => change.recordId,
  );
  for (const receipt of receipts) {
    const lifecycle = receiptChanges.get(receipt.id) ?? [];
    if (!lifecycle.length) lifecycle.push({
      id: `fallback:${receipt.id}`,
      sequence: 0,
      kind: ChangeLogKind.ReceiptChanged,
      recordType: 'receipt',
      recordId: receipt.id,
      changedAt: receipt.completedAt ?? receipt.startedAt ?? receipt.requestedAt,
      payload: { status: receipt.status },
    });
    for (const change of lifecycle) {
      const status = receiptStatusFromChange(change);
      if (!status) continue;
      const current = status === receipt.status &&
        change.changedAt === (receipt.completedAt ?? receipt.startedAt ?? receipt.requestedAt);
      const destinationVerified = current && isDestinationVerifiedReceipt(receipt);
      entries.push({
        id: current ? `receipt:${receipt.id}` : `receipt:${receipt.id}:change:${change.sequence}`,
        kind: CommandCenterTimelineKind.Receipt,
        occurredAt: change.changedAt,
        title: `${receipt.action}: ${status}`,
        recordType: 'receipt',
        recordId: receipt.id,
        ...(assignmentMissionId(assignments, receipt.assignmentId) ? {
          missionId: assignmentMissionId(assignments, receipt.assignmentId),
        } : {}),
        status,
        evidenceEventIds: receipt.evidenceEventIds,
        provenance: receipt.provenance,
        verified: destinationVerified,
        verification: destinationVerified
          ? CommandCenterVerification.Destination
          : CommandCenterVerification.NotVerified,
      });
    }
  }
  return entries.sort((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt) ||
    timelineKindOrder(left.kind) - timelineKindOrder(right.kind) ||
    left.id.localeCompare(right.id));
}

function buildNucleus(
  entities: Entity[],
  relations: ReturnType<JerichoStore['listRelations']>,
  events: EventEnvelope[],
  intents: IntentEnvelope[],
  missions: MissionPlan[],
  capabilities: AgentCapability[],
  assignments: Assignment[],
  receipts: ReturnType<JerichoStore['listReceipts']>,
  history: CommandCenterTimelineEntry[],
  missionTasks: ReadonlyMap<string, MissionTask[]>,
  knownEventIds: ReadonlySet<string>,
): CommandCenterNucleus {
  const nodes: NucleusNode[] = [];
  for (const entity of entities.filter(hasVerifiedIntegrity)) {
    nodes.push({
      id: `entity:${entity.id}`, kind: NucleusNodeKind.Entity,
      recordType: 'entity', recordId: entity.id, label: entity.canonicalName,
      entityType: entity.type, ...(entity.status ? { status: entity.status } : {}),
      ...(entity.risk ? { risk: entity.risk } : {}), updatedAt: entity.updatedAt,
      evidenceEventIds: evidenceFromProvenance(entity.provenance, knownEventIds), verified: true,
    });
  }
  for (const event of events.filter(hasVerifiedIntegrity)) {
    nodes.push({
      id: `evidence:${event.id}`, kind: NucleusNodeKind.Evidence,
      recordType: 'event', recordId: event.id,
      label: event.type === 'jericho.retention.completed' ? 'Mission retained' : event.type,
      ...(event.status ? { status: event.status } : {}),
      ...(event.risk ? { risk: event.risk } : {}),
      updatedAt: event.occurredAt, evidenceEventIds: [event.id], verified: true,
    });
  }
  for (const intent of intents.filter(hasVerifiedIntegrity)) {
    nodes.push({
      id: `intent:${intent.id}`, kind: NucleusNodeKind.Intent,
      recordType: 'intent', recordId: intent.id, label: intent.summary,
      status: intent.status, risk: intent.risk, updatedAt: intent.updatedAt,
      evidenceEventIds: intentEvidenceEventIds(intent), verified: true,
    });
  }
  for (const mission of missions.filter(hasVerifiedIntegrity)) {
    nodes.push({
      id: `mission:${mission.id}`, kind: NucleusNodeKind.Mission,
      recordType: 'mission', recordId: mission.id, label: mission.title,
      status: mission.status, risk: mission.risk, updatedAt: mission.updatedAt,
      evidenceEventIds: mission.evidenceEventIds, verified: true,
    });
  }
  const capabilityByAgent = new Map<string, AgentCapability>();
  for (const capability of capabilities.filter(hasVerifiedIntegrity)) {
    const current = capabilityByAgent.get(capability.agentId);
    if (!current || capability.updatedAt > current.updatedAt) {
      capabilityByAgent.set(capability.agentId, capability);
    }
  }
  for (const [agentId, capability] of capabilityByAgent) {
    nodes.push({
      id: `agent:${agentId}`, kind: NucleusNodeKind.Agent,
      recordType: 'agent', recordId: agentId, label: capability.name,
      status: capability.status, risk: capability.maximumRisk, updatedAt: capability.updatedAt,
      evidenceEventIds: evidenceFromProvenance(capability.provenance, knownEventIds), verified: true,
    });
  }
  for (const assignment of assignments.filter(hasVerifiedIntegrity)) {
    const title = missionTasks.get(assignment.missionId)
      ?.find((task) => task.id === assignment.missionTaskId)?.title ?? assignment.missionTaskId;
    nodes.push({
      id: `assignment:${assignment.id}`, kind: NucleusNodeKind.Assignment,
      recordType: 'assignment', recordId: assignment.id,
      label: `${assignment.agentId}: ${title}`, status: assignment.status, risk: assignment.risk,
      updatedAt: assignment.completedAt ?? assignment.acceptedAt ?? assignment.assignedAt,
      evidenceEventIds: assignment.evidenceEventIds, verified: true,
    });
  }
  for (const receipt of receipts.filter((item) =>
    hasVerifiedIntegrity(item) && isDestinationVerifiedReceipt(item))) {
    nodes.push({
      id: `receipt:${receipt.id}`, kind: NucleusNodeKind.Receipt,
      recordType: 'receipt', recordId: receipt.id,
      label: `${receipt.action} → ${receipt.destination}`, status: receipt.status, risk: receipt.risk,
      updatedAt: receipt.completedAt ?? receipt.requestedAt,
      evidenceEventIds: receipt.evidenceEventIds, verified: true,
    });
  }
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: CommandCenterNucleus['edges'] = relations.filter(hasVerifiedIntegrity)
    .filter((relation) =>
      nodeIds.has(`entity:${relation.fromEntityId}`) && nodeIds.has(`entity:${relation.toEntityId}`))
    .map((relation) => ({
      id: `relation:${relation.id}`,
      fromNodeId: `entity:${relation.fromEntityId}`,
      toNodeId: `entity:${relation.toEntityId}`,
      relation: relation.type,
      evidenceEventIds: evidenceFromProvenance(relation.provenance, knownEventIds),
      verified: true,
    }));
  for (const intent of intents.filter(hasVerifiedIntegrity)) {
    for (const eventId of intentEvidenceEventIds(intent)) {
      if (nodeIds.has(`evidence:${eventId}`) && nodeIds.has(`intent:${intent.id}`)) {
        edges.push({
          id: `evidence-intent:${eventId}:${intent.id}`,
          fromNodeId: `evidence:${eventId}`,
          toNodeId: `intent:${intent.id}`,
          relation: RelationType.Supports,
          evidenceEventIds: [eventId],
          verified: true,
        });
      }
    }
  }
  for (const mission of missions.filter(hasVerifiedIntegrity)) {
    if (nodeIds.has(`intent:${mission.intentId}`)) {
      edges.push({
        id: `intent-mission:${mission.intentId}:${mission.id}`,
        fromNodeId: `intent:${mission.intentId}`,
        toNodeId: `mission:${mission.id}`,
        relation: RelationType.Supports,
        evidenceEventIds: mission.evidenceEventIds,
        verified: true,
      });
    }
    for (const eventId of mission.evidenceEventIds) {
      if (nodeIds.has(`evidence:${eventId}`)) {
        edges.push({
          id: `evidence-mission:${eventId}:${mission.id}`,
          fromNodeId: `evidence:${eventId}`,
          toNodeId: `mission:${mission.id}`,
          relation: RelationType.Supports,
          evidenceEventIds: [eventId],
          verified: true,
        });
      }
    }
  }
  for (const event of events.filter(hasVerifiedIntegrity)) {
    const missionId = missionIdFromPayload(event.payload);
    if (missionId && nodeIds.has(`mission:${missionId}`)) {
      edges.push({
        id: `evidence-mission:${event.id}:${missionId}`,
        fromNodeId: `evidence:${event.id}`,
        toNodeId: `mission:${missionId}`,
        relation: RelationType.Supports,
        evidenceEventIds: [event.id],
        verified: true,
      });
    }
  }
  for (const mission of missions) {
    for (const agentId of unique(mission.selectedAgents.map((agent) => agent.agentId))) {
      if (nodeIds.has(`mission:${mission.id}`) && nodeIds.has(`agent:${agentId}`)) {
        edges.push({
          id: `mission-agent:${mission.id}:${agentId}`,
          fromNodeId: `mission:${mission.id}`,
          toNodeId: `agent:${agentId}`,
          relation: RelationType.AssignedTo,
          evidenceEventIds: mission.evidenceEventIds,
          verified: true,
        });
      }
    }
  }
  for (const assignment of assignments.filter(hasVerifiedIntegrity)) {
    if (nodeIds.has(`assignment:${assignment.id}`) && nodeIds.has(`mission:${assignment.missionId}`)) {
      edges.push({
        id: `assignment-mission:${assignment.id}`,
        fromNodeId: `assignment:${assignment.id}`,
        toNodeId: `mission:${assignment.missionId}`,
        relation: RelationType.DependsOn,
        evidenceEventIds: assignment.evidenceEventIds,
        verified: true,
      });
    }
  }
  for (const receipt of receipts.filter(hasVerifiedIntegrity)) {
    if (receipt.assignmentId &&
      nodeIds.has(`receipt:${receipt.id}`) && nodeIds.has(`assignment:${receipt.assignmentId}`)) {
      edges.push({
        id: `receipt-assignment:${receipt.id}:${receipt.assignmentId}`,
        fromNodeId: `receipt:${receipt.id}`,
        toNodeId: `assignment:${receipt.assignmentId}`,
        relation: RelationType.Supports,
        evidenceEventIds: receipt.evidenceEventIds,
        verified: true,
      });
    }
  }
  const activityPulses = history.filter((entry) => entry.verified).flatMap((entry) => {
    const nodeId = timelineNodeId(entry, nodeIds);
    return nodeId ? [{
      id: `pulse:${entry.id}`,
      kind: entry.kind,
      occurredAt: entry.occurredAt,
      nodeId,
      label: entry.title,
      evidenceEventIds: entry.evidenceEventIds,
      verified: true as const,
    }] : [];
  });
  return { nodes, edges, activityPulses };
}

function missionStage(status: LifecycleStatus): CommandCenterMissionStage {
  if (status === LifecycleStatus.PendingApproval) return CommandCenterMissionStage.Approve;
  if (status === LifecycleStatus.Draft) return CommandCenterMissionStage.Plan;
  if (status === LifecycleStatus.Approved || status === LifecycleStatus.Active || status === LifecycleStatus.Queued) {
    return CommandCenterMissionStage.Execute;
  }
  if (status === LifecycleStatus.Succeeded) return CommandCenterMissionStage.Present;
  return CommandCenterMissionStage.Review;
}

function timelineNodeId(
  entry: CommandCenterTimelineEntry,
  nodeIds: ReadonlySet<string>,
): string | undefined {
  const candidate = entry.recordType === 'mission'
    ? `mission:${entry.recordId}`
    : entry.recordType === 'event'
      ? `evidence:${entry.recordId}`
      : entry.recordType === 'intent'
        ? `intent:${entry.recordId}`
    : entry.recordType === 'assignment'
      ? `assignment:${entry.recordId}`
      : entry.recordType === 'receipt'
        ? `receipt:${entry.recordId}`
        : entry.recordType === 'decision' && entry.missionId
          ? `mission:${entry.missionId}`
          : undefined;
  return candidate && nodeIds.has(candidate) ? candidate : undefined;
}

function projectCurrentAssignment(
  assignment: Assignment,
  receipts: ActionReceipt[],
): CommandCenterTimelineEntry {
  const terminal = TERMINAL_ASSIGNMENT_STATUSES.has(assignment.status);
  const outcomeVerified = terminal && verifiedOutcome(
    assignment,
    receiptsForAssignment(receipts, assignment),
  );
  return {
    id: `${terminal ? 'outcome' : 'assignment'}:${assignment.id}`,
    kind: terminal ? CommandCenterTimelineKind.Outcome : CommandCenterTimelineKind.Execute,
    occurredAt: assignment.completedAt ?? assignment.acceptedAt ?? assignment.assignedAt,
    title: `Assignment ${assignment.status}`,
    recordType: 'assignment',
    recordId: assignment.id,
    missionId: assignment.missionId,
    status: assignment.status,
    agentId: assignment.agentId,
    ...(assignment.cancelReason ? { reason: assignment.cancelReason } : {}),
    ...(terminal && assignment.artifact !== undefined ? { artifactRecorded: true } : {}),
    evidenceEventIds: assignment.evidenceEventIds,
    provenance: assignment.provenance,
    verified: terminal ? outcomeVerified : Boolean(assignment.integrityHash),
    verification: terminal
      ? outcomeVerified
        ? CommandCenterVerification.Outcome
        : CommandCenterVerification.NotVerified
      : assignment.integrityHash
        ? CommandCenterVerification.Integrity
        : CommandCenterVerification.NotVerified,
  };
}

function intentEvidenceEventIds(intent: IntentEnvelope): string[] {
  return unique([
    ...(intent.eventId ? [intent.eventId] : []),
    ...intent.requiredEvidence.map((evidence) => evidence.eventId),
    ...intent.contradictoryEvidenceEventIds,
  ]);
}

function missionIdFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const missionId = (payload as Record<string, unknown>).missionId;
  return typeof missionId === 'string' && missionId.trim() ? missionId : undefined;
}

function lifecycleStatusFromChange(change: ChangeLog): LifecycleStatus | undefined {
  const status = change.payload.status;
  return typeof status === 'string' && Object.values(LifecycleStatus).includes(status as LifecycleStatus)
    ? status as LifecycleStatus
    : undefined;
}

function receiptStatusFromChange(change: ChangeLog): ReceiptStatus | undefined {
  const status = change.payload.status;
  return typeof status === 'string' && Object.values(ReceiptStatus).includes(status as ReceiptStatus)
    ? status as ReceiptStatus
    : undefined;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const id = key(item);
    const group = grouped.get(id) ?? [];
    group.push(item);
    grouped.set(id, group);
  }
  return grouped;
}

function timelineKindOrder(kind: CommandCenterTimelineKind): number {
  return {
    [CommandCenterTimelineKind.Capture]: 0,
    [CommandCenterTimelineKind.Understand]: 1,
    [CommandCenterTimelineKind.Route]: 2,
    [CommandCenterTimelineKind.Plan]: 3,
    [CommandCenterTimelineKind.Mission]: 3,
    [CommandCenterTimelineKind.Approve]: 4,
    [CommandCenterTimelineKind.Decision]: 4,
    [CommandCenterTimelineKind.Execute]: 5,
    [CommandCenterTimelineKind.Assignment]: 5,
    [CommandCenterTimelineKind.Outcome]: 6,
    [CommandCenterTimelineKind.Receipt]: 6,
    [CommandCenterTimelineKind.Retain]: 7,
    [CommandCenterTimelineKind.Present]: 8,
  }[kind];
}

function evidenceFromProvenance(
  provenance: Provenance[],
  knownEventIds: ReadonlySet<string>,
): string[] {
  return unique(provenance.flatMap((item) =>
    item.sourceEventId && knownEventIds.has(item.sourceEventId) ? [item.sourceEventId] : []));
}

function receiptsForAssignment(
  receipts: ActionReceipt[],
  assignment: Assignment,
): ActionReceipt[] {
  return receipts.filter((receipt) =>
    receipt.assignmentId === assignment.id || receipt.missionTaskId === assignment.missionTaskId);
}

function isDestinationVerifiedReceipt(receipt: ActionReceipt): boolean {
  return receipt.status === ReceiptStatus.Succeeded &&
    receipt.verified &&
    Boolean(receipt.externalId && receipt.verifiedAt && receipt.completedAt);
}

function verifiedOutcome(assignment: Assignment, receipts: ActionReceipt[]): boolean {
  return assignment.status === LifecycleStatus.Succeeded &&
    assignment.artifact !== undefined &&
    receipts.every(isDestinationVerifiedReceipt);
}

function actorFromProvenance(provenance: Provenance[]): string | undefined {
  return provenance.find((item) => item.actorId)?.actorId;
}

function hasVerifiedIntegrity<T extends { integrityHash?: string }>(
  value: T,
): value is T & { integrityHash: string } {
  return typeof value.integrityHash === 'string' && value.integrityHash.length > 0;
}

function assignmentMissionId(
  assignments: Assignment[],
  assignmentId: string | undefined,
): string | undefined {
  return assignmentId
    ? assignments.find((assignment) => assignment.id === assignmentId)?.missionId
    : undefined;
}

function isTerminal(status: LifecycleStatus | undefined): boolean {
  return status === LifecycleStatus.Succeeded ||
    status === LifecycleStatus.Failed ||
    status === LifecycleStatus.Cancelled ||
    status === LifecycleStatus.Rejected ||
    status === LifecycleStatus.Archived;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
