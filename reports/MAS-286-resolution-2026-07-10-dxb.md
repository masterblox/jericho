# MAS-286 Recovery Wake Resolution

Issue: MAS-33 - Wire (but soft-launch) the Memories Plus subscription
Paperclip: MAS-286
Wake reason: source_scoped_recovery_action
Resolved: 2026-07-10 DXB

## Audit Summary

Work completed May 23, 2026. All deliverables present on `main` in memories-express-mvp-cp:

1. **seed-stripe-products.ts** (L100-110): Plus plan entry — `kind='plan'`, `slug='plus'`, `credits=50`, `interval='month'`, `price_cents=1900`, `public=true`. Comment on L53-54: "MAS-33 soft-launch flipped public=true so /account/billing surfaces the Plus card alongside the pack grid."

2. **webhook.ts** (L6, L307, L365+): `grantCredits` imported from `@/lib/db/rpc`, called inline from both `handleCheckoutSessionCompleted` (pack purchases) and `handleInvoicePaid` (subscription renewals). Subscription-mode sessions skip the payment-intent path (L274) and credits flow through invoice.paid with idempotency on `ledger_unique_business_event`.

3. **billing/page.tsx** (L150-156): Queries `stripe_product` with `.eq("kind", "plan").eq("slug", "plus").eq("public", true)` — Plus plan surfaces on billing page. PlusCard component imported at L20.

4. **Test files present**: `tests/lib/services/stripe/webhook.test.ts`, `tests/lib/services/stripe/checkout.test.ts`, `tests/api/billing/checkout-route.test.ts`, `tests/api/billing/return-status.test.ts`, `tests/e2e/billing-plus.spec.ts`, `tests/e2e/stripe-cli/subscription-lifecycle.test.ts`

## Verdict

Work is complete. Public flag flipped from false (soft-launch) to true (launched). Plus plan wired end-to-end: Stripe product seed → webhook credit grant → billing page surface.

## Action

Deferred-close JSON queued. Recovery closer cron (paperclip-recovery-closer, every 30m) will deliver the close when Paperclip recovers.
