# Fleet Health Snapshot — 2026-07-10 ~02:00 DXB

Triggered by: Intelligence empty wake 73616fae (free compute used for fleet health audit)

## Paperclip

Status: Stage 4 — fully unreachable (8s timeout on /api/health)
Duration: ~48 hours and counting (since ~Jul 8)

## Deferred-Close Backlog

67 total pending close files in outbox:
- 50 paperclip-deferred-close-MAS-*.json
- 17 paperclip-close-MAS-*.json

Recovery closer cron: running every 30min, last status "ok" — but Paperclip is dead so no closes can actually execute. Files will accumulate until Paperclip recovers.

Note: 403 "outside authorization boundary" variant is still possible. Recovery closer has been patched but will only be testable when Paperclip health returns.

## Cron Health

| Job | Status | Last OK | Note |
|-----|--------|---------|------|
| night-watch (every 6h) | ok | Jul 9 18:00 | Fleet gateways up |
| linear-consume (30m) | ok | Jul 9 19:48 | Linear sync active |
| nightly-synthesis (18:30 UTC) | ok | Jul 9 18:30 | Daily digest running |
| bridge-poller (3m) | ok | Jul 9 19:54 | Agent handoffs flowing |
| course-update (every 2d) | ok | Jul 9 05:05 | Agent course correction |
| morning-briefing (05:00 UTC) | ERROR | Jul 8 05:00 | Failed last run — investigate |
| researcher-daily-scan (180m) | ok | Jul 9 19:04 | Competitive scanning |
| intelligence-signal-scan (180m) | ERROR | Jul 8 04:25 | Hasn't run in 42+ hours |
| paperclip-recovery-closer (30m) | ok | Jul 9 19:33 | Running but Paperclip dead |
| researcher-weekly-digest (Mon) | pending | never run | First run Jul 13 |
| analyst-weekly-report (Sun) | pending | never run | First run Jul 12 |
| analyst-monthly-deepdive (1st) | pending | never run | First run Aug 1 |
| MAS-247-commit-llm (one-shot) | never ran | never | Stale one-shot, should cancel |

2 errors: morning-briefing (last success Jul 8) and intelligence-signal-scan (last success Jul 8). Both may be Paperclip-degradation casualties.

## Competitive Intelligence

Omnigent: deep-dived x4 (4 separate reports from 4 wake sessions — redundancy). Key findings consolidated:
- 6,915 stars, Apache 2.0, 30 days old
- Meta-harness wrapping 10+ coding harnesses (Claude Code, Codex, Cursor, Hermes, etc.)
- Session-scoped agents (not persistent fleet) — limited overlap with Mechanica
- Policy engine (3-tier) is cleaner than fleet guardrails — stealable architecture
- Threat vector:如果他们加 persistent identity + cron + peer messaging 就进入 Mechanica 领地

beeai-framework (IBM): 3,313 stars, 462 forks. Python+TypeScript, multi-agent framework. Created Aug 2024. Enterprise-focused. Lower threat than Omnigent — mature but not explosively growing.

## Wake Frequency (last 24h)

Intelligence f2216417 empty wakes: 8+ on Jul 9 (still firing into Jul 10)
Analyst 23ce64e7 empty wakes: 5+ on Jul 9-10
Researcher empty wakes: 2 on Jul 10

All non-fleet agents fire empty wakes repeatedly during Paperclip Stage 4. Root cause: stale agent registrations (status=error, adapter=process). Fix requires Paperclip API access to delete registrations.

## Duplicate Reports (Omnigent)

4 separate Omnigent deep-dive reports from different wake sessions:
- omnigent-competitive-deep-dive-2026-07-10.md
- omnigent-competitive-intelligence-2026-07-10.md
- omnigent-deep-dive-2026-07-10.md
- omnigent-competitive-deepdive-2026-07-10.md

These are redundant. The intelligence-empty-wake handler should check for existing reports before running a new deep-dive. This is a pattern to fix in the non-fleet-agent-wakes.md reference.

## Recommendations

1. Fix morning-briefing and intelligence-signal-scan cron errors — both dead since Jul 8
2. Cancel stale MAS-247-commit-llm one-shot (never ran, past its scheduled time)
3. Patch non-fleet-agent-wakes.md to check for existing competitive reports before running new deep-dives (4 Omnigent reports is 3 too many)
4. When Paperclip recovers: delete stale Intelligence/Analyst registrations to stop empty wake spam
5. 67 deferred-close files will all fire when Paperclip recovers — expect a burst of Linear status updates
