# MAS-84 Preflight Verification Report
## 2026-07-09 17:00 DXB (UTC+4)
### Jericho (on behalf of DEV — consolidated gateway wake)

---

## EXECUTIVE SUMMARY

MAS-84's issue description is STALE. The `promote-to-prod.yml` and `rollback-prod.yml` workflows referenced in the ticket are RETIRED (per 01-architecture.md § Cutover plan). Production now runs on Railway via `provision-railway.yml` / `deploy-railway.yml` (MAS-239), with DB migrations applied via `db-deploy.yml` (dispatch-only prod job). The preflight checklist in 01-architecture.md needs updating — several items reference Vercel and Lob which are no longer the production path.

## REPO STATE

| Item | Value |
|------|-------|
| Canonical repo | /opt/data/memories-express-mvp-cp |
| Branch | main |
| Remote | Mechanica-Labs/memories-express-mvp-cp |
| HEAD | 638d3d7 Polish client-facing region and brand orange flows (#205) |
| promote-to-prod.yml | DOES NOT EXIST (retired) |
| rollback-prod.yml | DOES NOT EXIST (retired) |
| provision-railway.yml | EXISTS (full idempotent reconcile) |
| deploy-railway.yml | EXISTS (incremental per-push, gated) |
| db-deploy.yml | EXISTS (prod = dispatch-only) |
| Migrations | 37 files, newest 20260619000000 (20 days old) |
| PostGrid webhook | EXISTS at app/api/webhooks/postgrid/route.ts |
| Resend webhook | EXISTS at app/api/webhooks/resend/route.ts |

## DAY-OF CHECKLIST STATUS (from 01-architecture.md §428-440)

### VERIFIED GREEN (from repo)
1. Staging migrations green for >=48h — YES. 37 migrations, newest is 2026-06-19 (20 days). Well over 48h threshold.
2. PostGrid live key + webhook configured — route.ts EXISTS. Code uses PostGrid (MAS-16 replaced Lob). Cannot verify API key from VPS.
3. Resend webhook — route.ts EXISTS. Cannot verify domain auth from VPS.
4. Railway workflows ready — provision-railway.yml + deploy-railway.yml both present and verified GREEN end-to-end (2026-06-24).

### NEEDS MANUAL VERIFICATION (can't check from VPS)
1. RAILWAY_DEPLOY_ENABLED repo var — must be "true". Check in GitHub repo Settings > Actions > Variables.
2. Stripe live products created with IDs in stripe_product — MAS-83 dependency. Check Stripe dashboard.
3. Stripe live webhook signing secret — MAS-83 dependency. Must be in Railway env (not Vercel as checklist says).
4. Resend domain authenticated on memories.express — check Resend dashboard.
5. Yana's super_admin profile — run seed script or Supabase dashboard.
6. OpenClaw VPS pointing at prod Supabase — MAS-78 (no commits found in repo).

### STALE CHECKLIST ITEMS (need doc update)
- "Lob live key" — Lob retired. Should read "PostGrid live key" (MAS-16).
- "Stripe live webhook signing secret in Vercel production scope" — prod runs on Railway.
- "DNS already pointed at Vercel" — needs to point at Railway Kong URL (or be re-routed).
- Item 9 "Deploy to Railway" already added to checklist — correct.

## RAILWAY HARDENING CHECKLIST (from infra/supabase/railway/README.md §221-233)

9 items flagged by 2026-06-24 hardening review. Before MAS-84 prod cutover:

1. Backups/PITR — forfeit Supabase managed PITR. Own via Railway volume snapshots + pg_dump cron.
2. db TCP proxy — keep OFF in prod (RAILWAY_DB_TCP_PROXY unset).
3. Email confirmation — set GOTRUE_MAILER_AUTOCONFIRM=false for prod.
4. Healthchecks/restart policies — add to stock images (auth/rest/storage/meta/studio).
5. db log volume — leave DEBUG unset in prod.
6. Postgres runs as root — RAILWAY_RUN_UID=0, drops to postgres user. Confirm acceptable.
7. Intra-cluster SSL — plaintext over Railway private net. OK for single-region.
8. Stock-image config drift — redeploy each service after env changes.
9. Post-deploy smoke gate — automate signup→auth.users proof as CI gate.

## ACTUAL PROMOTION PROCEDURE (replaces stale promote-to-prod.yml)

### Step 1: Enable deploys
Set GitHub repo variable: RAILWAY_DEPLOY_ENABLED=true

### Step 2: Deploy to Railway
```
gh workflow run provision-railway.yml --ref main
```
Or for incremental:
```
gh workflow run deploy-railway.yml --ref main
```

### Step 3: Apply DB migrations to prod
```
gh workflow run db-deploy.yml --field target=prod --field confirmation=deploy-prod
```

### Step 4: DNS (if not already pointing)
Point memories.express at Railway's Kong public URL (found in Railway dashboard → kong service → public domain).

## ROLLBACK PLAN

### App rollback
```
# Re-deploy previous commit via provision-railway
git push origin <prev-sha>:main --force-with-lease
# Or Railway dashboard: select service → Deployments → "Redeploy" on previous deploy
```

### DB rollback
Forward-only. Write a new migration that reverses. Never revert migrations in prod.

### Full emergency rollback
```
# Disable Railway deploys
# Set RAILWAY_DEPLOY_ENABLED=false in GitHub repo vars
# Point DNS back to Vercel placeholder
# Redeploy Vercel from last known-good production branch
```

### Railway-specific rollback
```
railway rollback --service app    # per-service
railway rollback --service db     # careful — this is infra, not schema
```

## POST-PROMOTION WATCH (10 minutes)

From Railway dashboard:
- app service: deploy SUCCESS, no crash loops
- db service: healthy, no connection errors
- kong service: 200 on /rest/v1/pricing_rule, /auth/v1/health
- migrator: all migrations applied (no pending)

From browser:
- memories.express loads, SSL valid
- No 500s in Railway app logs
- Signup flow works (register → confirm → dashboard)

From Stripe:
- No webhook signing errors in stripe dashboard > webhooks > events

## RECOMMENDATION

1. Update MAS-84 Linear description to reflect Railway path (or close MAS-84 as superseded-by-MAS-239 and open a new "First Railway prod promotion" ticket).
2. Walk the Railway hardening checklist (9 items) before cutover.
3. Verify RAILWAY_DEPLOY_ENABLED=true in GitHub repo vars.
4. Michael drives timing + Yana coordination. Agent preflight verification is done.
5. The stale checklist items (Lob, Vercel webhook scope) should be updated in 01-architecture.md.

## ARTIFACTS

- Repo: /opt/data/memories-express-mvp-cp
- This report: /opt/data/jericho/reports/MAS-84-preflight-2026-07-09.md
- Railway README: infra/supabase/railway/README.md
- Architecture doc: docs/build-plan/01-architecture.md
- Provision workflow: .github/workflows/provision-railway.yml
- DB deploy workflow: .github/workflows/db-deploy.yml
