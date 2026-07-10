# Fleet Health Delta — 2026-07-10 ~03:30 DXB

Triggered by: DEV empty wake 4c9017ff
Prior snapshot: fleet-health-snapshot-2026-07-10-0200-DXB.md (~02:00 DXB)

## Changes Since 0200 Snapshot

### Deferred-Close Backlog

0200: 67 total (50 deferred-close + 17 close)
Now: 89 total (70 deferred-close-MAS + 1 deferred-close-jericho + 18 close-MAS)

Delta: +22 files in ~90 minutes. Rate: ~15/hour. Accumulating faster than earlier.

### Cron Health

| Job | 0200 Status | Now | Delta |
|-----|------------|-----|-------|
| intelligence-signal-scan | ERROR (next_run 02:53 DXB) | ERROR — next_run PASSED without firing. Error state blocks scheduling. Needs restart. | ACTION REQUIRED |
| morning-briefing | ERROR (next_run 09:00 DXB) | ERROR — unchanged. Expected, fires at 09:00. | No action |
| MAS-247-commit-llm | Stale one-shot | REMOVED from cron list. | RESOLVED |
| voice-ingest | Not in snapshot | PAUSED since Jul 8 06:01 UTC | Noted |
| All others | ok/active | Unchanged | Stable |

### intelligence-signal-scan — Root Cause

last_run_at: Jul 8 04:25 UTC
next_run_at: Jul 9 22:53 UTC (02:53 DXB Jul 10) — NOW PASSED
last_status: error
state: scheduled (enabled: true)

The scheduler did NOT fire at 22:53 — last_run_at still shows Jul 8. The error state is preventing the scheduler from advancing to the next tick. This is different from morning-briefing (which hasn't reached its next_run_at yet). intelligence-signal-scan's window has already passed.

Attempting: cronjob(action="resume") to reset error state. If that doesn't work, will try pause+resume or recreate.

### Omnigent Reports

0200: 4 duplicate reports
Now: 5 duplicate reports (+1: omnigent-competitive-deep-dive-2026-07-10-DXB.md)

Pattern: each empty wake runs a fresh deep-dive without checking for existing reports. The non-fleet-agent-wakes.md reference's "check before diving" guidance isn't being followed.

### Empty Wakes Today (Jul 10)

0200: ~15 in prior 24h (mixed Jul 9-10)
Now: 4 researcher + unknown intelligence/analyst on Jul 10 alone

### Researcher Wakes

0200: 2 on Jul 10
Now: 4 on Jul 10 (e1ada56f, 65d4be75, 0c316686, plus earlier 0020)
All empty. No new competitive signals since 0200.

## Current State Summary

- Paperclip: still Stage 4 (48+ hours)
- 89 pending close files in outbox
- intelligence-signal-scan: blocked by error state — needs restart
- morning-briefing: due at 09:00 DXB (~5.5h from now) — will test if error state also blocks it
- 5 redundant Omnigent reports — no new competitive intelligence since 0200
- Fleet gateways: stable (per night-watch ok at 18:00 Jul 9)
