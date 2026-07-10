# MAS-326 Resolution Report

**Date:** 2026-07-09 17:19 UTC+4 (Dubai)
**Verdict:** done (PR #211 open for review)
**Paperclip status:** Stage 4 — all API endpoints HTTP 000; manual update needed when service recovers

## Summary

Created `resolveConstructionTax` helper and supporting region data per MAS-316-04 spec. Prior run (e1adce13) hit HTTP 429 on Paperclip update but had already built all files — verified, tested, and shipped.

## Commit

- **Branch:** `dev/mas-326-resolve-construction-tax`
- **Commit:** `581cf53` — `[MAS-326] feat: resolveConstructionTax helper over region.legal.taxes`
- **PR:** https://github.com/Mechanica-Labs/memories-express-mvp-cp/pull/211
- **Base:** main (HEAD == origin/main at 638d3d7)

## Files Shipped (10 files, 323 insertions)

```
lib/budget/resolveConstructionTax.ts            — implementation (65 lines)
lib/budget/regions/types.ts                     — Tax, TaxBracket, RegionalRates types
lib/budget/regions/lisbon.ts                    — IVA 0.23
lib/budget/regions/mumbai.ts                    — GST 0.12
lib/budget/regions/london.ts                    — VAT 0.20
lib/budget/regions/dubai.ts                     — VAT 0.05
lib/budget/regions/nyc.ts                       — Sales Tax 0.08875
lib/budget/regions/registry.ts                  — listRegions()
lib/budget/regions/index.ts                     — barrel exports
tests/lib/budget/resolveConstructionTax.test.ts — 9 vitest tests
```

## Tests (9/9 pass)

```
 ✓ resolveConstructionTax
   ✓ resolves Lisbon IVA at 0.23
   ✓ resolves Mumbai GST at 0.12
   ✓ flags NYC as approximate with a non-empty note
   ✓ flags Dubai as approximate with a non-empty note
   ✓ does NOT flag Lisbon as approximate
   ✓ returns non-null with 0 < rate < 1 for every registered region
   ✓ returns null when no flat construction_cost tax exists
   ✓ returns null when only a progressive construction_cost tax exists
   ✓ returns null when only a property_value flat tax exists
```

## Acceptance Criteria

- [x] Lisbon rate === 0.23, Mumbai rate === 0.12
- [x] Every listRegions() entry returns non-null with 0 < rate < 1
- [x] NYC and Dubai return approximate:true with non-empty note
- [x] Lisbon returns approximate falsy
- [x] Return type is nullable (ResolvedConstructionTax | null)
- [x] All tests pass

## Deviation from Issue Spec

Issue specified `src/lib/budget/` but this repo uses `lib/` at root (no `src/` prefix). Files placed at `lib/budget/` which resolves correctly via `@/*` path alias (tsconfig: `"@/*": ["./*"]`).

## Paperclip Note

Paperclip unreachable at time of completion (health=200 but all /api/* endpoints timeout with HTTP 000). Issue status remains `in_progress` in Paperclip — needs manual update to `in_review` or `done` when service recovers. PR #211 is the authoritative source of truth.
