import { readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

import { EmbeddingService, type EmbeddingDocument } from '../retrieval/embeddings.js';

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB per note
const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt', '.markdown']);

export interface VaultIndexerOptions {
  vaultPath: string;
  embeddingIndexPath: string;
  clock?: () => string;
}

/**
 * Builds the TF-IDF embedding index from all notes in the Obsidian vault.
 * Runs on startup and can be triggered manually for re-indexing.
 */
export class VaultIndexer {
  #embeddingService: EmbeddingService;
  #vaultPath: string;

  constructor(options: VaultIndexerOptions) {
    this.#vaultPath = options.vaultPath;
    this.#embeddingService = new EmbeddingService(options.embeddingIndexPath, options.clock);
  }

  /**
   * Scan the vault and build the embedding index.
   * Returns the number of documents indexed.
   */
  async buildIndex(): Promise<{
    documentCount: number;
    vocabularySize: number;
    durationMs: number;
  }> {
    const start = Date.now();
    const documents = this.#scanVault();
    const result = await this.#embeddingService.buildIndex(documents);
    return { ...result, durationMs: Date.now() - start };
  }

  /**
   * Get the underlying embedding service for search.
   */
  get embeddings(): EmbeddingService {
    return this.#embeddingService;
  }

  /**
   * Get index statistics.
   */
  stats() {
    return this.#embeddingService.stats();
  }

  #scanVault(): EmbeddingDocument[] {
    const documents: EmbeddingDocument[] = [];
    this.#walkDir(this.#vaultPath, documents);
    return documents;
  }

  #walkDir(dir: string, documents: EmbeddingDocument[]): void {
    let entries: import('node:fs').Dirent[];
    try {
      const fs = require('node:fs');
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      
      if (entry.isDirectory()) {
        // Skip .obsidian directory
        if (entry.name === '.obsidian' || entry.name === '.git') continue;
        this.#walkDir(fullPath, documents);
        continue;
      }

      if (!entry.isFile()) continue;
      
      const ext = extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

      try {
        const stat = statSync(fullPath);
        if (stat.size > MAX_FILE_SIZE) continue;
        
        const content = readFileSync(fullPath, 'utf8');
        if (!content.trim()) continue;

        const relativePath = relative(this.#vaultPath, fullPath);
        documents.push({
          id: relativePath,
          text: content,
          metadata: {
            path: relativePath,
            size: stat.size,
            lastModified: stat.mtime.toISOString(),
          },
        });
      } catch {
        // Skip unreadable files
      }
    }
  }
}
