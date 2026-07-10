# DEV Handoff — MAS-234 (MAS-85 Smoke Test)

From: Jericho
To: DEV
Date: 2026-07-07
Status: READY FOR REVIEW

## What was done

Both deliverables for MAS-85 prepared:

1. `/opt/data/memories-express/tests/e2e/smoke.spec.ts` (8,803 bytes)
2. `/opt/data/memories-express/docs/smoke-checklist.md` (4,998 bytes)

## Actions for DEV

- [ ] Verify files at the paths above
- [ ] Run `pnpm typecheck` to validate the spec compiles
- [ ] Update Paperclip issue MAS-234 status to `in_review` (API 403'd from Jericho — issue is in DEV's authorization boundary)
- [ ] Post comment on MAS-234 with the heartbeat summary (see below)
- [ ] Open PR with `[MAS-85]` prefix targeting `main`

## Comment to post on MAS-234

"""
## Heartbeat summary — MAS-234 / MAS-85

### Work completed

Both deliverables prepared:

**1. `tests/e2e/smoke.spec.ts`** (8,803 bytes)
- All tests tagged `@smoke` for CI exclusion via `--grep-invert '@smoke'`
- Public surface: landing, signup, login, marketing pages, invalid-email error path
- Authed surface: dashboard, create-design/canvas-mount, library, billing, sends, designs listing, settings
- Recipient view: bogus-token 404 check
- Production detection: payment steps auto-skip on `memories.express`
- All imports resolve against existing fixtures

**2. `docs/smoke-checklist.md`** (4,998 bytes)
- 8-step manual walkthrough: pre-flight → signup → buy credits → compose/send → recipient view → admin checks → mobile → cleanup
- Rollback triggers, results table

### Remaining (for Michael/Yana)
- [ ] Run manual smoke against prod per `docs/smoke-checklist.md`
- [ ] Run `PLAYWRIGHT_BASE_URL=https://staging.memories.express pnpm exec playwright test --grep '@smoke'`
- [ ] Attach evidence to MAS-85 Linear ticket
- [ ] Open PR
"""
