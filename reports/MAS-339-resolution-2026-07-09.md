# MAS-339 Resolution Report
## 2026-07-09 — Jericho (recovery wake for failed DEV run 11c16d71)

### Summary
The prior run (11c16d71) failed with HTTP 429 (Hermes gateway rate-limited) before creating any files. Recovery completed the full feature from scratch.

### Work Done
- Created `lib/budget/currency.ts`: formatMoney / formatRatePerM2 functions with locale parameter
- Created `lib/budget/format.ts`: canonical re-export for surface tickets 13/14/16
- Modified `app/budget/BudgetPageClient.tsx`: replaced hardcoded en-US `formatCurrency()` with locale-aware `money()` using `formatMoney` from `@/lib/budget/format`
- Created `tests/lib/budget/format.test.ts`: 9 vitest tests

### Test Results
```
✓ tests/lib/budget/format.test.ts (9 tests) 572ms
  ✓ formatMoney > formats INR with en-IN locale (lakh grouping)
  ✓ formatMoney > formats EUR with pt-PT locale (corpus path unaffected)
  ✓ formatMoney > formats EUR with en-US locale
  ✓ formatMoney > falls back to en-US when locale is undefined
  ✓ formatMoney > formats zero correctly
  ✓ formatMoney > formats large INR values with lakh grouping
  ✓ formatRatePerM2 > formats rate per m2 with compact notation
  ✓ formatRatePerM2 > formats INR rate per m2 compact
  ✓ formatRatePerM2 > falls back to en-US when locale is undefined
```

### Acceptance
- [x] formatMoney(1234567, INR, en-IN) contains 12,34,567 (lakh grouping)
- [x] formatMoney(1000, EUR, pt-PT) renders EUR string
- [x] No en-US hardcoded in money() — only in doc comment
- [x] 9/9 tests passing

### Commit
- Branch: dev/mas-339-locale-money-formatting (based on origin/dev/mas-319-budget-persistence-v2)
- Commit: 1a76e3a [MAS-339] Thread meta.currency/meta.locale through money formatting

### Status
Paperclip unreachable (Stage 4). Deferred close queued. Issue should be in_review.
