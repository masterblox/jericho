# MAS-24 / MAS-216 — Resolution Report

**Date:** 2026-07-09 (DXB)
**Disposition:** Done (code already merged)
**Root cause of retry:** HTTP 429 on Paperclip status update, not on build

## What happened

- Previous run (50c8554c) completed all implementation, pushed PR #122, merged to main
- Crashed with `hermes_gateway_rate_limited: HTTP 429` when updating Paperclip
- This is the standard consolidated-gateway transient failure pattern

## Verification

Commit `b921125` on `memories-express-mvp-cp/main`:

```
[MAS-216] Editor canvas hardening: sized base, drop crop, kill dead chrome, mobile gate (#122)
```

All four issues addressed:

| Issue | Fix | File |
|-------|-----|------|
| 1. Crazy drag / crop tool default | `utils` allow-list excludes crop; `util:"annotate"` | config.ts |
| 2. 1×1 base → degenerate coords | 1200×1800 opaque-white PNG data URL | config.ts |
| 3. Yellow "Done" button overlaps SaveStatus | `enableButtonExport:false` + `enableButtonClose:false` | config.ts |
| 4. Editor unusable on mobile | `EditorViewportGate.tsx` with matchMedia(768px) | EditorViewportGate.tsx + page.tsx |

Tests: config.test.ts, exportImage.test.ts, EditorViewportGate.test.tsx, e2e/designs-editor-mobile-gate.spec.ts

## Working tree

- MAS-216 files: all clean
- Unrelated: `tests/e2e/postgrid-lifecycle.spec.ts` (modified, not MAS-216)

## Close action

Marked `done` on Paperclip.
