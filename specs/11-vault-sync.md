# SPEC-11: Obsidian Vault Sync

**Subsystem:** Obsidian vault → GitHub sync
**Source:** obsidian-git plugin on Carlos's Mac
**Target:** Existing Jericho connector-health records
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
2. Jericho periodically reads the last commit timestamp through the narrow vault gateway
3. If last sync >1h ago → alert in fleet health check
4. Sync stats (files changed, size delta) included in morning digest

Health is retained through the existing connector-health interface with
privacy-safe timestamps, age, index metadata, and a stable reason code.

### Health Check
```bash
# Check last commit time
git -C /opt/brain log -1 --format=%aI
```

### Verification
- [ ] Commits appearing on GitHub within 30m (live deployment check)
- [x] Jericho detects sync gaps >1h
- [x] No mutation action is taken — sync remains passive
