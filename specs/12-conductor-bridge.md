# SPEC-12: Conductor Bridge Integration

**Subsystem:** Inter-agent filesystem message bus
**Source:** `/opt/conductor-bridge/`
**Target:** Jericho inbox (uplink) + Jericho outbox → bridge outbox (downlink)
**Frequency:** Real-time (poll-based, 30s-5m)
**Status:** ⚠️ Partial — directory exists, watchers paused

## Integration

### Uplink (Bridge → Jericho)
Bridge inboxes that feed Jericho's intelligence:
- `inbox/iris-replies/` → Iris Reply Watcher → `jericho/inbox/realtime/iris-*.json`
- `inbox/engineer-replies/` → Engineer Reply Watcher → `jericho/inbox/realtime/engineer-*.json`

### Downlink (Jericho → Bridge)
Jericho dispatches to agents via bridge outbox:
- `jericho/outbox/dev/` → `conductor-bridge/outbox/engineer-messages/` (DEV lane)
- `jericho/outbox/iris/` → `conductor-bridge/outbox/iris-consults-queue/` (Iris lane)
- `jericho/outbox/pa/` → PA bridge endpoint (when PA runtime exists)
- `jericho/outbox/donald/` → Donald bridge endpoint (when runtime exists)

### Bridge Health
Jericho monitors bridge health:
- File count in each inbox/outbox (staleness detection)
- Last activity timestamp per lane
- Unprocessed message backlog (>50 files = alert)

### Current State
- Engineer replies: ~50+ unprocessed files (May 28–Jun 16)
- Iris replies: 9 files (May 31–Jun 25)
- Handoff notes: 1 pending (Donald prompt skill request)
- All watchers: PAUSED

### Reactivation Sequence
1. Resume Iris Reply Watcher (cron 794875e5c905)
2. Create Engineer Reply Watcher (new cron)
3. Process backlog of engineer replies
4. Route all future replies through Jericho inbox

### Verification
- [ ] Bridge directories exist and writable
- [ ] Watchers detect new files within 5m
- [ ] Downlink dispatches appear in correct bridge outbox
