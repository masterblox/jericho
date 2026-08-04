import {
  IntentKind,
  IntentRoute,
  RiskLevel,
  type ClassificationDraft,
  type EvidenceBackedStatement,
  type EvidenceReference,
  type EventEnvelope,
  type IntentDeadline,
  type JsonObject,
} from '@jericho/shared';

/**
 * Deterministic, read-only ingestion classifier. Model-backed classifiers can
 * provide hints, but this function only returns a draft and never authorizes
 * or persists work.
 */
export function classifyEvent(
  event: Readonly<EventEnvelope>,
  hints: Partial<ClassificationDraft> = {},
): ClassificationDraft {
  const payload = asObject(event.payload);
  const text = firstString(payload, ['text', 'transcript', 'message', 'title']) ?? event.type;
  const confidence = clampConfidence(hints.confidence ?? event.confidence ?? 0.5);
  const evidence = evidenceFor(event);
  const kind = hints.kind ?? inferKind(text);
  const suggestedRoute = hints.suggestedRoute ?? inferRoute(text, kind);
  const entityIds = hints.entityIds ?? stringArray(payload.entityIds);
  const expectedOutcome = hints.expectedOutcome ?? optionalString(payload.expectedOutcome);

  return {
    kind,
    summary: hints.summary ?? text.trim(),
    suggestedRoute,
    entityIds: [...entityIds],
    ...(expectedOutcome ? { expectedOutcome } : {}),
    commitments:
      hints.commitments ?? statements(payload.commitments, evidence, confidence),
    claims: hints.claims ?? statements(payload.claims, evidence, confidence),
    assumptions:
      hints.assumptions ?? statements(payload.assumptions, evidence, confidence),
    deadlines: hints.deadlines ?? deadlines(payload.deadlines),
    affectedPartyIds:
      hints.affectedPartyIds ?? stringArray(payload.affectedPartyIds),
    requiredEvidence: hints.requiredEvidence ?? [evidence],
    requiredCapabilities:
      hints.requiredCapabilities ?? stringArray(payload.requiredCapabilities),
    ambiguityReasons: hints.ambiguityReasons ?? stringArray(payload.ambiguityReasons),
    contradictoryEvidenceEventIds:
      hints.contradictoryEvidenceEventIds ??
      stringArray(payload.contradictoryEvidenceEventIds),
    risk: hints.risk ?? event.risk ?? RiskLevel.Low,
    confidence,
  };
}

function evidenceFor(event: EventEnvelope): EvidenceReference {
  return {
    eventId: event.id,
    ...(event.integrityHash ? { integrityHash: event.integrityHash } : {}),
  };
}

function statements(
  value: unknown,
  evidence: EvidenceReference,
  confidence: number,
): EvidenceBackedStatement[] {
  return stringArray(value).map((text) => ({
    text,
    evidence: [{ ...evidence }],
    confidence,
  }));
}

function deadlines(value: unknown): IntentDeadline[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asObject(item);
    const description = optionalString(record.description);
    const at = optionalString(record.at);
    if (!description || !at || !Number.isFinite(Date.parse(at))) return [];
    return [
      {
        description,
        at,
        confidence: clampConfidence(
          typeof record.confidence === 'number' ? record.confidence : 0.5,
        ),
      },
    ];
  });
}

function inferKind(text: string): IntentKind {
  const normalized = text.toLowerCase();
  if (/\b(cancel|stop|abort)\b/.test(normalized)) return IntentKind.Cancellation;
  if (/\b(prefer|always|never|remember)\b/.test(normalized)) return IntentKind.Preference;
  if (/\b(correct|actually|instead)\b/.test(normalized)) return IntentKind.Correction;
  if (/\?$|\b(what|which|who|when|where|how many)\b/.test(normalized)) return IntentKind.Query;
  if (/\b(build|reply|send|create|update|run|confirm|schedule|open)\b/.test(normalized)) {
    return IntentKind.Command;
  }
  return IntentKind.Observe;
}

function inferRoute(text: string, kind: IntentKind): IntentRoute {
  const normalized = text.toLowerCase();
  if (/\b(reply|respond|answer)\b/.test(normalized)) return IntentRoute.Reply;
  if (/\b(project|build|implement|multi-step|plan)\b/.test(normalized)) return IntentRoute.Project;
  if (/\b(remember|retain|index|note|knowledge|summarize)\b/.test(normalized)) {
    return IntentRoute.Knowledge;
  }
  if (/\b(signal|anomaly|warning|opportunity|status change)\b/.test(normalized)) {
    return IntentRoute.Signal;
  }
  if (kind === IntentKind.Query || kind === IntentKind.Preference || kind === IntentKind.Correction) {
    return IntentRoute.Knowledge;
  }
  return IntentRoute.Action;
}

function asObject(value: unknown): JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function firstString(record: JsonObject, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = optionalString(record[key]);
    if (value) return value;
  }
  return undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
