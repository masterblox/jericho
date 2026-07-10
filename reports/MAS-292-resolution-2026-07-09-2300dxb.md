# MAS-292 / MAS-305 Resolution Report
## Output-Trust Hardening — Budget, Sections, Persistence

**Audit date:** 2026-07-09 ~23:00 DXB
**Auditor:** Jericho (Paperclip wake misdelivery — DEV wake handled by Jericho)
**Repo:** /opt/data/repos/architect-ai (canonical)
**Branch:** main (HEAD 4b5dad2)
**Prior run:** e5e3ffa9 — timed out at 600s

---

## Verdict: ALL THREE AREAS COMPLETE ON MAIN

### 1. Budget VAT/Currency — DONE

| Check | Status | Evidence |
|-------|--------|----------|
| VAT/IVA resolution | PASS | `resolveConstructionTax.ts` (66 lines) — finds flat construction_cost taxes per region |
| VAT wired to budget | PASS | `global-calc.ts:55` — `vatRate: resolveConstructionTax(region)?.rate ?? 0` |
| VAT computation | PASS | `calc.ts:57` — `vat = base * project.meta.vatRate` |
| Lisbon PT-IVA 23% | PASS | `regions/lisbon.ts:50-59` — flatRate 0.23, appliesTo construction_cost |
| Lisbon currency/locale | PASS | EUR, pt-PT, metric |
| Dubai 5% VAT (approximate) | PASS | `resolveConstructionTax.ts:33-34` — marked approximate with caveat |
| NYC 8.875% (approximate) | PASS | `resolveConstructionTax.ts:32` — marked approximate with caveat |
| regionalExtras removed | PASS | Commit 4b5dad2 cherry-picked to main |
| Cross-check vs Prada orçamentos | N/A | `data/training/Prada/**` not on VPS — Carlos desktop data |

**Budget totals flow:** region.taxes → resolveConstructionTax → meta.vatRate → computeTotals → vat = base * vatRate → PDF/Excel/UI display with proper IVA line

### 2. Sections "Indicative" Label — DONE

| Check | Status | Evidence |
|-------|--------|----------|
| UI label | PASS | `console-copy.ts:102` — `sectionTag: "SECTION (INDICATIVE)"` |
| UI hint | PASS | `console-copy.ts:103` — `sectionHint: "Schematic only — not projected from floor plan. Verify dimensions before use."` |
| Wired in PlansView | PASS | `PlansView.tsx:113-115` — sectionTag used for badge, sectionHint as title tooltip |
| Code comment in section.ts | MINOR GAP | No internal comment in section.ts noting the schematic limitation. UI labeling is sufficient for user trust. |

### 3. Persistence (MAS-298) — DONE

| Check | Status | Evidence |
|-------|--------|----------|
| localStorage persistence | PASS | `workspace-store.ts:38-59` — saveWorkspace/loadWorkspace |
| Server persistence (create) | PASS | `workspace-store.ts:102-119` — POST /api/projects |
| Server persistence (sync) | PASS | `workspace-store.ts:126-147` — PATCH /api/projects/:id (debounced 2s) |
| Server persistence (restore) | PASS | `workspace-store.ts:154-178` — GET /api/projects/:id via ?id= param |
| API route POST | PASS | `src/app/api/projects/route.ts` — auth, RLS, ratelimit, Supabase insert |
| API route GET/PATCH | PASS | `src/app/api/projects/[id]/route.ts` — auth, RLS, UUID validation |
| Hook integration | PASS | `useArchitectWorkspace.ts:205-210` — useEffect persists on every state change |
| createProject server call | PASS | `useArchitectWorkspace.ts:273-281` — fire-and-forget createServerProject |
| Hydration from server | PASS | `useArchitectWorkspace.ts:157-188` — ?id= restore path |

**Project survival path:** createProject → localStorage + POST /api/projects → every state change → PATCH /api/projects/:id → reload → localStorage first (instant), fallback GET /api/projects/:id

---

## Prior Run (e5e3ffa9)

Timed out at 600s. The full MAS-305 work exists on branch `dev/mas-309-graph-placer` at commit `ba7e57f`. The regionalExtras removal was cherry-picked to main as `4b5dad2`. The sections label and persistence work were already on main from earlier commits (MAS-332, MAS-298 respectively).

## Disposition

**Status: DONE**

All three acceptance criteria are satisfied on main:
- Budget VAT/currency is correctly resolved and computed
- Sections are honestly labelled "INDICATIVE" in the UI
- A logged-in user's project survives a reload via dual-layer persistence

Minor gap: `section.ts` lacks an internal code comment noting the schematic limitation. The UI labeling is the user-facing trust signal and is sufficient.
