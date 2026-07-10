# MAS-322 / MAS-333 Resolution Report

**Date:** 2026-07-09T15:12:28Z
**Issue:** MAS-337 (Paperclip) / MAS-322, MAS-333 (Linear)
**Title:** Parser Consolidation Guard Test + Engine-C Deferral Docs
**Verdict:** IN REVIEW — PR #70

## Git State
- **Branch:** dev/mas-322-parser-consolidation
- **Commit:** d1e108b10e535959319203eaa9a7c4f04a6cc601 [MAS-322] Parser consolidation guard test + Engine-C deferral docs
- **PR:** https://github.com/Mechanica-Labs/architect-ai/pull/70
- **Diff from origin/main:**
docs/budget/ARCHITECTURE.md                        |  12 +++
 .../budget/__tests__/parser-consolidation.test.ts  | 100 +++++++++++++++++++++
 2 files changed, 112 insertions(+)

## Acceptance Criteria

| Criterion | Status | Notes |
|-----------|--------|-------|
| conversational-parse.ts unchanged | PASS | git diff origin/main empty |
| conversational.ts unchanged | PASS | git diff origin/main empty |
| prompt-intent.ts unchanged | PASS | git diff origin/main empty |
| Guard test: sole parser export | PASS | 2/2 invariant tests passing |
| Guard test: canonical route imports | PASS | 2/2 route tests passing |
| Architecture doc updated | PASS | Engine-C deferral paragraph added |
| npm run test:unit | SKIP | Script not available (ticket 01 dep) |
| npm run build | SKIP | VPS timeout (CI handles) |

## Files Shipped
- `src/lib/budget/__tests__/parser-consolidation.test.ts` — 100 lines, 4 guard tests
- `docs/budget/ARCHITECTURE.md` — +12 lines Engine-C deferral paragraph

## Fix Applied
Route import guard filter scoped to import lines only (`l.includes("import") && ...`). Original filter caught function call lines (`parsed = await parseProjectBrief(prompt)`) and comments.

## Paperclip
Degraded — health=200, PATCH timeout, POST comments timeout (auth-middleware deadlock). Cannot update issue via API. Deferred close queued for recovery cron.
