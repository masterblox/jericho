import { createHash } from 'node:crypto';

import {
  AgentLane,
  CaptureFailureKind,
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

  constructor(options: IntakeProcessorOptions) {
    this.#store = options.store;
    this.#classifier = options.classifier ?? classifyEvent;
    this.#router = options.router ?? routeIntent;
    const configuredPermissions = structuredClone(options.missionPermissions ?? safePermissions());
    const grants = mergeRepositoryGrants(
      configuredPermissions.allowedRepositories,
      options.repositoryGrants ?? [],
    );
    this.#repositoryGrants = new Map(grants.map((grant) => [grant.repository, grant]));
    this.#missionPermissions = {
      ...configuredPermissions,
      allowedRepositories: structuredClone(grants),
      allowedMutationClasses: uniqueMutationClasses([
        ...configuredPermissions.allowedMutationClasses,
        ...grants.flatMap((grant) => grant.mutationClasses),
      ]),
    };
    this.#baseMissionPermissions = {
      ...structuredClone(configuredPermissions),
      allowedRepositories: [],
      allowedMutationClasses: configuredPermissions.allowedMutationClasses.includes(MutationClass.ReadOnly)
        ? [MutationClass.ReadOnly]
        : [],
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
    for (const event of this.#store.listEvents({ limit: 10_000 })) {
      const existingIntent = this.#store.getIntent(deterministicId('intent', event.id));
      const complete = existingIntent !== undefined && (
        existingIntent.route !== IntentRoute.Project ||
        this.#store.getMission(deterministicId('mission', existingIntent.id)) !== undefined
      );
      if (complete) continue;
      const processed = this.processEvent(event.id);
      if (processed.status === 'failed') {
        result.failed += 1;
        continue;
      }
      result.processed += 1;
      if (processed.status === 'planned') result.planned += 1;
      if (processed.status === 'review') result.review += 1;
    }

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
    );
    return createMissionPlan(
      plan,
      new CapabilityRegistry(this.#store.listAgentCapabilities()),
      event.ingestedAt,
    );
  }

  #seedBuiltInCapabilities(): void {
    for (const lane of Object.values(AgentLane)) {
      const id = BUILT_IN_CAPABILITY_IDS[lane];
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
  return {
    id: missionId,
    seriesId: deterministicId('mission-series', intent.id),
    version: 1,
    intentId: intent.id,
    title: intent.summary,
    objective: intent.expectedOutcome ?? intent.summary,
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
        capabilityIds: [BUILT_IN_CAPABILITY_IDS[AgentLane.Researcher]],
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
      {
        id: laneTaskId,
        kind: MissionTaskKind.Analyze,
        title: `Prepare the bounded ${lane} result`,
        sequence: 1,
        lane,
        selectedAgentId: builtInAgentId(lane),
        capabilityIds: [BUILT_IN_CAPABILITY_IDS[lane]],
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
          objective: intent.expectedOutcome ?? intent.summary,
          eventId: event.id,
          researchTaskId,
        },
        estimatedCostMicroUsd: 1_000,
        route: RouteType.Agent,
        risk: intent.risk,
      },
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
      verification: 'No external action receipt exists for this planning mission',
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
    ],
    provenance,
  };
}

function builtInCapability(
  id: string,
  lane: AgentLane,
  permissions: MissionPermissions,
): AgentCapability {
  return {
    id,
    agentId: builtInAgentId(lane),
    lane,
    name: BUILT_IN_AGENT_IDS[lane],
    description: `Built-in bounded ${BUILT_IN_AGENT_IDS[lane]} planning capability`,
    status: LifecycleStatus.Active,
    routes: [RouteType.Agent],
    supportedActions: [laneAction(lane)],
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
  const compatible =
    capability.agentId === builtInAgentId(lane) &&
    capability.lane === lane &&
    capability.status === LifecycleStatus.Active &&
    capability.routes.includes(RouteType.Agent) &&
    capability.supportedActions.includes(laneAction(lane)) &&
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
