# MAS-220 — Status: BLOCKED on MAS-70 (2026-07-07)

## Blocker
MAS-70 (reports shell + tabs + exporters) has not been built. No `/admin/reports` page
exists in the codebase. Per the issue instructions, this ticket is blocked until
MAS-70 lands.

## Delivered (ready for MAS-70 integration)

### Service layer (`src/lib/services/reports/`)
| File | Purpose |
|------|---------|
| `index.ts` | Barrel export + DateRange type |
| `topWorkgroupsBySpend.ts` | Top 20 by ledger spend with AI gen count, Stripe fees |
| `topByMembers.ts` | Top 20 by active member count |
| `topBySends.ts` | Top 20 by send volume (recipient_view) |
| `activationFunnel.ts` | 4-step funnel: signup -> first design -> first send -> first purchase |
| `churnSignal.ts` | Workgroups 60+ days inactive, 90+ days since creation |

### Cron handler (`src/app/api/cron/weekly-report/route.ts`)
- Vercel Cron auth via CRON_SECRET bearer token
- Idempotency via scheduled_job(kind="send_weekly_report", payload.week_start)
- Handles UNIQUE constraint (23505) race condition
- Parallel fetch of all 5 report functions
- Sends to all super_admin profiles via getEmailProvider()

### Email template (`src/lib/services/email/weeklyReport.tsx`)
- Plain HTML email with inline styles
- Top-5 spend/members/sends tables
- Activation funnel with conversion percentages
- Churn signal table
- Empty states, XSS escaping

### Config
- `vercel.json`: cron schedule `0 9 * * 1`

### Tests (`tests/`)
- `tests/lib/services/email/weeklyReport.test.ts`: 14 structural tests (exports, auth, idempotency, XSS, empty states)
- `tests/app/api/cron/weekly-report.test.ts`: route structure + idempotency design
- TypeScript compiles clean (`npx tsc --noEmit`)

### Schema adaptations
No `orders`, `intent`, or `user_template` tables exist in architect-ai schema:
- First design = min(generation_job.created_at) per profile
- First send = min(upload.created_at WHERE source="ai_generation") per profile
- First purchase = min(ledger.created_at WHERE kind="purchase" AND source="stripe") per profile
- PostGrid not applicable (different product)

## Next steps when MAS-70 lands
1. Wire service functions into `/admin/reports` Cross-account tab
2. Add funnel chart card
3. Add churn table with export buttons
4. Add cost dashboard columns (AI gen count, Stripe fees)
5. Set CRON_SECRET env var in Vercel

## Branch
`feat/MAS-182-admin-observability` on `Mechanica-Labs/architect-ai`
