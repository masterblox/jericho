# SPEC-02: Nightly Vault Processor

**Subsystem:** Nightly vault processing
**Source:** `/opt/data/scripts/nightly-vault-processor.py`
**Target:** `/opt/data/jericho/inbox/nightly/{date}.md`
**Frequency:** Daily, 23:00 UTC
**Status:** Script exists, not scheduled

## Integration

### What It Produces
4-pass processor:
1. Inbox filing recommendations (unprocessed vault inbox → suggested folders)
2. Vault health check (orphans, stale projects, broken tags/links)
3. BM25 RAG index rebuild
4. Meeting auto-process (raw → structured markdown)

### Jericho Wiring
1. Cron job invokes `nightly-vault-processor.py`
2. Output captured to `inbox/nightly/{date}.md`
3. Jericho reads it during next morning synthesis
4. Orphan/stale alerts escalated to Carlos if >threshold

### Cron Config
```yaml
schedule: "0 23 * * *"
script: /opt/data/scripts/nightly-vault-processor.py
output: /opt/data/jericho/inbox/nightly/{date}.md
```

### Alert Thresholds
- Orphans: >5 → warning in morning digest
- Stale projects: >30d no activity → listed in weekly review
- Broken links: any → immediate alert via `inbox/realtime/vault-errors.json`

### Verification
- [ ] Runs at 23:00 UTC
- [ ] RAG index timestamp updated in `state/vault.json`
- [ ] Orphan/stale counts visible in next morning digest
