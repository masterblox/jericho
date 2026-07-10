# MAS-46 / MAS-189 Resolution — 2026-07-09

## Verdict: DONE (transient failure retry — work already completed)

Previous run 9635a2b2 failed with HTTP 429 (rate limited) before doing any work.
This run confirms the work was already completed and merged in a prior session.

## State

- HEAD: 638d3d77c7b4 (matches origin/main)
- Branch: dev/mas-162-support-inbox-contact (up to date with main)
- All MAS-46 files IN HEAD, clean (no unstaged changes)

## Files Shipped

- `app/(authed)/account/settings/page.tsx` — server component, loads profile + workgroup
- `app/(authed)/account/settings/_components/ProfileSection.tsx` — display_name + avatar upload via uploads.sign/confirm
- `app/(authed)/account/settings/_components/EmailSection.tsx` — email change with re-auth via signInWithPassword
- `app/(authed)/account/settings/_components/PasswordSection.tsx` — password change with re-auth + validation
- `app/(authed)/account/settings/_components/DeleteAccountSection.tsx` — type-DELETE confirm modal → deleteSelf mutation → /goodbye
- `app/(public)/goodbye/page.tsx` — post-delete landing page
- `lib/trpc/routers/profile.ts` — get, updateProfile, updateEmail, deleteSelf (mounted as `profile` router)
- `components/ui/UserMenu.tsx` — Settings nav link added

## Migrations

- `supabase/migrations/20260601000300_add_delete_profile_self_rpc.sql` — SECURITY DEFINER RPC
- `supabase/migrations/20260601000400_lock_profile_status_columns.sql` — column lockdown triggers

## Supporting Code

- `lib/db/rpc.ts` — deleteProfileSelf typed wrapper
- `lib/services/admin/auditLog.ts` — logAdminAction (best-effort audit)
- `lib/db/types.gen.ts` — delete_profile_self function type

## Tests

- `tests/lib/trpc/routers/profile.test.ts` — 39 assertions: SET-keys regression for P0008, deleteSelf sole-owner CONFLICT, happy-path RPC-before-audit, idempotent, UNAUTHORIZED
- `tests/e2e/account-settings.spec.ts` — 57 assertions: auth gate, authed surface, seeded destructive walks (delete happy-path, password round-trip)
- `supabase/tests/delete_profile_self.sql` — pgTAP: soft-deletes, PII anonymized, tokens revoked, ledger UNCHANGED, idempotent, grant

## RPC: delete_profile_self(p_profile_id uuid)

Idempotent SECURITY DEFINER function:
1. Soft-deletes profile (deleted_at = now())
2. Anonymizes recipient PII (physical_address → '[deleted]', digital_address.email → deleted@deleted.invalid)
3. Revokes live recipient_view tokens
4. Soft-suspends owned workgroups
5. Ledger/balance/orders untouched (financial trail preserved)
6. service_role only

## Paperclip Status

Unable to update issue to `done` — Paperclip API unreachable (HTTP 000, server down).
This report serves as durable resolution evidence.
