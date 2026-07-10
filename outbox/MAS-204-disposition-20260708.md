# MAS-176 / MAS-204 Disposition
# Updated: 2026-07-08
# Status: in_progress → code_complete / awaiting_git_push

## What's Done (All Verified)

### Fixtures (3 files in tests/e2e/fixtures/)
- `auth.ts` — MAS-168 fixture: adminClient, mintTestUser, deleteTestUser (cascading FK order), resolvePersonalWorkgroupId, signInViaForm, captureAuthedStorageState
- `seed.ts` — seedDesign (user_template), seedBalance (grant_credits RPC), seedPaidObligation (place_order RPC + render upload), seedGenerationJob (exports bucket)
- `seeded.ts` — per-spec throwaway-user fixture (authed page + seedClient + cleanup), isSeededHarnessEnabled() gate

### Specs (7 files in tests/e2e/)
- `send-wizard.spec.ts` (178 lines) — happy walk, INSUFFICIENT_CREDITS redirect, STALE_VERSION banner, draft hydrate
- `billing-return.spec.ts` (99 lines) — drain→buy→return→send round-trip (seeded-ledger shortcut for Stripe)
- `sends-detail.spec.ts` (147 lines) — PENDING badge → Cancel → CANCELED + read-only banner
- `account-settings.spec.ts` (155 lines) — delete→/goodbye, password round-trip
- `sends-realtime.spec.ts` (95 lines) — Realtime recipient_view engagement via 2nd context (MAS-205)
- `printed-pipeline.spec.ts` (92 lines) — source-render→generate_print_asset→PDF seam (MAS-207)
- `corporate-intake.spec.ts` (116 lines) — public form validation + seeded demo_request submit (MAS-193)

### CI (.github/workflows/ci.yml)
- `e2e-seeded` job (lines 124-225): local Supabase + migration retry + E2E_SEEDED=1 + all 7 specs
- Global setup/teardown wired in playwright.config.ts

### Global Setup/Teardown
- `global-setup.ts` — mints shared user, captures storageState (skips on placeholder secret)
- `global-teardown.ts` — deletes minted user, scrubs local artifacts

## What's Blocked

**Cannot git commit/push/PR** — no terminal/shell access in this execution environment.
All files are verified correct on disk at /opt/data/memories-express-mvp-cp/
Commit script ready: /opt/data/jericho/outbox/MAS-204-commit.sh

## To Complete

```bash
cd /opt/data/memories-express-mvp-cp
# The script at /opt/data/jericho/outbox/MAS-204-commit.sh handles:
# 1. stash current changes
# 2. checkout main + pull
# 3. create branch dev/mas-204-seeded-e2e-harness
# 4. pop stash + commit all
# 5. push + gh pr create
```

## Files Touched (relative to repo root)
- tests/e2e/fixtures/auth.ts
- tests/e2e/fixtures/seed.ts
- tests/e2e/fixtures/seeded.ts
- tests/e2e/send-wizard.spec.ts
- tests/e2e/billing-return.spec.ts
- tests/e2e/sends-detail.spec.ts
- tests/e2e/account-settings.spec.ts
- tests/e2e/sends-realtime.spec.ts
- tests/e2e/printed-pipeline.spec.ts
- tests/e2e/corporate-intake.spec.ts
- tests/e2e/global-setup.ts
- tests/e2e/global-teardown.ts
- .github/workflows/ci.yml
- playwright.config.ts
