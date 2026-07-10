# MAS-176 / MAS-204 — Resolution Report
**Date:** 2026-07-09
**Disposition:** DONE (work already merged; wake was ECONNREFUSED false alarm)

## Wake Analysis

Paperclip wake `ce638bad` failed with `ECONNREFUSED 172.19.0.1:8642` — the consolidated-gateway pattern. DEV's dedicated gateway no longer exists as a service (only default + jericho run post-consolidation). The agent crashed attempting to connect, but the code was already completed and merged.

## State Verification

- **Commit:** `4b1a91b` — "[MAS-204/208/205/207] PR #90 follow-ups: seeded e2e harness..." (PR #103)
- **Ancestor of HEAD:** YES (`4b1a91b` is ancestor of `638d3d7` on main)
- **Working tree:** clean

### Scope A — Seeding Harness
| Component | File | Status |
|---|---|---|
| seedDesign | tests/e2e/fixtures/seed.ts | PRESENT |
| seedBalance (grant_credits) | tests/e2e/fixtures/seed.ts | PRESENT |
| seedPaidObligation (via place_order RPC) | tests/e2e/fixtures/seed.ts | PRESENT |
| Per-spec authed fixture + teardown | tests/e2e/fixtures/seeded.ts | PRESENT (85 lines) |
| isSeededHarnessEnabled gate | tests/e2e/fixtures/seeded.ts | PRESENT |
| auth.ts fixes (signInViaForm, promo_redemption rename) | tests/e2e/fixtures/auth.ts | PRESENT |

### Scope B — Browser-Lifecycle Specs
| Spec | Lines | Tests | Active (not stubs) |
|---|---|---|---|
| send-wizard.spec.ts | 179 | 7 | YES — seeded fixture, real walks |
| sends-detail.spec.ts | 148 | 7 | YES — PENDING→Cancel→CANCELED chain |
| account-settings.spec.ts | 156 | 8 | YES — delete /goodbye + password round-trip |
| billing-return.spec.ts | 100 | 4 | YES — drain→top-up→return→send (seeded ledger) |

### Scope C — CI Wiring
- `e2e-seeded` job in `.github/workflows/ci.yml`: PRESENT
- Runs against fresh local Supabase, E2E_SEEDED=1
- Green-skip in shared `e2e` job (targets lagging staging)

## Conclusion

No action needed. The ECONNREFUSED was a consolidated-gateway artifact — the work was already done, merged, and verified (commit message notes "all 28 seeded specs green against a local migrated Supabase"). Closing as DONE.
