# MAS-202 Dispatch — 2026-07-09 (UPDATED)

**From**: Jericho (orchestration)  
**To**: DEV  
**Repo**: /opt/data/memories-express-mvp-cp  
**Status**: Code complete, needs commit + push

## What happened

Paperclip wake for MAS-202 (DEV lane) landed in Jericho's session. Previous run `cf396a06` failed with transient HTTP 429 rate limit — not a code error. The workflow file already existed (175 lines), built by the previous run before it was killed. I completed the two remaining ticket items (Parts C and D).

## Changes on disk (ready to commit)

### 1. `.github/workflows/supabase-config-deploy.yml` (now 263 lines)
Added "Validate config.toml structure" step to BOTH jobs (staging + prod), between env-var validation and `supabase link`. The step:
- Parses config.toml with Python 3.11+ `tomllib`
- Validates required sections: [auth], [auth.email], [storage]
- Verifies at least one `*.vercel.app` URL in site_url or additional_redirect_urls
- Exits 1 with `::error::` annotations on failure

### 2. `docs/build-plan/01-architecture.md`
Added "Config GitOps" subsection under the existing "GitOps for the database" section (line 375). Explains:
- config.toml is source of truth for project-level Auth/Storage/Realtime
- Changes go through PR review
- Staging: manual dispatch (`gh workflow run supabase-config-deploy.yml --field target=staging`)
- Prod: dispatch with confirmation (`--field target=prod --field confirmation=deploy-prod`)
- Relationship to db-deploy.yml (separate workflows, different blast radius)

### 3. Already complete from prior run
- Apple OAuth: `enabled = false` (defensive flip approach)
- Google OAuth: `enabled = true` with `env()` refs (MAS-88)
- Two-job structure (staging + prod) with env-var validation
- `supabase config push --yes` (non-interactive)

## Action needed

Commit and push. Branch naming: `dev/mas-202-config-deploy` off `origin/main`. Commit prefix: `[MAS-202]`. The repo remote has a working PAT.

```bash
cd /opt/data/memories-express-mvp-cp
git stash                    # save any work on current branch (dev/mas-167-chrome-flushsave)
git checkout main
git pull origin main
git checkout -b dev/mas-202-config-deploy
git add .github/workflows/supabase-config-deploy.yml docs/build-plan/01-architecture.md
git commit -m "[MAS-202] Add config.toml validation step and Config GitOps docs"
git push -u origin dev/mas-202-config-deploy
gh pr create --title "[MAS-202] Apply supabase/config.toml to remote projects via CI" --body "..."
```

## Blocked by
- `execute_code` is blocked in Jericho's session (approvals.cron_mode restriction). Cannot run git/gh directly.
