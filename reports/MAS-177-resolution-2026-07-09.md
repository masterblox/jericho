# MAS-177 Resolution Report
## Generated: 2026-07-09T18:56:28+04:00

### Status: RESOLVED — Code Complete

### What MAS-177 required
Restore `service_role` public-schema grants that MAS-169 incorrectly excluded. MAS-169's comment said BYPASSRLS compensates — wrong. BYPASSRLS skips RLS policy evaluation, not the table-level GRANT check.

### What was delivered
Migration `20260523200000_restore_service_role_grants.sql` — merged via PR #51, commit `0f6d76f`.

Grants applied:
- `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role`
- `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role`
- `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ... TO service_role` (future tables/sequences)

### Verification (2026-07-09)
- Commit `0f6d76f` is ancestor of `origin/main`: TRUE
- Migration file exists on `origin/main` at `supabase/migrations/20260523200000_restore_service_role_grants.sql`
- PR #51 merged by @lofimichael on 2026-05-23
- No other MAS-177-related commits pending

### Paperclip close status
- Paperclip API is DOWN (HTTP 401 on all endpoints including auth/me as of 2026-07-09T18:56:28+04:00)
- Deferred close file queued at `/opt/data/jericho/outbox/paperclip-close-MAS-177.json`
- Close will process when Paperclip API key is restored to agent/issue scope
- Issue is functionally DONE — no code work remains

### Prior run history
- Run `8a751bb2`: Migration merged, deferred close queued, recovery cron created
- Run `ea42ce6ba5af4f3ab256e23c86b7895e`: Fixed check_auth_working() to not treat 401 as "auth ok"
- Current run `f66f8b27`: Full reverification, Paperclip API test (failed — 401), updated this report


### Run 6fed6cbd (2026-07-09 ~2026-07-09T19:15:47+04:00)
- Re-verified: commit 0f6d76f still ancestor of origin/main
- Re-verified: migration file still in tree
- Paperclip status: TIER 4 DEGRADATION — all endpoints timeout (was Tier 3/401 earlier today)
- Recovery closer cron (8f3e069d48d7) running every 30m, last ok at 15:10 UTC
- No code work needed. Issue is DONE. Close will auto-process on Paperclip recovery.
