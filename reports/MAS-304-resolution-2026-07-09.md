# MAS-304 / MAS-317 — LLM Provider Resolution Fix — Resolution Report

**Date:** 2026-07-09  
**Agent:** DEV (hermes_gateway)  
**Run ID:** 17f78234-a162-4dbc-aded-7ecef0849593  
**Verdict:** DONE

## Summary

Created `lib/llm-config.ts` with a pure `resolveProviderConfig(env)` function and fixed the LLM_PROFILE bug where it could report a different provider than the one actually selected by key resolution.

## What Was Built

### lib/llm-config.ts

- `resolveProviderConfig(env)` — pure resolver taking NodeJS.ProcessEnv, returning `{ id, key, baseUrl, model, profile }`
- Resolution priority: FACTORY_LLM_API_KEY → DEEPSEEK_API_KEY → OPENAI_API_KEY
- Explicit overrides (FACTORY_LLM_BASE_URL, FACTORY_LLM_MODEL) win over provider defaults
- Module-level exports (`LLM_PROVIDER`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_PROFILE`) derived from `resolveProviderConfig(process.env)`
- NODE_ENV=test safe defaults for direct import in tests

### tests/lib/llm-config.test.ts

17 unit tests covering:
- OpenAI key → openai provider with correct defaults
- DeepSeek key → deepseek provider with correct defaults
- BUG FIX: FACTORY_LLM_PROFILE ignored when no factory key (profile matches key-selected provider)
- Factory key + explicit overrides (profile, base URL, model)
- Priority order: factory > deepseek > openai
- Empty-string overrides don't clobber defaults
- Unknown FACTORY_LLM_PROFILE defaults to openai
- No keys → throws
- Profile === id invariant across all resolution paths
- Return type correctness

All 17 tests pass.

## Path Deviation

Ticket specified `src/lib/config.ts` but this repo uses root-level `lib/` (no `src/` wrapper). File placed at `lib/llm-config.ts` — `lib/config.ts` conflicts with existing `lib/config/` directory (contains `printing.ts`).

Test placed at `tests/lib/llm-config.test.ts` to match existing vitest include pattern (`tests/**/*.test.{ts,tsx}`).

## Git

- Branch: `dev/mas-317-llm-provider-resolution`
- Commit: `ffce897`
- Pushed to origin

## Paperclip Status

Paperclip Stage 3 degradation — health=200, PATCH hangs/timeout. Deferred close JSON queued to outbox.
