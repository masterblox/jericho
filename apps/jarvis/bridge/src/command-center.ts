import { createHash } from 'node:crypto';

import {
  CommandCenterActionKind,
  CommandCenterMissionStage,
  CommandCenterTimelineKind,
  DecisionOutcome,
  EntityType,
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
  type Entity,
  type EventEnvelope,
  type MissionPlan,
  type MissionTask,
  type NucleusNode,
  type Provenance,
} from '@jericho/shared';

import type { JerichoStore } from './core/store.js';

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
  const connectors = store.listConnectorHealth();
  const captureFailures = store.listCaptureFailures();
  const costs = new Map(missions.map((mission) => [mission.id, store.listCosts(mission.id)]));
  const knownEventIds = new Set(events.map((event) => event.id));
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));

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

  const history = buildHistory(events, missions, assignments, receipts, decisions);
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
    connectors,
    captureFailures,
    costs: [...costs.values()],
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
    lastChangeSequence: source.lastChangeSequence,
    nucleus,
  };
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
  missions: MissionPlan[],
  assignments: Assignment[],
  receipts: ReturnType<JerichoStore['listReceipts']>,
  decisions: ReturnType<JerichoStore['listDecisions']>,
): CommandCenterTimelineEntry[] {
  const entries: CommandCenterTimelineEntry[] = events.map((event) => ({
    id: `capture:${event.id}`,
    kind: CommandCenterTimelineKind.Capture,
    occurredAt: event.occurredAt,
    title: event.type,
    recordType: 'event',
    recordId: event.id,
    ...(event.status ? { status: event.status } : {}),
    ...(actorFromProvenance(event.provenance) ? { actor: actorFromProvenance(event.provenance) } : {}),
    evidenceEventIds: [event.id],
    provenance: event.provenance,
    verified: Boolean(event.integrityHash),
  }));
  for (const mission of missions) {
    entries.push({
      id: `mission:${mission.id}:planned`,
      kind: CommandCenterTimelineKind.Mission,
      occurredAt: mission.createdAt,
      title: mission.title,
      recordType: 'mission',
      recordId: mission.id,
      missionId: mission.id,
      status: LifecycleStatus.PendingApproval,
      ...(actorFromProvenance(mission.provenance) ? { actor: actorFromProvenance(mission.provenance) } : {}),
      evidenceEventIds: mission.evidenceEventIds,
      provenance: mission.provenance,
      verified: Boolean(mission.integrityHash),
    });
  }
  for (const decision of decisions) {
    entries.push({
      id: `decision:${decision.id}`,
      kind: CommandCenterTimelineKind.Decision,
      occurredAt: decision.decidedAt,
      title: `Mission ${decision.outcome}`,
      recordType: 'decision',
      recordId: decision.id,
      ...(decision.missionId ? { missionId: decision.missionId } : {}),
      actor: decision.decidedBy,
      reason: decision.rationale,
      evidenceEventIds: decision.evidenceEventIds,
      provenance: decision.provenance,
      verified: Boolean(decision.integrityHash),
    });
  }
  for (const assignment of assignments) {
    const outcome = TERMINAL_ASSIGNMENT_STATUSES.has(assignment.status);
    entries.push({
      id: `${outcome ? 'outcome' : 'assignment'}:${assignment.id}`,
      kind: outcome ? CommandCenterTimelineKind.Outcome : CommandCenterTimelineKind.Assignment,
      occurredAt: assignment.completedAt ?? assignment.acceptedAt ?? assignment.assignedAt,
      title: `${assignment.agentId}: ${assignment.status}`,
      recordType: 'assignment',
      recordId: assignment.id,
      missionId: assignment.missionId,
      status: assignment.status,
      actor: assignment.agentId,
      ...(assignment.cancelReason ? { reason: assignment.cancelReason } : {}),
      evidenceEventIds: assignment.evidenceEventIds,
      provenance: assignment.provenance,
      verified: outcome
        ? verifiedOutcome(assignment, receiptsForAssignment(receipts, assignment))
        : Boolean(assignment.integrityHash),
    });
  }
  for (const receipt of receipts) {
    entries.push({
      id: `receipt:${receipt.id}`,
      kind: CommandCenterTimelineKind.Receipt,
      occurredAt: receipt.completedAt ?? receipt.requestedAt,
      title: `${receipt.action}: ${receipt.status}`,
      recordType: 'receipt',
      recordId: receipt.id,
      ...(assignmentMissionId(assignments, receipt.assignmentId) ? {
        missionId: assignmentMissionId(assignments, receipt.assignmentId),
      } : {}),
      status: receipt.status,
      ...(actorFromProvenance(receipt.provenance) ? { actor: actorFromProvenance(receipt.provenance) } : {}),
      evidenceEventIds: receipt.evidenceEventIds,
      provenance: receipt.provenance,
      verified: isDestinationVerifiedReceipt(receipt),
    });
  }
  return entries.sort((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
}

function buildNucleus(
  entities: Entity[],
  relations: ReturnType<JerichoStore['listRelations']>,
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
  const activityPulses = history.filter((entry) => entry.verified).map((entry) => ({
    id: `pulse:${entry.id}`,
    kind: entry.kind,
    occurredAt: entry.occurredAt,
    ...(timelineNodeId(entry, nodeIds) ? { nodeId: timelineNodeId(entry, nodeIds) } : {}),
    label: entry.title,
    evidenceEventIds: entry.evidenceEventIds,
    verified: true as const,
  }));
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
    : entry.recordType === 'assignment'
      ? `assignment:${entry.recordId}`
      : entry.recordType === 'receipt'
        ? `receipt:${entry.recordId}`
        : entry.recordType === 'decision' && entry.missionId
          ? `mission:${entry.missionId}`
          : undefined;
  return candidate && nodeIds.has(candidate) ? candidate : undefined;
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
