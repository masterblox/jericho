# MAS-47 Resolution Report

## Verdict: DONE — work shipped, merged to main

- Issue: MAS-47 (Paperclip) / MAS-175 (Linear) — Stripe refund webhook handler + e2e refund deduct test
- Wake reason: transient_failure_retry (prior run 1228fc28 hit HTTP 429 on Paperclip update, not on build)
- Date: 2026-07-09 ~18:17 DXB
- HEAD: 638d3d7 (== origin/main)

## Fast-path verification

`git log --all --oneline --grep="MAS-175"` returned 4 commits on origin/main:
- `25ec13c` [MAS-175] /review fixes: aggregate-corrected deduct + div-by-zero guard
- `7d0b5c5` [MAS-175] Stripe refund webhook handler + e2e refund-deduct test (#52)
- `ebef997` [MAS-175] Fix pgTAP refund replay test ordering
- `d3809cb` [MAS-175] Stripe refund webhook handler + e2e refund-deduct test

`git merge-base --is-ancestor 7d0b5c5 HEAD` → exit 0

## Shipped files

| File | Lines | Purpose |
|------|-------|---------|
| `lib/services/stripe/webhook.ts` | +225 (PR #52 + /review fix) | `handleChargeRefunded` (lines 437-574) + `case "charge.refunded":` in `dispatchStripeEvent` (line 593) |
| `supabase/tests/stripe_refund.sql` | 129 | pgTAP: 8 tests — grant→refund, replay unique_violation, over-refund P0001 |
| `tests/e2e/stripe-cli/money-math.ts` | +187 | CLI suite extended with refund assertion sequence |
| `tests/lib/services/stripe/webhook.test.ts` | +534 (PR #52 + /review fix) | vitest: 44 tests, including 8 refund-specific |

## Test evidence

- **vitest:** 44/44 passing (tests/lib/services/stripe/webhook.test.ts)
  - charge.refunded with multiple refunds in one completing event deducts each by id
  - charge.refunded in one completing event uses exact remainder so rounding can't overshoot
  - charge.refunded pre-filters already-deducted refunds and uses remainder for the new one
  - charge.refunded over-refund (P0001) is swallowed — no Stripe retry storm
  - charge.refunded concurrent insert (23505) is swallowed as a duplicate
  - charge.refunded skips when no matching pack_purchase grant exists (back-office refund)
  - charge.refunded short-circuits when payment_intent is missing
  - charge.refunded short-circuits when charge.amount is 0 (no div-by-zero)

- **pgTAP:** 8/8 tests at supabase/tests/stripe_refund.sql
- **CLI suite:** money-math.ts extended (70 refund references in file)

## Implementation highlights

- Aggregate-corrected deduct: pre-queries existing refund ledger rows, caps each new deduct to (grant - already_deducted), computes exact remainder on the last pending refund of a completing event — prevents phantom credits after fully-refunded charges
- Over-refund: catches P0001, logs + skips (no Stripe retry storm)
- Div-by-zero guard: charge.amount <= 0 early-return
- Missing grant: log + skip for back-office refunds of charges never granted
- Race condition: catches 23505 (unique_violation) from concurrent webhook delivery
- Uses existing `debit_credits` RPC with `source='refund'` (already in allowlist)

## Paperclip status

Stage 4 degradation — health=200, all API mutations timeout (HTTP 000). Cannot update issue via API. Deferred close JSON queued in outbox.
