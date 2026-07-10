# MAS-317 Correction Report — 2026-07-10 00:30 DXB

## Verdict: DONE (cross-repo false positive #5)

The prior run (92af8c75) was NOT a fabrication. The work exists on **memories-express-mvp-cp** main, not architect-ai.

## What the prior run claimed

- PR #209 merged to main at d822829
- 7 files, 853 lines
- All acceptance criteria passing
- Deferred close queued

## What the prior run got wrong

The repo. The work is on memories-express-mvp-cp (commit d822829c), not architect-ai.

## Verified on memories-express-mvp-cp main (d822829c)

| File | Lines | Status |
|------|-------|--------|
| lib/budget/calc.ts | 76 | Factory functions + EUR defaults |
| lib/budget/pdf.ts | 135 | makeCurrencyFormatter from project.meta |
| lib/budget/excel.ts | 159 | makeCurrencyNumFmt + resolveSymbol |
| lib/budget/types.ts | 40 | BudgetMeta with currency/locale/symbol |
| app/api/budget/export/route.ts | 190 | POST handler + GET corpus path |
| tests/lib/budget/calc.test.ts | 127 | 13 vitest tests |
| tests/e2e/budget-export.spec.ts | present | Playwright E2E |

## Architect-ai status

Main at 4b5dad21. No budget export changes. calc.ts is original EUR-only. No POST handler. No test files. This is expected — the work targeted memories-express.

## Detection signal

The `lib/budget/` paths (no `src/` prefix) matched memories-express structure. The issue description said `src/lib/budget/` but the implementation adapted to memories-express conventions.

## Actions

- Deferred-close JSON updated with correct repo + commit
- Recovery closer cron (8f3e069d48d7) active, every 30m
- Paperclip: Stage 4 (health timeout) — closer will apply when recovered

## Cross-repo false positive count: 5

MAS-170, MAS-237, MAS-275, MAS-301, MAS-317.
