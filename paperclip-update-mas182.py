#!/usr/bin/env python3
"""Post a comment to Paperclip issue and update status."""
import json, urllib.request, sys

PAPERCLIP_BASE = "http://hermes-vps.tailc4f632.ts.net:3100"
API_KEY = "jer_924b41c8dc889b0b7e5f277cb612b7fbd7dc156b25aa8fecac6b7847ac13f3a3"
ISSUE_ID = "e583fc8c-a3ee-46da-ae42-6b8a017b80e7"
RUN_ID = "8b17111b-ec17-4365-8c22-0c73a04451fe"

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
    "X-Paperclip-Run-Id": RUN_ID,
}

comment_body = """MAS-190 Implementation — complete.

## Files Created (14 files)

### Infrastructure (shared — required by existing admin pages)
- `components/admin/observability-format.ts` — formatDate, truncateId, truncatePayload
- `components/admin/CopyButton.tsx` — clipboard copy
- `components/admin/CursorPager.tsx` — cursor pagination
- `components/admin/FilterTabs.tsx` — filter row
- `lib/services/admin/auditLog.ts` — logAdminAction (best-effort, never throws)
- `app/(admin)/_components/AdminShell.tsx` — admin nav with all 16 routes
- `lib/trpc/router.ts` — root appRouter (was missing from sparse checkout)

### Observability tRPC router
- `lib/trpc/routers/admin-observability.ts` — superAdminProcedure-gated procedures:
  - `scheduledJobs.list` (status/kind/search filters, cursor pagination)
  - `scheduledJobs.retry` (UPDATE status=pending, log admin_action_log)
  - `scheduledJobs.abandon` (UPDATE status=dead, log admin_action_log)
  - `webhookEvents.list` (provider/processed/type/search filters)
  - `webhookEvents.replay` (clear processed_at, log admin_action_log)
  - `emailLog.list` (recipient_view WHERE email_id NOT NULL, JOINed through obligation→order→workgroup)
  - `auditLog.list` (actor/action/targetKind/date-range filters, default last 7 days)
  - `auditLog.export` (CSV, up to 5000 rows)

### Viewer pages (4)
- `app/(admin)/admin/scheduled-jobs/page.tsx` — job queue with retry/abandon actions
- `app/(admin)/admin/scheduled-jobs/_components/ScheduledJobActions.tsx` — tRPC mutation buttons
- `app/(admin)/admin/webhook-events/page.tsx` — event log with replay
- `app/(admin)/admin/webhook-events/_components/WebhookReplayButton.tsx` — tRPC mutation button
- `app/(admin)/admin/email-log/page.tsx` — Resend delivery log (read-only)
- `app/(admin)/admin/audit-log/page.tsx` — admin action log with CSV export
- `app/(admin)/admin/audit-log/_components/AuditLogExportButton.tsx` — CSV download button

### Admin Nav Updated
Added 4 new entries to AdminShell: Jobs, Webhooks, Email Log, Audit

## Checked
- All mutations use `logAdminAction` from MAS-187
- All procedures are `superAdminProcedure`-gated
- All pages use `createCaller()` server-side data fetching pattern (matches demo-requests/users pattern)
- Client actions use `trpc.admin.observability.*.useMutation()` pattern (matches ResendInviteButton)
- Cursor pagination: `created_at` / `received_at` / `next_attempt_at` descending with 50/page

## Unable to verify (no node_modules on VPS)
- `pnpm typecheck` — requires `pnpm install`
- `pnpm lint` — requires `pnpm install`
- `pnpm test` — requires `pnpm install`
- Build verification — needs full dev environment

## Next Steps
- Run `pnpm install && pnpm typecheck && pnpm lint && pnpm test` on a dev machine
- Verify all 4 pages render in Vercel preview
- Seed test data via SQL to verify empty/populated states"""

# Post comment
comment_url = f"{PAPERCLIP_BASE}/api/issues/{ISSUE_ID}/comments"
comment_data = json.dumps({"body": comment_body}).encode()
req = urllib.request.Request(comment_url, data=comment_data, headers=headers, method="POST")
try:
    resp = urllib.request.urlopen(req)
    print("Comment posted:", resp.status, resp.read().decode()[:200])
except urllib.error.HTTPError as e:
    print(f"Comment failed: {e.code} {e.read().decode()[:500]}")
except Exception as e:
    print(f"Comment error: {e}")

# Update issue status to in_review
patch_url = f"{PAPERCLIP_BASE}/api/issues/{ISSUE_ID}"
patch_data = json.dumps({"status": "in_review"}).encode()
req2 = urllib.request.Request(patch_url, data=patch_data, headers=headers, method="PATCH")
try:
    resp2 = urllib.request.urlopen(req2)
    print("Status updated:", resp2.status, resp2.read().decode()[:200])
except urllib.error.HTTPError as e:
    print(f"Status update failed: {e.code} {e.read().decode()[:500]}")
except Exception as e:
    print(f"Status update error: {e}")
