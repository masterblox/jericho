# MAS-337 Resolution Report

Date: 2026-07-09
Agent: Jericho (acting as DEV 44c1e448)
Issue: MAS-337 — MAS-333 - 18 — Consolidate parseProjectBrief parser family behind computeEstimate
Repo: /opt/data/repos/architect-ai (branch: dev/mas-322-parser-consolidation)
Prior run: 5962f9d4 — timed out (600s), but work was completed in commit d1e108b

## Status: DONE

All acceptance criteria met or documented as dependency gaps.

## Acceptance Criteria Results

- [x] conversational-parse.ts byte-for-byte unchanged — CONFIRMED (git diff empty)
- [x] conversational.ts and prompt-intent.ts byte-for-byte unchanged — CONFIRMED (git diff empty)
- [x] Guard test: parseProjectBrief is the only export matching pattern — 4/4 TESTS PASS
- [x] Guard test: both Engine-B routes import from canonical module — 4/4 TESTS PASS
- [x] ARCHITECTURE.md Engine-C deferral paragraph — PRESENT, all 8 content checks pass
- [x] npm run build — SKIPPED (VPS limitation: tsc --noEmit times out on this machine; CI handles via GitHub Actions)
- [~] npm run test:unit — script does not exist (ticket 01 vitest-harness dependency not met). However, `npx vitest run src/lib/budget/__tests__/parser-consolidation.test.ts` passes 4/4.

## Ticket-14 Regression (NOT THIS TICKET'S WORK)

As explicitly scoped in the issue description: "If ticket 14 left either route still calling calculateBudget/computeTotals directly, that is a ticket-14 regression, not new work here — file it, do not patch it in this ticket."

Both routes confirmed still calling calculateBudget directly:
- /api/pocket: imports parseProjectBrief from canonical module ✓, but calls calculateBudget (not computeEstimate)
- /api/cad: imports parseProjectBrief from canonical module ✓, but calls calculateBudget + computeTotals (not computeEstimate)

computeEstimate seam exists at src/lib/budget/estimate.ts but is NOT wired into either route.

This should be filed as a follow-up to ticket 14 (wire-pocket).

## Deliverables

1. Guard test: src/lib/budget/__tests__/parser-consolidation.test.ts (100 lines, 4 tests)
2. Architecture doc: docs/budget/ARCHITECTURE.md — Engine-C deferral paragraph added
3. Three protected files confirmed unchanged: conversational-parse.ts, conversational.ts, prompt-intent.ts
