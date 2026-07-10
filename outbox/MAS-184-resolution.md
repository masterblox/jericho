# MAS-184 Resolution — DEV

## Status: DONE (Paperclip unreachable, requires manual closure)

## Issue
MAS-184 tracking MAS-178: Fix customer_provision_failed on /account/billing — trim env secrets at boundary

## Ground Truth
Commit 61dd2a2 (May 23, 2026) on main of memories-express-mvp-cp. All 4 deliverables verified on main:

1. lib/env.ts — 16 `.trim()` calls on all string-secret schemas (SUPABASE_SECRET_KEY, RESEND_API_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, OPENAI_API_KEY, GEMINI_API_KEY, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_AI_TOKEN, POLLINATIONS_MODEL, POSTGRID_API_KEY, POSTGRID_FROM_ADDRESS_ID, POSTGRID_WEBHOOK_SECRET, RESEND_WEBHOOK_SECRET, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_PINTURA_LICENSE_KEY, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)

2. tests/api/billing/checkout.test.ts — 6 tests covering customer_provision_failed redirect contract, happy-path 303, no_workgroup, missing_product, stripe_session_failed

3. tests/lib/env.test.ts — 5 tests pinning trim behavior so future PRs can't drop .trim()

4. .env.example + docs/build-plan/04-agent-conventions.md — whitespace gotcha documented with diagnostic recipe

## Previous Run Failure
Run 06b802fb failed with hermes_gateway_rate_limited (HTTP 429) — transient rate limit, not a code failure.

## Outstanding
Manual followup only (not code): re-paste affected Vercel preview + production env values without trailing whitespace. Code fix neutralizes the issue regardless on next deploy.

## Paperclip Status
API unreachable (HTTP 000 on health, 404 on PATCH). Post-0.3.1 auth deadlock. Unable to set issue status to "done" via API. Manual closure required.

## Action for Jericho
Close MAS-184 in Paperclip when API recovers. Status should be "done".
