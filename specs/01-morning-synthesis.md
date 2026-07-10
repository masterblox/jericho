# SPEC-01: Morning Synthesis

**Subsystem:** Morning synthesis reports (DEV, PA, Iris lanes)
**Source:** `/opt/data/scripts/morning-synthesis.py`, `pa-morning-synthesis.py`, `iris-morning-synthesis.py`
**Target:** `/opt/data/jericho/inbox/morning/{lane}-{date}.md`
**Frequency:** Daily, 08:00 UTC
**Status:** Scripts exist, not scheduled

## Integration

### What It Produces
- DEV: Last 3 daily notes, active projects, inbox, Linear tickets, meetings. Compact brief.
- PA: People radar (contacts, chats, mentioned people), inbox, connection maps via cross-pollinate.
- Iris: Foxsy render pipeline, asset cache freshness, design tickets, Designer vault health, Figma status.

### Jericho Wiring
1. Cron job invokes each script via `hermes cron` or bash
2. Output written to `/opt/data/jericho/inbox/morning/{lane}-{date}.md`
3. Jericho aggregator reads all three, produces single `reports/daily/{date}.md`

### Cron Config
```yaml
# Hermes cron job
schedule: "0 8 * * *"
script: /opt/data/scripts/jericho-morning.sh
```
Where `jericho-morning.sh`:
```bash
#!/bin/bash
DATE=$(date +%Y-%m-%d)
/opt/hermes/.venv/bin/python /opt/data/scripts/morning-synthesis.py > /opt/data/jericho/inbox/morning/dev-${DATE}.md
/opt/hermes/.venv/bin/python /opt/data/scripts/iris-morning-synthesis.py > /opt/data/jericho/inbox/morning/iris-${DATE}.md
```

### State Tracking
`state/digest.json` entry: `{"morning_synthesis": {"last_run": "ISO8601", "lanes": ["dev", "iris"]}}`

### Verification
- [ ] Files appear in `inbox/morning/` after 08:00 UTC
- [ ] Jericho aggregator produces `reports/daily/{date}.md`
- [ ] Carlos receives single digest, not 3 separate messages
