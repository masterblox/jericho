import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const SOURCE = 'jericho:embeddings-v1';
const MAX_VOCAB_SIZE = 50_000;
const MAX_DOCUMENTS = 10_000;
const MIN_DF = 2; // Minimum document frequency for a term to be included

export interface EmbeddingDocument {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface EmbeddingIndex {
  version: 1;
  dimension: number;
  vocabulary: Map<string, number>; // term -> index
  idf: Float64Array; // inverse document frequency per term
  documents: Array<{
    id: string;
    tfidf: Map<number, number>; // term index -> tfidf weight
    magnitude: number; // L2 norm for cosine similarity
    metadata?: Record<string, unknown>;
  }>;
  createdAt: string;
}

export interface EmbeddingSearchResult {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/**
 * Lightweight embedding service using TF-IDF with cosine similarity.
 * This provides semantic-like search without requiring a GPU or external model.
 * 
 * For production use with better semantic understanding, this can be swapped
 * for a real embedding model (e.g., nomic-embed, bge-small) via the
 * EmbeddingProvider interface.
 */
export class EmbeddingService {
  #indexPath: string;
  #clock: () => string;

  constructor(indexPath: string, clock?: () => string) {
    this.#indexPath = indexPath;
    this.#clock = clock ?? (() => new Date().toISOString());
  }

  /**
   * Build or update the embedding index from documents.
   */
  async buildIndex(documents: EmbeddingDocument[]): Promise<{
    documentCount: number;
    vocabularySize: number;
  }> {
    const docs = documents.slice(0, MAX_DOCUMENTS);
    
    // Build vocabulary and document frequencies
    const vocabulary = new Map<string, number>();
    const docFreq = new Map<string, number>();
    const tokenizedDocs: Array<{ id: string; tokens: string[]; metadata?: Record<string, unknown> }> = [];

    for (const doc of docs) {
      const tokens = tokenize(doc.text);
      const uniqueTokens = new Set(tokens);
      tokenizedDocs.push({ id: doc.id, tokens, metadata: doc.metadata });

      for (const token of uniqueTokens) {
        docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
      }
    }

    // Build vocabulary (filter by document frequency)
    const sortedTerms = [...docFreq.entries()]
      .filter(([, df]) => df >= MIN_DF)
      .sort((a, b) => b[1] - a[1]) // Sort by frequency descending
      .slice(0, MAX_VOCAB_SIZE);

    for (let i = 0; i < sortedTerms.length; i++) {
      vocabulary.set(sortedTerms[i][0], i);
    }

    const vocabSize = vocabulary.size;
    const N = docs.length;

    // Compute IDF
    const idf = new Float64Array(vocabSize);
    for (const [term, idx] of vocabulary) {
      const df = docFreq.get(term) ?? 0;
      idf[idx] = Math.log((N + 1) / (df + 1)) + 1; // Smoothed IDF
    }

    // Compute TF-IDF vectors
    const indexedDocs: EmbeddingIndex['documents'] = [];
    for (const doc of tokenizedDocs) {
      const tf = new Map<number, number>();
      const termCounts = new Map<number, number>();

      for (const token of doc.tokens) {
        const idx = vocabulary.get(token);
        if (idx !== undefined) {
          termCounts.set(idx, (termCounts.get(idx) ?? 0) + 1);
        }
      }

      const maxCount = Math.max(...termCounts.values(), 1);
      let magnitude = 0;

      for (const [idx, count] of termCounts) {
        const tfidf = (count / maxCount) * idf[idx];
        tf.set(idx, tfidf);
        magnitude += tfidf * tfidf;
      }

      magnitude = Math.sqrt(magnitude);
      indexedDocs.push({
        id: doc.id,
        tfidf: tf,
        magnitude,
        metadata: doc.metadata,
      });
    }

    const index: EmbeddingIndex = {
      version: 1,
      dimension: vocabSize,
      vocabulary,
      idf,
      documents: indexedDocs,
      createdAt: this.#clock(),
    };

    this.#writeIndex(index);
    return { documentCount: indexedDocs.length, vocabularySize: vocabSize };
  }

  /**
   * Search the index using cosine similarity.
   */
  search(query: string, limit: number = 5): EmbeddingSearchResult[] {
    const index = this.#readIndex();
    if (!index) return [];

    const queryTokens = tokenize(query);
    const queryVector = new Map<number, number>();
    const queryCounts = new Map<number, number>();

    for (const token of queryTokens) {
      const idx = index.vocabulary.get(token);
      if (idx !== undefined) {
        queryCounts.set(idx, (queryCounts.get(idx) ?? 0) + 1);
      }
    }

    const maxCount = Math.max(...queryCounts.values(), 1);
    let queryMagnitude = 0;

    for (const [idx, count] of queryCounts) {
      const tfidf = (count / maxCount) * index.idf[idx];
      queryVector.set(idx, tfidf);
      queryMagnitude += tfidf * tfidf;
    }

    queryMagnitude = Math.sqrt(queryMagnitude);
    if (queryMagnitude === 0) return [];

    // Compute cosine similarity with all documents
    const results: EmbeddingSearchResult[] = [];
    for (const doc of index.documents) {
      let dotProduct = 0;
      for (const [idx, weight] of queryVector) {
        const docWeight = doc.tfidf.get(idx);
        if (docWeight !== undefined) {
          dotProduct += weight * docWeight;
        }
      }

      const similarity = dotProduct / (queryMagnitude * doc.magnitude);
      if (similarity > 0.01) { // Minimum similarity threshold
        results.push({
          id: doc.id,
          score: similarity,
          metadata: doc.metadata,
        });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Get index statistics.
   */
  stats(): { documentCount: number; vocabularySize: number; createdAt: string } | null {
    const index = this.#readIndex();
    if (!index) return null;
    return {
      documentCount: index.documents.length,
      vocabularySize: index.dimension,
      createdAt: index.createdAt,
    };
  }

  #readIndex(): EmbeddingIndex | null {
    try {
      if (!existsSync(this.#indexPath)) return null;
      const data = JSON.parse(readFileSync(this.#indexPath, 'utf8'));
      return {
        version: data.version,
        dimension: data.dimension,
        vocabulary: new Map(Object.entries(data.vocabulary)),
        idf: Float64Array.from(data.idf),
        documents: data.documents.map((doc: Record<string, unknown>) => ({
          id: doc.id as string,
          tfidf: new Map(Object.entries(doc.tfidf as Record<string, number>)),
          magnitude: doc.magnitude as number,
          metadata: doc.metadata as Record<string, unknown> | undefined,
        })),
        createdAt: data.createdAt,
      };
    } catch {
      return null;
    }
  }

  #writeIndex(index: EmbeddingIndex): void {
    mkdirSync(dirname(this.#indexPath), { recursive: true, mode: 0o700 });
    const data = {
      version: index.version,
      dimension: index.dimension,
      vocabulary: Object.fromEntries(index.vocabulary),
      idf: Array.from(index.idf),
      documents: index.documents.map((doc) => ({
        id: doc.id,
        tfidf: Object.fromEntries(doc.tfidf),
        magnitude: doc.magnitude,
        metadata: doc.metadata,
      })),
      createdAt: index.createdAt,
    };
    const temporary = `${this.#indexPath}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.#indexPath);
  }
}

/**
 * Tokenize text into normalized terms.
 * Simple whitespace + lowercase + stemming-ready tokenization.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/gu, ' ')
    .split(/\s+/u)
    .filter((token) => token.length > 1 && token.length < 50);
}

/**
 * Compute hash for embedding cache keys.
 */
function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
