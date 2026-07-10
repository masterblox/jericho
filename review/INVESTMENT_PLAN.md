# Terraza — Investment Plan

**Date:** July 2026
**Live at:** terraza.tech
**Target:** Architecture studios in Portugal, expanding to 5 global markets

---

## What Terraza Is

Terraza is a production AI platform that lets architects describe a building in plain language and receive floor plans, building sections, and a costed construction budget — without touching CAD software, spreadsheets, or configuration screens.

The first viewport makes the job obvious: choose `floorplan`, `sections`, or `budget`, answer a few plain questions, then get usable output. The interface is a drafting instrument, not a developer terminal.

---

## Tier 1 — Live and Shipping

These features are deployed, tested, and accessible on terraza.tech.

### Budget Engine (flagship)

The budget engine is Terraza's primary differentiator and the product investors should focus on.

**What it does:** An architect describes a building (type, location, area, rooms, quality tier) and receives a full construction budget — chapter-by-chapter breakdown with real unit rates, legal/tax/regulatory compliance, and value engineering options.

**Core components:**

| Component | Status | Detail |
|-----------|--------|--------|
| 5 regional frameworks | Live | Lisbon, Dubai, Mumbai, London, NYC — each with currency, tax brackets, permit fees, compliance costs, regulatory constraints (FSI, seismic zones, heritage), and risk vectors |
| Conversational Q&A | Live | Multi-turn dialogue extracts BuildingSpec from natural language. MiMo 2.5 LLM function calling with regex+keyword fallback. Confidence scoring. |
| E&O regression model | Live | Per-chapter escalation factors derived from real Portuguese tender addenda (7 Moinhos corpus). Global escalation: 4.83%. Ch.12 (MEP) +39%, Ch.4 (envelope) +15%. |
| 7 building types × 4 quality tiers | Live | Villa, apartment, townhouse, house, studio, commercial, warehouse, hospitality — each calibrated per region |
| Value engineering | Live | Material substitution engine with savings calculation. Premium → standard swaps with cost delta. |
| Export pipeline | Live | PDF (pdfkit), Excel (ExcelJS), municipal dossier with concept renders |
| Browser-native voice input | Live | Web Speech API (Chrome/Edge/Safari 14.5+), auto-submits on recognition end, graceful fallback |
| Standalone `/budget` route | Live | Self-contained budget calculator with region selector, real-time totals, scenario mode |
| Mobile `/pocket` route | Live | Chat-style conversational budget for on-site use. Free-text → parse → budget. |

**Portuguese corpus (7 Moinhos):**

| Asset | Source | Content |
|-------|--------|---------|
| 2 DWG files | Afonso Matos Ferreira (Bigmouse), 2020-2021 | Architectural drawings, Campolide, Lisbon |
| 3 XLSM files | Same source | Original tender + E&O addenda. EUR 1.14M project. 20 chapters. Full WBS. |
| Ajuda renovation corpus | Library renovation project | 868 lines of unit rates (EUR), 525 sqm interior, full M&E breakdown |

This is real data from real Portuguese architects, not synthetic training sets.

**Mumbai (just landed):**

| Regulation | Detail |
|------------|--------|
| CPWD DSR 2025 | Central Public Works Department daily rates |
| RICS India | Royal Institution of Chartered Surveyors India standards |
| Maharashtra RERA | Real Estate Regulatory Authority compliance |
| BMC fees | Brihanmumbai Municipal Corporation permit structure |
| FSI/TDR | Floor Space Index / Transferable Development Rights |
| SEZ/affordable housing | Tax exemptions and incentives |
| Monsoon risk | Seasonal risk vectors for construction scheduling |

### Architecture Studio

| Feature | Status | Detail |
|---------|--------|--------|
| 2D CAD editor | Live | AutoCAD-style Konva canvas. Line/polyline/rect/circle/dimension/text tools. Pan/zoom, grid snap, osnap, ortho. Command-line aliases (L, PL, REC, C, D, T, S, ZE). Touch support. |
| Floor plan generation | Live | Multi-path: LLM designs program → deterministic squarified treemap packs rooms → walls/doors/windows/furniture rendered. Three fallback levels: LLM → heuristic → canonical template. |
| Section generation | Live | Building sections with poche walls, floor slabs, dimension strings, level labels, gable roof. Varies with levels (1-6) and ceiling height. |
| DXF/SVG export | Live | Layered export with walls, openings, rooms, fixtures, dimensions. Shareable URL tokens. |
| 3D orbital viewer | Live | Three.js / React Three Fiber. Villa Savoye GLB model. OrbitControls, auto-rotate, plan/section/elevation clipping. Build animation (clipping plane sweep). Sun rig for solar studies. |
| FAL render pipeline | Live | Viewport capture → Flux Dev image-to-image (strength 0.35, 40 steps). Anti-AI-slop prompt tokens. Rate-limited 3/10min. CSP-compliant (data: URLs). |
| Client pack export | Live | Municipal dossier: compliance items, drawing register, budget rollup, material schedule, concept renders. Alcantara project (Lisbon) as reference. |

### CI/CD & Infrastructure

| Component | Status |
|-----------|--------|
| GitHub Actions CI | Live — build + lint + Supabase pgTAP tests on self-hosted runners |
| Vercel deploy | Live — push to main triggers production deploy |
| Supabase migrations | Live — schema pushed on migration file changes |
| Auth | Live — email OTP via Supabase Auth |
| Storage | Live — private `deliverables` bucket, RLS-scoped, 50MB limit |

---

## Tier 2 — Wired but Needs Polish

These features exist in code, are functional, but need refinement before investor demo or production hardening.

### Budget Engine Gaps

| Feature | Status | What's Needed |
|---------|--------|---------------|
| XGBoost unit price predictor | Wired | Trained on ~100 line items from 2 sources. Needs larger corpus for production accuracy. Currently serves as validation layer, not primary pricing. |
| XLSM budget parser | Wired | Parses existing budget files. Needs error handling for edge cases and malformed inputs. |
| Currency exchange API | Wired | `/api/fx` route exists. Needs caching, fallback rates, and refresh strategy for production use. |
| Dubai/London/NYC calibration | Wired | Region configs exist with sourced rates (RS Means, BCIS, RICS). Only Lisbon is calibrated against real corpus data. Others need field validation. |

### Architecture Studio Gaps

| Feature | Status | What's Needed |
|---------|--------|---------------|
| LLM-assisted plan design | Wired | MiMo 2.5 function calling designs room programs. Needs prompt tuning for edge cases (unusual building types, very small/large areas). |
| Floor plan heuristic | Wired | Deterministic room derivation + squarified treemap packing. Works for standard layouts. Complex shapes (L, U, courtyard) not yet supported. |
| 3D model pipeline | Wired | ifcopenshell → GLB conversion script exists. Needs CI automation and support for more IFC schemas beyond Villa Savoye. |
| Studio render | Wired | FAL Flux Dev image-to-image. Works but rate-limited. Needs queuing, cost monitoring, and alternative model fallbacks. |

### Data & ML Stack

| Feature | Status | What's Needed |
|---------|--------|---------------|
| ifcopenshell integration | Wired | Parses IFC4, tessellates geometry, exports GLB. Production-hardening: error handling, IFC schema validation, mesh optimization. |
| Training data pipeline | Wired | XGBoost training script (`train-budget.py`) with 5-fold CV. Needs automated retraining as corpus grows. |

---

## Tier 3 — Roadmap

Features identified in architecture or early development. Not yet in production.

### Budget Engine

| Feature | Timeline | Detail |
|---------|----------|--------|
| Expanded corpus | Q3 2026 | 425 DWG + 3 RVT from Portuguese architects (referenced in product spec, data in train branch only) |
| Real-time rate feeds | Q3 2026 | Live construction cost indices per region (RS Means, BCIS, CPWD DSR updates) |
| Bid comparison | Q4 2026 | Compare contractor bids against Terraza estimates with variance analysis |
| Insurance/cost bonding | Q4 2026 | Risk-adjusted budgets for lender submissions |

### Architecture Studio

| Feature | Timeline | Detail |
|---------|----------|--------|
| Multi-floor plans | Q3 2026 | Ground + upper floor generation with stair core consistency |
| Facade generation | Q3 2026 | Elevation views from plan geometry with material specifications |
| Parametric variation | Q4 2026 | Generate N plan options from same brief, rank by efficiency metrics |
| Revit/IFC export | Q4 2026 | BIM-native output for firms using Autodesk workflows |

### Engineering Engine

| Feature | Timeline | Detail |
|---------|----------|--------|
| Clear span calculations | Q3 2026 | Structural span rules per building type and material |
| MEP rough sizing | Q4 2026 | HVAC/ plumbing/ electrical rough estimates from area and occupancy |
| Code compliance check | Q4 2026 | Automated verification against regional building codes (egress, accessibility, fire) |

### Platform

| Feature | Timeline | Detail |
|---------|----------|--------|
| Team workspaces | Q3 2026 | Multi-user studios with role-based access |
| Client portal | Q3 2026 | Share budgets/plans with clients via branded links |
| Mobile app | Q4 2026 | Native iOS/Android for on-site budget review |
| API for third parties | Q4 2026 | Public API for BIM plugins and integrations |

---

## The Data Moat

Terraza's competitive advantage is not the AI — it's the data underneath it.

**What we have:**

| Asset | Count | Source |
|-------|-------|--------|
| Real Portuguese DWGs | 2 | 7 Moinhos building (Campolide, Lisbon), 2020-2021 |
| Budget XLSMs with E&O addenda | 3 | Same project. Original tender + corrections + omissions. EUR 1.14M. |
| Ajuda renovation unit rates | 868 lines | Library renovation, full WBS with min/max columns |
| Villa Savoye IFC reference | 1 | Open-source BIM model, tessellated to GLB |
| PDFs/drawings | 5 | Alcantara project (Lisbon municipal dossier) |

**What we're building toward:**

- 425 DWG + 3 RVT from Portuguese architecture firms (in train branch)
- Automated corpus ingestion pipeline (DWG → parsed entities → training features)
- XGBoost models trained on growing line-item datasets per region
- IfcOpenShell-based BIM validation against regional codes

**Why this matters:**

Synthetic training data produces synthetic budgets. Real Portuguese architects producing real construction documents produce real unit rates, real escalation patterns, and real legal/tax compliance requirements. This corpus is not scrapable — it comes from professional relationships and cannot be replicated by competitors using public data.

---

## Revenue Path

### Phase 1: Portugal (Now)

- Target: Small-to-medium architecture studios in Lisbon, Porto, Algarve
- Product: Budget engine + floor plan generation
- Price: Per-project or subscription (TBD)
- Evidence: Alcantara municipal dossier assembled end-to-end by the platform

### Phase 2: Global Markets (Q4 2026)

- Mumbai, Dubai, London, NYC region frameworks already wired
- Localize: language, currency, legal compliance
- Partner with local architectural associations for corpus development

### Phase 3: Platform (2027)

- API for BIM plugins (Revit, ArchiCAD, SketchUp)
- Client portal for architect-client collaboration
- Insurance/bonding integration for lender submissions
- Mobile-first field budgets

---

## Technical Architecture

```
Next.js 15 (App Router)
├── Marketing site
├── /console — Main workspace (ArchitectConsole)
├── /budget — Standalone budget calculator
├── /pocket — Mobile conversational budget
├── /view — Public drawing viewer
├── /api/budget/* — Budget Q&A, export, prompt
├── /api/cad — Floor plan / sections generation
├── /api/studio/render — FAL image-to-image
├── /api/client-pack/export — Municipal dossier
│
├── Supabase (Auth + Postgres + Storage)
│   ├── RLS-scoped project/deliverable tables
│   ├── pgTAP test suite (14 tests)
│   └── Auto-migration on push
│
├── LLM Layer
│   ├── MiMo 2.5 Pro (primary, function calling)
│   ├── DeepSeek (fallback)
│   └── OpenAI (emergency fallback)
│
├── CAD Engine
│   ├── Squarified treemap room packer
│   ├── BFS adjacency repair
│   ├── Wall/door/window primitives
│   └── DXF/SVG/JSON export
│
├── 3D Studio
│   ├── Three.js / React Three Fiber
│   ├── Villa Savoye GLB (ifcopenshell → trimesh)
│   ├── Orbital + orthographic camera
│   └── FAL Flux Dev render pipeline
│
└── Budget Engine
    ├── 5 regions (Lisbon, Dubai, Mumbai, London, NYC)
    ├── E&O regression (XGBoost)
    ├── Conversational Q&A (MiMo function calling)
    └── PDF/Excel/municipal dossier export
```

---

## Key Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| LLM dependency for plan design | Deterministic fallback at every level. LLM enhances but geometry engine is independent. |
| External API costs (FAL.ai) | Rate limiting (3/10min), caching (LRU 256 entries), model tiering (Schnell for concepts, Dev for final renders) |
| Training data scarcity | Active corpus development with Portuguese firms. Heuristic paths work without ML. |
| Regional calibration gaps | Lisbon fully calibrated. Others use sourced industry rates (RS Means, BCIS) — field validation is the next step, not a blocker. |
| Supabase vendor lock-in | Standard Postgres. pgTAP tests are portable. Auth can be swapped. |

---

## Summary

| Dimension | Status |
|-----------|--------|
| Product | Production-grade. Floor plans, sections, budgets generating real deliverables for real projects (Alcantara, Lisbon). |
| Data | Real Portuguese corpus (2 DWG, 3 XLSM, 868 unit rates). Not synthetic. Not scrapable. |
| Architecture | Resilient. LLM enhances, deterministic engine delivers. Three fallback levels for every generation path. |
| Markets | 5 regions wired. Lisbon calibrated. Mumbai just landed. Dubai, London, NYC need field validation. |
| Revenue | Portugal-first. Global expansion via region frameworks. Platform play via API + client portal. |

Terraza is not an AI demo. It is a drafting instrument that happens to use AI where it matters and deterministic geometry where it must.
