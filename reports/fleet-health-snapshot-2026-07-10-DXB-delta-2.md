# Fleet Health Delta — 2026-07-10 (Analyst wake 47a48777)

Reference snapshot: fleet-health-snapshot-2026-07-10-0200-DXB.md

## Changes since 02:00 DXB

### Paperclip
No change. Still Stage 4 (Failed to fetch).

### Deferred-Close Backlog
68 total (50 deferred-close + 18 close). Approx flat from 67. Recovery closer runs every 30min, can't execute while Paperclip dead.

### Cron Health
All unchanged. Same 2 errors:

- jericho-morning-briefing: last success Jul 8. Next run Jul 10 05:00 UTC. Has not had a chance to fire since prior resume. Status may self-resolve at 05:00.
- intelligence-signal-scan: last success Jul 8 04:25. Next run was Jul 9 23:11 UTC — that time has passed but last_run_at is still Jul 8. Job is stuck — scheduler didn't fire it. This is NOT just an agent error, it's a scheduler-level block. May need a manual run or pause/resume cycle.

### Competitive Intelligence
Omnigent: now 5 redundant reports (was 4). One more from a late Intelligence wake. No new competitive signal.

### Wake Frequency
Analyst empty wakes: 19+ (was 5+). Continuing accumulation through Jul 10.
Intelligence: still firing. Researcher: 2 on Jul 10.

### Clean
- No null-issue_id deferred-close files. All JSONs have valid UUIDs.
- MAS-247-commit-llm one-shot: gone from cron list (cleaned).

## Single Actionable
intelligence-signal-scan is STUCK — next_run_at passed, no execution. Different from the morning-briefing case (which just hasn't reached its next slot yet). This needs a manual intervention. Try: cronjob(action="run", job_id="889e60424327") to force a fire, then check last_status.
