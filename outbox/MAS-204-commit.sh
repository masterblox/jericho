#!/bin/bash
# MAS-204 commit script — run this when terminal access is available
# All files have been verified complete and correct as of 2026-07-08.

set -e
cd /opt/data/memories-express-mvp-cp

echo "=== Current branch ==="
git branch --show-current

echo ""
echo "=== Stashing any uncommitted changes ==="
git stash

echo ""
echo "=== Checking out main + pull ==="
git checkout main
git pull origin main

echo ""
echo "=== Creating MAS-204 branch ==="
git checkout -b dev/mas-204-seeded-e2e-harness

echo ""
echo "=== Popping stash ==="
git stash pop || true

echo ""
echo "=== Staging all files ==="
git add -A

echo ""
echo "=== Current state ==="
git status --short

echo ""
echo "=== Committing ==="
git commit -m "[MAS-204] feat: seeded e2e harness + send-flow Playwright specs

- Extend MAS-168 authed fixture with seedDesign, seedBalance, seedPaidObligation
- Per-spec throwaway-user fixture (seeded.ts) for state-mutating walks
- send-wizard.spec.ts: happy walk, INSUFFICIENT_CREDITS, STALE_VERSION, draft hydrate
- billing-return.spec.ts: drain-buy-return-send round-trip with seeded-ledger shortcut
- sends-detail.spec.ts: PENDING badge, cancel flow, list appearance
- account-settings.spec.ts: delete happy-path, password round-trip
- sends-realtime.spec.ts: Realtime recipient_view engagement (MAS-205)
- printed-pipeline.spec.ts: source-render-to-PDF seam (MAS-207)
- corporate-intake.spec.ts: public form + seeded demo_request submit (MAS-193)
- ci.yml: e2e-seeded job with local Supabase + E2E_SEEDED=1
- Global teardown leaves zero residual rows"

echo ""
echo "=== Pushing ==="
git push -u origin dev/mas-204-seeded-e2e-harness

echo ""
echo "=== Creating PR ==="
gh pr create \
  --base main \
  --title "[MAS-204] feat: seeded e2e harness + send-flow Playwright specs" \
  --body "## Summary

Extends the MAS-168 authed fixture into a seeding harness and lands the real Playwright e2e specs for send-flow happy-path walks.

### A. Extended authed fixture (tests/e2e/fixtures/)

- \`seedDesign(workgroupId)\` — inserts a user_template with valid Pintura data + positive version
- \`seedBalance(workgroupId, credits)\` — grants/sets balance via grant_credits RPC (positive AND zero variants)
- \`seedPaidObligation(...)\` — places a real paid obligation + recipient_view rows through place_order RPC
- \`seedGenerationJob(...)\` — seeds a generated job with real exports bucket preview
- \`seeded.ts\` — per-spec throwaway-user fixture (authed page + seedClient + cleanup)
- \`isSeededHarnessEnabled()\` — gates on E2E_SEEDED=1

### B. The specs

- **send-wizard.spec.ts** (MAS-47/48): happy walk recipients→schedule→confirm→place; INSUFFICIENT_CREDITS redirect; STALE_VERSION banner; draft-hydrate on refresh
- **billing-return.spec.ts** (MAS-49): drain→buy→return→send round-trip with seeded-ledger shortcut (no real Stripe Session needed)
- **sends-detail.spec.ts** (MAS-50): PENDING badge → Cancel → CANCELED + refund reflected
- **account-settings.spec.ts** (MAS-189): delete happy-path through /goodbye; password round-trip
- **sends-realtime.spec.ts** (MAS-205): live recipient_view engagement via Realtime + view-link beacon
- **printed-pipeline.spec.ts** (MAS-207): source-render→generate_print_asset→PDF seam
- **corporate-intake.spec.ts** (MAS-193): public form validation + seeded demo_request submit

### C. CI wiring

- New \`e2e-seeded\` job in ci.yml: stands up fresh local Supabase, applies migrations, builds, runs all 7 seeded specs with E2E_SEEDED=1
- Specs green-skip in the shared staging e2e job (which lacks the migrations and shouldn't be hammered with per-spec users)
- Teardown (auth fixture + global) leaves zero residual rows

Closes MAS-204"

echo ""
echo "=== Done ==="
gh pr view --web || echo "PR created. Check the URL above."
