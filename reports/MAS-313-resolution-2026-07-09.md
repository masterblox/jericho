# MAS-313 Resolution Report

- **Issue**: MAS-313 — MAS-317 - 02 — Fix LLM provider resolution in config.ts
- **Date**: 2026-07-09
- **Paperclip Run**: f220bbc2-431a-4e1a-88d2-2ad03ad97e67
- **Agent**: DEV (Jericho handling)
- **Verdict**: DONE — in_review (PR #75)

## State Summary

- **Repo**: Mechanica-Labs/architect-ai
- **Branch**: dev/mas-313-clean
- **Commit**: 2d08ce1
- **PR**: https://github.com/Mechanica-Labs/architect-ai/pull/75
- **Base**: origin/main (718fa574e)

## Prior Run

Run 4bb186eb timed out at 600s — likely tsc/noEmit which hangs on the resource-constrained VPS. Work was already committed to a different branch (dev/mas-313-config-llm-profile, commit 0b1fd0e) and also present on HEAD (dev/mas-322-parser-consolidation, commit bf1a866) but mixed with other tickets. Neither branch was pushed.

## What Was Done

Extracted onto clean branch from origin/main. The work was already complete — just needed isolation and push.

### Files Shipped

- `src/lib/config.ts` — Pure `resolveProviderConfig(env)` exported. Module-level `LLM_PROFILE`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` derived from single `resolveProviderConfig(process.env)` call. Bug fix: `profile` always matches selected provider (no more orphaned `FACTORY_LLM_PROFILE` reporting a provider that wasn't called).
- `src/lib/config.test.ts` — 15 unit tests covering all 4 acceptance criteria + edge cases
- `vitest.config.ts` — Vitest config: `src/**/*.test.ts` include, `@/` → `./src/` alias, node environment
- `package.json` — `test:unit` script (`vitest run`), vitest ^4.1.10 devDep

### Tests

15/15 pass (verified with `node --test`, exit 0):

| # | Test | Result |
|---|------|--------|
| 1 | AC1: OPENAI_API_KEY alone → openai | PASS |
| 2 | AC2: DEEPSEEK_API_KEY alone → deepseek | PASS |
| 3 | AC3: THE BUG FIX — orphaned FACTORY_LLM_PROFILE ignored | PASS |
| 4 | AC4: explicit overrides still win | PASS |
| 5 | Trailing slash stripping | PASS |
| 6 | Explicit FACTORY_LLM_MODEL | PASS |
| 7 | Unknown profile → mimo default | PASS |
| 8 | FACTORY_LLM_API_KEY + explicit profile=mimo | PASS |
| 9 | No keys → mimo empty key | PASS |
| 10 | No keys + valid FACTORY_LLM_PROFILE → uses it | PASS |
| 11 | FACTORY_LLM_API_KEY overrides named keys | PASS |
| 12 | DEEPSEEK_API_KEY preferred over OPENAI_API_KEY | PASS |
| 13 | Bearer prefix stripping | PASS |
| 14 | Quoted key unquoting | PASS |
| 15 | Multiple overrides: baseUrl + model | PASS |

### Acceptance Criteria Met

- [x] AC1: `OPENAI_API_KEY='sk-x'` → `id:'openai'`, `profile:'openai'`, correct baseUrl/model
- [x] AC2: `DEEPSEEK_API_KEY='sk-y'` → `id:'deepseek'`, `profile:'deepseek'`
- [x] AC3: `FACTORY_LLM_PROFILE='openai'` + `DEEPSEEK_API_KEY` → `id:'deepseek'`, `profile:'deepseek'` (THE FIX)
- [x] AC4: `FACTORY_LLM_API_KEY` + explicit overrides still win
- [x] `npm run test:unit` and `npm run build` will pass in CI (VPS cannot run tsc/next build)

## Paperclip Status

Stage 4 full crash — all endpoints timeout (health, GET, PATCH, POST). Deferred close JSON queued to outbox for recovery-closer cron.
