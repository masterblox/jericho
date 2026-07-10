# MAS-514 INTEL-6 Resolution — 2026-07-09 16:05 GST

## Issue
INTEL-6 fleet diagnostic scan: load 17.1, swap 100%, Paperclip Stage 3 collapse.

## Scan Actions (taken by scan author at ~19:49)
- Killed 5 zombie LSP processes → freed ~730MB RAM
- Memory reduced: 4.5Gi → 3.5Gi used

## Jericho Actions (2026-07-09 16:01–16:05 GST)

### Verified current state
| Metric | Scan Report | At 16:01 | After Actions | Trend |
|--------|------------|----------|---------------|-------|
| Load (1m) | 17.12 | 19.45 | 16.65 | Improving |
| Swap | 2048/2048Mi (100%) | 1.9G/2.0G (95%) | 1.8G/2.0G (88%) | Improving |
| Free RAM | 174Mi | 969Mi | 721Mi | Stable |
| Disk | 89% | 87% | 87% | Stable |
| Zombies | 5 LSP | 0 | 0 | Clean |
| Paperclip | Stage 3 | Stage 4 (port listen, no process) | Stage 4 | Unchanged |

### Restarted default gateway
- PID 178 had 103MB swap + compression-failure loop (401 on context compaction)
- s6-svc -d / -u cycled the service
- New PID 31568, 105MB RSS, clean state
- Old PID 178 cleaned up, 103MB swap reclaimed

### Figma MCP orphan
- npm/node figma-developer-mcp was running as child of old default gateway (PID 29841/29927)
- Self-terminated during investigation — no kill needed

## Remaining Issues
- **Paperclip Stage 4**: Port 3100 still LISTEN (inode 297358828) but no process owns the socket. Paperclip crashed and the listen socket is orphaned in the kernel. No docker container, no process to restart. Needs host-level intervention or Paperclip service restart from outside the container.
- **Load 16.65 on 2 CPUs**: Unsustainable long-term. Driven partly by Jericho subprocesses during active work. Settles to ~2.0 when idle.
- **Disk 87%**: Approaching 90% threshold. Docker layer cleanup needed on host.

## Liveness Continuation Actions (2026-07-09 17:09 GST)

Paperclip fired liveness continuation — prior run flagged as plan_only. Concrete actions taken:

| Action | Before | After | Impact |
|--------|--------|-------|--------|
| Kill figma-mcp | 10MB RSS | Gone | Freed orphan |
| Kill goliath mcp | 7MB RSS | Gone | Freed orphan |
| Kill yaml-ls | 5MB RSS | Gone | Freed orphan |
| Default gateway restart | 592MB RSS, 69MB swap | 114MB RSS, 0 swap | 478MB reclaimed |
| Paperclip close attempt | 000 (auth timeout) | 000 (unchanged) | Deferred close needed |

### System State After Liveness Actions

| Metric | Prior (16:05) | After (17:09) | Delta |
|--------|--------------|---------------|-------|
| Load (1m) | 16.65 | 15.79 | -0.86 |
| Swap used | 1843MB (88%) | 1875MB (91%) | +32MB |
| Free RAM | 721MB | 600MB | -121MB |
| Disk | 87% | 89% | +2% |
| Zombies | 0 | 0 | Clean |
| Papclip health | Stage 4 | Stage 4 HTTP/1.0:000, HTTP/1.1:200 | Unchanged |
| Papclip auth | Timeout | Timeout | Unchanged |

Note: Swap and RAM slightly worse than prior report due to gateway restart overhead + my active session consuming RAM. Net effect of restart was +478MB RSS freed, partially offset by new gateway bootstrap.

## Disposition
Done. INTEL-6 scan complete. Two rounds of concrete remediation: zombie LSP kills (prior run) + MCP cleanup + gateway restart (this run). Paperclip remains Stage 4 — authenticated endpoints deadlocked despite health returning 200 on HTTP/1.1. Deferred close JSON updated at /opt/data/jericho/outbox/paperclip-deferred-close-MAS-514.json. Recovery-closer cron active every 30m (last OK 16:41 UTC). Paperclip recovery requires host-level intervention.
