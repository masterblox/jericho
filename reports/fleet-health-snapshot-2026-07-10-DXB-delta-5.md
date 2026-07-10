# Fleet Health Delta 5 — 2026-07-10 ~01:00+ UTC (05:00+ DXB)

Reference: fleet-health-snapshot-2026-07-10-DXB-delta-4.md

## Changes Since Delta 4

### DAILY SCHEDULER NOW HUNG — ESCALATION
Delta-4 reported only sub-hourly scheduler hung. Now the daily scheduler is also dead:
- jericho-night-watch: next_run Jul 10 00:00 UTC, last_run Jul 9 18:00 — missed fire window, never executed
- Sub-hourly jobs same as delta-4: bridge-poller (20:56), linear-consume (21:23), recovery-closer (21:23), researcher-daily-scan (22:04) — all still in past, no advancement

jericho-morning-briefing next_run 05:00 UTC still in future — may also fail to fire if scheduler remains hung.

This is now a confirmed scheduler-level outage: both sub-hourly and daily timer threads are dead. Force-running individual jobs won't fix this — the Hermes cron scheduler process itself needs restart.

### Paperclip: Still Dead (Stage 4-5)
Browser CDP and browser_console fetch() both timeout at 10s. No change from delta-4.

### Deferred-Close Backlog: 89 (was 71)
- 71 paperclip-deferred-close-*.json (no change — recovery-closer stuck)
- 18 paperclip-close-*.json (counted separately, unchanged)

### Dead Deferred-Close Files
- paperclip-deferred-close-jericho-bcd39e7f.json — jericho self-wake, null issue_id, dead weight
- paperclip-deferred-close-mas-322.json — lowercase prefix, recovery-closer won't match

### Redundant Reports
4 Omnigent competitive deep-dives in reports/ from consecutive intelligence empty wakes:
- omnigent-competitive-deep-dive-2026-07-10-DXB.md
- omnigent-competitive-intelligence-2026-07-10.md
- omnigent-competitive-deep-dive-2026-07-10.md
- omnigent-competitive-deepdive-2026-07-10.md

### Empty Wake Tally (Jul 9-10 total)
- Analyst: 20 (this is #21)
- Intelligence: 26
- Researcher: 8

## Actionable
1. CRITICAL: Restart Hermes cron scheduler. Both timer threads hung — daily and sub-hourly. This requires process-level intervention (hermes cron restart or container restart).
2. Delete 2 dead deferred-close files (jericho-bcd39e7f, mas-322 lowercase).
3. Deduplicate 4 Omnigent reports — keep the canonical one (omnigent-competitive-deep-dive-2026-07-10-DXB.md), delete 3 duplicates.
4. When Paperclip recovers, force-run recovery-closer to clear 89-file backlog.
