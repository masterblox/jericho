# MAS-170 Wake Resolution — 2026-07-10

## Wake
- Type: source_scoped_recovery_action
- Issue: MAS-170 / MAS-203 — "Start a memory" 500s for member-role users
- Paperclip: dead (localhost fetch failed)

## Verdict: DONE — no rebuild needed

## Evidence

### Fix item 1: Hide create CTAs for member role
Confirmed present. `canCreate` gate using `workgroup.role !== "member"` on:
- `app/(authed)/account/page.tsx` (line 103)
- `app/(authed)/account/designs/page.tsx` (line 49)
- `app/(authed)/account/library/page.tsx` (line 54)

### Fix item 2: Catch FORBIDDEN in createDesignAction
Confirmed present. `app/(authed)/account/designs/_actions.ts` lines 42-54: catches `TRPCError FORBIDDEN` and redirects to `/account/designs?error=forbidden`.

### Fix item 3: Friendly UI for forbidden redirect
Confirmed present. `app/(authed)/account/designs/page.tsx` lines 48-54, 98: reads `error=forbidden` query param, displays friendly message.

## Git note
Prior run claimed commit 8ca3681 on origin/main. This commit is not in the current shallow history (tip: d822829c). The work is present in-tree regardless — likely squashed/rebased out of the shallow clone.

## Actions taken
- Fixed deferred close JSON: corrected `status` → `target_status`, `resolution` → `reason`, `queued_at` → `resolved_at`, added `resolution_report` and `attempts` fields
- Verified recovery closer cron active (8f3e069d48d7, every 30m, last ok 2026-07-09T20:37)
- Paperclip unreachable — deferred close will apply on recovery
