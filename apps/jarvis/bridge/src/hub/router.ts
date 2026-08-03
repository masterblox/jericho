import {
  HubCapability,
  HubCommandKind,
  type HubCommandClassification,
  type HubRoutingDecision,
} from '@jericho/shared';

/**
 * Routes a classified Hub command to DEV, Donald, PA, Iris, or Jericho.
 */
export function routeHubCommand(
  classification: Readonly<HubCommandClassification>,
  text = classification.summary,
): HubRoutingDecision {
  const normalized = text.toLowerCase();

  if (classification.kind === HubCommandKind.Demo || classification.kind === HubCommandKind.Brief) {
    return decision(
      HubCapability.Jericho,
      'hub:jericho-presentation',
      Math.max(classification.confidence, 0.8),
      'Briefs and demos stay on the Jericho presentation lane',
    );
  }

  if (/\b(design|visual|image|brand|mockup|ui|ux)\b/.test(normalized)) {
    return decision(HubCapability.Iris, 'hub:iris-visual', classification.confidence, 'Visual work routes to Iris');
  }
  if (/\b(sales|crm|outreach|lead|prospect|deal|pipeline)\b/.test(normalized)) {
    return decision(HubCapability.Donald, 'hub:donald-sales', classification.confidence, 'Sales work routes to Donald');
  }
  if (/\b(calendar|inbox|meeting|schedule|personal|travel|ops|pa\b)\b/.test(normalized)) {
    return decision(HubCapability.PA, 'hub:pa-ops', classification.confidence, 'Personal ops route to PA');
  }
  if (/\b(code|repo|git|github|linear|ci|deploy|pr\b|implement|fix|build)\b/.test(normalized)) {
    return decision(HubCapability.Dev, 'hub:dev-delivery', classification.confidence, 'Delivery work routes to DEV');
  }

  if (classification.kind === HubCommandKind.Query) {
    return decision(
      HubCapability.Jericho,
      'hub:jericho-query',
      classification.confidence,
      'General queries stay with Jericho',
    );
  }

  return decision(
    HubCapability.Dev,
    'hub:default-dev',
    Math.min(classification.confidence, 0.7),
    'Unmatched actionable work defaults to DEV',
  );
}

function decision(
  capability: HubCapability,
  ruleId: string,
  confidence: number,
  rationale: string,
): HubRoutingDecision {
  return {
    capability,
    ruleId,
    confidence: Math.min(1, Math.max(0, confidence)),
    rationale,
  };
}
