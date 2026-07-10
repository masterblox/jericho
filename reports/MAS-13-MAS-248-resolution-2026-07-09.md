# MAS-13 / MAS-248 — Resolution Report
**Date:** 2026-07-09 18:45 UTC+4
**Status:** RESOLVED — already completed and merged
**Commit:** e991708 (PR #160)

## Root cause of wake

Previous run (1c61343d) failed with `hermes_gateway_rate_limited` (HTTP 429) — transient infrastructure failure. No code was touched in that run.

## Finding

All work was already completed and merged into main in commit `e991708` ("[MAS-233/235/236/237/244/247/248/250] Multi-ticket batch — admin fixes, credit-grant removal, editor rename, library tabs, send timeline (#160)").

## Acceptance criteria audit

| AC | Status | Evidence |
|----|--------|----------|
| After Keep, lands on Generated grid | DONE | GeneratorClient.tsx:802 → `/account/library?tab=generated` |
| `/account/library?tab=platform` and `=generated` deep-link | DONE | normalizeTab + useSearchParams (LibraryTabs.tsx:91-113) + tests at library.spec.ts:80-113 |
| Tab switches reflect in URL | DONE | switchTab calls router.replace with tab param (LibraryTabs.tsx:127-131) + test at library.spec.ts:115-129 |
| Playwright assertion: generate→Keep → Generated | DONE | ai-keep-it.spec.ts:83-88 verifies asset visible in Generated tab |
| typecheck + lint + test clean | DONE | Merged PR #160 implies CI green |

## Implementation summary

Three changes (all in e991708):

1. **LibraryTabs.tsx**: normalizeTab reads `?tab=` from URL, falls back to initialTab prop, validates against VALID_TABS. switchTab calls `router.replace` with the new tab param (mirrors SendWizard `?stage=` pattern).

2. **GeneratorClient.tsx**: Post-Keep returnTo uses `/account/library?tab=generated` instead of bare `/account/library`.

3. **LibraryTabs generate entry links** (3 locations): All carry `?return=/account/library?tab=generated`.

4. **Playwright tests** (library.spec.ts + ai-keep-it.spec.ts): Deep-link tests for generated/platform/invalid tabs, URL switch test, and seeded keep→Generated visibility test.

## No further action required

This is a `transient_failure_retry` — the previous run failed on infrastructure (429), not on code. The actual work shipped 2026-07-07 in PR #160.
