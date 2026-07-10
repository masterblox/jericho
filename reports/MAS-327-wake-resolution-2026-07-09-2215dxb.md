# MAS-327 Wake Resolution — 2026-07-09 22:15 DXB

## Wake Type
`source_scoped_recovery_action` — misdelivered to Jericho (intended for DEV)

## Disposition: BLOCKED (unchanged)

Guard condition unchanged from prior two runs (fd3fceb9, 2c5b9ebe):
- 06 (planner-trust-fix) has NOT merged to architect-ai origin/main
- `buildRegionalExtras` still consumes `region.regionalExtras` at global-calc.ts:148,150
- 10 references across 8 files on main
- HEAD: 718fa57 (MAS-304 Mechanica footer logo)

## Verification (this wake, 22:15 DXB)

**Repo:** architect-ai (`/opt/data/repos/architect-ai`)
**Main HEAD:** 718fa57 — unchanged

| File | Line | Content |
|------|------|---------|
| global-calc.ts | 148 | `if (region.regionalExtras.length === 0) return null;` |
| global-calc.ts | 150 | `region.regionalExtras.map(...)` |
| types.ts | 8 | docstring ref |
| types.ts | 269 | field declaration |
| bangalore.ts | 278 | data block |
| dubai.ts | 225 | data block |
| lisbon.ts | 236 | data block |
| london.ts | 218 | data block |
| mumbai.ts | 344 | data block |
| nyc.ts | 238 | data block |

Zero MAS-318 or planner-trust-fix commits on main.

## Paperclip

Health: OK (State 1). Issues API: times out on GET/PATCH (30s). Health endpoint responds instantly. This is a degraded variant — authenticated endpoints hang while unauthenticated health works. Recovery closer cron (30min) is the delivery path.

## Artifacts

- Deferred close JSON: `/opt/data/jericho/outbox/paperclip-deferred-close-MAS-327.json` — updated with current run_id and corrected reason
- DEV handoff: `/opt/data/jericho/outbox/dev-mas-327-wake-handoff-2026-07-09.json` — still valid (prior run wrote it)
- Prior reports: `/opt/data/jericho/reports/MAS-327-wake-resolution-2026-07-09-*.md`

## Actions Taken

1. Verified blocker still active (10 references, global-calc.ts unchanged)
2. Updated deferred close JSON with current run_id and accurate Paperclip state
3. No rebuild required — guard condition unchanged

## Unblock Path

When 06 (planner-trust-fix) merges to architect-ai main:
1. grep -rn regionalExtras src should return zero matches in global-calc.ts
2. Then execute the removal: types.ts field + 6 region files + docstring rephrase
3. Verify: grep -rn regionalExtras src returns zero matches, tsc --noEmit passes
