# SPEC-11: Obsidian Vault Sync

**Subsystem:** Obsidian vault → GitHub sync
**Source:** obsidian-git plugin on Carlos's Mac
**Target:** `/opt/data/jericho/state/vault-sync.json`
**Frequency:** ~10-30 minutes (automatic)
**Status:** ✅ ACTIVE

## Integration

### What's Already Working
- Plugin: obsidian-git auto-commits + pushes to `git@github.com:masterblox/jarvis-brain.git`
- Commit author: "Hermes Agent (VPS)"
- Message: `agent: vault sync`
- Syncs full `/opt/brain/` tree

### Jericho Wiring
1. Passive integration — vault sync already works
2. Jericho periodically checks last sync timestamp via `state/vault-sync.json`
3. If last sync >1h ago → alert in fleet health check
4. Sync stats (files changed, size delta) included in morning digest

### State File
```json
{
  "last_sync": "2026-06-27T23:25:00Z",
  "repo": "masterblox/jarvis-brain",
  "status": "healthy",
  "avg_interval_minutes": 20
}
```

### Health Check
```bash
# Check last commit time
git -C /opt/brain log -1 --format=%aI
```

### Verification
- [ ] Commits appearing on GitHub within 30m
- [ ] Jericho detects sync gaps >1h
- [ ] No action needed — passive integration
