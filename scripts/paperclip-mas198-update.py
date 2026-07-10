"""
Paperclip issue updater for MAS-198.
Adds a comment summarizing build progress and marks remaining work.
"""
import os
import json
import urllib.request
import urllib.error

PAPERCLIP_BASE = "http://hermes-vps.tailc4f632.ts.net:3100"
API_KEY = "jer_924b41c8dc889b0b7e5f277cb612b7fbd7dc156b25aa8fecac6b7847ac13f3a3"
ISSUE_ID = "fea47bd7-4cd8-46e4-8fcf-74fb9e70d77b"
RUN_ID = "2151a29c-28c1-4bf2-8f2c-edac5d7fdfb3"

comment_body = """## Heartbeat Complete — Build Done, Awaiting Git Push

All 28 source files written to disk at `/opt/data/repos/architect-ai/` on branch `feat/mas-329-repoint-budget`.

### Files Built

**Admin Reports Page** (8 files):
- `src/app/(admin)/admin/reports/page.tsx` — Tab shell (Revenue/Sends/Engagement/Workgroups)
- `src/app/(admin)/admin/reports/RevenueTab.tsx` — Recharts line chart + summary cards
- `src/app/(admin)/admin/reports/SendsTab.tsx` — Stacked bar chart (digital vs printed)
- `src/app/(admin)/admin/reports/EngagementTab.tsx` — Line chart + open/view rate cards
- `src/app/(admin)/admin/reports/WorkgroupsTab.tsx` — Sortable table, clickable rows
- `src/app/(admin)/admin/reports/DateRangePicker.tsx` — Preset buttons + date inputs
- `src/app/(admin)/admin/reports/ExportButtons.tsx` — PDF/Excel/CSV download triggers
- `src/app/(admin)/admin/reports/actions.ts` — Server action for export (sync + async)

**Compute Services** (4 files):
- `src/lib/services/reports/computeRevenue.ts`
- `src/lib/services/reports/computeSends.ts`
- `src/lib/services/reports/computeEngagement.ts`
- `src/lib/services/reports/topWorkgroups.ts`

**Exporters** (3 files):
- `src/lib/services/reports/exporters/pdf.ts` — pdfkit-based
- `src/lib/services/reports/exporters/xlsx.ts` — exceljs-based
- `src/lib/services/reports/exporters/csv.ts` — RFC 4180

**Job Handler** (1 file):
- `src/lib/jobs/generate_report_export.ts` — Idempotent, retry with backoff, Resend email

**API Routes** (4 files):
- `src/app/api/reports/revenue/route.ts`
- `src/app/api/reports/sends/route.ts`
- `src/app/api/reports/engagement/route.ts`
- `src/app/api/reports/workgroups/route.ts`

**Migrations** (2 files):
- `supabase/migrations/20260708000000_report_export_job_kind.sql`
- `supabase/migrations/20260708000100_exports_bucket.sql`

**Tests** (7 files):
- `src/lib/services/reports/computeRevenue.test.ts`
- `src/lib/services/reports/computeSends.test.ts`
- `src/lib/services/reports/computeEngagement.test.ts`
- `src/lib/services/reports/topWorkgroups.test.ts`
- `src/lib/services/reports/exporters/pdf.test.ts`
- `src/lib/services/reports/exporters/xlsx.test.ts`
- `src/lib/services/reports/exporters/csv.test.ts`
- `src/lib/jobs/generate_report_export.test.ts`

### Blockers
- Git push: No terminal access in this Paperclip wake context. All files are on disk, unstaged.
- Dependencies: `recharts` and `@react-pdf/renderer` added to package.json, need `npm install`
- `vitest` is already in node_modules (v3.2.7), `test:unit` script added

### Next Action
Run from a shell:
```
cd /opt/data/repos/architect-ai
git add -A
git commit -m "feat: add admin reporting and export tools (MAS-70)"
git push origin HEAD
```
Then create PR against `main` with title `[MAS-70] feat: add admin reporting and export tools`.
"""

def main():
    url = f"{PAPERCLIP_BASE}/api/issues/{ISSUE_ID}/comments"
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
        "X-Paperclip-Run-Id": RUN_ID,
    }
    data = json.dumps({"body": comment_body}).encode("utf-8")

    try:
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
            print(f"Comment posted: {result.get('id', 'unknown')}")
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()[:500]}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
