# INTEL Scan — 2026-07-09 16:19 UTC+4 (DXB)

## Summary

CRITICAL: Paperclip Stage 3 (zombie socket) — fully unreachable. HIGH: memory pressure (swap 100%, load 20.5). Fleet running but fragile.

---

## 1. Paperclip — CRITICAL / BLOCKED

- **Stage**: 3 (zombie socket) — port 3100 in LISTEN per /proc/net/tcp, but raw HTTP/1.0 recv times out
- **Tailscale**: 000 (curl exit 28)
- **Localhost**: 000 (curl exit 28)
- **Progression**: Stage 2.5 (HTTP/1.1 deadlock) → Stage 3 (zombie socket). Occurred between last Researcher wake (11:38Z, when HTTP/1.0 still worked) and now
- **Blocker**: Container-locked — no Docker socket, no root, no fuser. Host-level restart required
- **Impact**: 49 deferred close files queued in /opt/data/jericho/outbox/. No agent can receive or update issues. Fleet operating blind

## 2. Memory Pressure — HIGH

- **Load**: 20.50 / 20.78 / 19.30 (on 2 vCPUs)
- **Memory**: 7.8G total, 659M free, swap 2.0G/2.0G (100%)
- **Gateways**: Jericho (pid 162, 444MB RSS), Default (pid 31568, 164MB RSS)
- **SIGTERMs**: 22 total. Two most recent at 14:32 (load 18.59) and 16:03 (load 17.41) — s6-supervise killed gateway-default under memory pressure. Classic Paperclip recovery → SIGTERM cascade
- **Zombie LSP**: 8 processes found (1.8GB RSS). Killed first wave — 4 remain (LSP reinfection from active session). Freed ~400MB (206M → 659M free)

## 3. Fleet Gateway State

| Gateway | Process | s6 State | Notes |
|---------|---------|----------|-------|
| Jericho | pid 162, --replace | running (outside s6) | Operational, fragile |
| Default | pid 31568, --replace | running (outside s6) | SIGTERM'd twice today, operational |
| Researcher | none | down (not started) | Consolidated — wakes through default |
| Analyst | none | down (not started) | Consolidated |
| Intelligence | none | down (not started) | Consolidated (this session = heartbeat wake) |
| Iris | none | down | Consolidated |
| Donald | none | down | Consolidated |
| Juridico | none | down | Never activated |

Both active gateways running outside s6 supervision (--replace flag). No crash recovery.

## 4. Disk

- 88% used (67G/77G), 9.7G available
- Not yet critical but trending up from last scan

## 5. Bridge / Handoffs

- Last bridge handoff: Jul 9 09:45 UTC+4 (TICKETS.md) — 6.5h stale
- Jericho outbox: active — 49 deferred closes queued, last at 16:16
- Signal: agents operating, but Paperclip blocked so all handoffs are file-only

## 6. Vault Activity (24h)

- /opt/brain/Memory/Agent/Dev/MEMORY.md
- /opt/brain/Memory/Agent/PA/USER.md
- /opt/brain/Memory/Agent/PA/MEMORY.md

Low activity — expected with Paperclip down (no issue-driven work).

## 7. Log Anomalies

- auth.json permission denied (5 occurrences at 16:04-16:05). Gateway restarted, auth store temporarily unreadable. Self-recovered — no current errors in either gateway log tail.
- 1 memory overflow event in agent.log (likely stale from transient spike)

---

## Recommended Actions

1. **IMMEDIATE**: Host-level Paperclip restart — `docker restart paperclip` or equivalent on VPS host. 49 deferred closes + all fleet issue operations blocked
2. **HIGH**: Kill remaining 4 LSP zombies after this session ends — they'll respawn while session is active
3. **MEDIUM**: Run `docker system prune -a` on host to reclaim Docker overlay space (67G/77G, 88%)
4. **MEDIUM**: After Paperclip recovers, expect SIGTERM cascade — gateways will flood it. Monitor load
5. **LOW**: Investigate auth.json permissions — 5 warnings on gateway restart, self-recovered

---

*Paperclip unavailable during scan — delivered directly via wake transport*
*49 deferred closes queued, none processed*
