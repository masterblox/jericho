# SPEC-16: Vault RAG Search

**Subsystem:** BM25 search over Obsidian vault
**Source:** `/opt/data/scripts/vault-rag.py`
**Target:** `/opt/data/jericho/intel/` cross-reference cache
**Frequency:** Index rebuilt nightly, queries on-demand
**Status:** ✅ ACTIVE — narrow authenticated gateway + scheduled post-sync rebuild

## Integration

### What It Does
- `vault-rag.py index` — rebuilds BM25 index over entire `/opt/brain/` vault
- `vault-rag.py search "query"` — returns top-K matching notes with excerpts
- `cross-pollinate.py` — finds non-obvious connections between topics

### Jericho Wiring
1. Jericho checks vault Git health every ten minutes and triggers one rebuild
   after a newer healthy sync during 01:00–05:00 UTC
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
  "version": 1,
  "cached_queries": {
    "<sha256(query + limit)>": {
      "query": "carlos ai stack", "limit": 5,
      "timestamp": "...", "results": 5, "items": []
    }
  }
}
```

### Verification
- [x] Index rebuild is scheduled after a newer healthy nightly sync
- [x] Search returns bounded structured vault notes through the private gateway
- [x] Cache expires after 24h and is invalidated after index rebuild
