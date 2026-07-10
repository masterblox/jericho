# MAS-187 / MAS-213 — Resolution Report

**Date:** 2026-07-09  
**Verdict:** DONE — work completed and merged to main on June 2, 2026  
**Paperclip wake reason:** transient_failure_retry (prior run hit HTTP 429 on Paperclip update)

## Issue

MAS-213: "Keep it" on a generated image fails silently — accept step never completes, resets to preview

## What Happened

The prior DEV run (dfa5f945) completed all implementation work but hit a 429 rate limit when trying to post the completion update to Paperclip. Paperclip retried with `transient_failure_retry`, but the code was already done.

## Verification

- `git log --all --oneline --grep="MAS-213"` → 4 commits found
- Final commit: `037c0b6` — "[MAS-213] Accept/credits wiring: surface INSUFFICIENT_CREDITS (402) + comprehensive auto-tests (#109)"
- `git merge-base --is-ancestor 037c0b6 HEAD` → YES (on main)
- `HEAD == origin/main` → `638d3d7` (identical)
- PR #109 (squash-merged Jun 2)

## Files Shipped (7 files, +768/-13)

| File | Change |
|------|--------|
| `app/api/ai/_shared.ts` | +150 — balance pre-flight, 402 INSUFFICIENT_CREDITS mapping, storage move isolation |
| `app/api/ai/accept/route.ts` | +22 — maxDuration=300, distinct error forwarding |
| `.../library/generate/GeneratorClient.tsx` | +42 — 402 UI with buy-credits CTA, preview stays |
| `supabase/tests/accept_generation.sql` | +130 — pgTAP: funded accept, double-charge guard, pricing_rule assert |
| `tests/api/ai-accept.test.ts` | +247 — vitest: full branch matrix (200, 402, 500, 502, 409, 404, idempotent) |
| `tests/e2e/ai-keep-it.spec.ts` | +141 — Playwright: funded keep → library, 0-balance → 402 + CTA |
| `tests/e2e/fixtures/seed.ts` | +49 — seedGenerationJob harness helper |

## What the Fix Does

**Backend (acceptGeneratedImage):**
- Balance pre-flight BEFORE touching storage — returns 402 `{need, balance}` if unaffordable
- Wraps `accept_generation` RPC: maps `INSUFFICIENT_CREDITS` (P0001) → 402, `PRICING_RULE_MISSING` → 500
- Storage move gets its own 502 `STORAGE_MOVE_FAILED` (distinguishable from RPC failure)

**Frontend (GeneratorClient):**
- 402 shows actionable message with `need` amount + "Get credits" link to `/account/billing`
- Preview stays in place so user can fund and keep without re-sketching
- Other failures keep generic copy

## Test Coverage

- **vitest:** 9 scenarios — happy path, pre-flight 402, RPC-raised 402, pricing rule missing, storage move fail, unexpected rethrow, idempotent re-accept, non-acceptable 409, 404
- **pgTAP:** Funded accept inserts upload + flips job + debits; re-call is no-op; pricing_rule asserted
- **Playwright:** Funded keep → 200 + library landing; 0-balance keep → 402 + CTA

## Paperclip Status

No update needed — the issue should be moved to `done` when Paperclip recovers.
