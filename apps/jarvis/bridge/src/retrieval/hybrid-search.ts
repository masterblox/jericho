import { EmbeddingService, type EmbeddingSearchResult } from './embeddings.js';

export interface HybridSearchConfig {
  bm25Weight: number;   // Weight for BM25 results (0-1)
  embeddingWeight: number; // Weight for embedding results (0-1)
  maxResults: number;
  minScore: number;
}

export interface SearchResult {
  id: string;
  title: string;
  excerpt: string;
  bm25Score: number;
  embeddingScore: number;
  combinedScore: number;
  source: 'bm25' | 'embedding' | 'hybrid';
  metadata?: Record<string, unknown>;
}

export interface BM25SearchPort {
  search(query: string, limit: number): Promise<Array<{
    path: string;
    title: string;
    excerpt: string;
    score: number;
  }>>;
}

/**
 * Hybrid search service combining BM25 (keyword) and embedding (semantic) search.
 * 
 * BM25 excels at exact keyword matching and rare term identification.
 * Embeddings excel at semantic similarity and handling synonyms/paraphrases.
 * 
 * The combined score is: α * bm25_score + (1-α) * embedding_score
 * where α is the bm25Weight (default 0.6).
 */
export class HybridSearchService {
  #bm25: BM25SearchPort;
  #embeddings: EmbeddingService;
  #config: HybridSearchConfig;

  constructor(
    bm25: BM25SearchPort,
    embeddings: EmbeddingService,
    config?: Partial<HybridSearchConfig>,
  ) {
    this.#bm25 = bm25;
    this.#embeddings = embeddings;
    this.#config = {
      bm25Weight: config?.bm25Weight ?? 0.6,
      embeddingWeight: config?.embeddingWeight ?? 0.4,
      maxResults: config?.maxResults ?? 10,
      minScore: config?.minScore ?? 0.05,
    };
  }

  /**
   * Perform hybrid search combining BM25 and embedding results.
   */
  async search(
    query: string,
    limit: number = 10,
  ): Promise<SearchResult[]> {
    const maxResults = Math.min(limit, this.#config.maxResults);

    // Run both searches in parallel
    const [bm25Results, embeddingResults] = await Promise.all([
      this.#bm25.search(query, maxResults * 2).catch(() => []),
      Promise.resolve(this.#embeddings.search(query, maxResults * 2)),
    ]);

    // Normalize scores to [0, 1] range
    const normalizedBM25 = normalizeScores(bm25Results.map((r) => r.score));
    const normalizedEmbedding = normalizeScores(embeddingResults.map((r) => r.score));

    // Create a map of document ID -> results from each source
    const bm25Map = new Map<string, { title: string; excerpt: string; normalizedScore: number; originalScore: number }>();
    bm25Results.forEach((result, idx) => {
      bm25Map.set(result.path, {
        title: result.title,
        excerpt: result.excerpt,
        normalizedScore: normalizedBM25[idx],
        originalScore: result.score,
      });
    });

    const embeddingMap = new Map<string, { normalizedScore: number; originalScore: number; metadata?: Record<string, unknown> }>();
    embeddingResults.forEach((result, idx) => {
      embeddingMap.set(result.id, {
        normalizedScore: normalizedEmbedding[idx],
        originalScore: result.score,
        metadata: result.metadata,
      });
    });

    // Merge results
    const allIds = new Set([...bm25Map.keys(), ...embeddingMap.keys()]);
    const combined: SearchResult[] = [];

    for (const id of allIds) {
      const bm25 = bm25Map.get(id);
      const embedding = embeddingMap.get(id);

      const bm25Score = bm25?.normalizedScore ?? 0;
      const embeddingScore = embedding?.normalizedScore ?? 0;

      const combinedScore =
        this.#config.bm25Weight * bm25Score +
        this.#config.embeddingWeight * embeddingScore;

      if (combinedScore < this.#config.minScore) continue;

      // Determine source
      let source: 'bm25' | 'embedding' | 'hybrid';
      if (bm25 && embedding) source = 'hybrid';
      else if (bm25) source = 'bm25';
      else source = 'embedding';

      combined.push({
        id,
        title: bm25?.title ?? id.split('/').pop()?.replace(/\.md$/u, '') ?? id,
        excerpt: bm25?.excerpt ?? '',
        bm25Score: bm25?.originalScore ?? 0,
        embeddingScore: embedding?.originalScore ?? 0,
        combinedScore,
        source,
        metadata: embedding?.metadata,
      });
    }

    // Sort by combined score and return top results
    return combined
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, maxResults);
  }

  /**
   * Get search statistics.
   */
  stats(): {
    bm25: { available: boolean };
    embeddings: { documentCount: number; vocabularySize: number } | null;
    config: HybridSearchConfig;
  } {
    return {
      bm25: { available: true },
      embeddings: this.#embeddings.stats(),
      config: { ...this.#config },
    };
  }
}

/**
 * Normalize scores to [0, 1] range using min-max normalization.
 */
function normalizeScores(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min;
  if (range === 0) return scores.map(() => 1);
  return scores.map((score) => (score - min) / range);
}
