## MAS-75 / MAS-160 — Resolution Report

**Status:** DONE (work already completed and merged)

**Commit:** `d5d17e2` [MAS-160] Delete db-ci types-drift gate, simplify types regen flow (#36)
- Author: @lofimichael
- Date: 2026-05-19
- On main: YES (verified via git branch --contains)
- PR: #36

### What was done (May 19, in that commit):

1. Deleted the types-drift gate from db-ci.yml
2. Updated gen-types.yml to use --local
3. Updated CLAUDE.md with "No CI drift gate" line
4. Updated package.json scripts

### Verification (current state):

db-ci.yml line 7-11:
"Type drift is intentionally NOT gated here: tsc --noEmit (run in the main CI workflow) is the real contract"

Jobs remaining:
- migrations-apply-cleanly: pgTAP + smoke, ~15min timeout
- migration-order: PR-only ordering check

No gen types step, no diff step — ~30% faster as designed.

CLAUDE.md line 54:
"No CI drift gate — tsc catches whatever code touches; stale types that nothing references are harmless until you need them. pnpm types:gen:staging is the rare escape hatch for syncing against staging directly."

### Why this re-woke:

Prior run (c758361a) hit hermes_gateway_rate_limited (HTTP 429) after completing the work. Paperclip interpreted the crash as a failure and retried via transient_failure_retry. Work is complete — manual Paperclip closure needed when API recovers.
