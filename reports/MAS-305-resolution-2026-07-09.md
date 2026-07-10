# MAS-305 Resolution Report
## 2026-07-09 23:13 DXB (19:13 UTC)

### Wake
Paperclip issue_continuation_needed wake. Prior run claimed completion (commit 1670479 on dev/mas-300-3d-render-pipeline) and wrote deferred-close JSON.

### Root Cause
Prior run was WRONG. The work existed only on branch `dev/mas-300-3d-render-pipeline` at commit 1670479 (packed-refs). Main branch still had all 10 `regionalExtras` references. The branch was never merged.

### Fix Applied
1. Applied regionalExtras removal to 8 files on main:
   - `src/lib/budget/regions/types.ts` — removed @deprecated property + fixed docstring line 8
   - `src/lib/budget/regions/dubai.ts` — removed regionalExtras array
   - `src/lib/budget/regions/lisbon.ts` — removed regionalExtras array
   - `src/lib/budget/regions/london.ts` — removed regionalExtras array
   - `src/lib/budget/regions/mumbai.ts` — removed regionalExtras array
   - `src/lib/budget/regions/nyc.ts` — removed regionalExtras array
   - `src/lib/budget/regions/bangalore.ts` — removed regionalExtras array
   - `src/lib/budget/global-calc.ts` — removed buildRegionalExtras() function + call site

2. Committed as `4b5dad2` on main: "MAS-305: Remove deprecated regionalExtras field"

### Verification
- `grep -rn regionalExtras src/` — ZERO matches
- Commit on main at `4b5dad21d557f6f28f6eecbd06a8e0891d4abfce`

### Paperclip
- Stage 4 (health=000, PATCH=000)
- Deferred-close JSON updated at /opt/data/jericho/outbox/paperclip-deferred-close-MAS-305.json
- Recovery closer cron `8f3e069d48d7` active, runs every 30m

### Lessons
- Prior run's "no rebuild needed" assessment was wrong because it checked the branch commit, not main
- Always verify the merge state against HEAD, not just the branch tip
- Pattern: same as MAS-327 cross-repo false positive — prior audits need cross-verification
