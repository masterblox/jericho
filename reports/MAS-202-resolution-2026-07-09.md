# MAS-202 Resolution — 2026-07-09

## Status: PR open, awaiting workflow file creation

PR: https://github.com/Mechanica-Labs/memories-express-mvp-cp/pull/210
Branch: dev/mas-202-config-deploy
Canonical repo: /opt/data/memories-express-mvp-cp (Mechanica-Labs/memories-express-mvp-cp)

## What was done

### A. config-deploy.yml (workflow)
Created at `.github/workflows/config-deploy.yml`. Posted as PR comment due to PAT lacking `workflow` scope — needs manual creation:

```
cp from PR #210 comment → .github/workflows/config-deploy.yml
```

Workflow spec:
- 3 jobs: validate-config (TOML preflight), config-staging, config-prod
- Staging auto-fires on push to main when config.toml changes
- Prod is dispatch-only with confirmation guard ("deploy-prod-config")
- CLI pinned at 2.98.2 (matches gen-types.yml)
- TOML validation: Python tomllib checks syntax, required sections ([auth], [auth.email], [storage]), redirect URL patterns
- Provider env vars use `|| ''` fallback — missing Google/Apple secrets don't fail
- GitHub Environments (staging/prod) for per-env vars

### B. Defensive flip — config.toml
`[auth.external.google].enabled = false` (was true from MAS-88)
Strategy (1): disable providers until OAuth follow-up lands with real creds.
Apple was already disabled, no change needed.

### C. TOML validation
Preflight step in validate-config job: Python 3.11+ tomllib checks syntax, required sections, redirect URL patterns. Fails fast with clear message.

### D. Docs
- 01-architecture.md: Config GitOps subsection added under "GitOps for the database"
- env.md: all supabase-config-deploy.yml references → config-deploy.yml; OAuth status updated; audit trail entry added

## Blocker / caveat

PAT (ghp_aE...) has `repo` scope but NOT `workflow` scope. Cannot push `.github/workflows/*` files. Workflow file posted as PR comment. Next person to touch this: create the file manually.

Fix: regenerate PAT with `workflow` scope, or use fine-grained PAT with `Contents: Write`.

## Verification remaining

- [ ] Create config-deploy.yml from PR comment
- [ ] Merge PR → watch staging auto-fire
- [ ] Prod dispatch test
- [ ] Guard test (wrong confirmation)

## Files changed
- supabase/config.toml (Google enabled → disabled)
- docs/build-plan/01-architecture.md (Config GitOps section)
- docs/build-plan/env.md (workflow refs, OAuth status, audit)
- .github/workflows/config-deploy.yml (NEW — in PR comment)
