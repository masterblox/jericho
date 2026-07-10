# MAS-239 / MAS-52 Completion Report

## Verdict: ALREADY IMPLEMENTED

The previous run (34b51bfc) failed with a gateway 429 before it could
inspect the repo. Full audit below.

## Complete Inventory

### Database (migrations)
- claim_scheduled_jobs(p_worker_id text, p_limit int) — FOR UPDATE SKIP LOCKED
  File: supabase/migrations/20260519180000_scheduled_job_claim.sql
- sweep_stale_scheduled_jobs(p_threshold interval default '15 minutes')
  File: supabase/migrations/20260601000200_scheduled_job_sweep.sql

### Dispatcher + Handlers
- runDispatcher(client, opts) — claim → handler → completed/retry/dead
  File: lib/services/jobs/dispatcher.ts
- Handler registry with all 12 kinds, real handlers for:
  send_obligation, generate_print_asset, submit_print_job, cleanup_orphan_uploads
  File: lib/services/jobs/handlers.ts
- Typed RPC wrappers: claim_scheduled_jobs + sweepStaleScheduledJobs
  File: lib/db/rpc.ts

### Cron Routes
- /api/cron/run-jobs — dispatcher entrypoint, Bearer auth, POST+GET
  File: app/api/cron/run-jobs/route.ts
- /api/cron/sweep — stale-lock reclaimer, Bearer auth, POST+GET
  File: app/api/cron/sweep/route.ts
- /api/cron/expire-generation-jobs — generation TTL
  File: app/api/cron/expire-generation-jobs/route.ts

### Env + Docs
- CRON_SECRET in lib/env.ts (optional z.string)
- CRON_SECRET documented in docs/build-plan/env.md

### Tests
- pgTAP: supabase/tests/scheduled_job_claim.sql (11 tests)
- pgTAP: supabase/tests/scheduled_job_sweep.sql (10 tests)
- vitest: tests/lib/services/jobs/dispatcher.test.ts (10 cases)
- vitest: tests/api/cron-run-jobs.test.ts (5 cases)
- vitest: tests/api/cron-sweep.test.ts (5 cases)

## Divergences from Original MAS-52 Spec (Intentional)

1. vercel.json was DELETED — scheduling moved to Cloudflare Cron Worker
   (MAS-241, workers/cron/). The worker hits /api/cron/* with Bearer auth.
2. Route is /api/cron/run-jobs not /api/cron/scheduled-jobs (cleaner name)
3. Dispatcher is lib/services/jobs/ not lib/jobs/ (repo convention)
4. Handler stubs throw NOT_IMPLEMENTED → normal dispatcher failure path
   (backoff → dead at max_attempts), no silent drops

## Remaining Ops Action (not a code change)

CRON_SECRET is UNKNOWN on Vercel today. All /api/cron/* routes return 401
until it's set in Vercel Production env + redeploy. Per env.md:
"CRON_SECRET is unset on Vercel today so all /api/cron/* 401 —
set it (Production) + redeploy to activate."

## Disposition: in_review

No code changes needed. The previous run failed on a 429 before it
could read the repo. Issue should be closed as "already implemented."
