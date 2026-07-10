# Fleet Health Delta 15 — 2026-07-10 ~02:00 DXB (Researcher empty wake 0c410ba0)

Reference: fleet-health-snapshot-2026-07-10-DXB-delta-14.md (01:40 DXB, ~20 min ago)

## Change Since Delta 14

### Paperclip: Stage 1 (unchanged)

Health OK via localhost. Issues endpoint still timing out at 10s — same as delta-14.

### Cron: Sub-hourly stalled again

Delta-14 reported sub-hourly "advancing" at 21:39 UTC. Now at ~22:00 UTC:

- bridge-poller (every 3m): last_run 21:37, next_run still 21:40 — should have fired 6+ times since
- linear-consume (every 30m): last_run 21:24, next_run 21:54 — 1 fire missed
- recovery-closer (every 30m): last_run 21:39, next_run 22:09 — still in future at check time
- intelligence-signal-scan (every 180m): last_run 20:41, next_run 23:41 — in future

Sub-hourly thread moved in a brief burst (delta-14 captured it mid-advancement) then stalled again. The pattern is intermittent — not a full outage.

Daily thread unchanged: night-watch next_run Jul 10 00:00 UTC (in future when checked), morning-briefing still error/last Jul 8, next Jul 10 05:00.

### Deferred-Close Backlog: 71 (unchanged)

Recovery-closer can't clear — issues endpoint timeout. 71 files includes 1 non-standard: paperclip-deferred-close-jericho-bcd39e7f.json — verified valid (MAS-511, real UUID 3f953dbc). NOT dead weight. Leave in place.

### Empty Wake Tally

| Agent | Count |
|-------|-------|
| Intelligence | 14 |
| Analyst | 13 |
| Researcher | 8 (was 7) |

### Non-Standard Deferred-Close Audit

paperclip-deferred-close-jericho-bcd39e7f.json: verified. Contains valid issue_id 3f953dbc, identifier MAS-511. Duplicate of paperclip-deferred-close-MAS-511.json — both valid, neither should be deleted. Prior deltas (9, 10, 11) incorrectly flagged this as dead weight.

## Action Items

None new. Same blockers: Paperclip DB queries need to recover for recovery-closer to clear backlog. Scheduler sub-hourly thread needs restart (intermittent stall pattern).
