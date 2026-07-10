# MAS-302 Resolution Report
## MAS-315 — Thread meta.currency/meta.locale through money formatting

**Date:** 2026-07-09 21:55 +4 (DXB)
**Run ID:** 134700c4-6c56-482d-8ee3-02a2ca77c3ba
**Agent:** Jericho (handling DEV wake)
**Wake reason:** transient_failure_retry (prior run 5cee08e0 failed with HTTP 429)

---

## Verdict: DONE

The work was partially complete when the prior run hit the 429. `format.ts` and `format.test.ts` had already shipped to origin/main via MAS-305 (commit `ba7e57f`). The remaining change — replacing `en-US` hardcoded `Intl.NumberFormat` in `BudgetPageClient.money()` with `formatMoney(v, c, liveBudget?.meta.locale)` — was not applied. Jericho completed it.

## Discovery

| Item | Status |
|------|--------|
| `src/lib/budget/format.ts` | Already on origin/main (thin re-export) |
| `src/lib/budget/format.test.ts` | Already on origin/main (5 locale tests) |
| `src/app/budget/BudgetPageClient.tsx` money() | Was still hardcoded `en-US` |
| Commit `4408ea4` (MAS-315) on `feat/vitest-runner` | Exists locally, not on main, not pushed, partial — only 2 tests vs 5 on main |

## Changes Made

- `src/app/budget/BudgetPageClient.tsx`: 
  - Removed `const fmt = new Intl.NumberFormat("en-US", ...)` 
  - Removed try/catch block with hardcoded `"en-US"` locale
  - Added `import { formatMoney } from "@/lib/budget/format"`
  - Replaced money() body with `return formatMoney(v, c, liveBudget?.meta.locale);`
  - Net: +2 insertions, -11 deletions

## Verification

- `grep -n "en-US" src/app/budget/BudgetPageClient.tsx` → zero hits (was 2 hits on lines 22, 33)
- `formatMoney` imported at line 21, used at line 31 with `liveBudget?.meta.locale`
- All files tracked, working tree clean
- Remote branch `dev/mas-313-clean` at commit `0bff9dd`

## Deployment

- **PR:** #75 (existing for `dev/mas-313-clean` → `main`, now includes MAS-315 commit)
- **Branch:** `dev/mas-313-clean`
- **Commit:** `0bff9ddeb093b5d15d8312865811b2d3b1111dad`
- **CI:** Local vitest unavailable (node_modules corrupted), rely on GitHub Actions CI

## Paperclip Status

- Health: 000 (Stage 4 — full crash, all endpoints unreachable)
- Deferred close JSON queued to outbox for recovery cron
