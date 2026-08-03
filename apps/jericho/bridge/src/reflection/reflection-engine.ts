import { createHash } from 'node:crypto';

import {
  IntentRoute,
  LifecycleStatus,
  RiskLevel,
  type DecisionRecord,
  type EvidenceBackedStatement,
  type IntentEnvelope,
  type MissionPlan,
} from '@jericho/shared';

export type ReflectionKind =
  | 'contradictory_evidence'
  | 'incompatible_assumptions'
  | 'abandoned_commitment'
  | 'failed_outcome'
  | 'conflicting_decisions';

export interface ReflectionSuggestion {
  id: string;
  kind: ReflectionKind;
  summary: string;
  recordIds: string[];
  evidenceEventIds: string[];
  route: IntentRoute.Review;
  status: LifecycleStatus.PendingApproval;
  risk: RiskLevel;
  autoResolution: false;
  observedAt: string;
}

export interface ReflectionSnapshot {
  intents: IntentEnvelope[];
  missions: MissionPlan[];
  decisions: DecisionRecord[];
}

/**
 * Deterministic reflection pass. Findings are review suggestions only; this
 * component has no mutation or memory-merge capability.
 */
export class ReflectionEngine {
  reflect(snapshot: Readonly<ReflectionSnapshot>, observedAt: string): ReflectionSuggestion[] {
    const at = normalizedTimestamp(observedAt);
    const suggestions: ReflectionSuggestion[] = [];
    const successfulIntents = new Set(snapshot.missions
      .filter((mission) => mission.status === LifecycleStatus.Succeeded)
      .map((mission) => mission.intentId));

    for (const intent of snapshot.intents) {
      if (intent.contradictoryEvidenceEventIds.length) {
        suggestions.push(suggestion(
          'contradictory_evidence',
          `Contradictory evidence is attached to “${intent.summary}”`,
          [intent.id],
          [
            ...intent.requiredEvidence.map((item) => item.eventId),
            ...intent.contradictoryEvidenceEventIds,
          ],
          at,
          RiskLevel.High,
        ));
      }
      const overdue = intent.deadlines.some((deadline) => Date.parse(deadline.at) < Date.parse(at));
      if (
        overdue && intent.commitments.length && !successfulIntents.has(intent.id) &&
        intent.status !== LifecycleStatus.Cancelled && intent.status !== LifecycleStatus.Archived
      ) {
        suggestions.push(suggestion(
          'abandoned_commitment',
          `Commitment may be overdue: “${intent.commitments[0].text}”`,
          [intent.id],
          evidenceForStatements(intent.commitments, intent.requiredEvidence.map((item) => item.eventId)),
          at,
          RiskLevel.Medium,
        ));
      }
    }

    suggestions.push(...assumptionSuggestions(snapshot.intents, at));

    for (const mission of snapshot.missions) {
      if (mission.status !== LifecycleStatus.Failed && mission.status !== LifecycleStatus.Cancelled) continue;
      suggestions.push(suggestion(
        'failed_outcome',
        `Review lessons from ${mission.status} mission “${mission.title}”`,
        [mission.id, mission.intentId],
        mission.evidenceEventIds,
        at,
        RiskLevel.Medium,
      ));
    }

    const decisionsBySubject = new Map<string, DecisionRecord[]>();
    for (const decision of snapshot.decisions) {
      const subject = decision.missionId
        ? `mission:${decision.missionId}`
        : decision.proposalId
          ? `proposal:${decision.proposalId}`
          : decision.preferenceChangeId
            ? `preference:${decision.preferenceChangeId}`
            : undefined;
      if (!subject) continue;
      const decisions = decisionsBySubject.get(subject) ?? [];
      decisions.push(decision);
      decisionsBySubject.set(subject, decisions);
    }
    for (const [subject, decisions] of decisionsBySubject) {
      if (new Set(decisions.map((decision) => decision.outcome)).size < 2) continue;
      suggestions.push(suggestion(
        'conflicting_decisions',
        `Conflicting decisions exist for ${subject}`,
        decisions.map((decision) => decision.id),
        decisions.flatMap((decision) => decision.evidenceEventIds),
        at,
        RiskLevel.High,
      ));
    }

    return deduplicateSuggestions(suggestions);
  }
}

export interface ReflectionSchedulerOptions {
  intervalMs: number;
  load(): ReflectionSnapshot | Promise<ReflectionSnapshot>;
  publish(suggestions: ReflectionSuggestion[]): void | Promise<void>;
  clock?: () => string;
}

export class ReflectionScheduler {
  readonly #engine = new ReflectionEngine();
  readonly #clock: () => string;
  #running = false;
  #timer?: ReturnType<typeof setTimeout>;
  #inFlight?: Promise<void>;

  constructor(private readonly options: ReflectionSchedulerOptions) {
    if (!Number.isInteger(options.intervalMs) || options.intervalMs < 1) {
      throw new Error('Reflection interval is invalid');
    }
    this.#clock = options.clock ?? (() => new Date().toISOString());
  }

  async start(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    await this.#run();
    this.#schedule();
  }

  async stop(): Promise<void> {
    this.#running = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    await this.#inFlight;
  }

  async runOnce(): Promise<void> {
    await this.#run();
  }

  #schedule(): void {
    if (!this.#running || this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#run().finally(() => this.#schedule());
    }, this.options.intervalMs);
  }

  async #run(): Promise<void> {
    if (this.#inFlight) return this.#inFlight;
    const execution = (async () => {
      const snapshot = await this.options.load();
      const suggestions = this.#engine.reflect(snapshot, this.#clock());
      if (suggestions.length) await this.options.publish(suggestions);
    })();
    this.#inFlight = execution;
    try {
      await execution;
    } finally {
      if (this.#inFlight === execution) this.#inFlight = undefined;
    }
  }
}

function assumptionSuggestions(intents: readonly IntentEnvelope[], at: string): ReflectionSuggestion[] {
  const suggestions: ReflectionSuggestion[] = [];
  for (let leftIndex = 0; leftIndex < intents.length; leftIndex += 1) {
    const left = intents[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < intents.length; rightIndex += 1) {
      const right = intents[rightIndex];
      if (!shareContext(left, right)) continue;
      for (const leftAssumption of left.assumptions) {
        for (const rightAssumption of right.assumptions) {
          if (!exactNegation(leftAssumption.text, rightAssumption.text)) continue;
          suggestions.push(suggestion(
            'incompatible_assumptions',
            `Incompatible assumptions: “${leftAssumption.text}” / “${rightAssumption.text}”`,
            [left.id, right.id],
            evidenceForStatements([leftAssumption, rightAssumption], []),
            at,
            RiskLevel.Medium,
          ));
        }
      }
    }
  }
  return suggestions;
}

function shareContext(left: IntentEnvelope, right: IntentEnvelope): boolean {
  return left.entityIds.some((id) => right.entityIds.includes(id));
}

function exactNegation(left: string, right: string): boolean {
  const first = normalizedStatement(left);
  const second = normalizedStatement(right);
  const firstNegated = negatedStatement(first);
  const secondNegated = negatedStatement(second);
  return (firstNegated.negated !== secondNegated.negated)
    && firstNegated.text === secondNegated.text;
}

function normalizedStatement(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/gu, ' ').trim();
}

function negatedStatement(value: string): { negated: boolean; text: string } {
  const match = /^(?:not|no|never)\s+(.+)$/u.exec(value);
  return match ? { negated: true, text: match[1] } : { negated: false, text: value };
}

function evidenceForStatements(statements: readonly EvidenceBackedStatement[], fallback: string[]): string[] {
  return unique([
    ...statements.flatMap((statement) => statement.evidence.map((item) => item.eventId)),
    ...fallback,
  ]);
}

function suggestion(
  kind: ReflectionKind,
  summary: string,
  recordIds: string[],
  evidenceEventIds: string[],
  observedAt: string,
  risk: RiskLevel,
): ReflectionSuggestion {
  const records = unique(recordIds);
  const evidence = unique(evidenceEventIds);
  const id = createHash('sha256')
    .update(JSON.stringify({ kind, records, evidence }), 'utf8')
    .digest('hex');
  return {
    id: `reflection-${id.slice(0, 32)}`,
    kind,
    summary,
    recordIds: records,
    evidenceEventIds: evidence,
    route: IntentRoute.Review,
    status: LifecycleStatus.PendingApproval,
    risk,
    autoResolution: false,
    observedAt,
  };
}

function deduplicateSuggestions(suggestions: ReflectionSuggestion[]): ReflectionSuggestion[] {
  const byId = new Map<string, ReflectionSuggestion>();
  for (const item of suggestions) {
    if (item.evidenceEventIds.length) byId.set(item.id, item);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function normalizedTimestamp(value: string): string {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new Error('Reflection timestamp is invalid');
  return new Date(epoch).toISOString();
}
