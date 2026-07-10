# MAS-29 / MAS-230 Resolution Report
**Date:** 2026-07-09 14:00 DXB (UTC+4)
**Status:** RESOLVED — work complete, awaiting Paperclip API recovery for issue closure

## Root Cause of Prior Failure

Run `42b1883f-b582-499e-a875-ebe687473e13` failed with `hermes_gateway_rate_limited: Hermes gateway HTTP 429`. Classic transient failure: the agent completed all work (build, PR, merge), then got rate-limited during the Paperclip comment/status update. The code was never broken — only the final API call failed.

## Audit Results

### Git State
- HEAD: `638d3d77c7b44594745056bde5fa140036f4066b`
- origin/main: `638d3d77c7b44594745056bde5fa140036f4066b`
- HEAD == origin/main: YES
- MAS-230 commit on main: `c845c2a [MAS-230] Operator env-var reference: AI-provider surface + rotation recipes (#170)`

### Acceptance Criteria Verification

1. PASS — Stripe webhook rotation recipe present (lines 268-271 of docs/build-plan/env.md)
   - Source dashboard, consumption site, update steps, verification step all documented
   - Full var-set checklist (lines 291-327) maps all 30 vars from lib/env.ts (names only, no values)

2. PASS — All required surfaces present:
   - AI-provider vars: 12 rows in dedicated sub-table (lines 41-53) — AI_PROVIDER, AI_PROVIDER_ALLOW_MOCK, OPENAI_API_KEY, OPENAI_IMAGE_MODEL, OPENAI_IMAGE_QUALITY, GEMINI_API_KEY, GEMINI_IMAGE_MODEL, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_AI_TOKEN, CLOUDFLARE_AI_MODEL, CLOUDFLARE_AI_STEPS, POLLINATIONS_MODEL
   - CRON_SECRET: in lib/env.ts (line 72), rotation recipe (lines 284-287), checklist
   - Railway runtime section (lines 57-110): service env, provisioning secrets (RAILWAY_PAT/PROJECT_ID/ENVIRONMENT_ID/TOKEN + 5 stack secrets), deploy gate var
   - Cloudflare cron-worker GH secrets (lines 61-91): CLOUDFLARE_CRON_DEPLOY_TOKEN, CLOUDFLARE_ACCOUNT_ID, CRON_TARGET_URL, with explicit AI-token vs deploy-token distinction

3. PASS — No prescriptive ANON_KEY or OPENCLAW_DB_PASSWORD references:
   - ANON_KEY: 2 mentions (lines 105, 110), both clarifying derivation from JWT_SECRET — "these are NOT env vars you set"
   - OPENCLAW_DB_PASSWORD: 3 mentions (lines 331, 348), all explicitly stating it was NEVER an app env var
   - PUBLISHABLE_KEY used throughout (not anon key)
   - openclaw_readonly role documented correctly
   - Legacy "anon" mention on line 21 is context for the API key model rename

### Var-Set Match (lib/env.ts)
- Server vars: 25 (3 required: SUPABASE_SECRET_KEY, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; 22 optional)
- Client vars: 5
- Total: 30 — documented count matches exactly

### Rotation Recipes (all present)
- STRIPE_WEBHOOK_SECRET (lines 268-271)
- RESEND_API_KEY — with SMTP double-consumer note (lines 273-277)
- OPENAI_API_KEY (lines 279-282)
- CRON_SECRET — with dual-side timing warning (lines 284-287)

## Action Required

Paperclip is in auth-deadlock (API key jer_924b… returns 401 on all endpoints post-0.3.1 upgrade). Cannot mark issue resolved via API.

Manual closure needed when Paperclip recovers:
- Issue: MAS-29 (3e40fc53-75eb-4205-a6db-575575692343)
- Status to set: `done`
- Resolution: All work delivered in PR #170, merged to main. Transient 429 failure, zero rebuild needed.
