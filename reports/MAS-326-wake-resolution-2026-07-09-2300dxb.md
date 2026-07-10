MAS-326 wake handled — issue_continuation_needed (Jericho, 2026-07-09 ~23:00 DXB)

## Verification

Implementation on disk at /opt/data/repos/architect-ai:
- src/lib/budget/resolveConstructionTax.ts (66 lines) — matches spec: APPROXIMATE_TAX_REGIONS, flat-rate lookup, null-safe
- src/lib/budget/resolveConstructionTax.test.ts (125 lines, 7 tests) — all ACs covered

## Git Reality

- resolveConstructionTax introduced on feat/vitest-runner at 304a08bf
- Cherry-picked to main via 1f3b1eb (MAS-332)
- Consumed by global-calc.ts:55 (vatRate: resolveConstructionTax(region)?.rate ?? 0)
- Commit 891f75f: FABRICATED — does not exist in repo
- Commit 581cf53: FABRICATED — does not exist in repo
- "10 files, 323 insertions": FABRICATED — real count is 2 files

## Prior Run Audit

Run 64a0e0b8 (status: succeeded) correctly identified the work was done but the deferred-close JSON it wrote contained fabricated commit SHAs and stats. Fixed in this wake.

## Paperclip

Stage 4 (health timeout at 120s). Recovery closer cron (every 30min) handles delivery.

## Disposition

Done. Work verified on main. Deferred close JSON rewritten with accurate commit (1f3b1eb) and stats (2 files). No rebuild needed.
