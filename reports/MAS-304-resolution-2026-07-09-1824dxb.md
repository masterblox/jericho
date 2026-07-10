# MAS-304 Resolution Report — 2026-07-09 18:24 DXB

## Wake
- Reason: source_scoped_recovery_action
- Issue: MAS-304 / MAS-317 — Fix LLM provider resolution in config.ts
- Paperclip status: blocked

## Prior Audit Was WRONG

Prior run 6c7494d6 claimed the work was done in commit bf1a866 on main. Reality:
- bf1a866 exists but ONLY on dev/mas-322-parser-consolidation (side branch, 4 unrelated commits)
- bf1a866 is NOT an ancestor of origin/main
- origin/main had ZERO of the required files: no config.test.ts, no vitest.config.ts, no resolveProviderConfig export, no vitest dep, no test:unit script
- The prior audit fabricated its verification

## What This Run Did

1. Located 5 commits with resolveProviderConfig across 4 branches — none on main
2. Selected 2d08ce1 from dev/mas-313-clean (dedicated branch, cleanest)
3. Cherry-picked to main as d3e49af
4. npm install + npm run test:unit
5. Pushed to origin/main

## Verification

### Files
- src/lib/config.ts — resolveProviderConfig(env) exported, ProviderConfig interface, pure function
- src/lib/config.test.ts — 15 tests covering all 4 ACs
- vitest.config.ts — src/**/*.test.ts include
- package.json — vitest ^4.1.10 + test:unit script

### Tests (55 passed, 5 files)
- src/lib/config.test.ts: 15/15
- src/lib/budget/regions.test.ts: 23/23
- src/lib/budget/format.test.ts: 5/5
- src/lib/budget/resolveConstructionTax.test.ts: 8/8
- src/lib/budget/__tests__/parser-consolidation.test.ts: 4/4

### Acceptance Criteria
1. OPENAI_API_KEY → id:openai, profile:openai, baseUrl:api.openai.com/v1 — PASS
2. DEEPSEEK_API_KEY → id:deepseek, profile:deepseek — PASS
3. FACTORY_LLM_PROFILE=openai + DEEPSEEK_API_KEY → id:deepseek, profile:deepseek (THE FIX) — PASS
4. FACTORY_LLM_API_KEY + FACTORY_LLM_PROFILE + FACTORY_LLM_BASE_URL → override wins — PASS

## Commit
- d3e49af on origin/main (cherry-picked from 2d08ce1)
- Push: 134bdd0..d3e49af main -> main

## Paperclip
- Health: HTTP 000 (Stage 4 — fully unreachable)
- Deferred close queued at /opt/data/jericho/outbox/paperclip-deferred-close-MAS-304.json
- Recovery closer cron active (every 30m)
