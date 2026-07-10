# SPEC-16: Vault RAG Search

**Subsystem:** BM25 search over Obsidian vault
**Source:** `/opt/data/scripts/vault-rag.py`
**Target:** `/opt/data/jericho/intel/` cross-reference cache
**Frequency:** Index rebuilt nightly, queries on-demand
**Status:** Script exists, on-demand only

## Integration

### What It Does
- `vault-rag.py index` — rebuilds BM25 index over entire `/opt/brain/` vault
- `vault-rag.py search "query"` — returns top-K matching notes with excerpts
- `cross-pollinate.py` — finds non-obvious connections between topics

### Jericho Wiring
1. Nightly vault processor triggers index rebuild
2. RAG available for on-demand queries
3. Jericho uses RAG for:
   - Cross-referencing people across notes
   - Finding evidence for argument-builder
   - Context injection for agent tasks
4. Query results cached in `intel/` for 24h

### Integration Points
- **Morning synthesis:** RAG search for key people/mentions in last 24h
- **Argument builder:** RAG search for supporting evidence
- **Cross-pollinate:** RAG to find wikilink connections

### Cache Schema
```json
// intel/rag-cache.json
{
  "last_index": "2026-06-27T23:00:00Z",
  "index_size_mb": 12.4,
  "cached_queries": {
    "carlos-ai-stack": {"timestamp": "...", "results": 5},
    "mechanica-brand": {"timestamp": "...", "results": 12}
  }
}
```

### Verification
- [ ] Index rebuilt nightly
- [ ] Search returns relevant vault notes
- [ ] Cache invalidated after index rebuild
