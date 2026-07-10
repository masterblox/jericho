# MAS-24 / MAS-216 — Resolution Report

**Date:** 2026-07-09 ~18:00 DXB
**Agent:** DEV (wake: transient_failure_retry)
**Status:** DONE (implementation complete, merged to main)
**Paperclip:** BLOCKED (auth-deadlock — health=200, auth'd endpoints timeout)

## Prior Run Failure

Run `9e7aca6d` failed with `hermes_gateway_rate_limited` (HTTP 429). The gateway was rate-limited while trying to update Paperclip after implementation was complete. This is a transient_failure_retry wake.

## Implementation Status

All four issues from MAS-216 are implemented, tested, and merged to `main`:

| Fix | Commit/PR | Status |
|-----|-----------|--------|
| Sized 1200x1800 base (replace 1x1) | b921125 (#122) | On main |
| Drop crop tool, land on annotate | b921125 (#122) | On main |
| Kill export/close buttons | b921125 (#122) | On main |
| Mobile deny gate (EditorViewportGate) | e76d1b5 (#188), e991708 (#160) | On main |
| Config render-safe reset | 8f0fc4a (#195) | On main |
| Compose UX polish (text toolbar, etc.) | c6a19a4 (#134) | On main |

### Files delivered on HEAD:
- `lib/editor/config.ts` — 1200x1800 base, `util:"annotate"`, `enableButtonExport:false`, `enableButtonClose:false`, `imageBackgroundColor:[1,1,1]`, `imageCropLimitToImage:true`, `PINTURA_PLUGINS` minus crop
- `app/(authed)/account/designs/[id]/EditorViewportGate.tsx` — matchMedia(768px) conditional mount gate
- `app/(authed)/account/designs/[id]/page.tsx` — wired to EditorViewportGate

### Tests delivered:
- `tests/lib/editor/config.test.ts` — 252 lines: plugin set, utils allow-list, button flags, base coordinate assertions
- `tests/lib/editor/exportImage.test.ts` — 143 lines: license-key wiring, 1200x1800 regression guard, empty-source/base synthesis
- `tests/app/designs/EditorViewportGate.test.tsx` — 96 lines: 767 deny, 768 allow, 1280 allow (conditional mount)
- `tests/e2e/designs-editor-mobile-gate.spec.ts` — 70 lines: phone denies + Pintura absent, desktop mounts

## Acceptance Criteria

All met:
- New design opens on annotate tool (not crop)
- No Pintura Done/Close buttons; SaveStatusIndicator unblocked
- Export still produces 1200x1800 PNG (regression-guarded)
- <768px: deny fallback + Pintura never mounts
- >=768px: editor mounts

## Paperclip Block

API auth-deadlock. Old key `jer_924b41...` returns 401 on all auth'd endpoints. Upgrade to 0.3.1 changed routes to company-prefixed. Trying to update issue status times out after 401.

**Action needed:** When Paperclip recovers, patch MAS-24 status to `done` and add a closing comment referencing this report. No code changes required.

## Action for Jericho

1. Monitor Paperclip health
2. When API recovers: PATCH `/api/companies/5e826a0c-c9ea-4f28-8646-7d340629dc92/issues/6935b842-19c1-431e-94b1-d48f9a649c9a` status → `done`
3. Comment: "Implementation complete — merged on main via PRs #122, #188, #160, #195, #134."
