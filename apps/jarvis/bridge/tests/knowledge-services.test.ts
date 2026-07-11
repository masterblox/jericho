import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DecisionOutcome,
  IntentKind,
  IntentRoute,
  LifecycleStatus,
  ReceiptStatus,
  RiskLevel,
  RouteType,
  SourceType,
  type ActionReceipt,
  type DecisionRecord,
  type IntentEnvelope,
  type MissionPlan,
  type MissionTask,
} from '@jericho/shared';

import { JerichoStore } from '../src/core/store.js';
import {
  MissionKnowledgeRetentionService,
  ReflectionReviewService,
  type MissionKnowledgeStore,
} from '../src/retention/knowledge-services.js';
import { KnowledgeRuntime } from '../src/retention/knowledge-runtime.js';
import { ObsidianRetentionWriter } from '../src/retention/obsidian-writer.js';

const NOW = '2026-07-11T07:00:00.000Z';
const directories: string[] = [];
const stores: JerichoStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('mission knowledge retention service', () => {
  it('projects only verified summaries into Obsidian and excludes artifact bodies', () => {
    const vault = temporaryDirectory();
    const mission = completedMission();
    const retainedEvents = new Map<string, Parameters<MissionKnowledgeStore['appendEvent']>[0]>();
    const appendEvent = vi.fn((event: Parameters<MissionKnowledgeStore['appendEvent']>[0]) => {
      retainedEvents.set(event.id, event);
    });
    const service = new MissionKnowledgeRetentionService(
      { ...knowledgeStore(mission), appendEvent, getEvent: (id) => retainedEvents.get(id) },
      new ObsidianRetentionWriter({ vaultPath: vault }),
      () => '2026-07-11T07:05:00.000Z',
    );

    const retained = service.retainMission(mission.id);
    const note = readFileSync(retained.absolutePath, 'utf8');

    expect(retained.status).toBe('created');
    expect(note).toContain('Verified report');
    expect(note).toContain('telegram:message → person-paula');
    expect(note).not.toContain('private artifact body');
    expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({
      source: 'jericho:retention', sourceType: SourceType.System,
      sourceEventId: `retention:${mission.id}:${mission.planHash}`,
      type: 'jericho.retention.completed',
      occurredAt: '2026-07-11T07:05:00.000Z',
      payload: {
        missionId: mission.id, planHash: mission.planHash,
        relativePath: retained.relativePath, status: retained.status,
      },
    }));
    expect(service.retainMission(mission.id).status).toBe('unchanged');
    expect(appendEvent).toHaveBeenCalledTimes(1);
  });

  it('rejects incomplete tasks and unverified external receipts', () => {
    const mission = completedMission();
    const vault = temporaryDirectory();
    const task = completedTask();
    task.status = LifecycleStatus.Active;
    expect(() => new MissionKnowledgeRetentionService(
      knowledgeStore(mission, { tasks: [task] }),
      new ObsidianRetentionWriter({ vaultPath: vault }),
    ).retainMission(mission.id)).toThrow(/verified mission tasks/i);

    const receipt = verifiedReceipt();
    receipt.verified = false;
    expect(() => new MissionKnowledgeRetentionService(
      knowledgeStore(mission, { receipts: [receipt] }),
      new ObsidianRetentionWriter({ vaultPath: vault }),
    ).retainMission(mission.id)).toThrow(/verified external receipts/i);
  });
});

describe('reflection review publication', () => {
  it('persists deterministic pending proposals and never auto-resolves them', () => {
    const store = new JerichoStore({ path: ':memory:', key: Buffer.alloc(32, 41) });
    stores.push(store);
    store.saveIntent(intent());
    const service = new ReflectionReviewService(store);

    const first = service.runOnce(NOW);
    const replay = service.runOnce('2026-07-11T08:00:00.000Z');

    expect(first).toHaveLength(1);
    expect(replay).toHaveLength(1);
    expect(store.listProposals()).toHaveLength(1);
    expect(store.listProposals()[0]).toMatchObject({
      id: first[0].id,
      status: LifecycleStatus.PendingApproval,
      route: RouteType.HumanApproval,
      body: { autoResolution: false, kind: 'contradictory_evidence' },
    });
    expect(store.listDecisions()).toEqual([]);
    expect(store.listChangeLog({ afterSequence: 0 })).toContainEqual(
      expect.objectContaining({
        kind: 'proposal_changed', recordType: 'proposal', recordId: first[0].id,
      }),
    );
  });

  it('runs at startup on a review-only schedule without requiring an Obsidian vault', async () => {
    const store = new JerichoStore({ path: ':memory:', key: Buffer.alloc(32, 42) });
    stores.push(store);
    store.saveIntent(intent());
    const runtime = new KnowledgeRuntime({
      store,
      reflectionIntervalMs: 60 * 60 * 1_000,
      clock: () => NOW,
    });

    try {
      await runtime.start();
      expect(runtime.retention).toBeUndefined();
      expect(store.listProposals()).toHaveLength(1);
      expect(store.listProposals()[0]).toMatchObject({
        body: { autoResolution: false },
        status: LifecycleStatus.PendingApproval,
      });
      expect(store.listDecisions()).toEqual([]);
    } finally {
      await runtime.stop();
    }
  });
});

function knowledgeStore(
  mission: MissionPlan,
  overrides: { tasks?: MissionTask[]; receipts?: ActionReceipt[] } = {},
): MissionKnowledgeStore {
  const tasks = overrides.tasks ?? [completedTask()];
  const receipts = overrides.receipts ?? [verifiedReceipt()];
  return {
    getMission: (id) => id === mission.id ? mission : undefined,
    listMissionTasks: () => tasks,
    listReceipts: () => receipts,
    listDecisions: () => [decision()],
    appendEvent: () => undefined,
    getEvent: () => undefined,
  };
}

function completedMission(): MissionPlan {
  return {
    id: 'mission-1', seriesId: 'series-1', version: 1, intentId: 'intent-1',
    title: 'Verified report', objective: 'Ship a verified report',
    status: LifecycleStatus.Succeeded, route: RouteType.HumanApproval, risk: RiskLevel.Low,
    deliverables: [{ id: 'deliverable-1', description: 'Verified report', artifactType: 'report', required: true }],
    acceptanceTests: [{ id: 'accept-1', description: 'Evidence exists', verification: 'automatic', requiredEvidence: ['verification'] }],
    evidenceEventIds: ['event-request'], contextSnapshotHash: 'a'.repeat(64), taskGraph: [], selectedAgents: [],
    budget: { maxCostMicroUsd: 1, maxRuntimeMs: 1, maxConcurrency: 1, maxRetriesPerAssignment: 0 },
    permissions: { allowedTools: [], allowedSystems: [], allowedRepositories: [], allowedChannels: [], allowedRecipients: [], allowedCredentialRefs: [], allowedDataScopes: [], allowedMutationClasses: [] },
    rollback: { strategy: 'none', steps: [], verification: 'No mutations' }, escalationConditions: [],
    planHash: 'b'.repeat(64), approvalDecisionId: 'decision-1', approvedAt: NOW, completedAt: NOW,
    provenance: provenance(), createdAt: NOW, updatedAt: NOW,
  };
}

function completedTask(): MissionTask {
  return {
    id: 'task-1', missionId: 'mission-1', kind: 'analyze' as MissionTask['kind'],
    title: 'Analyze', status: LifecycleStatus.Succeeded, route: RouteType.Agent,
    risk: RiskLevel.Low, sequence: 0, lane: 'analyst' as MissionTask['lane'],
    selectedAgentId: 'Analyst', capabilityIds: ['analyst-v1'], requiredActions: [],
    requiredTools: [], model: 'local', maxTokens: 1,
    writableScope: { allowedTools: [], allowedSystems: [], allowedRepositories: [], allowedChannels: [], allowedRecipients: [], allowedCredentialRefs: [], allowedDataScopes: [], allowedMutationClasses: [] },
    requiredCapabilities: ['analyst-v1'], dependsOn: [], evidenceEventIds: ['event-request'],
    expectedArtifact: { type: 'report', description: 'Report', verification: ['verified'], requiredEvidence: ['verification'] },
    input: {}, estimatedCostMicroUsd: 1,
    output: {
      type: 'report', data: { secret: 'private artifact body' }, verified: true,
      verifierId: 'verifier-1', checks: ['verified'],
      evidence: [{ eventId: 'event-verification', selector: 'verification' }],
    },
    provenance: provenance(), createdAt: NOW, updatedAt: NOW, completedAt: NOW,
  };
}

function verifiedReceipt(): ActionReceipt {
  return {
    id: 'receipt-1', missionTaskId: 'task-1', connectorId: 'telegram', action: 'message',
    idempotencyKey: 'receipt-key', destination: 'person-paula', status: ReceiptStatus.Succeeded,
    route: RouteType.Connector, risk: RiskLevel.Low, requestedAt: NOW, completedAt: NOW,
    externalId: 'message-1', verified: true, verifiedAt: NOW,
    evidenceEventIds: ['event-receipt'], attempt: 1, provenance: provenance(),
  };
}

function decision(): DecisionRecord {
  return {
    id: 'decision-1', missionId: 'mission-1', decidedBy: 'carlos',
    outcome: DecisionOutcome.Approved, rationale: 'Approved bounded plan', assumptions: [],
    evidenceEventIds: ['event-request'], route: RouteType.HumanApproval, risk: RiskLevel.Low,
    decidedAt: NOW, provenance: provenance(),
  };
}

function intent(): IntentEnvelope {
  return {
    id: 'intent-reflect', source: 'local:manual', sourceType: SourceType.User,
    kind: IntentKind.Command, summary: 'Review contradiction', payload: {},
    status: LifecycleStatus.PendingApproval, route: IntentRoute.Review,
    routeRuleId: 'safety:contradiction', entityIds: [], commitments: [], claims: [], assumptions: [],
    deadlines: [], affectedPartyIds: [], requiredEvidence: [{ eventId: 'event-a' }],
    requiredCapabilities: [], ambiguityReasons: [], contradictoryEvidenceEventIds: ['event-b'],
    risk: RiskLevel.Medium, confidence: 0.9, provenance: provenance(), createdAt: NOW, updatedAt: NOW,
  };
}

function provenance() {
  return [{ source: 'test', sourceType: SourceType.System, observedAt: NOW }];
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'jericho-knowledge-'));
  directories.push(directory);
  return directory;
}
