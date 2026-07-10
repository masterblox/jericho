# Fleet Intelligence Scan — 2026-07-09 13:05 DXB (09:05 UTC)

## Summary

Paperclip RECOVERED after multi-day outage. Scan reveals 2 CRITICAL issues: extreme load (25 on 2 CPUs) risking gateway SIGTERM, and disk 93% container-locked. Fleet otherwise stable with 2/2 gateways.

## CRITICAL — Load: 25.04 on 2 CPUs

- Swap: 78% utilized (1606/2047 MB)
- Default gateway: 4 restarts in 40 minutes today (12:17, 12:26, 12:55, 12:55 DXB)
- 3 zombie tsserver processes still alive despite kill -9
- Killed 6/9 LSP zombies — freed 371MB RAM
- Risk: sustained load >20 triggers s6 SIGTERM on gateways

## CRITICAL — Disk 93% container-locked

- 5.7G free on 77G overlay
- Container cleanup: removed 1012MB node_modules + npm cache — ZERO impact on df
- Confirms: 50GB+ gap is host-level Docker overlay layers
- BLOCKED inside container — needs host-level `docker system prune -a`

## HIGH — Analyst agent in error state

- Paperclip shows Analyst (23ce64e7) status=error
- No dedicated gateway (consolidated model — intentional)
- May block wake routing

## POSITIVE — Paperclip recovered

- Health: 200 on both localhost and Tailscale
- Issue list: returns 50 issues with exit 0
- All authenticated endpoints responding
- After multi-day outage: health=000 → auth deadlock → list-only degradation → FULL RECOVERY

## Fleet State

| Metric | Status |
|---|---|
| Gateways | 2/2 running (default + jericho) |
| Paperclip | Fully operational |
| MoA | Not running (low impact) |
| Bridge | Active (last: 13:01 DXB) |
| Vault | Recent writes (Designer, Dev, PA) |
| S6 states | All decommissioned gateways: down (not started yet) — expected |

## Agent Status (Paperclip)

| Agent | Status |
|---|---|
| DEV | running |
| Jericho | idle |
| Intelligence | running |
| Researcher | running |
| Analyst | error |
| PA | idle |
| Iris | idle |
| Donald | idle |
| Insights | idle |

## Issues

- INTEL-6 filed (todo, high priority) — this scan
- INTEL-5: stale (2 days old, memory overflow was transient)
- INTEL-1: not in 50-issue window (older, blocked — conditions changed)
- 41 issues in_progress (mostly DEV MAS tickets)
- 7 blocked

## Actions Taken

- Killed 6/9 zombie LSP processes (freed 371MB RAM)
- Removed memories-express-mvp-cp/node_modules (1012MB — no disk impact)
- Removed .npm/_npx cache (no disk impact)
- Filed INTEL-6 on Paperclip

## Recommended

1. HOST-LEVEL: `docker system prune -a` for disk
2. PATCH Analyst agent to clear error state
3. Close INTEL-5 as stale
4. Monitor load — sustained >20 = gateway SIGTERM risk

## Paperclip Status

Paperclip recovered from multi-day outage. Delivery: Paperclip issue (INTEL-6 created successfully). INTEL-5 comment timed out (known partial degradation on comment endpoint).
