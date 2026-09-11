import type { HubIntentClassification, HubIntentKind } from '@jericho/shared';

/** Optional model-backed classifier port. Never required for deterministic rules. */
export interface HubModelClassifierPort {
  classify?(text: string): Promise<Partial<HubIntentClassification> | undefined>;
}

/**
 * Pure deterministic Hub intent classifier.
 * Ambiguous/low-signal text falls through as TASK with reduced confidence.
 * Maestro dispatch hooks (dispatch/verify/archive/ack) are recognized as
 * first-class command intents so the hub can drive the board loop.
 */
export function classifyHubIntent(
  text: string,
  hints: Partial<HubIntentClassification> = {},
): HubIntentClassification {
  if (hints.intent && hints.summary && typeof hints.confidence === 'number') {
    return {
      intent: hints.intent,
      summary: hints.summary,
      confidence: clamp(hints.confidence),
      signals: [...(hints.signals ?? ['hint'])],
    };
  }

  const normalized = text.trim().toLowerCase();
  const signals: string[] = [];

  if (/\b(demo mode|walkthrough|party trick|showcase)\b/.test(normalized)) {
    signals.push('demo-keyword');
    return result('DEMO', text, 0.93, signals);
  }
  if (/\b(brief|summar(y|ize)|sitrep|last 72 hours|status report)\b/.test(normalized)) {
    signals.push('brief-keyword');
    return result('BRIEF', text, 0.91, signals);
  }
  if (/\b(create workspace|spin up|new conductor|open workspace)\b/.test(normalized)) {
    signals.push('create-keyword');
    return result('CREATE', text, 0.9, signals);
  }
  if (/\b(dispatch|assign to lane|send to lane|hand to lane)\b/.test(normalized)) {
    signals.push('dispatch-command');
    return result('DISPATCH', text, 0.9, signals);
  }
  if (/\b(verify|verified|verdict)\b/.test(normalized)) {
    signals.push('verify-command');
    return result('VERIFY', text, 0.9, signals);
  }
  if (/\b(archive|close out)\b/.test(normalized)) {
    signals.push('archive-command');
    return result('ARCHIVE', text, 0.9, signals);
  }
  if (/\b(a(?:ck|cknowledge))\b/.test(normalized)) {
    signals.push('ack-command');
    return result('ACK', text, 0.9, signals);
  }
  if (
    /\?$/.test(normalized) ||
    /\b(what|which|who|when|where|how|why|status of|show me)\b/.test(normalized)
  ) {
    signals.push('query-form');
    return result('QUERY', text, 0.88, signals);
  }
  if (/\b(fix|build|implement|deploy|run|schedule|send|update|assign|debug|extract|research)\b/.test(normalized)) {
    signals.push('task-verb');
    return result('TASK', text, 0.86, signals);
  }

  signals.push('ambiguous-default-task');
  return result('TASK', text, 0.45, signals);
}

function result(
  intent: HubIntentKind,
  text: string,
  confidence: number,
  signals: string[],
): HubIntentClassification {
  return {
    intent,
    summary: text.trim(),
    confidence: clamp(confidence),
    signals: [...signals],
  };
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
