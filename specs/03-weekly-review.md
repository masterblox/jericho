# SPEC-03: Weekly Review

**Subsystem:** Weekly review synthesis
**Source:** `/opt/data/scripts/weekly-review.py`
**Target:** `/opt/data/jericho/inbox/weekly/{date}.md`
**Frequency:** Weekly, Friday 18:00 UTC
**Status:** Script exists, not scheduled

## Integration

### What It Produces
- Git velocity by author across all tracked repos
- Linear tickets shipped this week
- Key accomplishments/decisions from daily notes
- Blocked items and stale tasks

### Jericho Wiring
1. Cron fires Friday 18:00 UTC
2. Output → `inbox/weekly/{date}.md`
3. Jericho produces `reports/weekly/{date}.md`
4. Delivered to Carlos with summary stats

### Cron Config
```yaml
schedule: "0 18 * * 5"
script: /opt/data/scripts/weekly-review.py
output: /opt/data/jericho/inbox/weekly/{date}.md
```

### Git Repos Tracked
- Mechanica-Labs/launchrail
- Mechanica-Labs/architect-ai
- Mechanica-Labs/memories-express-mvp-cp
- masterblox/jarvis-brain (vault)

### Verification
- [ ] Runs Friday 18:00 UTC
- [ ] Git stats match `git log --since` across repos
- [ ] Linear stats match actual ticket movements
