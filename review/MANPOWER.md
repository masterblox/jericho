# Terraza — Engineering Gap Analysis

**Date:** July 2026
**Scope:** What's live vs. ideal-world Terraza. Story points, skill profiles, phasing.
**Companion:** See `INVESTMENT_PLAN.md` for the product vision this document measures against.

---

## Reading This Document

- **Story points:** Fibonacci scale (1, 2, 3, 5, 8, 13). 1 = trivial, 13 = epic requiring research spikes.
- **Skill profiles:** FE (frontend), BE (backend), BIM/ML (domain engineering), INFRA (infrastructure/DevOps).
- **Phase 1:** Must-have for public launch. Without these, the product is not credible.
- **Phase 2:** Post-launch improvements that retain users and expand use cases.
- **Phase 3:** Scale features that unlock new markets and revenue streams.
- **R&D:** The approach is undefined. Story points are estimates; a discovery spike is needed before committing.
- **Partial credit:** Where a stub, WIP, or adjacent implementation exists, the estimate accounts for it.

---

## Tier 1 — What's Live Today

For context. These are NOT gaps — they are the baseline.

| Feature | Engine | Status |
|---------|--------|--------|
| Budget engine (5 regions) | `src/lib/budget/` | Production |
| Conversational budget Q&A | `src/lib/budget/conversational*.ts` | Production |
| E&O regression | `src/lib/budget/regression.ts` | Production |
| Floor plan generation (3 fallbacks) | `src/lib/cad/floorplan.ts`, `layout.ts`, `program.ts` | Production |
| Section generator | `src/lib/cad/section.ts` | Production |
| 2D CAD editor (Konva) | `src/components/console/editor/` | Production |
| 3D orbital viewer (Three.js) | `src/components/marketing/studio/Massing.tsx` | Production |
| FAL render pipeline | `src/app/api/studio/render/route.ts` | Production |
| DXF/SVG export | `src/lib/cad/export-dxf.ts`, `export-svg.ts` | Production |
| Client pack / municipal dossier | `src/lib/client-pack/` | Production |
| PDF/Excel budget export | `src/lib/budget/pdf.ts`, `excel.ts` | Production |
| Voice input | `src/components/marketing/BudgetDialog.tsx` | Production |
| CI/CD (GitHub Actions + Vercel) | `.github/workflows/` | Production |
| Supabase auth + storage | `supabase/migrations/` | Production |

---

## Phase 1 — Must-Have for Launch

Without these, Terraza is a demo, not a product.

### 1.1 AutoCAD Auto-Draw from Prompts

**The gap:** Currently, the floor plan engine produces DXF/SVG geometry, but there is no full drawing-generation pipeline that produces publication-quality AutoCAD output from a natural-language prompt. The existing `console-copy.ts:134` has "AutoCAD mode" labels but no auto-draw implementation. `architect-content.ts:374` explicitly states "Full AI drawing generation is next."

| Sub-feature | Points | Profile | Notes |
|-------------|--------|---------|-------|
| Prompt → room program (heuristic) | 0 | — | Done: `src/lib/cad/program.ts` (370 lines) |
| Room program → packed floor plan | 0 | — | Done: `src/lib/cad/layout.ts` (486 lines) |
| Floor plan → DXF with layers | 0 | — | Done: `src/lib/cad/export-dxf.ts` |
| Auto-dimensioning (aligned, linear, angular) | 5 | BIM/ML | Partial: `src/lib/cad/layout.ts` has overall dims. Needs per-room, per-wall, angular dims per ANSI/ISO standard. |
| Auto-title-block and sheet layout | 5 | FE/BIM | Missing. Needs A1/A3 sheet template, title block with project metadata, viewport scaling. |
| Annotation engine (room names, area callouts, notes) | 3 | FE | Partial: `layout.ts:310-320` has room labels. Needs area callouts, wall tags, door/window schedules. |
| Block library (doors, windows, fixtures, furniture) | 5 | BIM/ML | Partial: `walls.ts` has door/window primitives. Needs standard block library (200+ blocks) with insertion points. |
| LLM → full drawing orchestration | 8 | BIM/ML | Missing. The `parseProjectBrief` in `src/app/api/cad/route.ts` parses briefs but doesn't orchestrate a full drawing set. Needs prompt → program → layout → annotate → dimension → title-block pipeline. |
| Multi-sheet generation (plan + section + elevation in one pass) | 8 | BIM/ML | Missing. Currently each command runs independently. Needs a "generate project" flow that produces a coordinated sheet set. |
| **Subtotal** | **34** | | |

**Existing partial credit:** The core geometry engine (layout.ts + walls.ts + floorplan.ts) is production-grade. The gap is annotation, sheeting, and orchestration — not geometry generation.

### 1.2 Full Plan-Set Generation

**The gap:** Today, an architect must run `floorplan`, then `sections`, then manually assemble a drawing set. The ideal is one brief → complete plan set.

| Sub-feature | Points | Profile | Notes |
|-------------|--------|---------|-------|
| Floor plans (all levels) | 5 | BIM/ML | Partial: single-level floor plan exists. Multi-level with stair core consistency is R&D — needs level stacking logic. |
| Building sections (cross + longitudinal) | 3 | BIM/ML | Done: `src/lib/cad/section.ts`. Needs longitudinal variant (currently only cross-section). |
| Elevations (all facades) | 8 | BIM/ML | Partial: `studio-cad.ts:44` has 3D→2D elevation projection for Villa Savoye. No standalone elevation generator from plan geometry. R&D for facade articulation. |
| Reflected ceiling plan (RCP) | 8 | BIM/ML | **Not implemented.** No ceiling code exists. Needs ceiling grid, lighting layout, HVAC diffuser placement, smoke detector routing. R&D-heavy. |
| MEP layouts (duct/pipe/electrical) | 13 | BIM/ML | **Not implemented.** Budget data only (`regions/*.ts` MEP percentages). No routing engine, no load calculations, no fixture placement. Full R&D. |
| Door/window schedule | 3 | FE/BIM | Missing. Needs extraction from plan geometry → schedule table. Simple given existing entity data. |
| Finish schedule | 2 | FE | Partial: `client-pack/alcantara.ts` has hardcoded finish schedule. Needs dynamic generation from plan. |
| Sheet index and drawing register | 2 | FE | Partial: `client-pack/alcantara.ts:35-60` has drawing register. Needs dynamic generation. |
| **Subtotal** | **44** | | |

**Key risk:** RCP and MEP are full R&D. If these are Phase 1 requirements, the timeline doubles. Recommendation: ship plan + section + elevation + schedules in Phase 1; defer RCP and MEP to Phase 2.

### 1.3 Budget Engine Hardening

**The gap:** The budget engine works but has incomplete wiring for permits, VAT, and persistence.

| Sub-feature | Points | Profile | Notes |
|-------------|--------|---------|-------|
| Wire permit fees into budget chapters | 3 | BE | Stubbed: `global-calc.ts:60-68` builds meta but doesn't add permit line items. Region data exists in `regions/*.ts` (permits array). Simple wiring. |
| Wire VAT/ tax into budget totals | 2 | BE | Documented gap: `STATE_OF_AFFAIRS.md:151` says "VAT=0, unused region data." Lisbon VAT 23% is in `regions/lisbon.ts`. Needs multiplication into final total. |
| Budget persistence (save/reopen) | 5 | BE/INFRA | Missing: `STATE_OF_AFFAIRS.md:103` "No way to save a budget." Supabase `plan` table stores CAD docs; needs budget JSONB column or separate table. |
| Share-by-URL for budgets | 3 | BE/FE | Partial: `src/lib/cad/serialize.ts` works for CAD. Needs budget serialization + `/budget/view?id=` route. |
| Currency selector persistence | 2 | FE | Partial: `BudgetView.tsx` has currency selector. Needs localStorage persistence and region auto-detection. |
| **Subtotal** | **15** | | |

### Phase 1 Total

| Category | Points |
|----------|--------|
| AutoCAD auto-draw | 34 |
| Full plan-set generation | 44 |
| Budget hardening | 15 |
| **Phase 1 Total** | **93** |

**Estimated team:** 2 BIM/ML engineers, 1 frontend, 1 backend. 12-16 weeks at velocity.

---

## Phase 2 — Post-Launch (Retain + Expand)

Features that make existing users stay and new use cases possible.

### 2.1 Structural Analysis Integration

**The gap:** Budget chapter "1" has structural percentages. No engineering calculations exist. `INVESTMENT_PLAN.md:144` lists clear spans as Q3 2026.

| Sub-feature | Points | Profile | Notes |
|-------------|--------|---------|-------|
| Clear span rules per building type | 5 | BIM/ML | R&D. Needs structural engineering domain knowledge. Rules like "timber span ≤ 6m, steel ≤ 12m, concrete ≤ 9m" for residential. |
| Beam/column sizing from span + load | 8 | BIM/ML | R&D. Requires load path assumptions, material properties, deflection limits. May use simplified tables rather than FEA. |
| Structural grid overlay on floor plan | 5 | BIM/ML | Partial: plan engine produces room geometry. Needs column grid generation from structural rules. |
| Integration with budget chapter 1 | 3 | BE | Straightforward: calculated spans → material quantities → budget line items. |
| **Subtotal** | **21** | | |

**R&D flag:** Beam/column sizing from first principles is a research project. Recommend starting with lookup tables (CUBm2, RS Means) and graduating to simplified FEA if needed.

### 2.2 Automatic Quantity Takeoff & BOQ

**The gap:** `global-calc.ts` produces parametric estimates, not measured takeoffs. `corpus-data.json` has real quantity data but no connection to CAD geometry.

| Sub-feature | Points | Profile | Notes |
|-------------|--------|---------|-------|
| CAD entity → area/length extraction | 5 | BIM/ML | Partial: `src/lib/cad/geometry.ts` has `boundingBox`, `area`, `length`. Needs room-area-to-budget-quantity mapping. |
| Wall length/area takeoff from plan | 3 | BIM/ML | Feasible: walls are double-line entities in `walls.ts`. Sum wall lengths × height = area. |
| Opening count extraction (doors/windows) | 2 | BIM/ML | Simple: count entity types in CAD document. |
| Floor area → finishes takeoff | 3 | BIM/ML | Room areas × finish spec → quantities. Needs finish schedule integration. |
| BOQ → budget chapter mapping | 2 | BE | Mapping layer between takeoff quantities and budget line items. |
| Export as standard BOQ format | 3 | BE | Excel/PDF with industry-standard columns (item, description, unit, qty, rate, amount). |
| **Subtotal** | **18** | | |

### 2.3 Permit-Ready Drawing Sets

**The gap:** `client-pack/alcantara.ts` has a hardcoded municipal dossier. No dynamic permit-set generation.

| Sub-feature | Points | Profile | Notes |
|-------------|--------|---------|-------|
| Region-specific drawing requirements | 5 | BIM/ML | R&D. Lisbon (licenciamento), NYC (DOB), London (Building Regs) each have different required drawings. Needs rule engine per region. |
| Compliance checklist generation | 3 | BE | Partial: `client-pack/alcantara.ts:30-60` has compliance items. Needs dynamic generation from plan + region. |
| Stamped drawing output (PDF with borders) | 3 | FE | PDF generation with title blocks, revision tables, professional stamps. |
| **Subtotal** | **11** | | |

### 2.4 Local Building Code Compliance Checking

**The gap:** Region legal data exists in `regions/types.ts:77-123`. No automated checking against generated designs.

| Sub-feature | Points | Profile | Notes |
|-------------|--------|---------|-------|
| Egress calculation (travel distance, exits) | 8 | BIM/ML | R&D. Needs pathfinding on plan graph, exit width rules per IBC/NBR. |
| Accessibility compliance (wheelchair paths) | 8 | BIM/ML | R&D. Door widths, ramp slopes, turning circles, accessible bathroom layouts. |
| Fire rating checks (compartmentation) | 5 | BIM/ML | R&D. Wall/door fire ratings, compartment areas, escape route integrity. |
| Daylight/ventilation ratios | 3 | BIM/ML | Feasible: window area / floor area ≥ threshold. Rules per region (Portugal NRE 176/2006). |
| Structural zone validation (seismic) | 3 | BIM/ML | Partial: `regions/dubai.ts:181` notes seismic zones. Needs zone → construction type validation. |
| **Subtotal** | **27** | | |

**R&D flag:** Egress and accessibility are active research areas in computational building design. Budget 2-3x the estimate if full automation is required. Recommend starting with rule-based checks (area thresholds, width minimums) and deferring pathfinding to Phase 3.

### 2.5 Material Scheduling

**The gap:** `client-pack/alcantara.ts` has hardcoded material schedule. `value-engineering.ts` has swap logic. No generative system.

| Sub-feature | Points | Profile | Notes |
|-------------|--------|---------|-------|
| Dynamic finish schedule from plan | 3 | BIM/ML | Room types → finish spec (floor, wall, ceiling). Rule-based: wet rooms get tile, bedrooms get carpet, etc. |
| Material spec sheet generation | 3 | FE | PDF/Excel with product codes, suppliers, quantities. |
| Integration with value engineering | 2 | BE | Wire `value-engineering.ts` swaps into generated schedules. |
| **Subtotal** | **8** | | |

### 2.6 Multi-Language Console

**The gap:** Marketing has 4 locales (`marketing-locale.ts`). Console is English-only (`console-copy.ts`).

| Sub-feature | Points | Profile | Notes |
|-------------|--------|---------|-------|
| i18n framework setup | 3 | FE | Install `next-intl` or `react-i18next`. Extract all strings from `console-copy.ts`. |
| Portuguese translation | 2 | FE | Translate ~200 console strings. |
| Arabic RTL support | 5 | FE | Partial: `marketing-locale.ts:12` has RTL detection. Console layout needs RTL mirroring. |
| LLM prompt localization | 3 | BIM/ML | `conversational-parse.ts:44` already handles EN/PT/ES/AR. Needs validation. |
| **Subtotal** | **13** | | |

### Phase 2 Total

| Category | Points |
|----------|--------|
| Structural analysis | 21 |
| Quantity takeoff / BOQ | 18 |
| Permit-ready drawing sets | 11 |
| Building code compliance | 27 |
| Material scheduling | 8 |
| Multi-language | 13 |
| **Phase 2 Total** | **98** |

**Estimated team:** 2 BIM/ML engineers, 1 frontend, 1 backend, 1 structural consultant (part-time). 16-20 weeks.

---

## Phase 3 — Scale (New Markets + Platform)

Features that unlock new revenue streams and platform economics.

### 3.1 BIM Authoring (Not Just Viewing)

**The gap:** The 3D viewer loads a GLB and projects to 2D. No BIM authoring — creating/modifying BIM elements interactively.

| Sub-feature | Points | Profile | Notes |
|-------------|--------|---------|-------|
| IFC export from generated plans | 8 | BIM/ML | Partial: `ifc-to-glb.py` imports IFC. Needs reverse: plan entities → IFC IfcWall/IfcSlab/IfcDoor/IfcWindow. |
| Interactive BIM editing (move walls, resize rooms) | 13 | BIM/ML/FE | R&D. Full parametric editing with constraint preservation. Major engineering effort. |
| IFC roundtrip (import → edit → export) | 8 | BIM/ML | R&D. Needs IFC schema understanding, property set preservation. |
| Revit plugin / Dynamo script | 13 | BIM/ML | R&D. Autodesk API integration, separate codebase. |
| **Subtotal** | **42** | | |

**R&D flag:** Interactive BIM editing is a multi-year effort. The Revit plugin is a separate product. Recommend IFC export only in Phase 3; defer interactive editing.

### 3.2 Cloud Render Farm

**The gap:** FAL.ai handles single renders. No batch/queue/GPU management.

| Sub-feature | Points | Profile | Notes |
|-------------|--------|---------|-------|
| Render queue (Redis/BullMQ) | 5 | INFRA | Missing. Needs job queue, worker processes, retry logic. |
| GPU worker pool (Fly.io machines / RunPod) | 8 | INFRA | R&D. Cost modeling, auto-scaling, cold start optimization. |
| Batch render (N views × M times of day) | 5 | INFRA | Missing. Loop over camera positions + sun positions → parallel FAL calls. |
| Cost monitoring and budgeting | 3 | INFRA | Missing. Track FAL/GPU spend per user/project. |
| **Subtotal** | **21** | | |

### 3.3 Team Collaboration

**The gap:** Product spec mentions team seats. No code exists.

| Sub-feature | Points | Profile | Notes |
|-------------|--------|---------|-------|
| Team model (org → projects → members) | 5 | BE/INFRA | Needs Supabase schema: `organization`, `membership` tables with RLS. |
| Role-based access (owner/editor/viewer) | 5 | BE/FE | RLS policies + UI permission checks. |
| Real-time collaboration (multiplayer) | 13 | FE/BE | R&D. Needs CRDT or OT engine (Yjs, Liveblocks). Major feature. |
| Commenting and markup | 5 | FE/BE | Annotation layer on drawings. |
| **Subtotal** | **28** | | |

**R&D flag:** Real-time collaboration is a separate product category. Recommend comment-only collaboration in Phase 3; defer live multiplayer.

### 3.4 Mobile App

**The gap:** No mobile implementation. `/pocket` route is a web chat interface.

| Sub-feature | Points | Profile | Notes |
|-------------|--------|---------|-------|
| React Native wrapper (Expo) | 5 | FE | Wrap existing Next.js routes in WebView or rebuild native. |
| Offline budget caching | 5 | FE/INFRA | SQLite/AsyncStorage for field use without connectivity. |
| Camera integration (site photos) | 3 | FE | Photo capture → attach to project. |
| Push notifications | 3 | INFRA | FCM/APNs setup. |
| **Subtotal** | **16** | | |

### 3.5 API for Third Parties

**The gap:** No public API. Internal `/api/cad` and `/api/budget/*` routes exist but are not documented or rate-limited for external use.

| Sub-feature | Points | Profile | Notes |
|-------------|--------|---------|-------|
| API key management (Supabase or external) | 3 | BE/INFRA | Needs key generation, rotation, usage tracking. |
| OpenAPI spec and developer docs | 3 | FE/BE | Document existing endpoints, add schema validation. |
| Webhook support (render complete, export ready) | 3 | BE | Event-driven notifications for async operations. |
| Usage metering and billing integration | 5 | BE/INFRA | Stripe/LemonSqueezy metered billing. |
| **Subtotal** | **14** | | |

### Phase 3 Total

| Category | Points |
|----------|--------|
| BIM authoring | 42 |
| Cloud render farm | 21 |
| Team collaboration | 28 |
| Mobile app | 16 |
| Third-party API | 14 |
| **Phase 3 Total** | **121** |

**Estimated team:** 2 BIM/ML, 2 frontend, 2 backend, 1 infra/DevOps, 1 mobile. 20-28 weeks.

---

## Grand Summary

### Points by Phase

| Phase | Points | Weeks (4-person team) | Weeks (8-person team) |
|-------|--------|----------------------|----------------------|
| Phase 1 | 93 | 24-30 | 12-15 |
| Phase 2 | 98 | 25-30 | 13-15 |
| Phase 3 | 121 | 30-36 | 15-18 |
| **Total** | **312** | **79-96** | **40-48** |

### Points by Skill Profile

| Profile | Phase 1 | Phase 2 | Phase 3 | Total |
|---------|---------|---------|---------|-------|
| BIM/ML | 69 | 45 | 55 | 169 (54%) |
| Frontend | 10 | 16 | 26 | 52 (17%) |
| Backend | 10 | 11 | 18 | 39 (12%) |
| Infrastructure | 4 | 6 | 22 | 32 (10%) |
| R&D (cross-cutting) | — | 20 | 32 | 52 (17%) |
| **Total** | **93** | **98** | **121** | **312** |

### R&D Items (Approach Undefined)

These features require discovery spikes before accurate estimation:

| Feature | Phase | Why R&D |
|---------|-------|---------|
| RCP generation | 1/2 | No reference implementation in codebase. Ceiling grid algorithms are domain-specific. |
| MEP routing | 2/3 | Full building services engineering. May need external library (OpenStudio, EnergyPlus). |
| Egress pathfinding | 2 | Graph-based escape route analysis. Needs IBC/NBR rule engine. |
| Accessibility compliance | 2 | Wheelchair path simulation on floor plan graph. |
| Interactive BIM editing | 3 | Parametric constraint solver. Multi-year effort. |
| Real-time collaboration | 3 | CRDT/OT engine integration. Separate product category. |
| Beam/column sizing | 2 | Structural engineering domain. May use lookup tables instead of FEA. |
| Clear span rules | 2 | Material-specific span limits. Needs engineering reference data. |

### Team Composition (Recommended)

**Phase 1 (launch):**
- 2× BIM/ML engineers (floor plans, sections, annotations, sheeting)
- 1× Frontend engineer (CAD editor polish, sheet UI, dimension strings)
- 1× Backend engineer (budget wiring, persistence, API)
- Total: 4 FTE, 12-16 weeks

**Phase 2 (post-launch):**
- 2× BIM/ML engineers (structural, takeoff, compliance, materials)
- 1× Frontend engineer (i18n, RTL, schedule UI)
- 1× Backend engineer (permit sets, BOQ export)
- 1× Structural consultant (part-time, clear span rules)
- Total: 4.5 FTE, 16-20 weeks

**Phase 3 (scale):**
- 2× BIM/ML engineers (IFC export, Revit plugin research)
- 2× Frontend engineers (mobile, collaboration UI, API docs)
- 2× Backend engineers (team model, API, billing)
- 1× Infrastructure/DevOps (render farm, GPU workers)
- 1× Mobile engineer (React Native)
- Total: 8 FTE, 20-28 weeks

---

## What This Means for Investors

1. **Phase 1 is buildable with a small team.** The core geometry engine is done. The gap is annotation, sheeting, and orchestration — engineering work, not research. 4 people, 4 months.

2. **Phase 2 is where the moat deepens.** Structural analysis, quantity takeoff, and code compliance are features competitors charge $50K+/year for. The data corpus (real Portuguese rates + E&O regression) gives Terraza a head start no one else has.

3. **Phase 3 is platform economics.** BIM authoring, team collaboration, and the API turn Terraza from a tool into a platform. This is where valuation multiples expand.

4. **The BIM/ML skill profile is the bottleneck.** 54% of all story points require domain engineering. Hiring or contracting 2 strong BIM/ML engineers is the critical path.

5. **R&D items are real risks.** MEP, egress pathfinding, and interactive BIM editing are not engineering tasks — they are research projects. The plan accounts for this by phasing them out and recommending lookup-table shortcuts where possible.

---

## Appendix: Code Path Reference

| Feature | Existing Code | Gap |
|---------|---------------|-----|
| Auto-draw | `src/lib/cad/floorplan.ts`, `layout.ts`, `program.ts` | Annotation, sheeting, orchestration |
| Multi-level plans | `src/lib/cad/floorplan.ts` (single-level) | Level stacking, stair core |
| Elevations | `src/components/marketing/studio/studio-cad.ts:44` (3D→2D) | Standalone generator from plan |
| RCP | None | Full R&D |
| MEP | `src/lib/budget/regions/*.ts` (data only) | Full R&D |
| Structural | `src/lib/budget/global-calc.ts:94-96` (chapter %) | Engineering calculations |
| Takeoff | `src/lib/cad/geometry.ts` (bbox/area/length) | Plan→quantity mapping |
| BOQ export | `src/lib/budget/pdf.ts`, `excel.ts` | Takeoff integration |
| Compliance | `src/lib/budget/regions/types.ts:77-123` (data types) | Rule engine |
| Materials | `src/lib/client-pack/alcantara.ts` (hardcoded) | Dynamic generation |
| i18n | `src/lib/console-copy.ts` (strings centralized) | Framework + translations |
| Teams | None | Full build |
| Mobile | None | Full build |
| Render farm | FAL single-render (`src/app/api/studio/render/route.ts`) | Queue + workers |
| IFC export | `scripts/ifc-to-glb.py` (import only) | Reverse pipeline |
