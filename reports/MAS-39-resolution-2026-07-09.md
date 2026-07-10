# MAS-39 Resolution — 2026-07-09

Issue: MAS-231 - Backup/restore, disaster-recovery + incident runbook
File: docs/handover/disaster-recovery.md (676 lines, 38KB)
Status: DONE — merged to main via PR #174 (commit 26e57b8)

## Acceptance Criteria Assessment

### 1. PITR restore drill (PASS)
Section 2.3 "How to request / perform a PITR restore":
- Self-serve path: Dashboard → Project → Database → Backups → Point in Time
- Fallback: Supabase support ticket for Free plan / cross-project / older-than-retention
- Post-restore validation checklist in §2.5 (5 checks: Storage-DB coupling, ledger integrity, obligation fulfilled hazard, auth, cron heartbeat)
- Schema-only rebuild fallback in §2.4

### 2. Upstream-down scenarios (PASS)
Section 3 covers all seven providers, each with: symptom, degradation behavior, self-heal assessment, and operator action:
- Supabase — total outage, hard-fail, self-heals on recovery
- App host (Railway) — 502/unreachable, hard-fail, rollback via dashboard redeploy
- Cloudflare cron — queue stalls (not lost), self-heals next tick, CRON_SECRET diagnosis
- Stripe — graceful, auto-retries, idempotent replay safe
- Resend — partial (mid-batch fire-and-forget needs manual resend)
- PostGrid — graceful (quadratic backoff, max 5 attempts)
- OpenAI/AI — hard-fail per request, manual env flip + redeploy (pollinations keyless fallback)

### 3. super_admin provisioning (PASS)
Section 5 documents P0008 trigger:
- Branch-by-branch SQL analysis (auth.uid() IS NULL → trusted; is_super_admin() → permitted; else P0008)
- Normal path: admin UI via admin.users.setRole tRPC mutation (§5.2)
- Bootstrap/fallback: service-role SQL with email join on auth.users (§5.3)
- Allowlist variant: super_admin_seed insert + backfill (§5.3 second block)
- Current seeded operators documented (§5.4)

## Previous Run Failure
Run d5029b05 (2026-07-09T14:21:28Z): hermes_gateway HTTP 429 (rate limited).
Work was already complete and merged — the 429 occurred during Paperclip issue update, not during document creation.

## Deferred Close
Paperclip API is degraded (health=200, auth endpoints timeout HTTP 000).
Deferred close JSON queued at /opt/data/jericho/outbox/paperclip-close-MAS-39.json.
