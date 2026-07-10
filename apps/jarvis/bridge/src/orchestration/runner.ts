import { randomUUID } from 'node:crypto';

import {
  CostCategory,
  EscalationReason,
  LifecycleStatus,
  MutationClass,
  ReceiptStatus,
  RouteType,
  SourceType,
  type ActionReceipt,
  type ArtifactRequirement,
  type Assignment,
  type CostRecord,
  type EvidenceReference,
  type JsonObject,
  type JsonValue,
  type MissionPermissions,
  type MissionPlan,
  type MissionTask,
  type MissionTaskDefinition,
} from '@jericho/shared';

import type { JerichoStore } from '../core/store.js';
import { CapabilityRegistry } from './capability-registry.js';
import { evaluateMissionAction, type MissionActionRequest } from './policy.js';
import {
  externalActionScopeViolations,
  permissionScopeViolations,
} from './scope.js';

export interface StructuredArtifact {
  type: string;
  data: JsonValue;
}

export interface ExecutorCost {
  id: string;
  category: CostCategory;
  estimatedMicroUsd: number;
  actualMicroUsd: number;
  idempotencyKey: string;
  provider?: string;
  model?: string;
  tool?: string;
}

export interface ExternalExecutionResult {
  externalId: string;
  result: JsonValue;
  verified: boolean;
  evidenceEventIds: string[];
}

export interface ExecutorResult {
  artifact: StructuredArtifact;
  costs: ExecutorCost[];
  external?: ExternalExecutionResult;
}

export interface ExecutorDescriptor {
  model: string;
  maxTokens: number;
  tools: string[];
  writableScope: MissionPermissions;
  mayCreateAssignments: boolean;
}

export interface AssignmentExecutionContext {
  assignment: Assignment;
  mission: MissionPlan;
  task: MissionTask;
  signal: AbortSignal;
}

export interface AssignmentExecutor {
  descriptor: ExecutorDescriptor;
  execute(context: AssignmentExecutionContext): Promise<ExecutorResult>;
}

export interface ArtifactVerificationResult {
  verified: boolean;
  checks: string[];
  evidence: EvidenceReference[];
}

export interface ArtifactVerificationContext extends AssignmentExecutionContext {
  artifact: StructuredArtifact;
  requirement: ArtifactRequirement;
}

export interface ArtifactVerifier {
  id: string;
  verify(context: ArtifactVerificationContext): Promise<ArtifactVerificationResult>;
}

export interface MissionRunnerOptions {
  workerId: string;
  leaseMs: number;
  clock?: () => string;
  retryDelayMs?: number;
  cancellationPollMs?: number;
}

export interface RunnerOutcome {
  kind: 'idle' | 'completed' | 'retrying' | 'failed' | 'checkpoint' | 'cancelled';
  assignmentId?: string;
  reasons: Array<EscalationReason | string>;
}

type ControlledInterruption =
  | { kind: 'deadline' }
  | { kind: 'cancelled' }
  | { kind: 'aborted' };

type ControlledResult<T> =
  | { kind: 'completed'; value: T }
  | { kind: 'error'; error: unknown }
  | ControlledInterruption;

interface ExecutionControl {
  signal: AbortSignal;
  race<T>(work: Promise<T>): Promise<ControlledResult<T>>;
  dispose(): void;
}

class RuntimeBudgetExceededError extends Error {
  constructor() {
    super('Mission runtime budget was exhausted');
    this.name = 'RuntimeBudgetExceededError';
  }
}

class MissionCancelledError extends Error {
  constructor() {
    super('Mission was cancelled');
    this.name = 'MissionCancelledError';
  }
}

export class MissionRunner {
  readonly #clock: () => string;
  readonly #retryDelayMs: number;
  readonly #cancellationPollMs: number;

  constructor(
    private readonly store: JerichoStore,
    private readonly executor: AssignmentExecutor,
    private readonly artifactVerifier: ArtifactVerifier,
    private readonly options: MissionRunnerOptions,
  ) {
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#retryDelayMs = options.retryDelayMs ?? 1_000;
    this.#cancellationPollMs = options.cancellationPollMs ?? 100;
    if (!Number.isInteger(this.#cancellationPollMs) || this.#cancellationPollMs < 1) {
      throw new Error('Cancellation poll interval is invalid');
    }
  }

  async runNext(signal: AbortSignal = new AbortController().signal): Promise<RunnerOutcome> {
    const now = this.#clock();
    const [assignment] = this.store.leaseReadyAssignments({
      workerId: this.options.workerId,
      now,
      leaseMs: this.options.leaseMs,
      limit: 1,
    });
    if (!assignment) return { kind: 'idle', reasons: [] };

    const mission = this.store.getMission(assignment.missionId);
    const task = this.store.getMissionTask(assignment.missionTaskId);
    if (!mission || !task) {
      return this.fail(assignment, new Error('Assignment mission context is missing'), now);
    }

    try {
      const definition = mission.taskGraph.find((item) => item.id === task.id);
      if (!definition) throw new Error(`Task ${task.id} is outside the approved graph`);
      new CapabilityRegistry(this.store.listAgentCapabilities()).assertTaskSupported(definition);

      const policy = evaluateMissionAction(
        mission,
        this.usageFor(mission, assignment, now),
        this.actionFor(mission, assignment),
      );
      if (policy.kind !== 'allow') {
        if (policy.kind === 'deny') throw new Error(policy.reasons.join(', '));
        this.store.pauseAssignmentForCheckpoint(
          assignment.id,
          assignment.leaseToken!,
          policy.reasons,
          now,
        );
        return { kind: 'checkpoint', assignmentId: assignment.id, reasons: policy.reasons };
      }

      if (assignment.externalAction) {
        const existing = this.store.getReceiptByIdempotencyKey(
          assignment.externalAction.idempotencyKey,
        );
        if (existing) return this.reconcileExistingReceipt(assignment, existing, now);
      }

      assertExecutorDescriptor(definition, this.executor.descriptor);

      if (assignment.externalAction) {
        const reserved = this.store.reserveReceipt(pendingReceiptFor(assignment, now));
        if (!receiptMatchesAssignment(reserved, assignment)) {
          return this.checkpointUncertain(assignment, now);
        }
        if (reserved.status !== ReceiptStatus.Pending || reserved.verified) {
          return this.reconcileExistingReceipt(assignment, reserved, now);
        }
      }

      if (this.cancellationRequested(assignment)) {
        return this.acknowledgeCancellation(assignment, this.#clock());
      }

      const control = this.createExecutionControl(assignment, mission, now, signal);
      const work = (async () => {
        const result = await this.executor.execute({
          assignment,
          mission,
          task,
          signal: control.signal,
        });
        if (control.signal.aborted || this.cancellationRequested(assignment)) {
          throw new MissionCancelledError();
        }
        assertNoRecursiveExpansion(result);
        this.assertRuntimeWithinBudget(mission, this.#clock());
        const verifiedArtifact = await verifyArtifact(
          assignment,
          mission,
          task,
          result.artifact,
          this.artifactVerifier,
          control.signal,
        );
        if (control.signal.aborted || this.cancellationRequested(assignment)) {
          throw new MissionCancelledError();
        }
        const completedAt = this.#clock();
        this.assertRuntimeWithinBudget(mission, completedAt);
        return { result, verifiedArtifact, completedAt };
      })();

      const controlled = await control.race(work);
      control.dispose();
      if (controlled.kind === 'cancelled') {
        return this.acknowledgeCancellation(assignment, this.#clock());
      }
      if (controlled.kind === 'deadline') {
        return this.checkpointRuntime(assignment, this.#clock());
      }
      if (controlled.kind === 'aborted') {
        if (assignment.externalAction) return this.checkpointUncertain(assignment, this.#clock());
        throw new Error('Assignment execution was aborted');
      }
      if (controlled.kind === 'error') {
        if (controlled.error instanceof MissionCancelledError) {
          return this.acknowledgeCancellation(assignment, this.#clock());
        }
        if (controlled.error instanceof RuntimeBudgetExceededError) {
          return this.checkpointRuntime(assignment, this.#clock());
        }
        if (assignment.externalAction) return this.checkpointUncertain(assignment, this.#clock());
        throw controlled.error;
      }
      const { result, verifiedArtifact, completedAt } = controlled.value;

      if (this.cancellationRequested(assignment)) {
        return this.acknowledgeCancellation(assignment, completedAt);
      }

      for (const cost of result.costs) {
        this.store.recordCost(costRecord(cost, assignment, completedAt));
      }

      if (assignment.externalAction) {
        if (!result.external?.verified || !result.external.externalId) {
          return this.checkpointUncertain(assignment, now);
        }
        const receipt = this.store.getReceiptByIdempotencyKey(
          assignment.externalAction.idempotencyKey,
        );
        if (!receipt || !receiptMatchesAssignment(receipt, assignment)) {
          return this.checkpointUncertain(assignment, now);
        }
        this.store.completeReceipt(receipt.id, {
          status: ReceiptStatus.Succeeded,
          externalId: result.external.externalId,
          result: result.external.result,
          verified: true,
          verifiedAt: completedAt,
          completedAt,
          evidenceEventIds: result.external.evidenceEventIds,
        });
      }

      if (this.store.summarizeMissionCost(mission.id).actualMicroUsd > mission.budget.maxCostMicroUsd) {
        this.store.pauseAssignmentForCheckpoint(
          assignment.id,
          assignment.leaseToken!,
          [EscalationReason.CostBudget],
          completedAt,
        );
        return {
          kind: 'checkpoint',
          assignmentId: assignment.id,
          reasons: [EscalationReason.CostBudget],
        };
      }

      this.store.completeAssignment(
        assignment.id,
        assignment.leaseToken!,
        verifiedArtifact as unknown as JsonValue,
        completedAt,
      );
      return { kind: 'completed', assignmentId: assignment.id, reasons: [] };
    } catch (error) {
      return this.fail(assignment, error, now);
    }
  }

  private reconcileExistingReceipt(
    assignment: Assignment,
    receipt: ActionReceipt,
    now: string,
  ): RunnerOutcome {
    if (!receiptMatchesAssignment(receipt, assignment)) {
      return this.checkpointUncertain(assignment, now);
    }
    if (receipt.status === ReceiptStatus.Succeeded && receipt.verified) {
      this.store.completeAssignment(
        assignment.id,
        assignment.leaseToken!,
        {
          type: assignment.expectedArtifact.type,
          data: receipt.result ?? null,
          verified: true,
          verifierId: 'action-receipt',
          checks: [...assignment.expectedArtifact.verification],
          evidence: receipt.evidenceEventIds.map((eventId) => ({ eventId })),
          receiptId: receipt.id,
        },
        now,
      );
      return { kind: 'completed', assignmentId: assignment.id, reasons: [] };
    }
    return this.checkpointUncertain(assignment, now);
  }

  private checkpointUncertain(assignment: Assignment, now: string): RunnerOutcome {
    this.store.pauseAssignmentForCheckpoint(
      assignment.id,
      assignment.leaseToken!,
      [EscalationReason.UncertainExternalAction],
      now,
    );
    return {
      kind: 'checkpoint',
      assignmentId: assignment.id,
      reasons: [EscalationReason.UncertainExternalAction],
    };
  }

  private checkpointRuntime(assignment: Assignment, now: string): RunnerOutcome {
    const reasons = assignment.externalAction
      ? [EscalationReason.RuntimeBudget, EscalationReason.UncertainExternalAction]
      : [EscalationReason.RuntimeBudget];
    this.store.pauseAssignmentForCheckpoint(
      assignment.id,
      assignment.leaseToken!,
      reasons,
      now,
    );
    return {
      kind: 'checkpoint',
      assignmentId: assignment.id,
      reasons,
    };
  }

  private acknowledgeCancellation(assignment: Assignment, now: string): RunnerOutcome {
    const current = this.store.getAssignment(assignment.id);
    if (
      current?.status === LifecycleStatus.Active &&
      current.cancelRequestedAt &&
      current.leaseToken === assignment.leaseToken
    ) {
      this.store.acknowledgeAssignmentCancellation(
        assignment.id,
        assignment.leaseToken!,
        now,
      );
    }
    return {
      kind: 'cancelled',
      assignmentId: assignment.id,
      reasons: [current?.cancelReason ?? 'mission_cancelled'],
    };
  }

  private cancellationRequested(assignment: Assignment): boolean {
    const current = this.store.getAssignment(assignment.id);
    const mission = this.store.getMission(assignment.missionId);
    return Boolean(
      current?.cancelRequestedAt ||
      current?.status === LifecycleStatus.Cancelled ||
      mission?.cancelRequestedAt ||
      mission?.status === LifecycleStatus.Cancelled
    );
  }

  private assertRuntimeWithinBudget(mission: MissionPlan, at: string): void {
    const startedAt = mission.startedAt ?? mission.approvedAt ?? at;
    if (Date.parse(at) - Date.parse(startedAt) >= mission.budget.maxRuntimeMs) {
      throw new RuntimeBudgetExceededError();
    }
  }

  private createExecutionControl(
    assignment: Assignment,
    mission: MissionPlan,
    now: string,
    callerSignal: AbortSignal,
  ): ExecutionControl {
    const controller = new AbortController();
    const startedAt = mission.startedAt ?? mission.approvedAt ?? now;
    const remainingMs = Math.max(
      0,
      mission.budget.maxRuntimeMs - Math.max(0, Date.parse(now) - Date.parse(startedAt)),
    );
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let cancellationTimer: ReturnType<typeof setInterval> | undefined;
    let removeCallerAbort = () => {};

    let settleDeadline!: (value: ControlledInterruption) => void;
    const deadline = new Promise<ControlledInterruption>((resolve) => {
      settleDeadline = resolve;
    });
    deadlineTimer = setTimeout(() => {
      settleDeadline({ kind: 'deadline' });
      controller.abort(new RuntimeBudgetExceededError());
    }, remainingMs);

    let settleCancellation!: (value: ControlledInterruption) => void;
    const cancellation = new Promise<ControlledInterruption>((resolve) => {
      settleCancellation = resolve;
    });
    cancellationTimer = setInterval(() => {
      if (!this.cancellationRequested(assignment)) return;
      settleCancellation({ kind: 'cancelled' });
      controller.abort(new MissionCancelledError());
    }, this.#cancellationPollMs);

    let settleCallerAbort!: (value: ControlledInterruption) => void;
    const callerAbort = new Promise<ControlledInterruption>((resolve) => {
      settleCallerAbort = resolve;
    });
    const onCallerAbort = () => {
      settleCallerAbort({ kind: 'aborted' });
      controller.abort(callerSignal.reason);
    };
    if (callerSignal.aborted) {
      onCallerAbort();
    } else {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
      removeCallerAbort = () => callerSignal.removeEventListener('abort', onCallerAbort);
    }

    return {
      signal: controller.signal,
      race: async <T>(work: Promise<T>): Promise<ControlledResult<T>> => Promise.race([
        work.then<ControlledResult<T>, ControlledResult<T>>(
          (value) => ({ kind: 'completed', value }),
          (error: unknown) => ({ kind: 'error', error }),
        ),
        deadline,
        cancellation,
        callerAbort,
      ]),
      dispose: () => {
        if (deadlineTimer) clearTimeout(deadlineTimer);
        if (cancellationTimer) clearInterval(cancellationTimer);
        removeCallerAbort();
      },
    };
  }

  private fail(assignment: Assignment, error: unknown, now: string): RunnerOutcome {
    const retryAt = new Date(Date.parse(now) + this.#retryDelayMs).toISOString();
    const failed = this.store.failAssignment(
      assignment.id,
      assignment.leaseToken!,
      { message: error instanceof Error ? error.message : String(error) },
      now,
      retryAt,
    );
    return {
      kind: failed.status === LifecycleStatus.Queued ? 'retrying' : 'failed',
      assignmentId: assignment.id,
      reasons: [error instanceof Error ? error.message : String(error)],
    };
  }

  private usageFor(mission: MissionPlan, assignment: Assignment, now: string) {
    const cost = this.store.summarizeMissionCost(mission.id);
    const startedAt = mission.startedAt ?? mission.approvedAt ?? now;
    return {
      actualCostMicroUsd: cost.actualMicroUsd,
      elapsedRuntimeMs: Math.max(0, Date.parse(now) - Date.parse(startedAt)),
      activeAssignments: this.store.listAssignments({
        missionId: mission.id,
        status: LifecycleStatus.Active,
      }).length,
      retryCount: Math.max(0, assignment.attempt - 1),
    };
  }

  private actionFor(mission: MissionPlan, assignment: Assignment): MissionActionRequest {
    const external = assignment.externalAction;
    const expectedRuntime = assignment.instructions.expectedRuntimeMs;
    return {
      objective: mission.objective,
      acceptanceTestIds: mission.acceptanceTests.map((test) => test.id),
      estimatedCostMicroUsd: assignment.estimatedCostMicroUsd,
      expectedRuntimeMs:
        typeof expectedRuntime === 'number' && Number.isInteger(expectedRuntime) && expectedRuntime >= 0
          ? expectedRuntime
          : 0,
      retryCount: Math.max(0, assignment.attempt - 1),
      activeAssignments: this.store.listAssignments({
        missionId: mission.id,
        status: LifecycleStatus.Active,
      }).length,
      ...(external?.tool ? { tool: external.tool } : {}),
      ...(external?.system ? { system: external.system } : {}),
      ...(external?.channel ? { channel: external.channel } : {}),
      ...(external?.recipient ? { recipient: external.recipient } : {}),
      ...(external?.repository ? { repository: external.repository } : {}),
      ...(external?.repositoryPath ? { repositoryPath: external.repositoryPath } : {}),
      ...(external?.credentialRef ? { credentialRef: external.credentialRef } : {}),
      ...(external?.dataScope ? { dataScope: external.dataScope } : {}),
      mutationClass: external?.mutationClass ?? MutationClass.ReadOnly,
      contradictoryEvidenceEventIds: [],
    };
  }
}

function assertExecutorDescriptor(
  task: Readonly<MissionTaskDefinition>,
  descriptor: Readonly<ExecutorDescriptor>,
): void {
  if (descriptor.mayCreateAssignments) {
    throw new Error(`Executor for task ${task.id} may not create assignments`);
  }
  if (descriptor.model !== task.model) {
    throw new Error(`Executor model ${descriptor.model} is outside task ${task.id}`);
  }
  if (!Number.isInteger(descriptor.maxTokens) || descriptor.maxTokens < 1 || descriptor.maxTokens > task.maxTokens) {
    throw new Error(`Executor token limit is outside task ${task.id}`);
  }
  if (!sameStringSet(descriptor.tools, task.requiredTools)) {
    throw new Error(`Executor tools are outside task ${task.id}`);
  }
  const scopeViolations = permissionScopeViolations(descriptor.writableScope, task.writableScope);
  if (scopeViolations.length > 0) {
    throw new Error(`Executor writable scope exceeds task ${task.id}: ${scopeViolations.join(', ')}`);
  }
  for (const tool of task.requiredTools) {
    if (!descriptor.writableScope.allowedTools.includes(tool)) {
      throw new Error(`Executor writable scope is missing task tool ${tool}`);
    }
  }
  if (task.externalAction) {
    const actionViolations = externalActionScopeViolations(
      task.externalAction,
      descriptor.writableScope,
    );
    if (actionViolations.length > 0) {
      throw new Error(`Executor scope cannot perform task ${task.id}: ${actionViolations.join(', ')}`);
    }
  }
}

async function verifyArtifact(
  assignment: Assignment,
  mission: MissionPlan,
  task: MissionTask,
  artifact: StructuredArtifact,
  verifier: ArtifactVerifier,
  signal: AbortSignal,
): Promise<JsonObject> {
  if (!artifact || artifact.type !== assignment.expectedArtifact.type) {
    throw new Error(`Assignment ${assignment.id} artifact type is invalid`);
  }
  if (assignment.expectedArtifact.schema) {
    assertSchemaMatches(artifact.data, assignment.expectedArtifact.schema, '$');
  }
  if (!verifier.id || verifier.id.trim().length === 0) {
    throw new Error('Artifact verifier identity is required');
  }
  const verification = await verifier.verify({
    assignment,
    mission,
    task,
    artifact: { type: artifact.type, data: structuredClone(artifact.data) },
    requirement: structuredClone(assignment.expectedArtifact),
    signal,
  });
  if (!verification.verified) {
    throw new Error(`Assignment ${assignment.id} artifact is unverified`);
  }
  for (const check of assignment.expectedArtifact.verification) {
    if (!verification.checks.includes(check)) {
      throw new Error(`Assignment ${assignment.id} artifact is missing verification ${check}`);
    }
  }
  for (const selector of assignment.expectedArtifact.requiredEvidence) {
    if (!verification.evidence.some((item) => item.selector === selector)) {
      throw new Error(`Assignment ${assignment.id} artifact is missing evidence ${selector}`);
    }
  }
  for (const evidence of verification.evidence) {
    if (!evidence.eventId || evidence.eventId.trim().length === 0) {
      throw new Error(`Assignment ${assignment.id} verifier returned invalid evidence`);
    }
  }
  return {
    type: artifact.type,
    data: structuredClone(artifact.data),
    verified: true,
    verifierId: verifier.id,
    checks: [...verification.checks],
    evidence: structuredClone(verification.evidence) as unknown as JsonValue,
  };
}

function assertSchemaMatches(value: JsonValue, schema: JsonObject, path: string): void {
  const supportedKeywords = new Set([
    'type', 'enum', 'const',
    'required', 'properties', 'additionalProperties', 'minProperties', 'maxProperties',
    'items', 'minItems', 'maxItems', 'uniqueItems',
    'minLength', 'maxLength', 'pattern',
    'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
    'title', 'description', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly',
  ]);
  for (const keyword of Object.keys(schema)) {
    if (!supportedKeywords.has(keyword)) {
      throw new Error(`Artifact schema at ${path} uses unsupported keyword ${keyword}`);
    }
  }
  if (schema.type !== undefined) {
    if (typeof schema.type !== 'string' || !matchesJsonType(value, schema.type)) {
      throw new Error(`Artifact schema mismatch at ${path}: expected ${String(schema.type)}`);
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => canonicalJson(item) === canonicalJson(value))) {
    throw new Error(`Artifact schema mismatch at ${path}: value is outside enum`);
  }
  if (schema.const !== undefined && canonicalJson(schema.const) !== canonicalJson(value)) {
    throw new Error(`Artifact schema mismatch at ${path}: const does not match`);
  }
  if (typeof value === 'number') {
    assertNumericConstraint(schema, 'minimum', path, (limit) => value >= limit);
    assertNumericConstraint(schema, 'maximum', path, (limit) => value <= limit);
    assertNumericConstraint(schema, 'exclusiveMinimum', path, (limit) => value > limit);
    assertNumericConstraint(schema, 'exclusiveMaximum', path, (limit) => value < limit);
    if (schema.multipleOf !== undefined) {
      const divisor = schema.multipleOf;
      if (typeof divisor !== 'number' || !Number.isFinite(divisor) || divisor <= 0) {
        throw new Error(`Artifact schema at ${path} has invalid multipleOf`);
      }
      const quotient = value / divisor;
      if (Math.abs(quotient - Math.round(quotient)) > Number.EPSILON * 10) {
        throw new Error(`Artifact schema mismatch at ${path}: multipleOf`);
      }
    }
  }
  if (typeof value === 'string') {
    const length = [...value].length;
    assertLengthConstraint(schema, 'minLength', path, (limit) => length >= limit);
    assertLengthConstraint(schema, 'maxLength', path, (limit) => length <= limit);
    if (schema.pattern !== undefined) {
      if (typeof schema.pattern !== 'string') {
        throw new Error(`Artifact schema at ${path} has invalid pattern`);
      }
      let pattern: RegExp;
      try {
        pattern = new RegExp(schema.pattern, 'u');
      } catch {
        throw new Error(`Artifact schema at ${path} has invalid pattern`);
      }
      if (!pattern.test(value)) throw new Error(`Artifact schema mismatch at ${path}: pattern`);
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as JsonObject;
    const keys = Object.keys(record);
    assertLengthConstraint(schema, 'minProperties', path, (limit) => keys.length >= limit);
    assertLengthConstraint(schema, 'maxProperties', path, (limit) => keys.length <= limit);
    const required = schema.required;
    if (required !== undefined) {
      if (!Array.isArray(required) || required.some((item) => typeof item !== 'string')) {
        throw new Error(`Artifact schema at ${path} has invalid required fields`);
      }
      for (const key of required as string[]) {
        if (!Object.hasOwn(record, key)) {
          throw new Error(`Artifact schema mismatch at ${path}: missing ${key}`);
        }
      }
    }
    const properties = schema.properties;
    let propertySchemas: JsonObject = {};
    if (properties !== undefined) {
      if (properties === null || Array.isArray(properties) || typeof properties !== 'object') {
        throw new Error(`Artifact schema at ${path} has invalid properties`);
      }
      propertySchemas = properties as JsonObject;
      for (const [key, childSchema] of Object.entries(propertySchemas)) {
        if (!Object.hasOwn(record, key)) continue;
        if (childSchema === null || Array.isArray(childSchema) || typeof childSchema !== 'object') {
          throw new Error(`Artifact schema at ${path}.${key} is invalid`);
        }
        assertSchemaMatches(record[key], childSchema as JsonObject, `${path}.${key}`);
      }
    }
    for (const key of keys) {
      if (Object.hasOwn(propertySchemas, key)) continue;
      if (schema.additionalProperties === false) {
        throw new Error(`Artifact schema mismatch at ${path}: unexpected ${key}`);
      }
      if (
        schema.additionalProperties !== undefined &&
        schema.additionalProperties !== true
      ) {
        const additional = schema.additionalProperties;
        if (additional === null || Array.isArray(additional) || typeof additional !== 'object') {
          throw new Error(`Artifact schema at ${path} has invalid additionalProperties`);
        }
        assertSchemaMatches(record[key], additional as JsonObject, `${path}.${key}`);
      }
    }
  }
  if (Array.isArray(value)) {
    assertLengthConstraint(schema, 'minItems', path, (limit) => value.length >= limit);
    assertLengthConstraint(schema, 'maxItems', path, (limit) => value.length <= limit);
    if (schema.uniqueItems !== undefined) {
      if (typeof schema.uniqueItems !== 'boolean') {
        throw new Error(`Artifact schema at ${path} has invalid uniqueItems`);
      }
      if (
        schema.uniqueItems &&
        new Set(value.map((item) => canonicalJson(item))).size !== value.length
      ) {
        throw new Error(`Artifact schema mismatch at ${path}: uniqueItems`);
      }
    }
    if (schema.items !== undefined) {
      if (schema.items === null || Array.isArray(schema.items) || typeof schema.items !== 'object') {
        throw new Error(`Artifact schema at ${path} has invalid items`);
      }
      value.forEach((item, index) => assertSchemaMatches(item, schema.items as JsonObject, `${path}[${index}]`));
    }
  }
}

function assertNumericConstraint(
  schema: JsonObject,
  keyword: 'minimum' | 'maximum' | 'exclusiveMinimum' | 'exclusiveMaximum',
  path: string,
  predicate: (limit: number) => boolean,
): void {
  const limit = schema[keyword];
  if (limit === undefined) return;
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    throw new Error(`Artifact schema at ${path} has invalid ${keyword}`);
  }
  if (!predicate(limit)) throw new Error(`Artifact schema mismatch at ${path}: ${keyword}`);
}

function assertLengthConstraint(
  schema: JsonObject,
  keyword: 'minLength' | 'maxLength' | 'minItems' | 'maxItems' | 'minProperties' | 'maxProperties',
  path: string,
  predicate: (limit: number) => boolean,
): void {
  const limit = schema[keyword];
  if (limit === undefined) return;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0) {
    throw new Error(`Artifact schema at ${path} has invalid ${keyword}`);
  }
  if (!predicate(limit)) throw new Error(`Artifact schema mismatch at ${path}: ${keyword}`);
}

function matchesJsonType(value: JsonValue, expected: string): boolean {
  switch (expected) {
    case 'null': return value === null;
    case 'array': return Array.isArray(value);
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    default: throw new Error(`Artifact schema type ${expected} is unsupported`);
  }
}

function pendingReceiptFor(assignment: Assignment, requestedAt: string): ActionReceipt {
  const action = assignment.externalAction!;
  return {
    id: `receipt-${randomUUID()}`,
    assignmentId: assignment.id,
    missionTaskId: assignment.missionTaskId,
    connectorId: action.connectorId,
    action: action.action,
    idempotencyKey: action.idempotencyKey,
    destination: action.destination,
    status: ReceiptStatus.Pending,
    route: RouteType.Connector,
    risk: assignment.risk,
    requestedAt,
    verified: false,
    evidenceEventIds: [],
    attempt: assignment.attempt,
    provenance: [runnerProvenance(requestedAt, assignment.id)],
  };
}

function receiptMatchesAssignment(receipt: ActionReceipt, assignment: Assignment): boolean {
  const action = assignment.externalAction;
  return Boolean(
    action &&
    receipt.idempotencyKey === action.idempotencyKey &&
    receipt.assignmentId === assignment.id &&
    receipt.missionTaskId === assignment.missionTaskId &&
    receipt.connectorId === action.connectorId &&
    receipt.action === action.action &&
    receipt.destination === action.destination
  );
}

function assertNoRecursiveExpansion(result: ExecutorResult): void {
  const record = result as unknown as Record<string, unknown>;
  for (const field of ['assignments', 'spawnedAssignments', 'capabilities', 'agents']) {
    if (Object.hasOwn(record, field)) {
      throw new Error(`Executor attempted unrestricted recursive expansion through ${field}`);
    }
  }
}

function costRecord(
  cost: ExecutorCost,
  assignment: Assignment,
  incurredAt: string,
): CostRecord {
  return {
    id: cost.id,
    missionId: assignment.missionId,
    assignmentId: assignment.id,
    category: cost.category,
    ...(cost.provider ? { provider: cost.provider } : {}),
    ...(cost.model ? { model: cost.model } : {}),
    ...(cost.tool ? { tool: cost.tool } : {}),
    estimatedMicroUsd: cost.estimatedMicroUsd,
    actualMicroUsd: cost.actualMicroUsd,
    idempotencyKey: cost.idempotencyKey,
    incurredAt,
    provenance: [runnerProvenance(incurredAt, assignment.id)],
  };
}

function sameStringSet(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((item) => second.includes(item));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function runnerProvenance(observedAt: string, assignmentId: string) {
  return {
    source: 'mission-runner',
    sourceType: SourceType.System,
    sourceEventId: assignmentId,
    observedAt,
  } as const;
}
