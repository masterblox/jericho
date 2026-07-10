# MAS-184 Resolution Report
**Date:** 2026-07-09
**Verdict:** DONE — merged to main

## Issue
MAS-184 (Paperclip) / MAS-178 (Linear) — Fix customer_provision_failed on /account/billing, trim env secrets at boundary

## State
- **Commit:** 61dd2a2 — `[MAS-178] Trim env secrets at boundary — fix customer_provision_failed (#56)`
- **Merged:** May 23, 2026 (6+ weeks ago)
- **Branch:** main (ancestor of both HEAD and origin/main)
- **Git status:** clean
- **HEAD:** ec9fa75 (2 commits ahead of origin/main for unrelated MAS-206/MAS-334 work)

## Verification
All 4 scope items confirmed on main:

1. **lib/env.ts** — `.trim()` chained on all 7 string-secret schemas:
   - STRIPE_SECRET_KEY ✓
   - STRIPE_WEBHOOK_SECRET ✓
   - SUPABASE_SECRET_KEY ✓
   - RESEND_API_KEY ✓
   - NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ✓
   - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ✓
   - NEXT_PUBLIC_PINTURA_LICENSE_KEY ✓

2. **tests/api/billing/checkout.test.ts** — 262 lines, `customer_provision_failed` contract tests present

3. **tests/lib/env.test.ts** — 122 lines, trim behavior pinned

4. **Docs** — `.env.example` header + `docs/build-plan/04-agent-conventions.md` updated

## Paperclip Status
Auth-deadlock (Stage 5): health=200, authenticated endpoints timeout. Cannot PATCH issue via API. Deferred close queued.

## Prior Run
Run 60eb1bc9 failed with HTTP 429 (Hermes gateway rate limited). The code work was already complete and merged — the 429 happened on the Paperclip update, not during the build.
