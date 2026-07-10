# MAS-332 — Engine-B Per-Region Correctness Test Suite — Completion Report

**Date:** 2026-07-07
**Run ID:** 495c5ded-a242-404d-8056-4f17cae2a8b9
**Agent:** DEV (via Jericho gateway)
**Disposition:** in_review

## Summary

Created `src/lib/budget/regions.test.ts` — a data-driven per-region correctness test suite that iterates all 5 regions from `listRegions()`. The test file uses Node.js built-in test runner (`node:test` + `node:assert/strict`).

## File Created

- **`src/lib/budget/regions.test.ts`** — 179 lines, 8 test cases across 3 describe blocks

## Test Structure

### Region Coverage (2 tests)
- Asserts exactly 5 registered regions
- Asserts all region IDs are unique

### Per-Region Assertions (3 tests x 5 regions = 15 tests, dynamic via `for` loop)

(a) **VAT guard** — Computes `calculateBudget()` → not-null guard → `computeTotals()`. Asserts `totals.vat === totals.base × meta.vatRate` using `assert.strictEqual()`. Currently `vatRate: 0` in `global-calc.ts:57`, so this passes trivially. When ticket 04 (`resolveConstructionTax`) lands and feeds the real construction-cost tax rate into the meta, this becomes the canary — reverting `vatRate` to 0 WILL fail this test. Documented in comments.

(b) **Currency rendering** — Calls `formatMoney(1_000_000, region.currency, region.locale)` and asserts the output contains `region.currencySymbol` OR `region.currency`. Tolerant of `Intl` locales that emit the ISO code instead of a glyph (e.g., Dubai emits "AED").

(c) **Tier monotonicity** — Drives three `ParsedProject` inputs differing only in `quality` (economy / standard / premium) through `calculateBudget` + `computeTotals`. Asserts `premium.total > standard.total > economy.total` via explicit comparison.

### Cross-Region / Mechanism (1 test)

(d) **Alias resolution** — Asserts `mumbai.locationAliases["bandra"] === "bandra-west"` and `"bandra-west" in mumbai.neighborhoods`. Confirmed: `mumbai.ts:354` + `mumbai.ts:83`.

### Identity (1 test)
- Asserts all regions have populated `id`, `name`, `currency`, `currencySymbol`, `locale`, `neighborhoods`, and `baseRates.villa`.

## Prerequisite Gap

The issue spec references two APIs that don't exist yet:

| Spec API | Actual API Used | Ticket |
|---|---|---|
| `computeEstimate(parsed)` → `Estimate\|null` | `calculateBudget(parsed)` → `BudgetProject\|null` | 10 |
| `resolveConstructionTax(region)` → `{rate}\|null` | `meta.vatRate` (currently 0) | 04 |

The test file documents the migration path in comments: when 04 and 10 land, update imports and replace `calculateBudget` → `computeEstimate`, then feed `resolveConstructionTax(region)?.rate ?? 0` into the VAT assertion.

## Verification

- All imports verified to resolve against existing source files
- `bandra` → `bandra-west` alias confirmed at `mumbai.ts:354`
- `bandra-west` neighborhood multiplier confirmed at `mumbai.ts:83`
- `node --test` could not run: execute_code blocked in wake context, delegate_task terminal sandbox doesn't produce side effects. Full test run deferred to CI or manual verification.
- Lint: timed out (30s) as expected on resource-constrained VPS

## Run Command

```bash
cd /opt/data/repos/architect-ai && node --experimental-strip-types --test src/lib/budget/regions.test.ts
```

## Git Status

Test file is untracked — needs `git add src/lib/budget/regions.test.ts` + commit + push.
