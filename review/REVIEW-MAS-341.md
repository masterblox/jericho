# MAS-341 Review: Terraza Investment Plan + Engineering Gap Analysis

Date: 2026-07-07 | Reviewer: Jericho (Fleet Orchestration)

---

## Documents Reviewed

| File | Lines | Branch | Repo |
|------|-------|--------|------|
| INVESTMENT_PLAN.md | 277 | investment-plan | Mechanica-Labs/architect-ai |
| MANPOWER.md | 385 | investment-plan | Mechanica-Labs/architect-ai |

---

## Overall Assessment

Both documents are **investor-ready first drafts**. INVESTMENT_PLAN.md is a strong product narrative with real data backing. MANPOWER.md is the best engineering gap analysis I've seen from this team — honest about R&D risks, specific about code paths, and realistic about team composition.

**Grade: B+**. Solid foundation. Gaps are in the business layer, not the technical layer.

---

## INVESTMENT_PLAN.md — Strengths

1. **Data moat argument is the strongest section.** Real Portuguese DWGs/XLSMs with named sources (Afonso Matos Ferreira, 7 Moinhos, Ajuda). "Not synthetic. Not scrapable." — this is the line investors will remember.

2. **Tier structure is clear.** Live / Wired-but-needs-polish / Roadmap. Easy to scan. Tables are dense but readable.

3. **Budget engine detail is excellent.** 5 regions with specific regulatory frameworks (CPWD DSR 2025, Maharashtra RERA, monsoon risk). Mumbai section shows depth.

4. **Technical architecture section is clean.** Next.js 15 tree diagram, Supabase stack, LLM layer with fallbacks. Investor-technical enough without being overwhelming.

5. **Risk mitigations are specific.** Not hand-wavy. "Deterministic fallback at every level" / "Rate limiting 3/10min" / "Standard Postgres — portable."

---

## INVESTMENT_PLAN.md — Gaps

### Critical

| # | Gap | Why It Matters |
|---|-----|----------------|
| 1 | **No team section.** Who is building this? Carlos + DEV + who else? Investors bet on teams, not products. | Missing the "why this team" slide. |
| 2 | **No traction metrics.** Zero users, projects, or revenue numbers. "Alcantara project" is mentioned but no counts. | "Production-grade" without adoption data is a demo. |
| 3 | **No ask.** How much funding? What will it buy? What's the valuation context? | This is an investment plan with no investment specifics. |
| 4 | **No competition section.** Who else is doing AI architecture? Autodesk Forma? Finch3D? Archistar? | Investors will ask. Have the answer in the doc. |

### Secondary

| # | Gap | Why It Matters |
|---|-----|----------------|
| 5 | Revenue path says "TBD" for pricing. | Even a range helps. Portuguese studios pay EUR 50-200/mo for CAD tools. |
| 6 | No GTM detail beyond "Portugal first." | How do you reach Portuguese architects? Associations? Conferences? LinkedIn? |
| 7 | Tier 3 timelines are aggressive for Q3/Q4 2026. | 425 DWG, BIM export, mobile app, API — all in 6 months? MANPOWER says 40-48 weeks with 8 FTE. |
| 8 | "Mumbai just landed" — but no calibration data like Lisbon. | Don't overclaim. Say "wired" not "landed." |

---

## MANPOWER.md — Strengths

1. **Code-path appendix is gold.** Maps every feature gap to actual files in the repo. `console-copy.ts:134`, `layout.ts:310-320`, `regions/types.ts:77-123`. This is engineering rigor.

2. **R&D flagging is responsible.** 8 items marked as "approach undefined" with honest risk assessment. MEP, egress, interactive BIM — these are not engineering tasks and the doc says so.

3. **Story point methodology is explicit.** Fibonacci scale, skill profiles defined, partial credit accounted for. An investor who understands agile will appreciate this.

4. **Phasing is realistic.** Phase 1 (93 pts) is the minimum viable launch. Phase 2 (98 pts) deepens the moat. Phase 3 (121 pts) is the platform play. Clear progression.

5. **"What This Means for Investors" section is crisp.** Five bullets, no fluff. "Buildable with a small team" / "BIM/ML is the bottleneck" / "R&D items are real risks."

---

## MANPOWER.md — Gaps

### Critical

| # | Gap | Why It Matters |
|---|-----|----------------|
| 1 | **No cost estimates.** 4 FTE × 12-16 weeks = what burn rate? EUR 150K? EUR 400K? | Investors need to price the plan, not just read it. |
| 2 | **No team listed.** "2× BIM/ML engineers" — who are they? Are they hired? Identified? This is the critical path and it's unspecified. | 54% of all points depend on this hire. |
| 3 | **No dependency mapping.** Can Phase 1.1 (Auto-Draw) start while 1.2 (Plan-Set) is still WIP? Which features unblock others? | Parallelization strategy is implicit. |

### Secondary

| # | Gap | Why It Matters |
|---|-----|----------------|
| 4 | No mention of the Hermes/Mechanica fleet. DEV is building this on Conductor with Linear, Paperclip, and AI agent infrastructure. That's part of the engineering story. | Shows operational maturity. |
| 5 | Phase 1 timeline (12-16 weeks) doesn't match INVESTMENT_PLAN.md's "Portugal now" framing. | One doc implies live + shipping, the other says 4 months to launch-ready. |
| 6 | Corpus expansion (425 DWG) is in INVESTMENT_PLAN.md's Tier 3 but doesn't appear in MANPOWER.md phases. | Who does this work? What does it cost? |
| 7 | No testing/QA allocation in team composition. | Frontend + backend engineers also do QA? Budget 10-15% for testing. |

---

## Cross-Document Alignment

| Topic | INVESTMENT_PLAN.md | MANPOWER.md | Delta |
|-------|-------------------|-------------|-------|
| Timeline | Portugal now, global Q4 2026, platform 2027 | Phase 1: 12-16 weeks, Phase 2: 16-20, Phase 3: 20-28 | INVESTMENT_PLAN is more aggressive. MANPOWER is realistic. Pick one. |
| Team | Not mentioned | 4 FTE → 4.5 FTE → 8 FTE | MANPOWER is specific. INVESTMENT_PLAN should quote these numbers. |
| Corpus | 425 DWG + 3 RVT in Q3 2026 | Not in phases | Corpus work needs its own MANPOWER line item. |
| Budget engine | "Flagship" — detailed | Scattered across Phase 1 budget-hardening items | INVESTMENT_PLAN sells it better than MANPOWER builds it. |
| Infrastructure | Supabase, Vercel, GitHub Actions | INFRA profile gets 4 pts (Phase 1), 6 (Phase 2), 22 (Phase 3) | Phase 1 infra is under-resourced. Render farm and GPU workers in Phase 3 need early planning. |

---

## Recommendations

### Fix INVESTMENT_PLAN.md (before investor)

1. Add Team section — Carlos, DEV, fleet, key hires needed
2. Add Traction section — project count, user count, revenue (even if $0, say "$0, pre-revenue" honestly)
3. Add The Ask — amount, use of funds, runway extension
4. Add Competition matrix — Autodesk Forma, Finch3D, Archistar, Snaptrude, Hypar
5. Align timeline with MANPOWER.md — use MANPOWER's numbers as the source of truth
6. Remove "Mumbai just landed" → "Mumbai framework wired, calibration pending"

### Fix MANPOWER.md (before investor)

7. Add cost column — EUR per FTE per profile, total burn per phase
8. Add dependency graph — which features unblock others, what can parallelize
9. Add BIM/ML hiring plan — identified candidates, timelines, contingency if hire fails
10. Add corpus expansion as a Phase 1/2 task with story points
11. Add QA/testing allocation — 10-15% buffer per phase
12. Mention Mechanica fleet infrastructure — Conductor, Linear, Paperclip, AI agents

### Strategic Notes

13. The data moat is the strongest argument. Lead with it in the pitch deck, not buried mid-document.
14. BIM/ML bottleneck is honest but alarming. Have a backup plan (contracting firms, university partnerships, open-source contributors).
15. Phase 3 "real-time collaboration" is a multi-year product category. Don't promise it. Call it "async commenting + annotation" and defer CRDT.

---

## Verdict

The engineering plan is solid. The investment narrative needs the business layer (team, traction, ask, competition). MANPOWER.md is the stronger of the two documents — use it as the timeline authority and backfill INVESTMENT_PLAN.md with its numbers.

Priority order for Carlos:
1. Add team + ask to INVESTMENT_PLAN.md (30 min)
2. Align timelines between docs (15 min)
3. Add competition matrix (30 min)
4. Add cost estimates to MANPOWER.md (45 min)
5. Everything else is polish

Files saved to /opt/data/jericho/review/
- INVESTMENT_PLAN.md
- MANPOWER.md
- REVIEW-MAS-341.md (this review)
