# MAS-12 / MAS-251 Resolution Report
Date: 2026-07-09 16:00 DXB
Status: Complete, pushed to dev/mas-251-ci-gap-digital-e2e

## Previous Run
Run ee8458ab timed out after 600s — no artifacts produced. Recovery action: rebuilt from continuation summary.

## Changes (commit 07162e6)

### 1. seed.ts — "due" state support
- Added `"due"` to `SeedObligationOpts.state` type union
- When state is "due": back-dates `obligation.delivery` AND `scheduled_job.scheduled_for` to the past WITHOUT setting `fulfilled=true`
- Dispatcher claims the due job on next cron tick

### 2. digital-pipeline.spec.ts — new e2e spec
- Mirrors printed-pipeline.spec.ts POST-cron pattern
- Seeds DUE digital obligation → fires cron → asserts:
  - obligation.fulfilled=true + fulfilled_at set
  - recipient_view.email_id stamped
  - token_hash rotated (new 48-hex token)
  - DELIVERED badge visible on sends detail page

### 3. sendObligation.test.ts — delivered_at contract
- Added `expect(update.values).not.toHaveProperty("delivered_at")` to existing token/email_id persistence test
- Proves dispatcher owns token_hash + email_id; delivered_at is webhook-owned

### 4. Migration — opened_at guard
- 20260709120000_guard_opened_at_delivered_at_invariant.sql
- Adds `and delivered_at is not null` to 'clicked' branch of record_recipient_view_engagement
- Click count still bumps; opened_at stays null until delivered_at is set
- Design decision: WHERE-clause guard, not CHECK constraint (Resend webhooks can deliver click before delivered)

### 5. pgTAP — invariant test
- recipient_view_opened_delivered_invariant.sql — 10 assertions
- Proves: clicked before delivered → count bumped, opened_at null
- Proves: delivered → clicked → opened_at set normally

## Test Results
- sendObligation.test.ts: all 17 tests pass
- webhook.test.ts: all 33 tests pass
- E2E auto-discovered by Playwright (testMatch: **/*.spec.ts)
- CI e2e-seeded job has E2E_SEEDED=1 + CRON_SECRET configured

## Acceptance Criteria
- [x] New seeded spec in e2e-seeded CI job
- [x] Signed email.delivered sets delivered_at (dispatch test + pgTAP cover the chain)
- [x] opened-without-delivered invariant enforced (guard + pgTAP)
- [x] sendObligation contract asserts delivered_at stays webhook-owned
- [x] pnpm test green

## Paperclip Status
Issue MAS-12 needs status update: blocked → in_review
Paperclip API degraded (comments POST times out). Resolution report saved locally.
