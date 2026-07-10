# MAS-197 Resolution Report

- Issue: MAS-197 (Paperclip) / MAS-22 (Linear) — Apply migrations to staging and developer Supabase projects
- Date: 2026-07-09
- Agent: Jericho (handling DEV wake — transient_failure_retry after HTTP 429)
- Verdict: PARTIAL — staging done via CI, developer projects BLOCKED on credentials

## Audit Summary

Previous run `14259cfa-9951-4609-91d4-1a918b52c530` hit `hermes_gateway_rate_limited` (HTTP 429). No code was built — the consolidated gateway rate-limited before the DEV agent ran. Continuation summary showed zero files/routes touched (expected — gateway never spawned the agent).

## What's Done

### MAS-21 (Precondition) — MERGED
- Last MAS-21 commit: `75a72d3` (docs: reconcile handoff docs) on 2026-06-25
- MAS-21 implementation commits (`256c025`, `4b3b0a0`, `04f68d2`, `3a32bd7`, `7883998`) all ancestors of origin/main
- 37 migration files on origin/main
- 30 CREATE TABLE statements in init_tables migration
- types.gen.ts committed at lib/db/types.gen.ts (65KB)

### Staging Supabase — AUTO-DEPLOYED VIA RAILWAY CI
- deploy-railway.yml pipeline on main: GREEN (run 28863151994, Jul 7 2026, conclusion: success)
- Pipeline detects supabase/migrations/** changes and applies via migrator on push to main
- db-deploy workflow: GREEN (run 28243946134, Jun 26)
- db-ci workflow: GREEN (run 28243946133, Jun 26)
- Railway infra README confirms: "Status: verified GREEN end-to-end on Railway (2026-06-24)"
- The migration set has been applied to staging through CI — all 37 migrations deployed

## What's Blocked

### Developer Supabase Projects — BLOCKED
The following are required to run `supabase link --project-ref <dev-ref> && supabase db push` for developer projects:

1. Supabase CLI NOT INSTALLED on this VPS (`which supabase` returns empty)
2. No SUPABASE_ACCESS_TOKEN set (required for `supabase link` and `supabase db push`)
3. No developer project refs (SUPABASE_PROJECT_REF_DEV or equivalent not set)
4. No SUPABASE_DB_PASSWORD_STAGING set
5. No Linear API token to update the Linear ticket to BLOCKED

### Linear Ticket Status
Cannot update MAS-22 Linear ticket to BLOCKED — no Linear CLI or API token available on this VPS.

## CI Status Note
The `ci` workflow (typecheck/lint) is RED on recent main commits (runs 28863151966, 28829477804). This is unrelated to migrations — it tracks client-facing region/brand orange flows PRs. The migration-specific workflows (deploy-railway, db-deploy, db-ci) are all green.

## Migration Inventory (37 files on origin/main)
```
20260512000000_init_extensions.sql
20260512000100_init_enums.sql
20260512000200_init_tables.sql     (30 CREATE TABLE statements)
20260512000300_init_functions.sql
20260512000400_init_triggers.sql
20260512000500_init_rls.sql
20260512000600_init_views.sql
20260512000700_init_storage.sql
20260512000800_init_seeds.sql
20260513210000_fix_grant_credits_on_conflict.sql
20260513231500_fix_signup_bootstrap_search_path.sql
20260513233000_fix_tg_maintain_balance_negative_amounts.sql
20260513234000_fix_place_order_search_path.sql
20260519120000_tighten_storage_bucket_limits.sql
20260519180000_scheduled_job_claim.sql
20260521120000_restore_default_public_grants.sql
20260522170000_allow_checkout_intents_without_payment_intent.sql
20260522180000_drop_intent_table.sql
20260522220000_collapse_promo_to_credit_grant.sql
20260523200000_restore_service_role_grants.sql
20260526000000_add_admin_action_log.sql
20260531000000_add_soft_delete_upload.sql
20260601000000_webhook_event_postgrid_provider.sql
20260601000100_place_order_enforce_future_delivery.sql
20260601000200_scheduled_job_sweep.sql
20260601000300_add_delete_profile_self_rpc.sql
20260601000400_lock_profile_status_columns.sql
20260601000500_recipient_view_sender_visibility.sql
20260602000100_find_orphan_uploads_rpc.sql
20260602000200_place_order_now_delivery_grace.sql
20260604000000_fix_openclaw_view_grants.sql
20260604010000_wrap_rls_auth_initplan.sql
20260607000000_seed_super_admins.sql
20260616000000_revoke_credit_grant_redeem.sql
20260617000000_add_record_recipient_view_engagement.sql
20260618000000_generation_single_flight.sql
20260619000000_super_admin_seed_rules.sql
```

## Unblocker Actions Required

To complete the developer-projects portion of MAS-22:

1. Install Supabase CLI (`npm i -g supabase` or brew install)
2. Set SUPABASE_ACCESS_TOKEN env var (generate from supabase.com/dashboard/account/tokens)
3. Obtain each developer's Supabase project ref
4. Run per developer: `supabase link --project-ref <ref> && supabase db push`
5. Regenerate types if drift: `supabase gen types typescript --linked > lib/db/types.gen.ts`
6. Open PR if types.gen.ts changes

## Paperclip Status
Paperclip auth-deadlock (Stage 4: health=200, all authenticated endpoints timeout HTTP 000). Cannot update issue via API. Deferred close queued.
