import { randomUUID } from 'node:crypto';

import {
  CostCategory,
  EscalationReason,
  LifecycleStatus,
  MutationClass,
  ReceiptStatus,
  RouteType,
  SourceType,
  type Assignment,
  type CostRecord,
  type JsonValue,
  type MissionPlan,
  type MissionTask,
} from '@jericho/shared';

import type { JerichoStore } from '../core/store.js';
import { CapabilityRegistry } from './capability-registry.js';
import { evaluateMissionAction, type MissionActionRequest } from './policy.js';

export interface StructuredArtifact {
  type: string;
  data: JsonValue;
  verified: boolean;
  checks: string[];
  evidenceEventIds: string[];
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

export interface AssignmentExecutionContext {
  assignment: Assignment;
  mission: MissionPlan;
  task: MissionTask;
  signal: AbortSignal;
}

export interface AssignmentExecutor {
  execute(context: AssignmentExecutionContext): Promise<ExecutorResult>;
}

export interface MissionRunnerOptions {
  workerId: string;
  leaseMs: number;
  clock?: () => string;
  retryDelayMs?: number;
}

export interface RunnerOutcome {
  kind: 'idle' | 'completed' | 'retrying' | 'failed' | 'checkpoint';
  assignmentId?: string;
  reasons: Array<EscalationReason | string>;
}

export class MissionRunner {
  readonly #clock: () => string;
  readonly #retryDelayMs: number;

  constructor(
    private readonly store: JerichoStore,
    private readonly executor: AssignmentExecutor,
    private readonly options: MissionRunnerOptions,
  ) {
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#retryDelayMs = options.retryDelayMs ?? 1_000;
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
        if (existing) {
          if (existing.status === ReceiptStatus.Succeeded && existing.verified) {
            this.store.completeAssignment(
              assignment.id,
              assignment.leaseToken!,
              {
                type: assignment.expectedArtifact.type,
                verified: true,
                receiptId: existing.id,
                result: existing.result ?? null,
              },
              now,
            );
            return { kind: 'completed', assignmentId: assignment.id, reasons: [] };
          }
          return this.checkpointUncertain(assignment, now);
        }
        this.store.reserveReceipt({
          id: `receipt-${randomUUID()}`,
          assignmentId: assignment.id,
          missionTaskId: assignment.missionTaskId,
          connectorId: assignment.externalAction.connectorId,
          action: assignment.externalAction.action,
          idempotencyKey: assignment.externalAction.idempotencyKey,
          destination: assignment.externalAction.destination,
          status: ReceiptStatus.Pending,
          route: RouteType.Connector,
          risk: assignment.risk,
          requestedAt: now,
          verified: false,
          evidenceEventIds: [],
          attempt: assignment.attempt,
          provenance: [runnerProvenance(now, assignment.id)],
        });
      }

      let result: ExecutorResult;
      try {
        result = await this.executor.execute({ assignment, mission, task, signal });
      } catch (error) {
        if (assignment.externalAction) return this.checkpointUncertain(assignment, now);
        throw error;
      }
      assertNoRecursiveExpansion(result);
      verifyArtifact(assignment, result.artifact);

      for (const cost of result.costs) {
        this.store.recordCost(costRecord(cost, assignment, now));
      }

      if (assignment.externalAction) {
        if (!result.external?.verified || !result.external.externalId) {
          return this.checkpointUncertain(assignment, now);
        }
        const receipt = this.store.getReceiptByIdempotencyKey(
          assignment.externalAction.idempotencyKey,
        )!;
        this.store.completeReceipt(receipt.id, {
          status: ReceiptStatus.Succeeded,
          externalId: result.external.externalId,
          result: result.external.result,
          verified: true,
          verifiedAt: now,
          completedAt: now,
          evidenceEventIds: result.external.evidenceEventIds,
        });
      }

      if (this.store.summarizeMissionCost(mission.id).actualMicroUsd > mission.budget.maxCostMicroUsd) {
        this.store.pauseAssignmentForCheckpoint(
          assignment.id,
          assignment.leaseToken!,
          [EscalationReason.CostBudget],
          now,
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
        result.artifact as unknown as JsonValue,
        now,
      );
      return { kind: 'completed', assignmentId: assignment.id, reasons: [] };
    } catch (error) {
      return this.fail(assignment, error, now);
    }
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

function verifyArtifact(assignment: Assignment, artifact: StructuredArtifact): void {
  if (!artifact || artifact.type !== assignment.expectedArtifact.type) {
    throw new Error(`Assignment ${assignment.id} artifact type is invalid`);
  }
  if (!artifact.verified) throw new Error(`Assignment ${assignment.id} artifact is unverified`);
  for (const check of assignment.expectedArtifact.verification) {
    if (!artifact.checks.includes(check)) {
      throw new Error(`Assignment ${assignment.id} artifact is missing verification ${check}`);
    }
  }
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

function runnerProvenance(observedAt: string, assignmentId: string) {
  return {
    source: 'mission-runner',
    sourceType: SourceType.System,
    sourceEventId: assignmentId,
    observedAt,
  } as const;
}
