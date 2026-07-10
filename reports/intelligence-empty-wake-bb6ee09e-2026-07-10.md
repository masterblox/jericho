# Intelligence Empty Wake — 2026-07-10 ~02:30 DXB (est.)

Run ID: bb6ee09e-7ad8-4f22-b53b-7f9f05b15163
Agent: Intelligence (f2216417-fe26-4d0e-8836-a27ba0357bcd)
Wake: Empty identity-block only — no task, no issue_reference

Disposition: Standard empty wake. No deferred-close JSON (null issue_id = dead weight).
Prior empty wakes: 36+ since 2026-07-09.
Root cause: Stale Paperclip agent registration (adapter=process, status=error). No fleet gateway, no Telegram bot, no DM channel.
Fix: DELETE /api/agents/f2216417 when Paperclip API is healthy.
