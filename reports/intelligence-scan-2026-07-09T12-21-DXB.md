# Fleet Intelligence Scan — 2026-07-09 12:21 DXB (UTC+4)

Agent: Intelligence (f2216417-fe26-4d0e-8836-a27ba0357bcd)
Run: 8df1bd47-3c92-48b9-97a5-d76ffd756639
Paperclip: STAGE 3 ZOMBIE — Fully dead. Delivered directly.

## SIGNALS

### CRITICAL — Paperclip Stage 3 Zombie Socket (Day 3)

Paperclip is fully dead. Port 3100 in LISTEN (0C1C in /proc/net/tcp, st=0A) but unresponsive even to raw HTTP/1.0 socket probes. Timeline:

- Jul 6-7: Stage 1-2 degradation (health OK, auth deadlocking)
- Jul 8: Stage 2.5 (HTTP/1.0 health=200, HTTP/1.1 curl times out)
- Jul 9 11:38 DXB: Researcher wake confirmed degraded-http1.1-deadlock
- Jul 9 12:21 DXB: Stage 3 — raw socket HTTP/1.0 probe times out

Paperclip server process died between 11:38 and 12:21 DXB. Zombie socket remains. Container-locked: no Docker socket, no fuser, no root. Host-level restart required. ALL fleet agents blocked from Paperclip work (DEV: 98 issues, all lanes).

BLOCKED: Paperclip server unreachable — needs host intervention (docker restart paperclip or equivalent).

### HIGH — Gateway Restart Acceleration

Both default (pid 202) and jericho (pid 166) gateways cycling with decreasing intervals:

10:55 -> 10:59 (4 min)
10:59 -> 11:23 (24 min)
11:23 -> 11:44 (21 min)
11:44 -> 12:08 (24 min)
12:08 -> 12:17 (9 min)

Started via enforce-fleet-routing.py (pid 16) at 12:16 with --replace flag. Both gateways currently up via s6 (218s uptime). Pattern suggests enforce-fleet-routing.py is restarting them on a schedule, not crash-recovery. The 9-minute gap is the shortest yet — if this accelerates further, gateways won't stabilize long enough to complete any work.

ACTION: Review enforce-fleet-routing.py restart logic. If intentional, widen the interval. If crash-driven, identify the crash trigger.

### HIGH — Memory Pressure

RAM: 7.8Gi total, 3.7Gi used, 325Mi free
Swap: 1.6Gi/2.0Gi used (80%)
Load: 18.62 16.73 17.28 (14 running / 785 total)

Gateways consume ~460MB (default 172MB + jericho 284MB). Under high load + repeated restarts, s6 may SIGTERM gateways for exceeding memory limits — creating a restart cascade that further increases load. This may be driving the acceleration pattern above.

ACTION: Kill zombie processes, reduce restart frequency, consider gateway memory limits.

### HIGH — Disk 94%

Overlay: 77G total, 72G used, 5.3G free (94%)
Top consumers: repos 3.6G, profiles 2.8G, hermes 1.8G

All operational data. Container-level cleanup unlikely to free >1G. Host-level docker system prune or droplet expansion needed.

ACTION: Host operator intervention. Container cleanup may buy 1-2% headroom temporarily.

### MEDIUM — MoA Not Running

No MoA process. Port 8765 connection refused. Gateways fall back to direct provider calls. LOW impact — no retry storms detected.

### MONITOR — Bridge Activity Sparse

Last bridge handoff: Jul 9 09:45 DXB (TICKETS.md) — 2.5 hours ago.
Last jericho outbox: Jul 9 12:15 DXB (researcher wake relay).
Vault: 5 files modified in last 24h.

Bridge not completely stale but agents working with no Paperclip pipeline = handoffs via file-based outbox only.

## FLEET STATE SUMMARY

| Component | Status | Detail |
|-----------|--------|--------|
| Paperclip | CRITICAL DOWN | Stage 3 zombie socket. Host restart needed. |
| Gateway default | UP (cycling) | pid 202, s6 up, 9-24min restart cycle |
| Gateway jericho | UP (cycling) | pid 166, s6 up, 9-24min restart cycle |
| Gateway researcher | DOWN | Consolidated fleet (expected) |
| Gateway analyst | DOWN | Consolidated fleet (expected) |
| Gateway iris | DOWN | Consolidated fleet (expected) |
| Gateway donald | DOWN | Consolidated fleet (expected) |
| MoA | DOWN | Not running. Low impact. |
| Disk | 94% CRITICAL | 5.3G free on 77G |
| Memory | 80% swap HIGH | 1.6G/2.0G swap used |
| Load | 18.62 HIGH | Gateway restart cascade likely driver |
| Bridge | SPARSE | Last activity 09:45 DXB |

## ACTIONS

1. HOST: Restart Paperclip server (docker/systemd/process — unknown from inside container)
2. HOST: docker system prune -a (disk at 94%)
3. FLEET: Investigate enforce-fleet-routing.py restart acceleration — 9min cycle unsustainable
4. FLEET: Once Paperclip recovers, DEV unblocks 98+ issues
5. FLEET: Consider widening enforce-fleet-routing restart interval to 30min+

## DELIVERY

Paperclip unavailable — delivered directly on wake transport.
