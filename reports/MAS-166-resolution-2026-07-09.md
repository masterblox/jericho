# MAS-166 / MAS-190 Resolution — 2026-07-09

## Verdict: ALREADY COMPLETE — merged to main via PR #82

## Investigation

The previous run (`a5478a82`) failed with ECONNREFUSED because the DEV
gateway was unreachable at the time. The actual work was long done.

## Evidence

Git log on origin/main:
```
202bff9 [MAS-190] admin: read-only observability viewers (scheduled jobs,
         webhooks, email log, audit log) (#82)
```

All four viewers confirmed on origin/main:

| Route | Page | Detail |
|---|---|---|
| /admin/scheduled-jobs | page.tsx, [id]/page.tsx | list + detail, retry/abandon actions |
| /admin/webhook-events | page.tsx, [id]/page.tsx | list + detail, replay action |
| /admin/email-log | page.tsx | list only (read-only MVP) |
| /admin/audit-log | page.tsx | list + CSV export |

## Backend

- tRPC router: `lib/trpc/routers/admin-observability.ts` (666 lines)
  - scheduledJob: list, byId, retry, abandon
  - webhookEvent: list, byId, replay
  - emailLog: list (recipient_view JOIN obligation + digital_address)
  - auditLog: list, exportCsv
  - generationJob: list, byId (bonus)
- Wired at `adminRouter.observability` in admin.ts line 639
- Shared helpers: `lib/services/admin/observability.ts`
- Audit logging: `lib/services/admin/auditLog.ts`

## Frontend

- AdminShell nav lists all 4 routes under "Platform operations"
- Admin dashboard overview page has links to all 4
- Shared components: FilterTabs, CursorPager, CopyButton,
  ScheduledJobActions, WebhookReplayButton, AuditLogExportButton,
  observability-format
- Loading skeletons for all pages

## Tests

- `tests/lib/trpc/routers/admin-observability.test.ts` exists
  (superAdminProcedure gate + service-client reads)

## Action

Mark MAS-166 as DONE. The implementation was completed and merged in
PR #82. The ECONNREFUSED failure on the last run was a transient
gateway outage, not a code issue.
