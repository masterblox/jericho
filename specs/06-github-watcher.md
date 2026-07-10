# SPEC-06: GitHub PR Watcher

**Subsystem:** GitHub pull request monitoring
**Source:** `/opt/data/scripts/github-pr-watcher.py`
**Target:** `/opt/data/jericho/inbox/realtime/github-{timestamp}.json`
**Frequency:** Every 30 minutes
**Status:** Script exists, not scheduled

## Integration

### What It Monitors
- Open PRs across tracked repos
- CI status (green/red/running)
- Review status (approved/changes requested/pending)
- Merge conflicts
- Stale PRs (>3d no activity)

### Tracked Repos
- Mechanica-Labs/launchrail
- Mechanica-Labs/architect-ai
- Mechanica-Labs/memories-express-mvp-cp
- masterblox/hermes (if active)

### Jericho Wiring
1. Cron every 30m runs `github-pr-watcher.py`
2. Output: JSON with PR states, deltas
3. Jericho includes in morning digest if changes detected
4. Red CI or merge conflicts: flagged in digest

### Cron Config
```yaml
schedule: "*/30 * * * *"
script: /opt/data/scripts/github-pr-watcher.py
output: /opt/data/jericho/inbox/realtime/
```

### Requires
- `GITHUB_TOKEN` in `/opt/hermes/.env` (classic PAT with repo scope)

### Verification
- [ ] Runs every 30m
- [ ] Detects new PRs within 30m
- [ ] Red CI surfaced in next digest
