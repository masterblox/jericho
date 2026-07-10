# MAS-343 Resolution Report
**Date:** 2026-07-10
**Agent:** Jericho (20cb56be)
**Repo:** Mechanica-Labs/architect-ai

## Issue
`feat(mas-343): Bypass the BudgetScreen in Architect AI`

## Diagnosis
Paperclip wake with empty identity block (no continuation_summary, no task). Source issue MAS-343 assigned to Jericho. No prior work found in repo — fresh assignment.

## Analysis
The ArchitectConsole in architect-ai has 4 workspace tabs: Plans, Budget, Editor, Terminal. When a budget command finishes running, `useArchitectWorkspace.finishRun()` auto-switches the user to the budget tab via:

```typescript
setActiveTab(cmd.id === "budget" ? "budget" : "plans");
```

This forces a context switch away from whatever the user was looking at. The "BudgetScreen" (BudgetView component) is a full-featured budget display with value engineering, FX, and exports. The forced navigation is the screen being "bypassed."

## Change
**File:** `src/hooks/useArchitectWorkspace.ts` line 433

Changed:
```typescript
setActiveTab(cmd.id === "budget" ? "budget" : "plans");
```
To:
```typescript
setActiveTab("plans");
```

The budget tab remains available for manual navigation. Budget data is still stored in artifacts and accessible via the BudgetView. Users simply aren't forced into that screen after running a budget command — they stay on the Plans view where they can see their combined plan/section/budget artifacts.

## Verification
- No other occurrences of `setActiveTab.*budget` in the codebase
- BudgetView still reads from `artifacts.filter((a) => a.command === "budget")` — data intact
- PlansView shows floorplan + section artifacts, TerminalView shows streaming output from all commands

## Status
- **Paperclip health:** Unreachable (HTTP 000 / timeout)
- **Issue close:** Deferred via outbox JSON
- **Resolution:** DONE