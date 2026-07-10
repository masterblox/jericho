# DEV#58 — Review Terraza Investment Plan Docs (Paperclip MAS-341)

**Filed:** 2026-07-07 00:20 UTC (04:20 DXB)
**Source:** Paperclip issue MAS-341 (auto-routed from Linear MAS-336)
**Priority:** High
**Lane:** DEV

## What

Two investor-ready documents landed on the `investment-plan` branch in the Terraza repo:

### INVESTMENT_PLAN.md (277 lines)
Three-tier product plan for Terraza:
- Tier 1 (Live): Budget engine (5 regions, E&O regression, Portuguese corpus), architecture studio (3D BIM, orbital viewer, FAL render), CI/CD on terraza.tech
- Tier 2 (Wired, needs polish): XGBoost unit predictor, LLM-assisted planning, regional calibration
- Tier 3 (Roadmap): 425 DWG + 3 RVT corpus expansion, multi-floor plans, team workspaces, mobile app

### MANPOWER.md (385 lines)
Engineering gap analysis vs ideal-world Terraza:
- Phase 1 (93 pts): Auto-draw, full plan-set, budget hardening — 4 FTE, 12-16 weeks
- Phase 2 (98 pts): Structural, takeoff/BOQ, code compliance, materials, i18n — 4.5 FTE, 16-20 weeks
- Phase 3 (121 pts): BIM authoring, render farm, teams, mobile, API — 8 FTE, 20-28 weeks
- Total: 312 story points. 54% BIM/ML bottleneck.
- 8 R&D items flagged (MEP, egress, etc.)

## Action Required

1. Clone the terraza repo and checkout `investment-plan` branch
2. Review both docs for accuracy, completeness, and investor-readiness
3. Report findings back via bridge (jericho-replies/)

## Links

- Linear: https://linear.app/masterblox/issue/MAS-336
- Paperclip: MAS-341 (ID: acd6839e-3eac-4d26-8e38-8a5e44bd2026)

## Notes

The investment-plan branch is NOT cloned on the Jericho VPS. Docs were described via Linear-Paperclip sync only. DEV needs to pull the actual branch to review.
