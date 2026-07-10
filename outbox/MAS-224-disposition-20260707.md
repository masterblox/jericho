# MAS-224 Disposition — 2026-07-07

## Status: Ready for review (in_review)

## Summary
Schema-alignment fixes applied to the Stripe money-flow e2e hardening suite. The spec and fixture now match the actual DB schema (ledger columns, webhook_event in admin schema). A new migration was created for the webhook_event table.

## Changes

### tests/e2e/fixtures/stripe.ts
- `ledgerRowCount`: `.eq("reference_id")` -> `.eq("source_ref")`
- `waitForWebhookProcessed`: added `.schema("admin")`; `.eq("reference_id")` -> `.eq("source_ref")`
- `webhookEventCount`: added `.schema("admin")`; `external_id` -> `external_event_id`
- `cleanupLedgerForUser`: `.eq("user_id")` -> `.eq("profile_id")`
- Added schema notes in file header

### tests/e2e/stripe-hardening.spec.ts
- `ledgerForPi`: `.eq("reference_id")` -> `.eq("source_ref")`
- All assertions: `source='pack_purchase'` -> `kind='purchase', source='stripe'`
- Refund assertion: `source='refund'` -> `kind='refund'`
- `ledger_unique_business_event` test: added note that index only covers kind='admin_grant' (purchases rely on app-level dedup)
- `afterAll` cleanup: `.like("reference_id")` -> `.like("source_ref")` for all 9 prefixes
- Promo test TODOs: updated column references in comments

### supabase/migrations/20260707010000_webhook_event.sql (NEW)
- Created admin.webhook_event table matching the Database type definition
- `webhook_event_provider_external_unique` index on (provider, external_event_id)
- Service-role grants only

## Remaining Gaps (not in this suite's scope)

| Gap | Why |
|-----|-----|
| No /api/webhooks/stripe route | MAS-30/MAS-31 route — separate tickets |
| No /account/billing/return page | MAS-36 route — separate ticket |
| No /api/billing/return-status endpoint | MAS-36 route — separate ticket |
| ledger_unique_business_event only covers admin_grant | Needs schema change for purchase — separate PR |
| Pre-existing TS errors (row null, type never) | Need explicit null guards — minor cleanup PR |

## Paperclip Update Failure
Could not update MAS-224 via API — 403 "Issue is outside this actor's authorization boundary" (Jericho api key vs DEV agent ownership). Needs DEV's own API key or cross-agent authorization.
