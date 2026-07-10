# MAS-24 Resolution — MAS-216 Editor Canvas Hardening

**Status: COMPLETE — Already merged to main (#122)**
**Date: 2026-07-09 16:53 UTC+4**
**Prior run: af6570e5 (hermes_gateway_rate_limited / HTTP 429 — no work done)**

## Root cause of wake

The prior continuation run (af6570e5) was rate-limited by the Hermes gateway before it could inspect the repo or take any action. The Paperclip wake is a transient_failure_retry — the actual work was already completed and merged as PR #122 (commit b921125) by @lofimichael on 2026-06-02.

## Verification

### Git

- Commit `b921125` is an ancestor of both `main` and the current HEAD (`dev/mas-339-locale-money-formatting`)
- No diff between main and HEAD on any of the four files:
  - `lib/editor/config.ts` — no diff
  - `app/(authed)/account/designs/[id]/EditorViewportGate.tsx` — no diff
  - `app/(authed)/account/designs/[id]/page.tsx` — no diff
  - `lib/editor/exportImage.ts` — no diff

### Tests (all pass)

- `tests/lib/editor/config.test.ts` — 22 tests passed
- `tests/lib/editor/exportImage.test.ts` — 9 tests passed
- `tests/app/designs/EditorViewportGate.test.tsx` — 3 tests passed
- `tests/e2e/designs-editor-mobile-gate.spec.ts` — E2E coverage exists

### Acceptance criteria

1. Sized base: BLANK_CANVAS_SRC is a real 1200x1800 opaque-white PNG (config.test.ts validates full decode/IDAT inflate)
2. Crop tool dropped: utils allow-list excludes crop (config.test.ts asserts)
3. util:"annotate" — editor opens on compose tool (config.test.ts asserts)
4. enableButtonExport:false + enableButtonClose:false — no Pintura Done/Close buttons (config.test.ts asserts)
5. Export still produces 1200x1800 PNG (exportImage.test.ts regression guards)
6. Mobile gate: <768px denies with fallback, >=768px mounts editor (EditorViewportGate.test.tsx 767-vs-768 boundary)
7. page.tsx repointed to EditorViewportGate

## No action needed

The previous run crashed before doing anything because the work was already done. Paperclip is unreachable (timeout on /api/health) — deferred close JSON written to outbox.
