# MAS-219 Preflight Verification — FINAL
## 2026-07-09 19:25 DXB (UTC+4)
## Jericho (consolidated-gateway wake for DEV, run 1cb63b85)

### Status: BLOCKED (agent work complete — needs Michael)

Prior runs completed preflight verification but failed with HTTP 429 on Paperclip update (rate limit, not build failure). Work was done. This run adds one new finding: Cloudflare Access gate.

---

## What's Verified (from repo /opt/data/memories-express-mvp-cp @ 12138e8)

- 37 migrations, newest 2026-06-19 (20 days — well over 48h threshold)
- Railway workflows present and verified green end-to-end (2026-06-24)
- PostGrid webhook route exists (Lob retired per MAS-16)
- Resend webhook route exists
- CI pipeline exists with lint + typecheck + test + e2e gates
- No new migrations since 638d3d7 (earlier report baseline)
- promote-to-prod.yml / rollback-prod.yml RETIRED (correct per 01-architecture.md)
- provision-railway.yml + deploy-railway.yml both gated on RAILWAY_DEPLOY_ENABLED

---

## NEW FINDING: Cloudflare Access Gate

memories.express returns 200 but ALL paths serve Cloudflare Access sign-in page:

- CF-Access-Domain: memories.express (explicit Zero Trust header)
- /api/healthz → Cloudflare Access gate (not the app healthcheck)
- /api/cron/run-jobs → Cloudflare Access gate
- Server: cloudflare, CF-RAY present on all requests

This means even if Railway is deployed and healthy, the public cannot reach the app. Cloudflare Access requires authentication before forwarding to origin. This is either:
(a) intentional — production is behind a zero-trust gate pending cutover
(b) misconfiguration — CF Access policy should allow /api/* and public paths

If (a), cutover = remove CF Access policy after Railway verification.
If (b), fix CF Access policy before promotion.

---

## What Michael Must Verify (7 items — unchanged from earlier reports)

1. RAILWAY_DEPLOY_ENABLED = "true" in GitHub repo vars
2. Stripe live products created, IDs in stripe_product (MAS-83)
3. Stripe live webhook signing secret in Railway env
4. Resend domain authenticated on target domain
5. Yana's super_admin profile created
6. OpenClaw VPS pointing at prod Supabase (MAS-78)
7. Railway hardening checklist (9 items in infra/supabase/railway/README.md)

---

## Railway Hardening Checklist (9 items — from infra/supabase/railway/README.md)

1. Backups/PITR — forfeit Supabase managed. Own via Railway snapshots + pg_dump cron
2. db TCP proxy — OFF in prod
3. Email auto-confirm — GOTRUE_MAILER_AUTOCONFIRM=false for prod
4. Healthchecks on stock services (auth/rest/storage/meta/studio)
5. db log volume — DEBUG unset in prod
6. Postgres runs as root — confirm acceptable
7. Intra-cluster SSL — plaintext over private net OK for single-region
8. Stock-image config drift — redeploy after env changes
9. Post-deploy smoke gate — automate signup→confirm→200 CI check

---

## Actual Promotion (replaces retired promote-to-prod.yml)

```
gh workflow run provision-railway.yml --ref main
gh workflow run db-deploy.yml --field target=prod --field confirmation=deploy-prod
```

Both gated on RAILWAY_DEPLOY_ENABLED=true.

---

## Rollback Plan (prepared)

- App: railway rollback --service app (or Railway dashboard Redeploy)
- DB: forward-only migration (never revert in prod)
- Emergency: set RAILWAY_DEPLOY_ENABLED=false, repoint DNS
- Cloudflare: disable Access policy for public cutover

---

## Cloudflare Access Resolution Needed

memories.express is behind Cloudflare Zero Trust. Before or during cutover:
- Option A: Remove CF Access policy entirely for public launch
- Option B: Add bypass rules for /api/*, /auth/*, public routes
- Current: All paths gated — no public access possible

---

## Recommendation for Michael

1. Resolve Cloudflare Access gate (new finding — was not in earlier reports)
2. Walk Railway hardening checklist (9 items)
3. Verify the 7 manual items above
4. Update Linear MAS-84 description to reflect Railway path
5. Schedule cutover window with Yana
6. Run provision-railway.yml (NOT promote-to-prod.yml)

---

## Paperclip / Jericho Auth Note

Jericho (agent 20cb56be) cannot mutate MAS-219 (DEV agent 44c1e448). This report must be relayed to Carlos or admin for Paperclip/Linear update.

Previous reports: /opt/data/jericho/reports/MAS-84-preflight-2026-07-09.md, MAS-219-preflight-2026-07-09.md
Prior dispositions: /opt/data/jericho/outbox/MAS-219-handoff-2026-07-09.md, MAS-219-final-disposition-2026-07-09.md
