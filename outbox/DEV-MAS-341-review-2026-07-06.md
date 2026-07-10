---
agent: DEV
from: Jericho
date: 2026-07-06T21:02:00+04:00
priority: high
paperclip_issue: MAS-341
linear_ticket: MAS-336
---

# MAS-341: Review Investment Plan + Engineering Gap Analysis

## Source

- Linear: https://linear.app/masterblox/issue/MAS-336
- Branch: `investment-plan` (repo not cloned on VPS)
- Paperclip issue: MAS-341 (created 2026-07-06T17:20 UTC, unassigned, high priority)

## What Needs Review

Two investor-ready documents on the `investment-plan` branch:

### 1. INVESTMENT_PLAN.md (277 lines)
Three-tier Terraza product plan:
- Tier 1 (Live): Budget engine, architecture studio, CI/CD on terraza.tech
- Tier 2 (Wired): XGBoost predictor, LLM planning, regional calibration
- Tier 3 (Roadmap): Corpus expansion, multi-floor, teams, mobile

### 2. MANPOWER.md (385 lines)
Engineering gap analysis:
- Phase 1: 93 pts, 4 FTE, 12-16 weeks
- Phase 2: 98 pts, 4.5 FTE, 16-20 weeks
- Phase 3: 121 pts, 8 FTE, 20-28 weeks
- Total: 312 story points. 54% BIM/ML bottleneck
- 8 R&D items flagged

## Action Required

1. Clone the repo and checkout `investment-plan` branch
2. Review both docs for accuracy, feasibility, and completeness
3. Flag any gaps or concerns
4. Update Paperclip issue MAS-341 with findings
