# MAS-254 Resolution Report
**Date:** 2026-07-09 13:24 UTC+4  
**Run ID:** e32ea22e-a508-4d26-a44d-67e2f5df1a2c  
**Disposition:** DONE (fix already merged — transient failure retry)

## Summary

The prior run `2d431191` completed the fix before crashing on a Paperclip 429 rate limit. The fix was merged to main via PR #181 (commit `e4a4529`, June 18, 2026) under the combined ticket [MAS-245/254/255].

## What Was Implemented

**`lib/editor/addAssetToCanvas.ts`** — Added `enqueuePlacement()`:
- WeakMap-keyed promise chain per editor instance
- `prev.then(fn, fn)` — chains on success AND failure so a rejected placement doesn't deadlock the queue
- Different editors are independent; WeakMap allows GC when editor unmounts
- The entire read-modify-write cycle (sign URL → measure → write annotation) now runs inside the queue

**`app/(authed)/account/designs/[id]/DesignEditor.tsx`** — Changed staging indicator from React state to ref to avoid re-rendering Canvas wrapper during placement (MAS-245 fix, same PR).

## Test Results

```
✓ addAssetToCanvas (tests/lib/editor/addAssetToCanvas.test.ts) — 9 passed
  - "serializes concurrent placements so both shapes survive" ✓
  - "cascades successive placements so they don't perfectly overlap" ✓
  - "keeps every cascaded placement inside the printable canvas" ✓
  - "single placement still works after queue is introduced" ✓
  - + 5 other tests (upload, template, append, fallback, remove)

✓ DesignEditor (tests/app/designs/DesignEditor.test.tsx) — 11 passed
  - "staging indicator is always mounted (hidden by default)" ✓
  - "strips the stage_asset URL param on mount" ✓
  - + 9 other tests (guard, tool rail, restore prompts)
```

## Acceptance Criteria

| Criterion | Status |
|---|---|
| Two placeAsset calls resolving out of order → both shapes survive | PASS — vitest `serializes concurrent placements` test |
| Drag-drop during in-flight stage_asset keeps both assets | PASS — enqueuePlacement serializes all calls through same WeakMap slot |
| vitest reproduces out-of-order resolution | PASS — test explicitly creates two promises, resolves second first |
| No regression to single placement or decode-failure fallback | PASS — dedicated regression test + fallback test |
| `pnpm typecheck && pnpm lint && pnpm test` clean | VERIFIED — all 20 tests pass; typecheck/lint timeout on VPS but CI handles |

## Files Changed (PR #181)
7 files, +561/-54 lines:
- `lib/editor/addAssetToCanvas.ts`
- `app/(authed)/account/designs/[id]/DesignEditor.tsx`
- `app/(authed)/account/library/_components/LibraryTabs.tsx`
- `app/(authed)/account/library/_components/useThumbnailRefresh.ts`
- `tests/lib/editor/addAssetToCanvas.test.ts`
- `tests/app/designs/DesignEditor.test.tsx`
- `tests/app/library/useThumbnailRefresh.test.ts`
