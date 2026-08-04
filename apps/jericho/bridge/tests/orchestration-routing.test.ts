import { describe, expect, it } from 'vitest';

import {
  AgentLane,
  IntentKind,
  IntentRoute,
  RiskLevel,
  SourceType,
  type ClassificationDraft,
  type EventEnvelope,
} from '@jericho/shared';

import { classifyEvent } from '../src/orchestration/classifier.js';
import { routeIntent, selectAgentLane } from '../src/orchestration/router.js';

const occurredAt = '2026-07-11T00:00:00.000Z';

describe('read-only intent classification', () => {
  it('extracts evidence-backed intent fields without mutating the source event', () => {
    const event = makeEvent({
      payload: {
        text: 'Reply to Paula by 2026-07-12T09:00:00.000Z and confirm the proposal.',
        entityIds: ['person-paula'],
        expectedOutcome: 'Paula receives a confirmed proposal',
        commitments: ['Confirm the proposal'],
        claims: ['Paula is waiting'],
        assumptions: ['The quoted price is current'],
        deadlines: [
          {
            description: 'Reply to Paula',
            at: '2026-07-12T09:00:00.000Z',
            confidence: 0.98,
          },
        ],
        affectedPartyIds: ['person-paula'],
        requiredCapabilities: ['reply.telegram'],
      },
    });
    const before = structuredClone(event);

    const result = classifyEvent(event);

    expect(event).toEqual(before);
    expect(result).toMatchObject({
      kind: IntentKind.Command,
      summary: expect.stringContaining('Reply to Paula'),
      suggestedRoute: IntentRoute.Reply,
      entityIds: ['person-paula'],
      expectedOutcome: 'Paula receives a confirmed proposal',
      affectedPartyIds: ['person-paula'],
      requiredCapabilities: ['reply.telegram'],
    });
    expect(result.commitments[0]).toMatchObject({
      text: 'Confirm the proposal',
      evidence: [{ eventId: 'evt-1' }],
    });
    expect(result.claims[0].confidence).toBeGreaterThan(0);
    expect(result.assumptions[0].evidence[0].eventId).toBe('evt-1');
    expect(result.deadlines[0].at).toBe('2026-07-12T09:00:00.000Z');
    expect('status' in result).toBe(false);
  });

  it('clamps provider confidence to the shared zero-to-one contract', () => {
    expect(classifyEvent(makeEvent(), { confidence: 4 }).confidence).toBe(1);
    expect(classifyEvent(makeEvent(), { confidence: -2 }).confidence).toBe(0);
  });
});

describe('deterministic routing', () => {
  it.each([
    [0.64, [], RiskLevel.Low, [], IntentRoute.Review, 'confidence'],
    [0.99, ['evt-conflict'], RiskLevel.Low, [], IntentRoute.Review, 'contradiction'],
    [0.99, [], RiskLevel.High, ['Recipient is unclear'], IntentRoute.Review, 'high-risk-ambiguity'],
  ])(
    'routes review for policy gate %#',
    (confidence, contradictoryEvidenceEventIds, risk, ambiguityReasons, route, reason) => {
      const decision = routeIntent(
        draft({ confidence, contradictoryEvidenceEventIds, risk, ambiguityReasons }),
      );
      expect(decision.route).toBe(route);
      expect(decision.ruleId).toContain(reason);
    },
  );

  it('chooses exactly one primary route and lets established ownership override a suggestion', () => {
    const decision = routeIntent(
      draft({
        kind: IntentKind.Preference,
        suggestedRoute: IntentRoute.Project,
        requiredCapabilities: ['memory.preference'],
      }),
    );

    expect(decision).toMatchObject({
      route: IntentRoute.Knowledge,
      lane: AgentLane.Angela,
      ruleId: 'ownership:preference-knowledge',
    });
    expect(Object.values(IntentRoute)).toEqual([
      'reply',
      'action',
      'project',
      'knowledge',
      'signal',
      'review',
    ]);
  });

  it.each([
    [['code.repo', 'linear.issue', 'ci.verify'], AgentLane.Dev],
    [['calendar.schedule', 'inbox.triage'], AgentLane.Angela],
    [['sales.crm', 'outreach.reply'], AgentLane.Donald],
    [['design.visual'], AgentLane.Iris],
    [['research.evidence'], AgentLane.Researcher],
    [['analysis.synthesis'], AgentLane.Analyst],
  ])('maps capability ownership %j to %s', (capabilities, expected) => {
    expect(selectAgentLane(capabilities)).toBe(expected);
  });
});

function makeEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    id: 'evt-1',
    source: 'telegram-gateway',
    sourceType: SourceType.Connector,
    sourceEventId: 'message-1',
    type: 'message.received',
    occurredAt,
    ingestedAt: '2026-07-11T00:00:01.000Z',
    payload: { text: 'Review today' },
    risk: RiskLevel.Low,
    confidence: 0.9,
    provenance: [
      {
        source: 'telegram-gateway',
        sourceType: SourceType.Connector,
        sourceEventId: 'message-1',
        observedAt: occurredAt,
      },
    ],
    ...overrides,
  };
}

function draft(overrides: Partial<ClassificationDraft> = {}): ClassificationDraft {
  return {
    kind: IntentKind.Command,
    summary: 'Complete the work',
    suggestedRoute: IntentRoute.Project,
    entityIds: [],
    commitments: [],
    claims: [],
    assumptions: [],
    deadlines: [],
    affectedPartyIds: [],
    requiredEvidence: [],
    requiredCapabilities: ['code.repo'],
    ambiguityReasons: [],
    contradictoryEvidenceEventIds: [],
    risk: RiskLevel.Low,
    confidence: 0.9,
    ...overrides,
  };
}
