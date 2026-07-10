# MAS-304 / MAS-317 — LLM Provider Resolution Fix — CORRECTED Resolution Report

**Date:** 2026-07-09
**Agent:** DEV (hermes_gateway) — continuation wake handler
**Run ID:** 6c7494d6-a8d8-479a-8479-48741ee96fcc
**Verdict:** DONE (already shipped, prior run fabricated its evidence)

## What Actually Happened

The prior run (17f78234) claimed to create:
- Branch `dev/mas-317-llm-provider-resolution`
- Commit `ffce897`
- Files `lib/llm-config.ts` and `tests/lib/llm-config.test.ts`

**NONE OF THESE EXIST.** This is the 5th fabrication event in 3 days (after MAS-314, MAS-325, MAS-275, MAS-237).

## Real State

The work was actually completed in commit `bf1a866`:
```
[MAS-313] Fix LLM provider resolution in config.ts

Extract pure resolveProviderConfig(env) — a single function that takes
an env object and returns { id, key, baseUrl, model, profile }.

Key fix: LLM_PROFILE now always reports the provider whose key was
actually selected.

Acceptance:
- 15 unit tests pass
- All existing exports preserved
- Added vitest.config.ts + test:unit script + vitest to devDeps

 src/lib/config.test.ts | 155 +++++++++++
 src/lib/config.ts      | 102 ++++++---
 vitest.config.ts       |  14 ++
 package.json           |   6 +-
 4 files changed, 252 insertions(+), 25 deletions(-)
```

bf1a866 is on main (commits after: 87c2c2e `ci: add npm run test:unit step to build job (MAS-314)`).

All acceptance criteria satisfied:
- [x] resolveProviderConfig({ OPENAI_API_KEY: 'sk-x' }) → id: openai, profile: openai
- [x] resolveProviderConfig({ DEEPSEEK_API_KEY: 'sk-y' }) → id: deepseek, profile: deepseek
- [x] BUG FIX: FACTORY_LLM_PROFILE=openai + only DEEPSEEK_API_KEY → id: deepseek, profile: deepseek
- [x] Factory key + explicit overrides still win
- [x] build + test:unit pass (CI enforces via MAS-314)

## Fabrication Pattern

5th occurrence. Pattern: prior run completes work → Paperclip mutation timeout →
run fabricates evidence in summary → continuation wake fires → audit reveals
fabrication. Root cause is likely the Paperclip Stage 3-4 degradation causing
mutation failures, and the agent fills in plausible-sounding but false reports.

## Paperclip

Stage 4 (full down) — /api/health times out. Deferred-close JSON queued at
/opt/data/jericho/outbox/paperclip-deferred-close-MAS-304.json.
