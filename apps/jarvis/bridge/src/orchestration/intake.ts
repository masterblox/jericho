import { createHash } from 'node:crypto';

import {
  AgentLane,
  CaptureFailureKind,
  ChangeLogKind,
  ConnectorCapability,
  CostClass,
  EscalationReason,
  IntentRoute,
  LifecycleStatus,
  MissionTaskKind,
  MutationClass,
  RiskLevel,
  RouteType,
  SourceType,
  type AgentCapability,
  type Assignment,
  type CaptureFailure,
  type ClassificationDraft,
  type EventEnvelope,
  type IntentEnvelope,
  type JsonObject,
  type MissionPermissions,
  type MissionPlan,
  type MissionTaskDefinition,
  type RepositoryGrant,
} from '@jericho/shared';

import type { JerichoStore } from '../core/store.js';
import type { FleetLaneRegistry } from '../fleet/lane-registry.js';
import { decideFleetDispatch } from '../fleet/dispatch-router.js';
import {
  fleetBridgeExternalAction,
  telegramWakeExternalAction,
} from '../fleet/bridge-handoff-executor.js';
import { composeFleetWakeText } from '../fleet/wake-composer.js';
import { fleetMissionPermissions, mergeMissionPermissions } from '../fleet/fleet-permissions.js';
import { CapabilityRegistry } from './capability-registry.js';
import { classifyEvent } from './classifier.js';
import { createMissionPlan } from './planner.js';
import { routeIntent, type RoutingDecision } from './router.js';
import { permissionScopeViolations } from './scope.js';

export const BUILT_IN_CAPABILITY_IDS: Record<AgentLane, string> = {
  [AgentLane.Dev]: 'builtin.dev.v2',
  [AgentLane.Angela]: 'builtin.angela.v2',
  [AgentLane.Donald]: 'builtin.donald.v2',
  [AgentLane.Iris]: 'builtin.iris.v2',
  [AgentLane.Researcher]: 'builtin.researcher.v2',
  [AgentLane.Analyst]: 'builtin.analyst.v2',
};

const BUILT_IN_REGISTRY_VERSION = 2;
const BUILT_IN_CREATED_AT = '2026-01-01T00:00:00.000Z';
const DIRECT_CAPTURE_CONFIDENCE = 0.98;
const DEFAULT_MODEL = 'local';
const RECOVERY_CHANGE_PAGE_SIZE = 1_000;
const LEGACY_RECOVERY_SCAN_LIMIT = 1_000;
const BUILT_IN_AGENT_IDS: Record<AgentLane, string> = {
  [AgentLane.Dev]: 'DEV',
  [AgentLane.Angela]: 'Angela',
  [AgentLane.Donald]: 'Donald',
  [AgentLane.Iris]: 'Iris',
  [AgentLane.Researcher]: 'Researcher',
  [AgentLane.Analyst]: 'Analyst',
};

export interface IntakeProcessorOptions {
  store: JerichoStore;
  classifier?: typeof classifyEvent;
  router?: typeof routeIntent;
  missionPermissions?: MissionPermissions;
  repositoryGrants?: RepositoryGrant[];
  fleetRegistry?: FleetLaneRegistry;
}

export interface IntakeProcessingResult {
  status: 'understood' | 'review' | 'planned' | 'failed';
  intent?: IntentEnvelope;
  mission?: MissionPlan;
  failure?: CaptureFailure;
}

export interface IntakeRecoveryResult {
  processed: number;
  planned: number;
  review: number;
  queued: number;
  failed: number;
}

export interface MissionQueueResult {
  missionId: string;
  queued: number;
  failed: number;
  assignments: Assignment[];
  failure?: CaptureFailure;
}

export class IntakeProcessor {
  readonly #store: JerichoStore;
  readonly #classifier: typeof classifyEvent;
  readonly #router: typeof routeIntent;
  readonly #missionPermissions: MissionPermissions;
  readonly #baseMissionPermissions: MissionPermissions;
  readonly #repositoryGrants: ReadonlyMap<string, RepositoryGrant>;
  readonly #fleetRegistry?: FleetLaneRegistry;

  constructor(options: IntakeProcessorOptions) {
    this.#store = options.store;
    this.#classifier = options.classifier ?? classifyEvent;
    this.#router = options.router ?? routeIntent;
    this.#fleetRegistry = options.fleetRegistry;
    const configuredPermissions = structuredClone(options.missionPermissions ?? safePermissions());
    const withFleet = options.fleetRegistry
      ? mergeMissionPermissions(configuredPermissions, fleetMissionPermissions(options.fleetRegistry))
      : configuredPermissions;
    const grants = mergeRepositoryGrants(
      withFleet.allowedRepositories,
      options.repositoryGrants ?? [],
    );
    this.#repositoryGrants = new Map(grants.map((grant) => [grant.repository, grant]));
    this.#missionPermissions = {
      ...withFleet,
      allowedRepositories: structuredClone(grants),
      allowedMutationClasses: uniqueMutationClasses([
        ...withFleet.allowedMutationClasses,
        ...grants.flatMap((grant) => grant.mutationClasses),
      ]),
    };
    const baseMutations: MutationClass[] = withFleet.allowedMutationClasses.includes(MutationClass.ReadOnly)
      ? [MutationClass.ReadOnly]
      : [];
    if (
      (withFleet.allowedTools.includes('telegram.send') ||
        withFleet.allowedTools.includes('fleet.bridge.write')) &&
      withFleet.allowedMutationClasses.includes(MutationClass.Reversible)
    ) {
      baseMutations.push(MutationClass.Reversible);
    }
    this.#baseMissionPermissions = {
      ...structuredClone(withFleet),
      allowedRepositories: [],
      allowedMutationClasses: uniqueMutationClasses(baseMutations),
    };
    this.#seedBuiltInCapabilities();
  }

  processEvent(eventId: string): IntakeProcessingResult {
    const event = this.#store.getEvent(eventId);
    if (!event) throw new Error(`Event ${eventId} does not exist`);

    try {
      const intentId = deterministicId('intent', event.id);
      const existing = this.#store.getIntent(intentId);
      const intent = existing ?? this.#understand(event, intentId);
      if (intent.route === IntentRoute.Review) return { status: 'review', intent };
      if (intent.route !== IntentRoute.Project) return { status: 'understood', intent };

      const missionId = deterministicId('mission', intent.id);
      const mission = this.#store.getMission(missionId) ?? this.#plan(event, intent, missionId);
      return { status: 'planned', intent, mission };
    } catch (error) {
      return {
        status: 'failed',
        failure: this.#recordProcessingFailure(event, 'intake', error),
      };
    }
  }

  prepareReviewedProject(intent: IntentEnvelope): MissionPlan {
    if (intent.route !== IntentRoute.Project || intent.status !== LifecycleStatus.Active) {
      throw new Error(`Reviewed intent ${intent.id} is not an active project`);
    }
    if (!intent.eventId) throw new Error(`Reviewed intent ${intent.id} has no immutable source event`);
    const event = this.#store.getEvent(intent.eventId);
    if (!event) throw new Error(`Reviewed intent source event ${intent.eventId} does not exist`);
    const missionId = deterministicId('mission', intent.id);
    return this.#preparePlan(event, intent, missionId);
  }

  queueApprovedMission(missionId: string): MissionQueueResult {
    const mission = this.#store.getMission(missionId);
    if (!mission) throw new Error(`Mission ${missionId} does not exist`);
    if (
      mission.status !== LifecycleStatus.Approved &&
      mission.status !== LifecycleStatus.Active
    ) {
      return { missionId, queued: 0, failed: 0, assignments: [] };
    }

    const assignments: Assignment[] = [];
    let queued = 0;
    try {
      const tasks = [...mission.taskGraph].sort(
        (left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id),
      );
      for (const task of tasks) {
        const existing = this.#store.listAssignments({ missionTaskId: task.id })[0];
        if (existing) {
          assignments.push(existing);
          continue;
        }
        assignments.push(this.#store.enqueueAssignment(buildAssignmentForTask(mission, task)));
        queued += 1;
      }
      return { missionId, queued, failed: 0, assignments };
    } catch (error) {
      const event = this.#eventForMission(mission);
      const failure = event
        ? this.#recordProcessingFailure(event, 'assignment_enqueue', error)
        : undefined;
      return { missionId, queued, failed: 1, assignments, ...(failure ? { failure } : {}) };
    }
  }

  recover(): IntakeRecoveryResult {
    const result: IntakeRecoveryResult = {
      processed: 0,
      planned: 0,
      review: 0,
      queued: 0,
      failed: 0,
    };
    // Take the durable high-water before any recovery work can append its own
    // intent, mission, or failure changes.
    const highWaterSequence = this.#store.getLatestChangeSequence();

    // appendEvent predates the durable EventCaptured change. Keep a deliberately
    // bounded compatibility window for those legacy/direct-import records; all
    // current connector and local capture paths recover through the paged log.
    const compatibilityAttempted = new Set<string>();
    for (const event of this.#store.listEvents({ limit: LEGACY_RECOVERY_SCAN_LIMIT })) {
      compatibilityAttempted.add(event.id);
      this.#recoverEvent(event, result);
    }
    this.#recoverCapturedEvents(result, highWaterSequence, compatibilityAttempted);

    const queueable = [
      ...this.#store.listMissions({ status: LifecycleStatus.Approved }),
      ...this.#store.listMissions({ status: LifecycleStatus.Active }),
    ];
    for (const mission of queueable) {
      const queued = this.queueApprovedMission(mission.id);
      result.queued += queued.queued;
      result.failed += queued.failed;
    }
    return result;
  }

  #recoverCapturedEvents(
    result: IntakeRecoveryResult,
    highWaterSequence: number,
    compatibilityAttempted: ReadonlySet<string>,
  ): void {
    // Intake itself appends changes, so following the live tail could otherwise
    // keep one recovery run open indefinitely under continuous capture or failure.
    let afterSequence = 0;
    while (afterSequence < highWaterSequence) {
      const changes = this.#store.listChangeLog({
        afterSequence,
        limit: RECOVERY_CHANGE_PAGE_SIZE,
      });
      if (changes.length === 0) break;

      let advanced = false;
      for (const change of changes) {
        if (change.sequence > highWaterSequence) break;
        afterSequence = change.sequence;
        advanced = true;
        if (change.kind !== ChangeLogKind.EventCaptured) continue;
        if (compatibilityAttempted.has(change.recordId)) continue;
        const event = this.#store.getEvent(change.recordId);
        if (event) this.#recoverEvent(event, result);
      }
      if (!advanced) break;
    }
  }

  #recoverEvent(event: EventEnvelope, result: IntakeRecoveryResult): void {
    const existingIntent = this.#store.getIntent(deterministicId('intent', event.id));
    const complete = existingIntent !== undefined && (
      existingIntent.route !== IntentRoute.Project ||
      this.#store.getMission(deterministicId('mission', existingIntent.id)) !== undefined
    );
    if (complete) return;

    const processed = this.processEvent(event.id);
    if (processed.status === 'failed') {
      result.failed += 1;
      return;
    }
    result.processed += 1;
    if (processed.status === 'planned') result.planned += 1;
    if (processed.status === 'review') result.review += 1;
  }

  #understand(event: EventEnvelope, intentId: string): IntentEnvelope {
    const hints = isDirectCarlosCapture(event)
      ? { confidence: DIRECT_CAPTURE_CONFIDENCE }
      : {};
    let draft = this.#classifier(event, hints);
    const repositorySelection = captureRepositorySelection(event);
    if (
      repositorySelection.requested &&
      (!repositorySelection.repository || !this.#repositoryGrants.has(repositorySelection.repository))
    ) {
      const label = repositorySelection.repository ?? '<invalid>';
      draft = {
        ...draft,
        confidence: 0,
        ambiguityReasons: [
          ...draft.ambiguityReasons,
          `Requested repository ${label} is not configured for Jericho mission authority`,
        ],
      };
    }
    const routing = this.#router(draft);
    const intent = intentFrom(event, intentId, draft, routing);
    return this.#store.saveIntent(intent);
  }

  #plan(event: EventEnvelope, intent: IntentEnvelope, missionId: string): MissionPlan {
    return this.#store.createMissionPlan(this.#preparePlan(event, intent, missionId));
  }

  #preparePlan(event: EventEnvelope, intent: IntentEnvelope, missionId: string): MissionPlan {
    const repositorySelection = captureRepositorySelection(event);
    const selectedGrant = repositorySelection.repository
      ? this.#repositoryGrants.get(repositorySelection.repository)
      : undefined;
    const permissions = selectedGrant
      ? permissionsWithRepository(this.#baseMissionPermissions, selectedGrant)
      : structuredClone(this.#baseMissionPermissions);
    const plan = defaultMissionPlan(
      event,
      intent,
      missionId,
      permissions,
      this.#fleetRegistry,
      (lane) => this.#capabilityId(lane),
    );
    return createMissionPlan(
      plan,
      new CapabilityRegistry(this.#store.listAgentCapabilities()),
      event.ingestedAt,
    );
  }

  #seedBuiltInCapabilities(): void {
    for (const lane of Object.values(AgentLane)) {
      const id = this.#capabilityId(lane);
      const existing = this.#store.getAgentCapability(id);
      if (existing) {
        assertBuiltInCompatible(existing, lane, this.#missionPermissions);
        continue;
      }
      this.#store.registerAgentCapability(
        builtInCapability(id, lane, this.#missionPermissions),
      );
    }
  }

  #capabilityId(lane: AgentLane): string {
    return this.#fleetRegistry
      ? `builtin.${lane}.fleet.v2`
      : BUILT_IN_CAPABILITY_IDS[lane];
  }

  #eventForMission(mission: MissionPlan): EventEnvelope | undefined {
    for (const eventId of mission.evidenceEventIds) {
      const event = this.#store.getEvent(eventId);
      if (event) return event;
    }
    return undefined;
  }

  #recordProcessingFailure(
    event: EventEnvelope,
    stage: string,
    error: unknown,
  ): CaptureFailure {
    const id = deterministicId('capture-failure', `${event.id}\0${stage}`);
    const existing = this.#store
      .listCaptureFailures(event.source)
      .find((item) => item.id === id);
    if (existing) return existing;
    return this.#store.recordCaptureFailure({
      id,
      connectorId: event.source,
      capability: ConnectorCapability.Capture,
      kind: CaptureFailureKind.Processing,
      message: errorMessage(error),
      retryable: true,
      sourceEventId: event.sourceEventId,
      status: LifecycleStatus.PendingApproval,
      route: RouteType.HumanApproval,
      risk: event.risk ?? RiskLevel.Low,
      details: { stage, eventId: event.id },
      occurredAt: event.ingestedAt,
      provenance: structuredClone(event.provenance),
    });
  }
}

export function buildAssignmentForTask(
  mission: Readonly<MissionPlan>,
  task: Readonly<MissionTaskDefinition>,
): Omit<Assignment, 'integrityHash'> {
  const boundAt = mission.approvedAt ?? mission.updatedAt;
  const binding = `${mission.id}\0${mission.planHash}\0${task.id}`;
  return {
    id: deterministicId('assignment', binding),
    missionId: mission.id,
    missionTaskId: task.id,
    agentId: task.selectedAgentId,
    capabilityIds: [...task.capabilityIds],
    status: LifecycleStatus.Queued,
    route: task.route,
    risk: task.risk,
    ...(mission.confidence !== undefined ? { confidence: mission.confidence } : {}),
    instructions: structuredClone(task.input),
    evidenceEventIds: [...task.evidenceEventIds],
    expectedArtifact: structuredClone(task.expectedArtifact),
    ...(task.externalAction ? { externalAction: structuredClone(task.externalAction) } : {}),
    idempotencyKey: deterministicId('assignment-key', binding),
    attempt: 0,
    maxAttempts: mission.budget.maxRetriesPerAssignment + 1,
    availableAt: boundAt,
    estimatedCostMicroUsd: task.estimatedCostMicroUsd,
    assignedAt: boundAt,
    provenance: structuredClone(mission.provenance),
  };
}

function intentFrom(
  event: EventEnvelope,
  id: string,
  draft: ClassificationDraft,
  routing: RoutingDecision,
): IntentEnvelope {
  return {
    id,
    eventId: event.id,
    source: event.source,
    sourceType: event.sourceType,
    kind: draft.kind,
    summary: draft.summary,
    payload: payloadSnapshot(event),
    status: routing.route === IntentRoute.Review
      ? LifecycleStatus.PendingApproval
      : LifecycleStatus.Active,
    route: routing.route,
    routeRuleId: routing.ruleId,
    entityIds: [...draft.entityIds],
    ...(draft.expectedOutcome ? { expectedOutcome: draft.expectedOutcome } : {}),
    commitments: structuredClone(draft.commitments),
    claims: structuredClone(draft.claims),
    assumptions: structuredClone(draft.assumptions),
    deadlines: structuredClone(draft.deadlines),
    affectedPartyIds: [...draft.affectedPartyIds],
    requiredEvidence: structuredClone(draft.requiredEvidence),
    requiredCapabilities: [...draft.requiredCapabilities],
    ambiguityReasons: [...draft.ambiguityReasons],
    contradictoryEvidenceEventIds: [...draft.contradictoryEvidenceEventIds],
    risk: draft.risk,
    confidence: routing.confidence,
    freshness: { observedAt: event.occurredAt },
    provenance: structuredClone(event.provenance),
    createdAt: event.ingestedAt,
    updatedAt: event.ingestedAt,
  };
}

function defaultMissionPlan(
  event: EventEnvelope,
  intent: IntentEnvelope,
  missionId: string,
  missionPermissions: MissionPermissions,
  fleetRegistry?: FleetLaneRegistry,
  capabilityId: (lane: AgentLane) => string = (lane) => BUILT_IN_CAPABILITY_IDS[lane],
): Parameters<typeof createMissionPlan>[0] {
  const researchTaskId = deterministicId('mission-task', `${missionId}\0research`);
  const lane = routeIntent({
    kind: intent.kind,
    summary: intent.summary,
    suggestedRoute: intent.route,
    entityIds: intent.entityIds,
    ...(intent.expectedOutcome ? { expectedOutcome: intent.expectedOutcome } : {}),
    commitments: intent.commitments,
    claims: intent.claims,
    assumptions: intent.assumptions,
    deadlines: intent.deadlines,
    affectedPartyIds: intent.affectedPartyIds,
    requiredEvidence: intent.requiredEvidence,
    requiredCapabilities: intent.requiredCapabilities,
    ambiguityReasons: intent.ambiguityReasons,
    contradictoryEvidenceEventIds: intent.contradictoryEvidenceEventIds,
    risk: intent.risk,
    confidence: intent.confidence,
  }).lane;
  const laneTaskId = deterministicId('mission-task', `${missionId}\0${lane}`);
  const permissions = structuredClone(missionPermissions);
  const eventEvidence = [event.id];
  const provenance = structuredClone(event.provenance);
  const researchScope: MissionPermissions = {
    ...safePermissions(),
    allowedRepositories: permissions.allowedRepositories.map((grant) => ({
      repository: grant.repository,
      writablePaths: [],
      mutationClasses: [],
    })),
  };
  const objective = intent.expectedOutcome ?? intent.summary;
  const fleetTask = fleetRegistry
    ? buildFleetLaneTask({
      lane,
      laneTaskId,
      researchTaskId,
      missionId,
      objective,
      summary: intent.summary,
      eventId: event.id,
      eventEvidence,
      permissions,
      risk: intent.risk,
      registry: fleetRegistry,
      capabilityId: capabilityId(lane),
    })
    : undefined;
  const laneTask: MissionTaskDefinition = fleetTask ?? {
    id: laneTaskId,
    kind: MissionTaskKind.Analyze,
    title: `Prepare the bounded ${lane} result`,
    sequence: 1,
    lane,
    selectedAgentId: builtInAgentId(lane),
    capabilityIds: [capabilityId(lane)],
    requiredActions: [laneAction(lane)],
    requiredTools: [...permissions.allowedTools],
    model: DEFAULT_MODEL,
    maxTokens: 8_000,
    writableScope: structuredClone(permissions),
    dependsOn: [researchTaskId],
    evidenceEventIds: eventEvidence,
    expectedArtifact: {
      type: `${lane}.bounded-result`,
      description: 'A proposal or artifact constrained to the approved mission scope',
      verification: ['Matches the approved objective and permissions'],
      requiredEvidence: eventEvidence,
    },
    input: {
      objective,
      eventId: event.id,
      researchTaskId,
    },
    estimatedCostMicroUsd: 1_000,
    route: RouteType.Agent,
    risk: intent.risk,
  };
  return {
    id: missionId,
    seriesId: deterministicId('mission-series', intent.id),
    version: 1,
    intentId: intent.id,
    title: intent.summary,
    objective,
    route: RouteType.HumanApproval,
    risk: intent.risk,
    confidence: intent.confidence,
    deliverables: [{
      id: deterministicId('deliverable', missionId),
      description: `Bounded result for: ${intent.summary}`,
      artifactType: 'mission.result',
      required: true,
    }],
    acceptanceTests: [{
      id: deterministicId('acceptance', missionId),
      description: 'Result is supported by the captured evidence and remains within the approved scope',
      verification: 'manual',
      requiredEvidence: eventEvidence,
    }],
    evidenceEventIds: eventEvidence,
    contextSnapshotHash: digest({
      eventId: event.id,
      eventIntegrityHash: event.integrityHash ?? null,
      intentId: intent.id,
      requiredEvidence: intent.requiredEvidence,
    }),
    taskGraph: [
      {
        id: researchTaskId,
        kind: MissionTaskKind.Research,
        title: 'Research the immutable capture evidence',
        sequence: 0,
        lane: AgentLane.Researcher,
        selectedAgentId: builtInAgentId(AgentLane.Researcher),
        capabilityIds: [capabilityId(AgentLane.Researcher)],
        requiredActions: [laneAction(AgentLane.Researcher)],
        requiredTools: [],
        model: DEFAULT_MODEL,
        maxTokens: 8_000,
        writableScope: researchScope,
        dependsOn: [],
        evidenceEventIds: eventEvidence,
        expectedArtifact: {
          type: 'research.evidence-summary',
          description: 'Evidence-grounded research snapshot',
          verification: ['Cites the immutable capture event'],
          requiredEvidence: eventEvidence,
        },
        input: { objective: intent.summary, eventId: event.id },
        estimatedCostMicroUsd: 500,
        route: RouteType.Agent,
        risk: intent.risk,
      },
      laneTask,
    ],
    budget: {
      maxCostMicroUsd: 2_000,
      maxRuntimeMs: 300_000,
      maxConcurrency: 1,
      maxRetriesPerAssignment: 1,
    },
    permissions,
    rollback: {
      strategy: 'Discard generated internal artifacts before any separately approved execution',
      steps: ['Cancel queued work', 'Retain the immutable capture and decision history'],
      verification: fleetTask
        ? 'External fleet dispatch receipts must match the approved plan'
        : 'No external action receipt exists for this planning mission',
    },
    escalationConditions: [
      EscalationReason.CostBudget,
      EscalationReason.RuntimeBudget,
      EscalationReason.RetryBudget,
      EscalationReason.ObjectiveChange,
      EscalationReason.RepositoryExpansion,
      EscalationReason.ToolExpansion,
      EscalationReason.DestructiveMutation,
      EscalationReason.ProductionMutation,
      EscalationReason.NewRecipient,
      EscalationReason.ChannelExpansion,
    ],
    provenance,
  };
}

function buildFleetLaneTask(input: {
  lane: AgentLane;
  laneTaskId: string;
  researchTaskId: string;
  missionId: string;
  objective: string;
  summary: string;
  eventId: string;
  eventEvidence: string[];
  permissions: MissionPermissions;
  risk: RiskLevel;
  registry: FleetLaneRegistry;
  capabilityId: string;
}): MissionTaskDefinition | undefined {
  const target = input.registry.target(input.lane);
  if (!target) return undefined;
  const decision = decideFleetDispatch(input.registry, {
    lane: input.lane,
    summary: input.summary,
  });
  const useTelegram =
    decision.mode === 'telegram_wake' && Boolean(target.telegramRecipient);
  const useBridge =
    !useTelegram &&
    (decision.mode === 'hybrid_durable' || decision.mode === 'bridge_handoff' || decision.mode === 'paperclip') &&
    input.registry.hasBridge();

  if (!useTelegram && !useBridge) return undefined;

  const wakeText = composeFleetWakeText({
    lane: input.lane,
    laneLabel: target.label,
    missionId: input.missionId,
    assignmentId: input.laneTaskId,
    planHash: digest({ missionId: input.missionId, lane: input.lane, objective: input.objective }),
    objective: input.objective,
  });

  if (useTelegram && target.telegramRecipient) {
    const recipient = target.telegramRecipient;
    const idempotencyKey = deterministicId('fleet-wake', `${input.missionId}\0${input.lane}\0${recipient}`);
    return {
      id: input.laneTaskId,
      kind: MissionTaskKind.Communicate,
      title: `Wake ${target.label} via Telegram`,
      sequence: 1,
      lane: input.lane,
      selectedAgentId: builtInAgentId(input.lane),
      capabilityIds: [input.capabilityId],
      requiredActions: ['send_message', laneAction(input.lane)],
      requiredTools: ['telegram.send'],
      model: DEFAULT_MODEL,
      maxTokens: 8_000,
      writableScope: structuredClone(input.permissions),
      dependsOn: [input.researchTaskId],
      evidenceEventIds: input.eventEvidence,
      expectedArtifact: {
        type: 'receipt',
        description: `Telegram wake delivery to ${target.label}`,
        verification: ['gateway-acknowledged', 'destination-matched', 'idempotency-bound'],
        requiredEvidence: ['destination-receipt'],
      },
      externalAction: telegramWakeExternalAction({ recipient, idempotencyKey }),
      input: {
        text: wakeText,
        objective: input.objective,
        eventId: input.eventId,
        researchTaskId: input.researchTaskId,
        dispatchMode: 'telegram_wake',
        fleetLane: target.label,
      },
      estimatedCostMicroUsd: 1_000,
      route: RouteType.Agent,
      risk: input.risk,
    };
  }

  const idempotencyKey = deterministicId('fleet-handoff', `${input.missionId}\0${input.lane}`);
  return {
    id: input.laneTaskId,
    kind: MissionTaskKind.Communicate,
    title: `Dispatch ${target.label} via bridge`,
    sequence: 1,
    lane: input.lane,
    selectedAgentId: builtInAgentId(input.lane),
    capabilityIds: [input.capabilityId],
    requiredActions: ['write_handoff', laneAction(input.lane)],
    requiredTools: ['fleet.bridge.write'],
    model: DEFAULT_MODEL,
    maxTokens: 8_000,
    writableScope: structuredClone(input.permissions),
    dependsOn: [input.researchTaskId],
    evidenceEventIds: input.eventEvidence,
    expectedArtifact: {
      type: 'receipt',
      description: `Bridge handoff for ${target.label}`,
      verification: ['gateway-acknowledged', 'destination-matched', 'idempotency-bound'],
      requiredEvidence: ['destination-receipt'],
    },
    externalAction: fleetBridgeExternalAction({
      destination: 'fleet-bridge',
      recipient: 'fleet-bridge',
      idempotencyKey,
    }),
    input: {
      text: wakeText,
      objective: input.objective,
      eventId: input.eventId,
      researchTaskId: input.researchTaskId,
      dispatchMode: decision.mode,
      fleetLane: target.label,
      paperclipTag: target.paperclipTag,
    },
    estimatedCostMicroUsd: 1_000,
    route: RouteType.Agent,
    risk: input.risk,
  };
}

function builtInCapability(
  id: string,
  lane: AgentLane,
  permissions: MissionPermissions,
): AgentCapability {
  const supportedActions = [laneAction(lane)];
  if (permissions.allowedTools.includes('telegram.send')) {
    supportedActions.push('send_message');
  }
  if (permissions.allowedTools.includes('fleet.bridge.write')) {
    supportedActions.push('write_handoff');
  }
  return {
    id,
    agentId: builtInAgentId(lane),
    lane,
    name: BUILT_IN_AGENT_IDS[lane],
    description: `Built-in bounded ${BUILT_IN_AGENT_IDS[lane]} planning capability`,
    status: LifecycleStatus.Active,
    routes: [RouteType.Agent],
    supportedActions,
    tools: [...permissions.allowedTools],
    modelPolicy: {
      allowedModels: [DEFAULT_MODEL],
      preferredModel: DEFAULT_MODEL,
      preferLocal: true,
      maxTokensPerAssignment: 8_000,
    },
    writableScope: structuredClone(permissions),
    costClass: CostClass.Local,
    mayCreateAssignments: false,
    maximumRisk: RiskLevel.Critical,
    metadata: { builtInVersion: BUILT_IN_REGISTRY_VERSION },
    provenance: [{
      source: 'builtin:jarvis',
      sourceType: SourceType.System,
      observedAt: BUILT_IN_CREATED_AT,
    }],
    createdAt: BUILT_IN_CREATED_AT,
    updatedAt: BUILT_IN_CREATED_AT,
  };
}

function builtInAgentId(lane: AgentLane): string {
  return BUILT_IN_AGENT_IDS[lane];
}

function assertBuiltInCompatible(
  capability: AgentCapability,
  lane: AgentLane,
  permissions: MissionPermissions,
): void {
  const expected = builtInCapability(capability.id, lane, permissions);
  const compatible =
    capability.agentId === expected.agentId &&
    capability.lane === expected.lane &&
    capability.status === LifecycleStatus.Active &&
    expected.supportedActions.every((action) => capability.supportedActions.includes(action)) &&
    permissions.allowedTools.every((tool) => capability.tools.includes(tool)) &&
    capability.modelPolicy.allowedModels.includes(DEFAULT_MODEL) &&
    capability.modelPolicy.maxTokensPerAssignment >= 8_000 &&
    capability.mayCreateAssignments === false &&
    capability.maximumRisk === RiskLevel.Critical &&
    capability.metadata.builtInVersion === BUILT_IN_REGISTRY_VERSION &&
    permissionScopeViolations(permissions, capability.writableScope).length === 0;
  if (!compatible) {
    throw new Error(
      `Capability ${capability.id} is incompatible with the built-in ${lane} v${BUILT_IN_REGISTRY_VERSION} contract`,
    );
  }
}

function laneAction(lane: AgentLane): string {
  return `lane.${lane}.plan`;
}

function isDirectCarlosCapture(event: EventEnvelope): boolean {
  return event.sourceType === SourceType.User &&
    (event.source === 'local:spoken' || event.source === 'local:manual');
}

function payloadSnapshot(event: EventEnvelope): JsonObject {
  return {
    eventType: event.type,
    captured: structuredClone(event.payload),
  };
}

function captureRepositorySelection(event: EventEnvelope): {
  requested: boolean;
  repository?: string;
} {
  if (!isDirectCarlosCapture(event) || !isRecord(event.payload)) return { requested: false };
  const scope = event.payload.jerichoScope;
  if (!isRecord(scope) || !Object.hasOwn(scope, 'repository')) return { requested: false };
  if (typeof scope.repository !== 'string' || !scope.repository.trim()) {
    return { requested: true };
  }
  return { requested: true, repository: scope.repository.trim() };
}

function mergeRepositoryGrants(
  first: readonly RepositoryGrant[],
  second: readonly RepositoryGrant[],
): RepositoryGrant[] {
  const grants = [...first, ...second].map((grant) => structuredClone(grant));
  const repositories = new Set<string>();
  for (const grant of grants) {
    if (!grant.repository.trim() || repositories.has(grant.repository)) {
      throw new TypeError(`Repository grant ${grant.repository || '<empty>'} is duplicated or invalid`);
    }
    repositories.add(grant.repository);
  }
  return grants;
}

function permissionsWithRepository(
  base: MissionPermissions,
  grant: RepositoryGrant,
): MissionPermissions {
  return {
    ...structuredClone(base),
    allowedRepositories: [structuredClone(grant)],
    allowedMutationClasses: uniqueMutationClasses([
      ...base.allowedMutationClasses,
      ...grant.mutationClasses,
    ]),
  };
}

function uniqueMutationClasses(values: readonly MutationClass[]): MutationClass[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safePermissions(): MissionPermissions {
  return {
    allowedTools: [],
    allowedSystems: [],
    allowedRepositories: [],
    allowedChannels: [],
    allowedRecipients: [],
    allowedCredentialRefs: [],
    allowedDataScopes: [],
    allowedMutationClasses: [MutationClass.ReadOnly],
  };
}

function deterministicId(namespace: string, value: string): string {
  return `${namespace}:${digest(`${namespace}\0${value}`)}`;
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
