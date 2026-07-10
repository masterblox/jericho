#!/bin/bash
set -e

REPO=/opt/data/repos/architect-ai
cd "$REPO"

echo "=== GIT STATUS ==="
git status --short

echo ""
echo "=== STAGING NEW FILES ==="
git add -A

echo ""
echo "=== COMMITTING ==="
git commit -m "feat: add admin reporting and export tools (MAS-70)

- Admin reports page with tabs: Revenue, Sends, Engagement, Workgroups
- Recharts-based charts (line, bar) with dark theme
- Date range picker with presets (7D/30D/90D/1Y)
- Summary cards per report tab
- Compute services: computeRevenue, computeSends, computeEngagement, topWorkgroups
- Exporters: PDF (pdfkit), Excel (exceljs), CSV (RFC 4180)
- Async export path via scheduled_job of kind generate_report_export
- Idempotent export handler with Resend email delivery
- Exports storage bucket migration
- Vitest unit tests for compute services, exporters, and job handler
- API routes for report data serving

Ref: MAS-70, MAS-198"

echo ""
echo "=== PUSHING ==="
git push origin HEAD
