# SPEC-05: Error Log Watcher

**Subsystem:** Error log monitoring
**Source:** `/opt/data/scripts/error-log-watcher.py`
**Target:** `/opt/data/jericho/inbox/realtime/errors-{timestamp}.json`
**Frequency:** Every 3 hours
**Status:** Script exists, not scheduled

## Integration

### What It Monitors
- `/opt/hermes/logs/gateway.log` — gateway errors
- `/opt/hermes/logs/agent.log` — agent loop errors
- `/opt/hermes/logs/errors.log` — general errors
- Patterns: ERROR entries, API failures (401/403/429/5xx), memory pressure, timeouts, blocked commands

### Jericho Wiring
1. Cron every 3h runs `error-log-watcher.py`
2. Output: JSON with error counts, new errors since last run, severity
3. Jericho deduplicates — only escalates new or high-severity errors
4. Critical (5xx, auth failures): immediate DM to Carlos
5. Non-critical: included in next morning digest

### Cron Config
```yaml
schedule: "0 */3 * * *"
script: /opt/data/scripts/error-log-watcher.py --output /opt/data/jericho/inbox/realtime/
```

### Severity Tiers
- **CRITICAL:** API auth failure, gateway crash, OOM → immediate DM
- **HIGH:** 5xx from provider, tool timeout, disk >90% → next digest, flagged
- **MEDIUM:** 429 rate limit, model fallback triggered → weekly review
- **LOW:** Deprecation warnings, transient DNS → log only

### Verification
- [ ] Runs every 3h
- [ ] Zero alerts when logs clean
- [ ] Critical errors reach Carlos within 15m
