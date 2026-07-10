import {
  EscalationReason,
  LifecycleStatus,
  MutationClass,
  type MissionPlan,
} from '@jericho/shared';

export interface MissionUsage {
  actualCostMicroUsd: number;
  elapsedRuntimeMs: number;
  activeAssignments: number;
  retryCount: number;
}

export interface MissionActionRequest {
  objective: string;
  acceptanceTestIds: string[];
  estimatedCostMicroUsd: number;
  expectedRuntimeMs: number;
  retryCount: number;
  activeAssignments: number;
  tool?: string;
  system?: string;
  channel?: string;
  recipient?: string;
  repository?: string;
  repositoryPath?: string;
  credentialRef?: string;
  dataScope?: string;
  mutationClass: MutationClass;
  contradictoryEvidenceEventIds: string[];
}

export type PolicyDecision =
  | { kind: 'allow'; reasons: [] }
  | { kind: 'checkpoint'; reasons: EscalationReason[] }
  | { kind: 'deny'; reasons: string[] };

export function evaluateMissionAction(
  plan: Readonly<MissionPlan>,
  usage: Readonly<MissionUsage>,
  action: Readonly<MissionActionRequest>,
): PolicyDecision {
  if (
    (plan.status !== LifecycleStatus.Approved && plan.status !== LifecycleStatus.Active) ||
    !plan.approvalDecisionId ||
    !plan.approvedAt
  ) {
    return { kind: 'deny', reasons: ['mission_not_approved'] };
  }

  const reasons: EscalationReason[] = [];
  if (usage.actualCostMicroUsd + action.estimatedCostMicroUsd > plan.budget.maxCostMicroUsd) {
    reasons.push(EscalationReason.CostBudget);
  }
  if (usage.elapsedRuntimeMs + action.expectedRuntimeMs > plan.budget.maxRuntimeMs) {
    reasons.push(EscalationReason.RuntimeBudget);
  }
  if (Math.max(usage.activeAssignments, action.activeAssignments) > plan.budget.maxConcurrency) {
    reasons.push(EscalationReason.ConcurrencyBudget);
  }
  if (Math.max(usage.retryCount, action.retryCount) > plan.budget.maxRetriesPerAssignment) {
    reasons.push(EscalationReason.RetryBudget);
  }
  if (action.objective !== plan.objective) reasons.push(EscalationReason.ObjectiveChange);
  if (!sameSet(action.acceptanceTestIds, plan.acceptanceTests.map((test) => test.id))) {
    reasons.push(EscalationReason.AcceptanceTestChange);
  }
  if (action.tool && !plan.permissions.allowedTools.includes(action.tool)) {
    reasons.push(EscalationReason.ToolExpansion);
  }
  if (action.system && !plan.permissions.allowedSystems.includes(action.system)) {
    reasons.push(EscalationReason.NewSystem);
  }
  if (action.channel && !plan.permissions.allowedChannels.includes(action.channel)) {
    reasons.push(EscalationReason.ChannelExpansion);
  }
  if (action.recipient && !plan.permissions.allowedRecipients.includes(action.recipient)) {
    reasons.push(EscalationReason.NewRecipient);
  }
  if (action.repository) {
    const grant = plan.permissions.allowedRepositories.find(
      (candidate) => candidate.repository === action.repository,
    );
    if (!grant) {
      reasons.push(EscalationReason.RepositoryExpansion);
    } else {
      if (
        action.repositoryPath &&
        !grant.writablePaths.some(
          (path) =>
            action.repositoryPath === path ||
            action.repositoryPath?.startsWith(`${path.replace(/\/$/, '')}/`),
        )
      ) {
        reasons.push(EscalationReason.RepositoryExpansion);
      }
      if (!grant.mutationClasses.includes(action.mutationClass)) {
        if (action.mutationClass === MutationClass.Destructive) {
          reasons.push(EscalationReason.DestructiveMutation);
        } else if (action.mutationClass === MutationClass.Production) {
          reasons.push(EscalationReason.ProductionMutation);
        } else {
          reasons.push(EscalationReason.RepositoryExpansion);
        }
      }
    }
  }
  if (
    action.credentialRef &&
    !plan.permissions.allowedCredentialRefs.includes(action.credentialRef)
  ) {
    reasons.push(EscalationReason.CredentialExpansion);
  }
  if (action.dataScope && !plan.permissions.allowedDataScopes.includes(action.dataScope)) {
    reasons.push(EscalationReason.DataExpansion);
  }
  if (!plan.permissions.allowedMutationClasses.includes(action.mutationClass)) {
    if (action.mutationClass === MutationClass.Destructive) {
      reasons.push(EscalationReason.DestructiveMutation);
    } else if (action.mutationClass === MutationClass.Production) {
      reasons.push(EscalationReason.ProductionMutation);
    } else {
      reasons.push(EscalationReason.DataExpansion);
    }
  }
  if (action.contradictoryEvidenceEventIds.length > 0) {
    reasons.push(EscalationReason.ContradictoryEvidence);
  }
  const unique = [...new Set(reasons)];
  return unique.length > 0
    ? { kind: 'checkpoint', reasons: unique }
    : { kind: 'allow', reasons: [] };
}

function sameSet(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((item) => second.includes(item));
}
