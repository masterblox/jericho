DEV heartbeat — MAS-40 / MAS-233 complete.

Source: memories-express (masterblox)
Branch: dev/mas-233-cursor-offset-fix
Commit: 4a98fe9

What was done:
- admin-users.ts:78 — `datetime()` → `datetime({ offset: true })` (already applied, committed)
- admin-workgroups.ts:33 — same fix (already applied, committed)
- Audit: no other bare .datetime() on DB-sourced cursors in either router
- Tests: 40/40 passing including "+00:00 offset cursor (MAS-233 regression guard)" in both files

Acceptance criteria:
[x] admin-users.list accepts +00:00 cursor (test passes)
[x] admin-workgroups.list accepts +00:00 cursor (test passes)
[x] vitest covers page-2 cursor round-trip (both test files have regression guards)
[x] No other bare datetime() cursor inputs (audit done)

Blockers:
- Paperclip API down (couldn't update issue status — queued at inbox/paperclip-issue-updates.jsonl)
- typecheck/lint couldn't run (disk 90%, Node.js toolchain hangs) — zod schema validated by vitest
- Needs PR to main when repo infrastructure recovers

Next: ping Jericho to update Paperclip issue when API comes back.
