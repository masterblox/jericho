import {
  FreshnessStatus,
  IndexLifecycleStatus,
  type IndexVersion,
  type RetrievalCollection,
  type RetrievalMetrics,
  type RetrievalResult,
} from '@jericho/shared';

import type { FleetKnowledgeService } from '../knowledge/fleet-knowledge.js';

export interface RetrievalBenchmarkCase {
  id: string;
  query: string;
  collection: RetrievalCollection;
  expectedSources: string[];
  expectedEvidenceEventIds: string[];
}

export interface VersionedRetrievalPort {
  search(indexId: string, query: string, collection: RetrievalCollection, limit: number): Promise<RetrievalResult[]>;
}

export class RetrievalBenchmarkRunner {
  constructor(
    private readonly knowledge: FleetKnowledgeService,
    private readonly retrieval: VersionedRetrievalPort,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  async evaluate(input: {
    indexId: string;
    collection: RetrievalCollection;
    version: number;
    configurationHash: string;
    supersedesId?: string;
    benchmarkVersion: string;
    cases: RetrievalBenchmarkCase[];
  }): Promise<ReturnType<FleetKnowledgeService['evaluateAndPromote']>> {
    if (!input.cases.length) throw new Error('Retrieval benchmark requires fixed cases');
    const started = performance.now();
    const resultSets: RetrievalResult[][] = [];
    for (const item of input.cases) {
      if (item.collection !== input.collection) continue;
      resultSets.push(await this.retrieval.search(input.indexId, item.query, item.collection, 10));
    }
    if (!resultSets.length) throw new Error('Retrieval benchmark has no cases for the candidate collection');
    const metrics = benchmarkMetrics(
      input.cases.filter((item) => item.collection === input.collection),
      resultSets,
      performance.now() - started,
    );
    const index: IndexVersion = {
      id: input.indexId,
      collection: input.collection,
      version: input.version,
      status: IndexLifecycleStatus.Candidate,
      configurationHash: input.configurationHash,
      metrics,
      createdAt: new Date(this.clock()).toISOString(),
      ...(input.supersedesId ? { supersedesId: input.supersedesId } : {}),
    };
    this.knowledge.recordIndex(index);
    return this.knowledge.evaluateAndPromote(index.id, input.benchmarkVersion);
  }
}

function benchmarkMetrics(
  cases: RetrievalBenchmarkCase[],
  resultSets: RetrievalResult[][],
  totalLatencyMs: number,
): RetrievalMetrics {
  let useful = 0;
  let evidenceHits = 0;
  let evidenceExpected = 0;
  let returned = 0;
  let fresh = 0;
  let duplicates = 0;
  const seen = new Set<string>();
  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index];
    const results = resultSets[index];
    if (results.some((result) => item.expectedSources.some((source) => result.source.includes(source)))) useful += 1;
    for (const result of results) {
      returned += 1;
      if (result.freshness.status !== FreshnessStatus.Stale) fresh += 1;
      if (item.expectedEvidenceEventIds.length) {
        evidenceExpected += 1;
        if (result.evidence.some((selector) => item.expectedEvidenceEventIds.includes(selector.eventId))) evidenceHits += 1;
      }
      const key = `${result.collection}:${result.source}:${result.title}`;
      if (seen.has(key)) duplicates += 1;
      seen.add(key);
    }
  }
  return {
    quality: useful / cases.length,
    freshness: returned ? fresh / returned : 0,
    latencyMs: totalLatencyMs / cases.length,
    duplicateRate: returned ? duplicates / returned : 0,
    contradictionRate: 0,
    evidenceCoverage: evidenceExpected ? evidenceHits / evidenceExpected : 1,
  };
}
