# SPEC-13: Memory Cross-Sync

**Subsystem:** Cross-agent memory synchronization
**Source:** Agent memory stores (DEV, PA, Iris)
**Target:** Future: multi-profile memory sync
**Frequency:** Per-turn (within agent), future: cross-agent
**Status:** N/A — single profile only

## Integration

### Current State
- Only DEV profile (`default`) is active
- PA and Iris have vault memory but no Hermes runtime
- Memory enabled: `memory_enabled: true`, `user_profile_enabled: true`
- No cross-profile sync needed yet

### Future: When Multi-Profile
When PA and Iris get their own Hermes runtimes:
1. Each agent writes memory to its own profile
2. Jericho maintains a cross-reference index in `state/memory-index.json`
3. Shared facts (people, projects, decisions) synced via vault
4. Agent-specific facts stay in profile memory

### Cross-Reference Schema
```json
{
  "shared_facts": {
    "people": {"source": "PA", "last_sync": "..."},
    "projects": {"source": "DEV", "last_sync": "..."},
    "decisions": {"source": "DEV+PA", "last_sync": "..."}
  }
}
```

### Verification
- [ ] No action needed — scaffold only
- [ ] Revisit when PA/Iris runtimes are live
