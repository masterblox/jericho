# MAS-240 Resolution Report

**Date**: 2026-07-09
**Agent**: Jericho (handling DEV wake)
**Disposition**: DONE — superseded

## What MAS-240 Asked

Decide between:
- **Option A**: Restore documented Vercel `production` branch via burner subdomain (lofilabs.xyz), wire `promote-to-prod.yml`
- **Option B**: Simplify — keep Vercel Production Branch = `main`, no staging tier

## What Actually Happened

Neither. **MAS-239 (Railway migration) superseded the entire Vercel deployment model**, making the Vercel branch model question moot.

### Evidence in repo (`/opt/data/memories-express-mvp-cp`)

1. **Architecture doc** (`docs/build-plan/01-architecture.md` lines 383-414):
   - Section header: "Historical (original Vercel plan)"
   - Body: "Superseded by the Railway path (MAS-239). Prod runs on Railway, not Vercel; the Vercel `promote-to-prod.yml` / `rollback-prod.yml` workflows are **retired**."
   - Deploy now uses `provision-railway.yml` and `deploy-railway.yml`

2. **Workflows directory** confirms:
   - `promote-to-prod.yml` — NOT present (retired)
   - Active deploy workflows: `deploy-railway.yml`, `provision-railway.yml`
   - DB deploy: `db-deploy.yml` (dispatch-only prod job with confirmation="deploy-prod")

3. **`origin/production` branch**: exists at a227ddd, ~180 commits behind main (638d3d7). Stale artifact from the original Vercel model — last touched by PR #21 (newgrounds.dev callbacks).

4. **HEAD == origin/main** at 638d3d7 — clean state, no uncommitted work.

## Recommended Cleanup (separate ticket)

- Delete stale `origin/production` branch — it's ~180 commits behind and no Vercel deployment listens to it
- The branch name `production` is misleading since the project deploys via Railway

## Paperclip Status

API times out (health=200, auth endpoints hang). Issue closure needs manual intervention when Paperclip recovers. Issue ID: `2413dfd8-22d3-4ffe-ad9c-1bc1a2cee893`, Run ID: `8d50c173-5d5a-45d4-873f-321e104d85b7`.

## Previous Run Failures

- Run `2cd0daad-1fec-40e4-8eae-3dd167827a21` failed with `hermes_gateway_rate_limited` (HTTP 429).
- Run `e8b8a290-b7b7-4c94-91b0-e23278139f28` failed with `hermes_gateway_rate_limited` (HTTP 429).
- Run `bff0e87d-e9e9-4fb5-9927-34c0fd5f4aa2` — verified state unchanged. All 429s were on the Paperclip update call, not on build/code work.

## Paperclip Status (2026-07-09 ~18:30 DXB)

Health=200. Company-prefixed PATCH returns 404 (0.3.1 route change). Bare PATCH times out (auth-deadlock Stage 5). Deferred close queued at `/opt/data/jericho/outbox/MAS-240-deferred-close.json` for `paperclip-recovery-closer` cron (next run 14:30 UTC).
