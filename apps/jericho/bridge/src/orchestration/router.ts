import {
  AgentLane,
  IntentKind,
  IntentRoute,
  RiskLevel,
  type ClassificationDraft,
} from '@jericho/shared';

export const REVIEW_CONFIDENCE_THRESHOLD = 0.65;

export interface RoutingDecision {
  route: IntentRoute;
  lane: AgentLane;
  ruleId: string;
  confidence: number;
}

export function routeIntent(draft: Readonly<ClassificationDraft>): RoutingDecision {
  const lane = selectAgentLane(draft.requiredCapabilities);
  if (draft.confidence < REVIEW_CONFIDENCE_THRESHOLD) {
    return decision(IntentRoute.Review, lane, 'safety:low-confidence', draft.confidence);
  }
  if (draft.contradictoryEvidenceEventIds.length > 0) {
    return decision(IntentRoute.Review, lane, 'safety:contradiction', draft.confidence);
  }
  if (isHighRisk(draft.risk) && draft.ambiguityReasons.length > 0) {
    return decision(IntentRoute.Review, lane, 'safety:high-risk-ambiguity', draft.confidence);
  }

  if (draft.kind === IntentKind.Preference || draft.kind === IntentKind.Correction) {
    return decision(
      IntentRoute.Knowledge,
      AgentLane.Angela,
      'ownership:preference-knowledge',
      draft.confidence,
    );
  }
  if (draft.kind === IntentKind.Cancellation) {
    return decision(IntentRoute.Action, lane, 'ownership:cancellation-action', draft.confidence);
  }
  return decision(draft.suggestedRoute, lane, 'classifier:validated-suggestion', draft.confidence);
}

export function selectAgentLane(capabilities: readonly string[]): AgentLane {
  const joined = capabilities.join(' ').toLowerCase();
  if (/\b(code|repo|git|github|linear|ci|deploy)/.test(joined)) return AgentLane.Dev;
  if (/\b(calendar|inbox|meeting|personal|schedule|memory|preference)/.test(joined)) {
    return AgentLane.Angela;
  }
  if (/\b(sales|crm|outreach|lead|relationship)/.test(joined)) return AgentLane.Donald;
  if (/\b(design|visual|image|brand)/.test(joined)) return AgentLane.Iris;
  if (/\b(research|evidence|source|investigate)/.test(joined)) return AgentLane.Researcher;
  return AgentLane.Analyst;
}

function isHighRisk(risk: RiskLevel): boolean {
  return risk === RiskLevel.High || risk === RiskLevel.Critical;
}

function decision(
  route: IntentRoute,
  lane: AgentLane,
  ruleId: string,
  confidence: number,
): RoutingDecision {
  return { route, lane, ruleId, confidence };
}
