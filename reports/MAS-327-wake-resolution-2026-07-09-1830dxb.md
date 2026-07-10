# MAS-327 Wake Resolution — 2026-07-09 18:30 DXB

**Wake reason:** source_scoped_recovery_action
**Prior run:** 3046e615 — failed with HTTP 429 (rate limited), zero artifacts
**Paperclip status:** Stage 4 (000 on health + issue GET)
**Issue status in Paperclip:** blocked

## Audit Results

### Guard condition: FAILED

Ticket 06 (planner-trust-fix) has NOT merged to main. `buildRegionalExtras` is still actively called:

```
src/lib/budget/global-calc.ts:41:  const extrasChapter = buildRegionalExtras(region, subtotal);
src/lib/budget/global-calc.ts:143: function buildRegionalExtras(
src/lib/budget/global-calc.ts:147:  if (region.regionalExtras.length === 0) return null;
src/lib/budget/global-calc.ts:149:  const items: BudgetLineItem[] = region.regionalExtras.map(...
```

Removing `regionalExtras` from the type and region files NOW would break tsc/build — the consumer still exists.

### regionalExtras in src/: 11 references across 8 files

| File | Lines |
|------|-------|
| global-calc.ts | 2 (consumer — ticket 06's domain) |
| types.ts | 2 (field declaration + docstring) |
| dubai.ts | 1 |
| lisbon.ts | 1 |
| london.ts | 1 |
| mumbai.ts | 1 |
| nyc.ts | 1 |
| bangalore.ts | 1 — NOT in ticket scope |

**Discovery: bangalore.ts** has a `regionalExtras` block at line 278 that is NOT listed in the ticket's scope. The ticket names 5 region files but there are 6. Any removal must include bangalore.ts or the `RegionalRates` type change will break it.

### Prior work on side branches (not merged)

Two prior agent runs independently did the MAS-318 work on feature branches:

| Commit | Branch | Files | Scope |
|--------|--------|-------|-------|
| 1670479 | dev/mas-300-3d-render-pipeline | 8 files, 82 del | Removes regionalExtras + buildRegionalExtras (bundles 06+07). Includes bangalore.ts. |
| 695ae85 | feat/vitest-runner | 7 files, 74 del | Same but MISSES bangalore.ts. |

Neither branch is merged to main. Neither is ancestor of main (HEAD: 718fa57).

### Paperclip: unreachable

Health returns 000. Direct PATCH blocked.

## Verdict: BLOCKED

The guard condition (ticket 06 merged) is not met. Two prior agents did the combined 06+07 work on side branches but neither landed. The correct path:

1. Ticket 06 merges first (removes `buildRegionalExtras` from global-calc.ts)
2. Then cherry-pick 1670479 (which includes bangalore.ts) or redo 07 as scoped

Issue stays blocked until dependency resolves.

## Actions this wake

- Audit completed — guard condition verified as unmet
- No code changes (guard blocks all work)
- No stale outbox artifacts found for MAS-327
- Deferred-close JSON queued with blocked status
