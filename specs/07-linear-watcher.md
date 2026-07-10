# SPEC-07: Linear Change Watcher

**Subsystem:** Linear ticket change detection
**Source:** `/opt/data/scripts/watcher-linear.py`
**Target:** `/opt/data/jericho/inbox/realtime/linear-{timestamp}.json`
**Frequency:** Every 15 minutes
**Status:** Script exists, not scheduled

## Integration

### What It Monitors
- Ticket state changes (backlog→in progress→done)
- Assignee changes
- Priority changes
- New tickets created
- Comments added
- 2-day lookback window, stateful (only reports deltas)

### Jericho Wiring
1. Cron every 15m runs `watcher-linear.py`
2. Output: JSON with change list
3. Jericho includes in morning digest, realtime for urgent
4. Tickets moving to "done" → celebrated in digest

### Cron Config
```yaml
schedule: "*/15 * * * *"
script: /opt/data/scripts/watcher-linear.py
output: /opt/data/jericho/inbox/realtime/
```

### Requires
- `LINEAR_API_KEY` in `/opt/hermes/.env` (already configured)

### Future: Linear Webhooks
- Enable webhook platform: `hermes webhook subscribe linear`
- Configure Linear to POST to webhook URL
- Eliminates polling, instant push notification

### Verification
- [ ] Runs every 15m
- [ ] Deltas accurate vs Linear UI
- [ ] State file prevents duplicate reporting
