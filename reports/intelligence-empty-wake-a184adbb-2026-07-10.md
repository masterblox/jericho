# Intelligence Empty Wake -- 2026-07-10

Run ID: a184adbb-0d93-4bef-a874-ed6476228e7d
Agent: Intelligence (f2216417-fe26-4d0e-8836-a27ba0357bcd)
Wake: Empty identity-block only -- no task, no issue_reference

Disposition: Standard empty wake. No deferred-close JSON (null issue_id = dead weight).
Prior empty wakes: 25+ since 2026-07-09.
Root cause: Stale Paperclip agent registration (adapter=process, status=error). No fleet gateway, no Telegram bot.
Fix: DELETE /api/agents/f2216417 when Paperclip API is fully healthy.

Paperclip state: Mixed. /api/issues returns 400 (alive), company-prefixed returns 401 (State 5 key scope), health endpoint times out. Recovery-closer stuck (sub-hourly scheduler hung).

Free compute: Produced fleet-health-delta-4.
