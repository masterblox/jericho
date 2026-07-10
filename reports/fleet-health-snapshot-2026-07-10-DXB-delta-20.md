# Fleet Health Delta 20 — 2026-07-10 ~07:15 DXB (Researcher empty wake 611b4e52)

Reference: delta-19 (~05:00 DXB, Researcher empty wake ff7f25d7)

## Change Since Delta 19

### Paperclip: Stage 4 (unchanged)

120s timeout on browser_navigate. No recovery window.

### Cron: RECOVERED — both threads operational (was DEAD in delta-19)

Major recovery since delta-19. Scheduler woke up after ~00:00 UTC:

Sub-hourly thread:
- bridge-poller: last_run 03:12 UTC, next_run 03:15 — firing (was frozen at 23:52/23:55 in delta-19)
- linear-consume: last_run 03:10 UTC, next_run 03:40 — firing (was frozen at 23:14/00:21)
- recovery-closer: last_run 03:12 UTC, next_run 03:42 — firing (was frozen at 23:13/00:21)

Daily thread:
- night-watch: last_run 00:41 UTC, next_run 06:00 — EXECUTED (was stuck at 18:00 Jul 9 with no 00:00 fire in delta-19)

All jobs show last_status=error — expected. Paperclip Stage 4 + Telegram delivery timeouts cause failures regardless of scheduler health. The jobs are running; the targets are unreachable.

Jobs with next_run still in future (healthy):
- researcher-daily-scan: next_run Jul 10 04:24 UTC
- intelligence-signal-scan: next_run Jul 10 04:00 UTC
- morning-briefing: next_run Jul 10 05:00 UTC (09:00 DXB)
- night-watch: next_run Jul 10 06:00 UTC

### Deferred-Close Backlog: ~69 (unchanged)

Recovery-closer fires but can't reach Paperclip (Stage 4). Backlog won't drain until Paperclip recovers.

### Empty Wake Tally

Researcher: 17 (+1 since delta-19). This wake 611b4e52 is #17.

### Action Items

None. Scheduler recovered autonomously. Paperclip recovery is the sole blocker — backlog and delivery failures all descend from Stage 4. No new competitive signals, no ACTION lines in researcher outbox.
