import { describe, expect, it, vi } from 'vitest';

import {
  KnowledgeDestination,
  KnowledgeSensitivity,
  LifecycleStatus,
  ReceiptStatus,
  RetrievalCollection,
  type Assignment,
  type KnowledgePackage,
  type KnowledgeProjection,
  type MissionPlan,
  type MissionTask,
} from '@jericho/shared';

import { NotionProjectionWriter } from '../src/connectors/notion-projection.js';
import { PaperclipExecutor } from '../src/connectors/paperclip-executor.js';
import { FederatedRetrievalService } from '../src/retrieval/federated-retrieval.js';

const NOW = '2026-07-12T00:00:00.000Z';

describe('Paperclip execution projection', () => {
  it('reuses a deterministic issue and never treats Paperclip done as Core verification', async () => {
    const issue = { id: 'issue-1', status: 'done', metadata: {} };
    const findByIdempotencyKey = vi.fn().mockResolvedValue(issue);
    const createIssue = vi.fn();
    const result = await new PaperclipExecutor({ findByIdempotencyKey, createIssue }, () => NOW)
      .reconcile(mission(), task(), assignment());
    expect(result).toMatchObject({ issueId: 'issue-1', status: LifecycleStatus.Active, verifiedByCore: false });
    expect(createIssue).not.toHaveBeenCalled();
  });

  it('pauses safely when Paperclip is unavailable', async () => {
    const result = await new PaperclipExecutor({
      findByIdempotencyKey: vi.fn().mockRejectedValue(new Error('timeout')),
      createIssue: vi.fn(),
    }, () => NOW).reconcile(mission(), task(), assignment());
    expect(result).toMatchObject({ status: LifecycleStatus.Paused, verifiedByCore: false, error: 'timeout' });
  });
});

describe('curated Notion projection', () => {
  it('sends only approved, non-redacted fields and returns a bound receipt', async () => {
    const upsertPage = vi.fn().mockResolvedValue({ pageId: 'page-1' });
    const receipt = await new NotionProjectionWriter({ upsertPage }, () => NOW)
      .write(knowledge(), projection());
    expect(upsertPage).toHaveBeenCalledWith(expect.objectContaining({
      fields: { title: 'Fleet learning', deliverables: ['Verified report'] },
    }), expect.any(AbortSignal));
    expect(receipt).toMatchObject({ status: ReceiptStatus.Succeeded, verified: true, externalId: 'page-1' });
  });

  it('records uncertain writes as pending and does not retry', async () => {
    const upsertPage = vi.fn().mockRejectedValue(new Error('uncertain timeout'));
    const receipt = await new NotionProjectionWriter({ upsertPage }, () => NOW)
      .write(knowledge(), projection());
    expect(receipt).toMatchObject({ status: ReceiptStatus.Pending, verified: false });
    expect(upsertPage).toHaveBeenCalledTimes(1);
  });
});

describe('federated retrieval', () => {
  it('keeps collections and provenance explicit without absolute vault paths', async () => {
    const service = new FederatedRetrievalService(
      { listEvents: () => [{
        id: 'event-1', source: 'core:test', sourceType: 'system', sourceEventId: 'source-1',
        type: 'decision.recorded', occurredAt: NOW, ingestedAt: NOW,
        payload: { summary: 'Fleet decision' }, provenance: [],
      } as any] },
      { search: vi.fn().mockResolvedValue({ cached: false, results: [{ path: 'Projects/Fleet.md', title: 'Fleet', excerpt: 'Learning system', score: 0.8 }] }) } as any,
    );
    const results = await service.search('fleet', [RetrievalCollection.PrivateVault, RetrievalCollection.CoreEvidence]);
    expect(results.map((item) => item.collection)).toEqual(expect.arrayContaining([
      RetrievalCollection.PrivateVault, RetrievalCollection.CoreEvidence,
    ]));
    expect(JSON.stringify(results)).not.toContain('/Users/');
    expect(results.find((item) => item.collection === RetrievalCollection.CoreEvidence)?.evidence).toEqual([{ eventId: 'event-1' }]);
  });
});

function mission(): MissionPlan {
  return { id: 'mission-1', planHash: 'a'.repeat(64), version: 1, status: LifecycleStatus.Approved } as MissionPlan;
}

function task(): MissionTask {
  return { id: 'task-1', missionId: 'mission-1', title: 'Bounded task' } as MissionTask;
}

function assignment(): Assignment {
  return { id: 'assignment-1', missionId: 'mission-1', missionTaskId: 'task-1', status: LifecycleStatus.Active } as Assignment;
}

function knowledge(): KnowledgePackage {
  return {
    id: 'knowledge-1', version: 1, packageHash: 'b'.repeat(64), missionId: 'mission-1', planHash: 'a'.repeat(64),
    title: 'Fleet learning', objective: 'Private objective', classification: ['verified-mission'],
    sensitivity: KnowledgeSensitivity.Private, retentionPolicy: 'verified-mission-v1',
    deliverables: ['Verified report'], outcomeTaskIds: ['task-1'], decisionIds: [], receiptIds: [],
    decisions: [], outcomes: [{ taskId: 'task-1', status: 'succeeded', completedAt: NOW }], receipts: [],
    evidence: [{ eventId: 'event-1' }], createdAt: NOW, completedAt: NOW,
  };
}

function projection(): KnowledgeProjection {
  return {
    id: 'projection-1', packageId: 'knowledge-1', packageHash: 'b'.repeat(64),
    destination: KnowledgeDestination.Notion, status: LifecycleStatus.Approved,
    approvedFieldNames: ['title', 'objective', 'deliverables'], redactedFieldNames: ['objective'],
    createdAt: NOW, approvedAt: NOW,
  };
}
