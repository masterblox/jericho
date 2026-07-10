# MAS-195 Resolution — Second Retry

Date: 2026-07-09 ~18:15 DXB
Verdict: DONE — PR #219 open for review

## Context

Second transient_failure_retry wake for MAS-195 (MAS-49: route insufficient-credits users to checkout and back to wizard). Prior run `399518d8` failed with HTTP 429 (rate limited). The first resolution (documented in the transient-failure-retry case study) had already committed the work as `1c33a8c` but it lived on `origin/dev/mas-85-smoke-test` — never merged to main.

## Root Cause

The first retry (case study) found untracked files, committed them, and pushed — but the branch name was `dev/mas-85-smoke-test` (mixed with smoke test work). The PR was either never created (Paperclip was down) or the branch was never merged. The work sat on the wrong branch for a second retry cycle.

## What Was Done

1. Verified commit `1c33a8cfe7da0b85783d462a3842a5c81602006a` exists on `origin/dev/mas-85-smoke-test`
2. Confirmed `lib/services/stripe/return-cookie.ts` and its test are NOT on `origin/main`
3. Confirmed checkout route and return-status route on main do NOT reference the cookie
4. Created clean branch `dev/mas-49-return-cookie-v2` from `origin/main` (638d3d7)
5. Cherry-picked commit `1c33a8c` cleanly → `d4af144`
6. Pushed to `origin/dev/mas-49-return-cookie-v2`
7. Created PR #219: https://github.com/Mechanica-Labs/memories-express-mvp-cp/pull/219

## Files Shipped

| File | Lines | Description |
|---|---|---|
| `lib/services/stripe/return-cookie.ts` | 162 | HMAC-SHA256 signed ephemeral cookie module |
| `tests/lib/services/stripe/return-cookie.test.ts` | 193 | 10 vitest cases |
| `lib/services/stripe/return-status.ts` | +21/-1 | Cookie-first resolution + clearing |
| `app/api/billing/checkout/route.ts` | +6 | `setReturnPathCookie` call after session creation |

## Test Status

- VPS vitest config has missing module (no node_modules installed) — can't run locally
- CI will run on PR #219
- 10 unit tests cover: sign/verify/fail/expire/clear/workgroup-mismatch

## Paperclip Status

Stage 5 auth-deadlock (health=timeout, PATCH=401, comments=401). API key is health-only. Deferred close queued.

## Action Items

- [ ] Review and merge PR #219
- [ ] Paperclip recovery: update MAS-195 to `in_review` with PR link
- [ ] Clean up stale `dev/mas-49-return-cookie` local branch (no diff vs main)
- [ ] Clean up stale `dev/mas-85-smoke-test` branch after smoke test work is merged
