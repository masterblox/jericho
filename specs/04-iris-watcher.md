# SPEC-04: Iris Reply Watcher

**Subsystem:** Iris reply detection
**Source:** `/opt/data/scripts/iris-watcher.py`
**Target:** `/opt/data/jericho/inbox/realtime/iris-{timestamp}.json`
**Frequency:** Every 5 minutes
**Status:** Cron job 794875e5c905 exists but PAUSED (quiet guard)

## Integration

### What It Wires
1. Polls `/opt/conductor-bridge/inbox/iris-replies/` for new files
2. When new reply found: writes alert to `inbox/realtime/iris-{timestamp}.json`
3. Jericho deduplicates and escalates to Carlos DM

### Fix Required
- Resume cron job 794875e5c905
- Or recreate with `no_agent=true, quiet_guard=false`
- Update script to write to Jericho inbox instead of direct DM

### Script Patch
```python
# Add to iris-watcher.py:
JERICHO_INBOX = "/opt/data/jericho/inbox/realtime"
# Write alerts as JSON instead of printing
alert = {"source": "iris-watcher", "timestamp": now, "files": new_files}
with open(f"{JERICHO_INBOX}/iris-{now.isoformat()}.json", "w") as f:
    json.dump(alert, f)
```

### Verification
- [ ] Watcher runs every 5m
- [ ] New Iris replies → JSON alert in `inbox/realtime/`
- [ ] Jericho delivers to Carlos within 5m
