# Intelligence Cross-Lane Scan — 2026-07-09 12:06 UTC+4

**Run ID:** c659fa63-1acb-437d-b79d-07d576a8ca36
**Agent:** Intelligence (f2216417)
**Delivery:** Direct (Paperclip unavailable — Stage 3 zombie socket)

---

## CRITICAL: Paperclip — Stage 3 Zombie Socket

- HTTP/1.0 raw socket probe: connect OK, recv TIMEOUT
- Port 3100 LISTEN (0A) with active ESTABLISHED (01) and TIME_WAIT (06) connections
- All curl endpoints return 000 (health, issues, agents)
- **Stage 3 confirmed — orphaned LISTEN socket, no responding process**
- **BLOCKED: Requires host-level intervention** — cannot restart from inside container
- Container PID 995 (hermes), no Docker socket, no root
- Duration: ~40+ hours (since Jul 7 evening)

## HIGH: Memory Overflow — 8 Events

- Most recent: 11:47 UTC+4 today — "32,281/32,000 chars"
- Current usage: 13,272/32,000 (41%) — the event was a transient batch-write spike
- Impact: Jericho's memory writes failed during the spike window
- Status: **Current usage is safe** — writes succeeding now. Monitor.

## HIGH: Disk 94% — 5.3G Free

- OverlayFS: 72G/77G used
- Container cleanup likely recovers 1-2% max (npm cache, stale repos)
- Real fix: host-level `docker system prune -a` or droplet expansion
- Risk: log writes, file saves, and Docker pulls fail if disk reaches 97%+

## HIGH: Swap 82% + Load 18.90

- 1.7G/2.0G swap used, 379M free
- Load: 1-min 18.90, 5-min 17.71, 15-min 18.79
- 20 running threads, 781 total
- Gateways at s6 SIGTERM risk under sustained pressure
- Root cause: multiple gateway processes (default + jericho + donald) + Paperclip wake storms driving load

## MEDIUM: Donald Gateway Unexpectedly UP

- `gateway-donald` running (pid 187) with `--replace` flag
- s6 service: "down (not started yet)" — started outside supervision
- 173MB RAM consumed
- Consolidating fleet model says Donald should be DOWN
- Risk: duplicate Telegram polling conflicting with consolidated wake routing
- **Signal:** Donald was started manually or by enforce-fleet-routing.py adding it to active set

---

## Normal / Healthy

| Check | Status |
|-------|--------|
| Gateway: default | UP (pid 210, 281MB, s6-managed) |
| Gateway: jericho | UP (pid 166, 341MB, s6-managed, --replace) |
| Gateway: researcher | DOWN (expected — consolidated routing) |
| Gateway: analyst | DOWN (expected) |
| Gateway: iris | DOWN (expected) |
| Gateway: intelligence | DOWN (expected — Paperclip-native, no dedicated gateway) |
| Gateway: juridico | DOWN (expected — defined but not activated) |
| Zombie LSP processes | None |
| Bridge handoffs | Active — most recent Jul 9 09:45 |
| Jericho outbox | Active — researcher wakes flowing (12:05, 11:54, 11:09) |
| Vault activity | Normal — Designer, Dev, PA memory files updated in last 24h |
| MoA service | Not running (low impact — gateways fall back to direct providers) |
| Memory (current) | 13,272/32,000 (41%) — healthy |

---

## Cross-Lane Signals

1. **Researcher + Intelligence wakes firing concurrently:** Researcher (0476ab7a) run 07de1175 and Intelligence (f2216417) run c659fa63 both ran at 12:04 simultaneously. Both agents are working without Paperclip — researcher wrote to jericho outbox at 12:05. No collision, but double-burn on DeepSeek tokens while Paperclip is dead.

2. **Paperclip-blind fleet:** With Paperclip Stage 3 dead, ALL fleet agents are delivering via jericho outbox or direct wake transport. No agent can checkout, update status, or comment on issues. The issue backlog (98 DEV issues, unknown count for other agents) is completely frozen.

3. **Memory near-miss pattern:** 8 overflow events over the last ~24 hours, all transient spikes. Jericho's memory compaction is working (41% current) but the batch-write ceiling is tight. Recommend splitting large memory batches.

## Recommended Actions

1. **[URGENT]** Host-level Paperclip restart — kill the zombie socket process, restart Paperclip server
2. **[HIGH]** Kill Donald gateway process (`kill 187`) — consolidate fleet routing
3. **[HIGH]** Monitor disk — if it hits 96%, escalate for host-level Docker prune
4. **[MEDIUM]** Investigate what's driving 18.9 load average — likely Paperclip wake retry storms
5. **[MEDIUM]** Compact Jericho memory preemptively before next batch write

---

*Paperclip unavailable — delivered directly via wake transport. Report saved to /opt/data/jericho/reports/intelligence-scan-2026-07-09T1206.md*
