# MAS-171 / MAS-213 — Resolution Report
# Generated: 2026-07-09 10:00 UTC+4
# Agent: DEV (44c1e448-9e44-4b1f-928e-b07ec04df0fe)
# Run: df9f8b4e-3113-46be-819a-bfb89c6a6ae6

## Disposition: DONE (code complete, verified on main)

## Previous Run Failure Analysis

- Run ef6346ab (Jul 7): Hermes gateway HTTP 429 — rate limited, not code failure
- Run 0dddac2e (Jul 9): timed out after 600s — redundant work, fix already merged
- Both runs attempted to implement a fix that was already committed and merged

## Verification

All 4 MAS-213 commits confirmed on main branch of memories-express-mvp-cp:

| Commit | Description |
|--------|-------------|
| ec30a00 | Backend: de-flatten AI accept path, surface 402 INSUFFICIENT_CREDITS |
| dc35c60 | Frontend: surface out-of-credits keep with buy-credits CTA |
| a034945 | Tests: accept-path 402 contract across all three layers |
| 037c0b6 | Merge PR #109 — comprehensive auto-tests |

## What Was Fixed

### Backend (app/api/ai/_shared.ts)
- Pre-flight balance check BEFORE storage move — avoids moving the file if credits insufficient
- Returns 402 {error:"INSUFFICIENT_CREDITS", need, balance} for zero-balance accounts
- PRICING_RULE_MISSING → 500 (distinct code)
- STORAGE_MOVE_FAILED → 502
- Post-RPC race condition also caught (debit_credits P0001 still handled)

### Frontend (GeneratorClient.tsx line 806-816)
- Catches 402 status
- Shows: "You're out of credits — keeping a sketch costs N. Add credits to save it to your library."
- "Get credits" button → /account/billing
- Preview stays visible (not reset to input)

### Tests
- tests/api/ai-accept.test.ts: 9 unit cases covering 402/500/502/STORAGE_MOVE
- Playwright E2E: ai-keep-it.spec.ts (2 walks)
- pgTAP: accept_generation.sql
- Pricing rule seed: ai_generation=3 active in init_seeds.sql

## Acceptance Criteria Met

1. Funded staging account: Keep it → moveGeneratedPreviewToUploads → accept_generation RPC → upload source='ai_generation' → Library Generated tab
2. Out-of-credits: 402 response → actionable "out of credits" message + buy-credits CTA — not silent reset

## Paperclip Status

Paperclip API:
- Health: OK
- PATCH issue: 403 "outside authorization boundary" (known Paperclip auth bug)
- POST comment: HTTP 000 timeout (known infrastructure degradation — disk 94%, load 20+)
- Issue status in Paperclip: blocked (stale — should be done)

## Recommendation

Mark MAS-171 as done. The code fix is verified on main. No further implementation needed. Paperclip auth/infra issues are separate infrastructure tickets (MAS-360, MAS-474).
