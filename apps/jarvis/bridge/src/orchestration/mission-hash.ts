import { createHash } from 'node:crypto';

import type { JsonValue, MissionPlan } from '@jericho/shared';

type HashableMission = Pick<
  MissionPlan,
  | 'id'
  | 'seriesId'
  | 'version'
  | 'intentId'
  | 'title'
  | 'objective'
  | 'route'
  | 'risk'
  | 'deliverables'
  | 'acceptanceTests'
  | 'evidenceEventIds'
  | 'contextSnapshotHash'
  | 'taskGraph'
  | 'selectedAgents'
  | 'budget'
  | 'permissions'
  | 'rollback'
  | 'escalationConditions'
> &
  Partial<Pick<MissionPlan, 'supersedesPlanId' | 'confidence'>>;

export function computeMissionPlanHash(plan: HashableMission): string {
  return createHash('sha256')
    .update(canonicalJson(missionDefinition(plan)))
    .digest('hex');
}

export function missionDefinition(plan: HashableMission): JsonValue {
  return {
    id: plan.id,
    seriesId: plan.seriesId,
    version: plan.version,
    ...(plan.supersedesPlanId ? { supersedesPlanId: plan.supersedesPlanId } : {}),
    intentId: plan.intentId,
    title: plan.title,
    objective: plan.objective,
    route: plan.route,
    risk: plan.risk,
    ...(plan.confidence !== undefined ? { confidence: plan.confidence } : {}),
    deliverables: plan.deliverables,
    acceptanceTests: plan.acceptanceTests,
    evidenceEventIds: plan.evidenceEventIds,
    contextSnapshotHash: plan.contextSnapshotHash,
    taskGraph: plan.taskGraph,
    selectedAgents: plan.selectedAgents,
    budget: plan.budget,
    permissions: plan.permissions,
    rollback: plan.rollback,
    escalationConditions: plan.escalationConditions,
  } as unknown as JsonValue;
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
