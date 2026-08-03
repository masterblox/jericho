import {
  FreshnessStatus,
  RetrievalCollection,
  type EventEnvelope,
  type RetrievalResult,
} from '@jericho/shared';

import type { VaultGatewayPort } from '../vault/vault-gateway-client.js';

export interface RetrievalEvidenceStore {
  listEvents(options?: { source?: string; limit?: number }): EventEnvelope[];
}

export interface SharedKnowledgeSearchPort {
  search(query: string, limit: number, signal: AbortSignal): Promise<Array<{
    title: string; excerpt: string; pageId: string; updatedAt: string; packageId?: string; packageVersion?: number;
  }>>;
}

export class FederatedRetrievalService {
  constructor(
    private readonly store: RetrievalEvidenceStore,
    private readonly vault?: VaultGatewayPort,
    private readonly notion?: SharedKnowledgeSearchPort,
  ) {}

  async search(query: string, collections: RetrievalCollection[], limit = 10): Promise<RetrievalResult[]> {
    const normalized = query.replace(/\s+/gu, ' ').trim();
    if (!normalized || normalized.length > 500 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error('Retrieval query bounds are invalid');
    }
    const signal = new AbortController().signal;
    const results: RetrievalResult[] = [];
    if (collections.includes(RetrievalCollection.PrivateVault) && this.vault) {
      const response = await this.vault.search(normalized, limit, signal);
      results.push(...response.results.map((item) => ({
        collection: RetrievalCollection.PrivateVault,
        title: item.title,
        excerpt: item.excerpt,
        source: item.path,
        evidence: [],
        freshness: { observedAt: new Date().toISOString(), status: FreshnessStatus.Unknown },
        score: item.score,
      })));
    }
    if (collections.includes(RetrievalCollection.CoreEvidence)) {
      const tokens = normalized.toLocaleLowerCase().split(' ');
      results.push(...this.store.listEvents({ limit: 10_000 }).flatMap((event) => {
        const text = JSON.stringify(event.payload);
        const matches = tokens.filter((token) => text.toLocaleLowerCase().includes(token)).length;
        if (!matches) return [];
        return [{
          collection: RetrievalCollection.CoreEvidence,
          title: event.type,
          excerpt: text.slice(0, 500),
          source: event.source,
          evidence: [{ eventId: event.id }],
          freshness: event.freshness ?? { observedAt: event.occurredAt, status: FreshnessStatus.Unknown },
          score: matches / tokens.length,
        } satisfies RetrievalResult];
      }));
    }
    if (collections.includes(RetrievalCollection.SharedNotion) && this.notion) {
      const pages = await this.notion.search(normalized, limit, signal);
      results.push(...pages.map((page) => ({
        collection: RetrievalCollection.SharedNotion,
        ...(page.packageId ? { packageId: page.packageId } : {}),
        ...(page.packageVersion !== undefined ? { packageVersion: page.packageVersion } : {}),
        title: page.title,
        excerpt: page.excerpt,
        source: `notion:${page.pageId}`,
        evidence: [],
        freshness: { observedAt: page.updatedAt, status: FreshnessStatus.Fresh },
        score: 1,
      })));
    }
    return results.sort((left, right) => right.score - left.score || left.source.localeCompare(right.source)).slice(0, limit);
  }
}
