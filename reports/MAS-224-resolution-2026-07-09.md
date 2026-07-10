# MAS-224 / MAS-157 Resolution — 2026-07-09

## Status: COMPLETE (merged)

The Stripe money-flow e2e hardening suite was implemented and merged via:
- **PR #55**: `2a614ad [MAS-157] Stripe hardening suite + idempotency vitest tests`
- **Branch**: merged to `main` from `origin/lofimichael/mas-174-stripe-e2e`

## What was built

### CLI Hardening Suite (`tests/e2e/stripe-cli/hardening.ts`)
5 scenarios using locally-signed Stripe events (no live Stripe needed):

1. **Replay attack** — same evt_id POST'd twice → webhook_event count=1, ledger count=1, balance unchanged
2. **Concurrent same-event delivery** — parallel POSTs → exactly one 'inserted' + one 'duplicate', ledger count=1
3. **Checkout abandonment** — `checkout.session.expired` → webhook_event stored with processed_at set, ledger count=0, balance=0
4. **Malformed metadata + retry recovery** — missing workgroup_id → 500 + processing_error set; retry with corrected metadata → 'replayed' + ledger row + cleared error
5. **Signature failure** — forged HMAC → 400, no webhook_event row, no ledger row

Run via: `pnpm test:stripe-cli:hardening` (tsx, no server needed)

### Return-Path Hardening (unit tests)
- `tests/lib/services/stripe/return-cookie.test.ts` — 14 test cases covering HMAC verification, tampering rejection, wrong secret, expiry, clock skew, malformed cookies
- `tests/lib/services/stripe/checkout.test.ts` — `normalizeReturnPath` rejects external URLs and protocol-relative URLs
- `tests/api/billing/return-status.test.ts` — all 5 return status states (ALREADY_CREDITED/PENDING/CANCELED/FAILED/UNKNOWN_SESSION)

### CI Integration
- `.github/workflows/stripe-e2e.yml` runs hardening suite on Stripe-touching PRs + nightly cron
- `package.json` script: `"test:stripe-cli:hardening": "tsx tests/e2e/stripe-cli/hardening.ts"`

## Why the heartbeat timed out

The prior run (cbb70dea) timed out at 600s with no recorded actions. Likely cause: the agent attempted to start the Next.js dev server to run Playwright tests. The CLI hardening suite runs directly via `tsx` with no server needed — it POSTs locally-signed events directly to the webhook endpoint.

## Remaining scope (deferred/blocked)
- Promo + Stripe coupon stack — blocked on MAS-34
- Subscription renewal idempotency — in `subscription-lifecycle.test.ts` (MAS-33)
- Playwright-level return-page tests — require live Stripe test Sessions; covered by vitest unit tests

## Paperclip issue
MAS-224 is `blocked` due to the timeout auto-block mechanism. The agent DEV (44c1e448) cannot PATCH issue status or POST comments due to Paperclip's authorization boundary rules. The issue should be manually moved to `done`.
