import {
  HubCommandKind,
  type HubCommandClassification,
} from '@jericho/shared';

/**
 * Deterministic Hub command classifier. Never authorizes or dispatches work.
 */
export function classifyHubCommand(text: string): HubCommandClassification {
  const normalized = text.trim().toLowerCase();
  const signals: string[] = [];

  if (/\b(demo|walkthrough|party trick|show(case)?)\b/.test(normalized)) {
    signals.push('demo-keyword');
    return classification(HubCommandKind.Demo, text, 0.92, signals);
  }
  if (/\b(brief|summar(y|ize)|status report|sitrep)\b/.test(normalized)) {
    signals.push('brief-keyword');
    return classification(HubCommandKind.Brief, text, 0.9, signals);
  }
  if (/\b(create|draft|compose|open ticket|new (issue|pr|task))\b/.test(normalized)) {
    signals.push('create-keyword');
    return classification(HubCommandKind.Create, text, 0.88, signals);
  }
  if (
    /\?$/.test(normalized) ||
    /\b(what|which|who|when|where|how|why|status of|show me)\b/.test(normalized)
  ) {
    signals.push('query-form');
    return classification(HubCommandKind.Query, text, 0.86, signals);
  }
  if (/\b(fix|build|implement|deploy|run|schedule|send|update|assign)\b/.test(normalized)) {
    signals.push('task-verb');
    return classification(HubCommandKind.Task, text, 0.84, signals);
  }

  signals.push('default-task');
  return classification(HubCommandKind.Task, text, 0.55, signals);
}

function classification(
  kind: HubCommandKind,
  text: string,
  confidence: number,
  signals: string[],
): HubCommandClassification {
  return {
    kind,
    summary: text.trim(),
    confidence: clamp(confidence),
    signals: [...signals],
  };
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
