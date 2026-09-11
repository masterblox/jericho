import type {
  HubAgentId,
  HubDispatchPlan,
  HubIntentClassification,
  HubIntentKind,
} from '@jericho/shared';

export interface HubCapabilityDefinition {
  agentId: HubAgentId;
  owns: readonly string[];
  description: string;
}

export const HUB_CAPABILITY_REGISTRY: readonly HubCapabilityDefinition[] = [
  {
    agentId: 'DEV',
    owns: ['infra', 'repo', 'git', 'github', 'deploy', 'debug', 'health', 'ci', 'linear', 'code'],
    description: 'Infrastructure, repositories, deploy, debug, and health',
  },
  {
    agentId: 'DONALD',
    owns: ['sales', 'lead', 'money', 'opportunity', 'crm', 'outreach', 'deal', 'pipeline', 'bd'],
    description: 'BD, leads, money, and opportunity extraction',
  },
  {
    agentId: 'PA',
    owns: ['calendar', 'email', 'schedule', 'inbox', 'travel', 'personal', 'logistics', 'meeting'],
    description: 'Scheduling, email drafts, and personal logistics',
  },
  {
    agentId: 'IRIS',
    owns: ['research', 'report', 'competitive', 'intel', 'analysis', 'design', 'visual', 'brand'],
    description: 'Research, reports, and competitive intelligence',
  },
  {
    agentId: 'JERICHO',
    owns: ['scan', 'brief', 'cron', 'demo', 'status', 'overview'],
    description: 'Scans, briefs, cron management, and presentation',
  },
];

const MUTATING_INTENTS = new Set<HubIntentKind>(['TASK', 'CREATE', 'DISPATCH']);
const OPERATOR_BOOKKEEPING = new Set<HubIntentKind>(['VERIFY', 'ARCHIVE', 'ACK']);

/** Route a classification to a capability lane without performing agent work. */
export function planHubDispatch(
  commandId: string,
  classification: Readonly<HubIntentClassification>,
  text = classification.summary,
): HubDispatchPlan {
  const targetAgent = selectAgent(classification, text);
  const requiresConfirmation = MUTATING_INTENTS.has(classification.intent);
  const ambiguous = classification.confidence < 0.65;

  if (ambiguous) {
    return {
      schemaVersion: 1,
      commandId,
      intent: classification.intent,
      targetAgent,
      confidence: classification.confidence,
      summary: classification.summary,
      requiresConfirmation: true,
      status: 'pending_approval',
      reason: 'Ambiguous classification held for review',
    };
  }

  if (classification.intent === 'DEMO' || classification.intent === 'BRIEF') {
    return {
      schemaVersion: 1,
      commandId,
      intent: classification.intent,
      targetAgent: 'JERICHO',
      confidence: classification.confidence,
      summary: classification.summary,
      requiresConfirmation: false,
      status: 'planned',
    };
  }

  // Maestro dispatch hooks: verify/archive/ack are idempotent bookkeeping,
  // planned for the operator lane with no confirmation (they never mutate a
  // repo/send externally by themselves). dispatch() behaves like TASK below.
  if (OPERATOR_BOOKKEEPING.has(classification.intent)) {
    return {
      schemaVersion: 1,
      commandId,
      intent: classification.intent,
      targetAgent: 'JERICHO',
      confidence: classification.confidence,
      summary: classification.summary,
      requiresConfirmation: false,
      status: 'planned',
      reason: `${classification.intent} hook (idempotent bookkeeping)`,
    };
  }

  if (classification.intent === 'QUERY') {
    return {
      schemaVersion: 1,
      commandId,
      intent: 'QUERY',
      targetAgent: targetAgent ?? 'JERICHO',
      confidence: classification.confidence,
      summary: classification.summary,
      requiresConfirmation: false,
      status: 'planned',
    };
  }

  return {
    schemaVersion: 1,
    commandId,
    intent: classification.intent,
    targetAgent,
    confidence: classification.confidence,
    summary: classification.summary,
    requiresConfirmation,
    status: requiresConfirmation ? 'pending_approval' : 'planned',
    ...(requiresConfirmation ? { reason: 'External effects require explicit confirmation' } : {}),
  };
}

function selectAgent(
  classification: Readonly<HubIntentClassification>,
  text: string,
): HubAgentId | null {
  const haystack = `${text} ${classification.signals.join(' ')}`.toLowerCase();
  let best: { agentId: HubAgentId; score: number } | undefined;
  for (const capability of HUB_CAPABILITY_REGISTRY) {
    const score = capability.owns.reduce(
      (total, token) => total + (haystack.includes(token) ? 1 : 0),
      0,
    );
    if (score > 0 && (!best || score > best.score)) {
      best = { agentId: capability.agentId, score };
    }
  }
  if (classification.intent === 'DEMO' || classification.intent === 'BRIEF') return 'JERICHO';
  if (classification.intent === 'VERIFY' || classification.intent === 'ARCHIVE' || classification.intent === 'ACK') {
    return 'JERICHO';
  }
  return best?.agentId ?? (classification.intent === 'QUERY' ? 'JERICHO' : 'DEV');
}
