# MAS-332 Wake Resolution — 2026-07-09 17:45 DXB

**Wake reason**: source_scoped_recovery_action
**Prior run**: bce3be63 (429 rate limit — no work done by prior run)
**Paperclip issue ID**: 1054dc18-669e-4954-bf88-c7a1eea6dcda

## Audit Findings

### File on disk: YES — but non-functional

`src/lib/budget/regions.test.ts` (197 lines) exists on origin/main via commit ba7e57f (MAS-305 megacommit).

**Structure quality**: The test file is structurally complete — all 4 assertion types from the ticket scope:
- (a) VAT computed via resolveConstructionTax with null-guard and toBeCloseTo
- (b) Currency rendering tolerant of symbol OR ISO code
- (c) Tier monotonicity driven by 3 explicit quality inputs
- (d) Alias resolution (bandra → bandra-west in mumbai.ts)
- Data-driven: iterates listRegions(), no hardcoded region names in loop
- Identity check: all regions have required fields populated

**Fatal gap**: `computeEstimate` does not exist. The file imports from `./estimate` but there is no `src/lib/budget/estimate.ts` anywhere in the repo. The 6 references to `computeEstimate` across the test are dead imports — the file won't typecheck and vitest can't resolve the import.

### Dependency status

| Ticket | Name | Status |
|--------|------|--------|
| 01 | vitest-harness | IN PLACE — vitest ^4.1.10, test:unit script, src/**/*.test.ts include |
| 04 | resolve-construction-tax-helper | IN PLACE — resolveConstructionTax.ts + .test.ts exist |
| 06 | planner-trust-fix | Cannot verify independently |
| 10 | compute-estimate-compose | NOT BUILT — estimate.ts / computeEstimate does not exist |

### Paperclip

Health check: timeout (code 28) — Stage 4/5 unreachable. Recovery closer cron (job_id: 8f3e069d48d7) active, runs every 30m, last run 17:16 UTC.

## Disposition: BLOCKED

The test file is structurally correct but non-functional. Blocker: ticket 10 (compute-estimate-compose) — `src/lib/budget/estimate.ts` must be created with an exported `computeEstimate(project: ParsedProject): Estimate | null` function.

Once `estimate.ts` exists, the test should be runnable via `npm run test:unit` and provide the per-region guard coverage the ticket requires.
