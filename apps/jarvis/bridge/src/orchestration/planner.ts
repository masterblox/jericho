import {
  LifecycleStatus,
  type AcceptanceTest,
  type EscalationReason,
  type MissionBudget,
  type MissionDeliverable,
  type MissionPermissions,
  type MissionPlan,
  type MissionTaskDefinition,
  type Provenance,
  type RiskLevel,
  type RollbackPlan,
  type RouteType,
} from '@jericho/shared';

import type { CapabilityRegistry } from './capability-registry.js';
import { computeMissionPlanHash } from './mission-hash.js';

export interface MissionPlanInput {
  id: string;
  seriesId: string;
  version: number;
  supersedesPlanId?: string;
  intentId: string;
  title: string;
  objective: string;
  route: RouteType;
  risk: RiskLevel;
  confidence?: number;
  deliverables: MissionDeliverable[];
  acceptanceTests: AcceptanceTest[];
  evidenceEventIds: string[];
  contextSnapshotHash: string;
  taskGraph: MissionTaskDefinition[];
  budget: MissionBudget;
  permissions: MissionPermissions;
  rollback: RollbackPlan;
  escalationConditions: EscalationReason[];
  provenance: Provenance[];
}

export function createMissionPlan(
  input: MissionPlanInput,
  registry: CapabilityRegistry,
  now = new Date().toISOString(),
): MissionPlan {
  validateMissionPlanInput(input, registry);
  const selectedAgents = input.taskGraph.map((task) => ({
    taskId: task.id,
    agentId: task.selectedAgentId,
    lane: task.lane,
    capabilityIds: [...task.capabilityIds],
  }));
  const plan: MissionPlan = {
    ...structuredClone(input),
    selectedAgents,
    status: LifecycleStatus.PendingApproval,
    planHash: '',
    createdAt: now,
    updatedAt: now,
  };
  plan.planHash = computeMissionPlanHash(plan);
  return plan;
}

export function validateMissionPlanInput(
  input: MissionPlanInput,
  registry: CapabilityRegistry,
): void {
  for (const [field, value] of [
    ['id', input.id],
    ['seriesId', input.seriesId],
    ['intentId', input.intentId],
    ['title', input.title],
    ['objective', input.objective],
  ] as const) {
    if (value.trim().length === 0) throw new Error(`Mission ${field} is required`);
  }
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new Error('Mission version must be a positive integer');
  }
  if (!/^[a-f0-9]{64}$/.test(input.contextSnapshotHash)) {
    throw new Error('Mission context snapshot hash is invalid');
  }
  if (input.deliverables.length === 0 || input.acceptanceTests.length === 0) {
    throw new Error('Mission requires deliverables and acceptance tests');
  }
  assertBudget(input.budget);
  if (input.taskGraph.length === 0) throw new Error('Mission task graph is empty');

  const ids = new Set<string>();
  const sequences = new Set<number>();
  for (const task of input.taskGraph) {
    if (ids.has(task.id)) throw new Error(`Duplicate mission task ${task.id}`);
    if (sequences.has(task.sequence)) throw new Error(`Duplicate mission task sequence ${task.sequence}`);
    if (!Number.isInteger(task.sequence) || task.sequence < 0) {
      throw new Error(`Task ${task.id} sequence is invalid`);
    }
    if (!Number.isInteger(task.estimatedCostMicroUsd) || task.estimatedCostMicroUsd < 0) {
      throw new Error(`Task ${task.id} estimated cost is invalid`);
    }
    ids.add(task.id);
    sequences.add(task.sequence);
    registry.assertTaskSupported(task);
  }
  for (const task of input.taskGraph) {
    for (const dependency of task.dependsOn) {
      if (!ids.has(dependency)) throw new Error(`Task ${task.id} has unknown dependency ${dependency}`);
      if (dependency === task.id) throw new Error(`Mission task graph contains a cycle at ${task.id}`);
    }
  }
  assertAcyclic(input.taskGraph);
  const estimated = input.taskGraph.reduce((sum, task) => sum + task.estimatedCostMicroUsd, 0);
  if (estimated > input.budget.maxCostMicroUsd) {
    throw new Error('Mission estimated cost exceeds its budget');
  }
}

function assertBudget(budget: MissionBudget): void {
  for (const [field, value] of Object.entries(budget)) {
    if (!Number.isInteger(value) || value < (field === 'maxRetriesPerAssignment' ? 0 : 1)) {
      throw new Error(`Mission budget ${field} is invalid`);
    }
  }
}

function assertAcyclic(tasks: readonly MissionTaskDefinition[]): void {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error(`Mission task graph contains a cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) visit(task.id);
}
