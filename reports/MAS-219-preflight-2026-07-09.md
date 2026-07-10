# MAS-219 Preflight Verification — MAS-84 First Production Promotion
**Run**: eb4ca4ad-c03e-4877-b84c-8896ece6025b
**Date**: 2026-07-09 15:45 DXB (UTC+4)
**Agent**: DEV (via Jericho orchestration)
**Repo**: Mechanica-Labs/memories-express-mvp-cp @ 638d3d7 (main)

## Summary

The Vercel `promote-to-prod.yml` has been fully retired. Production now deploys to Railway via `provision-railway.yml` (or `deploy-railway.yml`), both gated on the repo variable `RAILWAY_DEPLOY_ENABLED`. The cutover is a **domain change, not a code change**: attach a custom domain to the Railway `app` service and point DNS at Railway. `memories.express` is a product name, not a domain they control.

## Programmatically Verified (from repo)

| Item | Status | Detail |
|---|---|---|
| Repo state | GREEN | main at 638d3d7, clean tree, matches origin/main |
| promote-to-prod.yml | RETIRED (correct) | Fully removed from repo |
| provision-railway.yml | EXISTS | Gated on RAILWAY_DEPLOY_ENABLED, has workflow_dispatch |
| deploy-railway.yml | EXISTS | Gated on RAILWAY_DEPLOY_ENABLED |
| db-deploy.yml | EXISTS | Has deploy-prod job |
| rollback-prod.yml | MISSING | Rollback = Railway dashboard "Redeploy" or `railway redeploy --service <svc>` |
| Cloudflare Worker cron | EXISTS | workers/cron/ + deploy-cron-worker.yml |
| Migrations | 37 files | Latest: 20260619000000_super_admin_seed_rules.sql |
| types.gen.ts | EXISTS | lib/db/types.gen.ts |
| Vercel deploy workflow | NONE | Vercel is staging/PR previews only now |

## Preflight Checklist — Requires Michael's Access

These items cannot be verified from this VPS (no GitHub token, no provider dashboard access):

### Original Day-of Checklist (from 01-architecture.md, updated for Railway)

| # | Item | Who | Notes |
|---|---|---|---|
| 1 | Staging CI green for >=48h | Michael | Check GitHub Actions on main branch |
| 2 | Stripe live products created, IDs in stripe_product | Michael | MAS-83 scope |
| 3 | Stripe live webhook signing secret in Railway env | Michael | Was "Vercel production scope" — now Railway app env vars |
| 4 | PostGrid live key + webhook configured | Michael | Lob was retired per MAS-16, replaced by PostGrid |
| 5 | Resend domain authenticated on target domain | Michael | Check Resend dashboard for DKIM/SPF/DMARC |
| 6 | DNS pointed at Railway app domain | Michael | Was "Vercel" — now Railway custom domain on `app` service |
| 7 | Yana's super_admin profile created | Michael | Via Supabase Auth admin API or dashboard |
| 8 | OpenClaw VPS env points at prod Supabase | OpenClaw team | MAS-78 scope |
| 9 | Maintenance backlog page ready | Michael | Not found in repo — may not exist |
| 10 | Yana available for cutover window | Michael | Human coordination |

### Railway Hardening Checklist (from infra/supabase/railway/README.md)

These were flagged during the 2026-06-24 staging verification and should be addressed BEFORE cutover:

| # | Item | Current State |
|---|---|---|
| H1 | Backups/PITR | Self-hosting forfeits Supabase managed PITR. Need Railway volume snapshots + pg_dump cron |
| H2 | db TCP proxy | Must be OFF in prod (exposes password-only, non-SSL postgres) |
| H3 | Email auto-confirm | GOTRUE_MAILER_AUTOCONFIRM=true is staging-only. Set false for prod |
| H4 | Healthchecks on stock services | auth/rest/storage/meta/studio lack healthcheckPath + restartPolicyType |
| H5 | Post-deploy smoke gate | Not implemented in CI — should automate signup→confirm→200 check after migrator |

## Promotion Command (updated for Railway)

```
# From GitHub Actions tab (NOT from laptop):
# Actions → provision-railway → Run workflow → target=all
# OR if RAILWAY_DEPLOY_ENABLED is already true:
# git push to main triggers provision-railway.yml automatically
```

## Rollback

```
# Railway dashboard: Redeploy previous deployment
# OR CLI: railway redeploy --service <svc>
# Schema: forward-only — write a new migration, never revert in prod
```

## Blockers

1. Cannot verify CI status — no GITHUB_TOKEN on this VPS
2. Cannot verify any provider dashboards (Stripe/Resend/PostGrid/Railway/Supabase)
3. Cannot verify RAILWAY_DEPLOY_ENABLED repo variable state
4. No maintenance backlog page found in repo
5. No post-deploy smoke gate implemented in CI
6. rollback-prod.yml does not exist — need documented rollback runbook
