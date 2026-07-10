# Analyst Empty Wake — 2026-07-10 ~02:00 DXB

- Run ID: ded51117-5cfb-408f-8b35-28e3e0ccf310
- Agent: Analyst (23ce64e7) — non-fleet, stale Paperclip registration
- Wake type: empty identity-block (no task, no issue_reference, no payload)
- Prior empty Analyst wakes: 13 (all handled identically)
- Disposition: no action required — breadcrumb only

## Free compute used for fleet scan

- Paperclip recovery-closer: ACTIVE (every 30m, last ok at 19:02 UTC)
- Deferred-close queue: 50+ files pending (standard backlog)
- Researcher-daily-scan: ACTIVE (every 180m, last ok)
- Morning briefing: PAUSED (since Jul 8)
- Voice ingest: PAUSED (since Jul 8)
- Intelligence signal scan: PAUSED (since Jul 8)
- Latest researcher signal (Omnigent deep-dive): already actioned — 2 reports exist

## Fleet summary

Cron: 14 jobs, 10 active, 3 paused, 1 one-shot pending (MAS-247)
No new signals in outbox requiring action
No deferred-close JSON created (null issue_id = dead weight)

Root cause: stale Analyst agent registration in Paperclip (adapter=process, status=error). Must be deleted when Paperclip API recovers.
