# MAS-273 Resolution Report
**Date**: 2026-07-09 ~18:30 DXB
**Status**: RESOLVED — implementation complete, intentionally gated
**Previous run**: 5425e5eb (failed: Paperclip HTTP 429 on comment update)

## Audit

- HEAD: `638d3d77c7b44594745056bde5fa140036f4066b` (origin/main)
- Branch: `dev/mas-85-smoke-test` (HEAD == main)
- Working tree: clean (3 unrelated untracked files)

## Merged PRs

1. **PR #110** (commit `ed079fb`): Full implementation
   - `app/api/cron/cleanup-orphan-uploads/route.ts` — cron entrypoint
   - `lib/services/jobs/cleanupOrphanUploads.ts` — handler with `find_orphan_uploads` RPC
   - `supabase/migrations/20260602000100_find_orphan_uploads_rpc.sql` — RPC + GIN index
   - `supabase/tests/find_orphan_uploads.sql` — pgTAP tests
   - `tests/api/cron-cleanup-orphan-uploads.test.ts` — vitest integration tests
   - `tests/lib/services/jobs/cleanupOrphanUploads.test.ts` — vitest handler tests
   - `vercel.json` — cron schedule `0 3 * * *`

2. **PR #111** (commit `0e8bce2`): Safety disable
   - Added `CLEANUP_ORPHANS_ENABLED` env guard: handler no-ops unless explicitly enabled
   - Removed cron entry from `vercel.json` (currently empty)
   - Reason: `find_orphan_uploads` RPC compares bare storage paths against embedded URLs in `user_template.data`. Legacy rows contain signed URLs (`{origin}/object/sign/uploads/{path}?token=...`) which never equal bare paths, so a still-referenced asset would be falsely identified as an orphan and permanently deleted.

## Current State

The handler is fully implemented but gated behind `CLEANUP_ORPHANS_ENABLED=true`. No cron schedule fires it. No data can be deleted.

## Follow-up Required (separate ticket)

1. **Path-normalize RPC**: Add a function that strips origin, query params, and token from signed URLs, converting them to bare paths. Apply to both sides of the comparison in `find_orphan_uploads`.
2. **Re-enable**: Set `CLEANUP_ORPHANS_ENABLED=true` in production env, restore `vercel.json` cron entry.
3. **Migration**: Ensure legacy signed-URL rows are normalized (any re-save via the editor normalizes them).

## Failure Cause

Run `5425e5eb` completed the implementation work (PR #111 merge). It crashed on `hermes_gateway_rate_limited: HTTP 429` when attempting to update the Paperclip issue — not on the build itself. This is a transient infrastructure failure, not a code failure.

## Verdict

**No rebuild needed.** All code is on main. The safety gate is correct and intentional.
