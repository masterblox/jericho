import { describe, expect, it, vi } from 'vitest';

import {
  DecisionOutcome,
  IntentKind,
  IntentRoute,
  LifecycleStatus,
  RiskLevel,
  SourceType,
  type DecisionRecord,
  type IntentEnvelope,
  type MissionPlan,
} from '@jericho/shared';

import {
  ReflectionEngine,
  ReflectionScheduler,
} from '../src/reflection/reflection-engine.js';

const NOW = '2026-07-11T06:00:00.000Z';

describe('reflection suggestions', () => {
  it('surfaces explicit contradictions, incompatible assumptions, abandoned commitments, and failed outcomes for review only', () => {
    const engine = new ReflectionEngine();
    const suggestions = engine.reflect({
      intents: [
        intent({
          id: 'intent-a',
          entityIds: ['company-acme'],
          assumptions: [statement('Paula is the decision maker', 'event-a')],
          commitments: [statement('Reply to Paula', 'event-a')],
          deadlines: [{ description: 'Reply to Paula', at: '2026-07-10T09:00:00.000Z', confidence: 0.9 }],
          contradictoryEvidenceEventIds: ['event-conflict'],
        }),
        intent({
          id: 'intent-b',
          entityIds: ['company-acme'],
          assumptions: [statement('Not Paula is the decision maker', 'event-b')],
        }),
      ],
      missions: [mission({ status: LifecycleStatus.Failed, completedAt: '2026-07-11T04:00:00.000Z' })],
      decisions: [
        decision({ id: 'decision-a', missionId: 'mission-1', outcome: DecisionOutcome.Approved }),
        decision({ id: 'decision-b', missionId: 'mission-1', outcome: DecisionOutcome.Rejected }),
      ],
    }, NOW);

    expect(new Set(suggestions.map((item) => item.kind))).toEqual(new Set([
      'contradictory_evidence',
      'incompatible_assumptions',
      'abandoned_commitment',
      'failed_outcome',
      'conflicting_decisions',
    ]));
    expect(suggestions.every((item) =>
      item.route === IntentRoute.Review &&
      item.status === LifecycleStatus.PendingApproval &&
      item.autoResolution === false &&
      item.evidenceEventIds.length > 0
    )).toBe(true);
  });

  it('does not call ordinary incomplete work abandoned before a deadline or after verified success', () => {
    const engine = new ReflectionEngine();
    const active = intent({ deadlines: [{ description: 'Later', at: '2026-07-12T09:00:00.000Z', confidence: 1 }] });
    const completed = intent({ id: 'intent-complete', commitments: [statement('Shipped', 'event-2')] });
    const success = mission({ id: 'mission-success', intentId: completed.id, status: LifecycleStatus.Succeeded });

    const suggestions = engine.reflect({ intents: [active, completed], missions: [success], decisions: [] }, NOW);
    expect(suggestions.filter((item) => item.kind === 'abandoned_commitment')).toEqual([]);
  });
});

describe('scheduled reflection', () => {
  it('runs one pass at a time, publishes suggestions, and stops cleanly', async () => {
    vi.useFakeTimers();
    const publish = vi.fn().mockResolvedValue(undefined);
    const scheduler = new ReflectionScheduler({
      intervalMs: 60_000,
      load: () => ({ intents: [intent({ contradictoryEvidenceEventIds: ['event-conflict'] })], missions: [], decisions: [] }),
      publish,
      clock: () => NOW,
    });
    try {
      await scheduler.start();
      expect(publish).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(publish).toHaveBeenCalledTimes(2);
      await scheduler.stop();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(publish).toHaveBeenCalledTimes(2);
    } finally {
      await scheduler.stop();
      vi.useRealTimers();
    }
  });
});

function statement(text: string, eventId: string) {
  return { text, evidence: [{ eventId }], confidence: 0.9 };
}

function intent(overrides: Partial<IntentEnvelope> = {}): IntentEnvelope {
  return {
    id: 'intent-1', source: 'test', sourceType: SourceType.User,
    kind: IntentKind.Command, summary: 'Complete work', payload: {},
    status: LifecycleStatus.Queued, route: IntentRoute.Project, routeRuleId: 'test',
    entityIds: [], commitments: [], claims: [], assumptions: [], deadlines: [],
    affectedPartyIds: [], requiredEvidence: [{ eventId: 'event-1' }],
    requiredCapabilities: [], ambiguityReasons: [], contradictoryEvidenceEventIds: [],
    risk: RiskLevel.Low, confidence: 0.9,
    provenance: [{ source: 'test', sourceType: SourceType.User, observedAt: NOW }],
    createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

function mission(overrides: Partial<MissionPlan> = {}): MissionPlan {
  return {
    id: 'mission-1', seriesId: 'series-1', version: 1, intentId: 'intent-a',
    title: 'Mission', objective: 'Complete work', status: LifecycleStatus.PendingApproval,
    route: 'human_approval' as MissionPlan['route'], risk: RiskLevel.Low,
    deliverables: [{ id: 'deliverable-1', description: 'Result', artifactType: 'report', required: true }],
    acceptanceTests: [{ id: 'accept-1', description: 'Verified', verification: 'automatic', requiredEvidence: ['event-1'] }],
    evidenceEventIds: ['event-1'], contextSnapshotHash: 'a'.repeat(64), taskGraph: [], selectedAgents: [],
    budget: { maxCostMicroUsd: 1, maxRuntimeMs: 1, maxConcurrency: 1, maxRetriesPerAssignment: 0 },
    permissions: { allowedTools: [], allowedSystems: [], allowedRepositories: [], allowedChannels: [], allowedRecipients: [], allowedCredentialRefs: [], allowedDataScopes: [], allowedMutationClasses: [] },
    rollback: { strategy: 'none', steps: [], verification: 'No mutations' }, escalationConditions: [],
    planHash: 'b'.repeat(64), provenance: [{ source: 'test', sourceType: SourceType.System, observedAt: NOW }],
    createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

function decision(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    id: 'decision-1', decidedBy: 'carlos', outcome: DecisionOutcome.Approved,
    rationale: 'Decision', assumptions: [], evidenceEventIds: ['event-1'],
    route: 'human_approval' as DecisionRecord['route'], risk: RiskLevel.Low,
    decidedAt: NOW, provenance: [{ source: 'test', sourceType: SourceType.User, observedAt: NOW }],
    ...overrides,
  };
}
