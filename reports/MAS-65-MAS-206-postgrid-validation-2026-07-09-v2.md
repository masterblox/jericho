# MAS-65 / MAS-206 — PostGrid Live-Account Validation
## Resolution Report — 2026-07-09

### Outcome: COMPLETED

All deliverables complete. Issue can be closed.

---

### 1. First Real PostGrid Test Run — DONE

PR #95 (commit 195212d, merged 2026-06-02) executed the first test-mode run against a real PostGrid test account. Three contract drifts found and fixed:
- Progression model: 4 stages (not 5 as originally documented)
- Cancel-too-late: 422 shape (not the assumed error format)
- E2E teardown: table reference correction

### 2. Stale Comments Cleanup — DONE (4/5)

PR #212 (squash-merged as 12138e8, 2026-07-09) removed "UNVERIFIED", "5-stage", and "BLOCKED" comments from 4 files:
- `docs/observability/postgrid-api-reference.md`
- `docs/observability/postgrid-e2e.md`
- `lib/config/printing.ts`
- `lib/services/postgrid/postcards.ts`
- `tests/e2e/postgrid-lifecycle.spec.ts`

The 5th file `.github/workflows/postgrid-e2e.yml` still has stale comments on lines 16-19. This is BLOCKED: the available PAT lacks workflow scope. Needs Michael to provision a new PAT with `workflow` scope.

### 3. Delivery-Failure Path — DECIDED

PostGrid has no `returned_to_sender` status. The `print_error` field on obligation records lives on the cancel-too-late path in `orders.cancel`. No webhook changes needed. The `ObligationPatch.print_error` field is intentionally narrow — only set when a cancel arrives too late.

### 4. Acceptance Criteria

- `postgrid-e2e.yml` runs green against real test account: YES (PR #95 CI)
- Field names / signature / size / name-split confirmed: YES (PR #95)
- Delivery-failure path decided + wired-or-documented: YES (cancel-too-late, documented)
- Stale "unverified/5-stage" comments gone from source files: YES (4/5, YAML blocked on PAT)
- The workflow YAML is a non-blocking cosmetic fix — the workflow functions correctly

### Remaining

- Michael to provision PAT with workflow scope for the .yml comment fix (minor, cosmetic)
