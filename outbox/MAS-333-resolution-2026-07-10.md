MAS-333 Resolution Report
=======================
Wake: source_scoped_recovery_action (prev run 4eb332ba timed out)
Date: 2026-07-10
Status: DONE

Task: Make /api/budget/export currency/locale-aware for region Estimates (MAS-328 sub-task 15)

Changes (architect-ai repo, 4 files):

1. src/lib/budget/calc.ts — New locale-aware formatting layer:
   - formatCurrency(value, currency, locale) — replaces formatEUR
   - formatCurrencyCompact(value, currency, locale) — replaces formatEURCompact
   - formatDate(iso, locale) — replaces formatLongDate
   - excelCurrencyFormat(currency, locale) — dynamic Excel numFmt
   - Legacy functions kept as thin wrappers for backward compat

2. src/app/api/budget/export/route.ts — Region parameter:
   - Accepts ?region=lisbon|dubai|bangalore|london|mumbai|nyc
   - Looks up region via getRegion() from regions/registry
   - Overrides meta.currency + meta.locale on the project
   - Passes currency/currencySymbol/locale in exportOpts to builders
   - Falls back to EUR/pt-PT when region omitted or unknown

3. src/lib/budget/excel.ts — Dynamic Excel formatting:
   - Opts extended: currency?, currencySymbol?, locale?
   - Uses excelCurrencyFormat() for all currency cells
   - Uses formatDate() for the emission date on the Resumo sheet

4. src/lib/budget/pdf.ts — Dynamic PDF formatting:
   - Opts extended: currency?, currencySymbol?, locale?
   - Currency values formatted via fmt() wrapper using formatCurrency()
   - Date formatted via formatDate(iso, locale)

Verification:
- No other callers of buildBudgetWorkbook/buildBudgetPdf (only export route)
- BudgetMeta already had currency (string) and locale? (optional string) fields
- All 6 regions have currency, currencySymbol, and locale in RegionalRates
- Backward-compatible: default region=lisbon preserves existing behavior
