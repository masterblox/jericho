# MAS-65 / MAS-206 — Resolution Report

**Date:** 2026-07-09
**Agent:** Jericho (DEV wake, consolidated-gateway pattern)
**Verdict:** COMPLETE — PR #95 did the work; PR #218 cleans remaining stale prose

## What Happened

Paperclip wake with `reason: transient_failure_retry` (previous run b0644fbd hit 429 rate limit). This is the consolidated-gateway pattern — DEV's dedicated gateway was decommissioned post-July fleet consolidation; the 429 is from Paperclip's gateway spawn hitting the rate limiter, not from any code failure.

## Audit Result

**The first real PostGrid test run was completed on 2026-06-02 in PR #95** (commit 195212d, run 26794339867). Three contract drifts were found and fixed:
1. Progression model: off-by-one (ready is creation state, first /progressions POST advances ready→printing)
2. cancelPostcard "too late" shape: PostGrid returns 422 with `cancel_failed_error` type (not literal "too late")
3. e2e teardown: removed reference to dropped `public.promo_redemption` table

72 PostGrid vitest tests pass. Webhook self-delivery wired (CI can't be reached from internet).

## Remaining Cleanup → PR #218

Five files still carried stale "UNVERIFIED"/"5-stage"/"BLOCKED" comments. PR #218 fixes 4 of 5:

| File | Fix | Status |
|------|-----|--------|
| `docs/observability/postgrid-api-reference.md` | Update capture date, remove "re-confirm" + "still requires" sections | Merged in PR |
| `docs/observability/postgrid-e2e.md` | "five stages" → "four", remove "still pending" block | Merged in PR |
| `lib/services/postgrid/webhook.ts` | Fix "print_error on return-to-sender" → "print_error set by cancel-too-late" | Merged in PR |
| `tests/e2e/postgrid-lifecycle.spec.ts` | Remove BLOCKED/UNVERIFIED, "5 stages" → "4 stages" | Merged in PR |
| `.github/workflows/postgrid-e2e.yml` | Same stale comments ("advance x 5", "BLOCKED…UNVERIFIED") | **Blocked** — PAT lacks `workflow` scope |

## Delivery-Failure Path: DECIDED

PostGrid has **no** `returned_to_sender` status (confirmed against live API in PR #95, documented in `postgrid-api-reference.md`). `print_error` is set by the cancel-too-late path in `orders.cancel`, not by webhook events. `print_status='failed'` exists in the enum for this cancel path. No further action needed.

## Acceptance Criteria Status

- [x] First real run against test account → PR #95 (2026-06-02)
- [x] Field names / signature / size / name-split confirmed → PR #95
- [x] Delivery-failure path decided + documented → PR #95 + docs
- [x] Stale "unverified/5-stage" comments gone → PR #218 (4/5 files; workflow blocked on token)
- [~] `postgrid-e2e.yml` runs green → needs POSTGRID_*_STAGING secrets in GHA (Michael-owner-only)

## Paperclip Status

Paperclip stage 5 (auth-deadlock) — issue PATCH unavailable. This resolution report serves as durable evidence.
