# MAS-74 — MAS-165: Wire localStorage Restore Prompt on Canvas Mount
## Run: f8ac2f54-1f4a-47e0-87fc-c972f37effce (retry of a6487107)
## Agent: DEV (44c1e448-9e44-4b1f-928e-b07ec04df0fe) via Jericho relay
## Date: 2026-07-07

## Previous Run
- Run a6487107 failed with HTTP 429 (Hermes gateway rate limited) before any work landed

## Disposition: DONE

All implementation and tests already existed from a prior completed run. The 429 retry landed on an already-complete issue. No new code changes needed.

## Implementation Audit

### 1. SaveController (state machine)
File: `app/(authed)/account/designs/[id]/_hooks/SaveController.ts` (541 lines)

All required methods present:
- `readCachedNewerThan(serverVersion)` — line 177: reads localStorage, validates shape, returns cached snapshot when version > server
- `clearCache()` — line 225: removes localStorage key
- `restoreFromCache(serverVersion, serverState)` — line 502: re-baselines OCC to server version + server state hash, clears suppression flag
- `setLastAckedSnapshot(version, state)` — line 515: re-baselines, un-suppresses saves on CONFLICT reload
- `writeCache(version, data)` — line 210: writes to localStorage on every successful save

### 2. useCanvasSave (React glue)
File: `app/(authed)/account/designs/[id]/_hooks/useCanvasSave.ts` (187 lines)

- Lines 64-89: `cachedRestore` state with lazy initializer that reads `localStorage.getItem(template:${templateId})` on mount, validates shape, compares `parsed.version > initialVersion`
- Lines 171-185: `dismissRestore` function — restore path calls `controller.restoreFromCache()` + `controller.scheduleSave()`, discard calls `controller.clearCache()`
- Lines 137-151: Playwright bridge `__saveController` exposure

### 3. DesignEditor (UI wiring)
File: `app/(authed)/account/designs/[id]/DesignEditor.tsx` (462 lines)

- Lines 101-115: Destructures `cachedRestore`, `dismissRestore` from `useCanvasSave`
- Lines 85: `restoredFromCache` state — flips on restore to enable signed URL refresh
- Lines 408-427: Renders `LocalRestoreBanner` when `cachedRestore` is truthy
  - onRestore: swaps canvas state to cached data, bumps version for Canvas remount, sets restoredFromCache=true, calls dismissRestore("restore")
  - onDiscard: calls dismissRestore("discard")

### 4. LocalRestoreBanner (UI component)
File: `app/(authed)/account/designs/[id]/_components/LocalRestoreBanner.tsx` (56 lines)

- `data-testid="restore-prompt"` — prompt container
- `data-testid="restore-prompt-confirm"` — Restore button
- `data-testid="restore-prompt-discard"` — Discard button
- Shows local vs server version numbers for user awareness

## Test Coverage

| Test File | Scope | Tests |
|---|---|---|
| tests/app/designs/DesignEditor.test.tsx | Vitest integration | 6 tests: prompt renders with newer cache, no prompt when cache <= server, no prompt on corrupt cache, Restore OCC re-baseline (base_version=server, single bump), Discard clears cache, workgroup switch guard |
| tests/app/designs/SaveController.test.ts | Vitest state machine | 706 lines covering scheduleSave, flushSave, CONFLICT, NOT_FOUND, OFFLINE, backoff, restoreFromCache, setLastAckedSnapshot |
| tests/e2e/designs-local-restore.spec.ts | Playwright e2e | 5 tests: prompt appears with newer cache, Discard clears + dismisses, Restore re-baselines OCC + follow-up save clean, no prompt when equal version, corrupt fallback silent |

## Acceptance Criteria Against Linear MAS-165

- [x] On mount, call readCachedNewerThan — `useCanvasSave` lazy useState init (line 64-89)
- [x] Render restore prompt when newer cached snapshot exists — `LocalRestoreBanner` with data-testid="restore-prompt"
- [x] Restore path: hydrate from cache, mark dirty, save (single version bump) — `dismissRestore("restore")` at line 171-179
- [x] Discard path: drop cache, hydrate from server — `dismissRestore("discard")` at line 181-183
- [x] Vitest case: mount with stale server + newer cache, assert prompt — DesignEditor.test.tsx line 178
- [x] Playwright case: edit → reload → expect restore prompt — designs-local-restore.spec.ts line 29

## No changes required. Issue is complete.
