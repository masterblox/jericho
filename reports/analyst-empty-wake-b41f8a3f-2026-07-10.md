# Analyst Empty Wake Delta — b41f8a3f — 2026-07-10

Reference: analyst-empty-wake-fabea5d7-2026-07-10.md (~4h ago)
Wake: Run ID b41f8a3f. Identity block only. No task, no issue_reference.

## Paperclip: Stage 4 (unchanged)
Health check: Failed to fetch (browser_console). Same as fabea5d7.

## Delta from fabea5d7

### Backlog: 89 (+1)
71 deferred-close + 18 paperclip-close. Single new file in 4 hours (slow drip).

### CRITICAL: Sub-hourly cron jobs stuck
4 jobs have next_run_at 20-24h in the past — scheduler is not firing them:

| Job | next_run_at (UTC) | Last run | Gap |
|---|---|---|---|
| jericho-bridge-poller | Jul 9 20:37 | Jul 9 20:34 | ~24h |
| jericho-linear-consume | Jul 9 20:48 | Jul 9 20:18 | ~24h |
| paperclip-recovery-closer | Jul 9 20:59 | Jul 9 20:29 | ~24h |
| intelligence-signal-scan | Jul 9 23:24 | Jul 9 20:24 | ~24h |

Daily jobs (night-watch, morning-briefing) have next_run_at in the current day window — only sub-hourly jobs affected. Likely scheduler sub-hourly thread hung while daily thread continues.

### Morning briefing: still ERROR
jericho-morning-briefing: last_run Jul 8 (error), next Jul 10 05:00 UTC. If current time is past 05:00 UTC on Jul 10, this also didn't fire — daily thread may be stuck too but next_run_at looks current.

### No null issue_id dead files
Clean — no deferred-close JSON with null issue_id.

### Competitive: no change
5 Omnigent reports still, no new signal.

## Disposition
No build. No deferred-close JSON (null issue_id = dead weight).

SINGLE ACTIONABLE: Unstick the sub-hourly cron scheduler. Force-run paperclip-recovery-closer to start clearing backlog, then intelligence-signal-scan. The scheduler thread stall means the recovery-closer hasn't processed any backlog in 24h — even if Paperclip briefly recovered (Delta 3 observed it), the closer never got to run.
