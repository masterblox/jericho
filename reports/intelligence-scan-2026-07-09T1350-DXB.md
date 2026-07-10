# Intelligence Scan — 2026-07-09 13:50 DXB (09:50 UTC)

Wake: no task attached (identity block only). Paperclip degraded — all API reads timeout, writes return 404.

## CRITICAL: Paperclip Regression

Paperclip was fully recovered at 13:05 DXB (scan confirmed all endpoints responding). By 13:49 DXB, degraded again:
- Health: 200 OK (HTML dashboard)
- GET /api/issues: timeout (HTTP 000)
- GET /api/agents: timeout (HTTP 000)
- POST /api/issues: 404 (endpoint routing failure?)
- GET /api/issues?agent_id=...: 400 Bad Request (rejected before timeout)

Pattern: brief recovery window ~45 minutes, then collapsed again. This is the third degradation cycle in 3 days. Root cause likely the same auth-middleware deadlock — server comes back, handles some traffic, then locks up again.

## HIGH: Gateway SIGTERMs Accelerating

- 12 SIGTERMs today (was 4 at 13:05 DXB scan — 8 more in ~45 min)
- Load: 21.55 (down from 25.04 but still critical on 2 CPUs)
- Swap: likely still 78% (unchanged from earlier)
- Gateways: both up (default + jericho, 2222s uptime)
- The 8 new SIGTERMs correlate with Paperclip's brief recovery window — gateways may have flooded Paperclip with queued requests, triggering load spike → SIGTERM → restart cascade

## Cross-Lane Signals

- DEV lane: MAS-40 completed (bridge update: in_review, {offset:true} applied). Active PR stream.
- PA lane: no signals (idle)
- Iris lane: no signals (idle)
- Donald lane: no signals (idle)
- Researcher: inactive (gateway intentionally down per consolidation)
- Analyst: error state in Paperclip (from earlier scan — cannot verify now)
- Vault: 2 files modified in last hour (low activity)
- Memory: 3GB available / 8GB total (healthy)
- Disk: 93% (5.4G free) — unchanged, needs host-level docker prune
- Zombies: 0 (LSP cleanup from earlier scan held)

## MAS-333 Status

Previous Intelligence task complete. PR #209 open on memories-express-mvp-cp (branch dev/mas-333-budget-export-region-aware). All code done. Waiting on Paperclip recovery to update status to "in_review".

## Actions This Run

- Cross-lane scan complete (this report)
- Cannot file INTEL issues on Paperclip (degraded)
- Cannot update MAS-333 status on Paperclip (degraded)

## Recommended

1. Host restart for Paperclip (3 cycles of recovery→collapse in 3 days)
2. Monitor gateway SIGTERM rate — if >20/day, consider throttling Paperclip pollers
3. docker system prune -a on host for disk
4. When Paperclip recovers: update MAS-333 to in_review, close INTEL-5 as stale
