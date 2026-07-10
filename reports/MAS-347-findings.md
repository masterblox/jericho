# MAS-347 — INTEL-002 Findings Report
**Date:** 2026-07-07 18:25 UTC+4 (Dubai)
**Run:** d35d84e6-4548-4920-a473-1f5718367ff2
**Status:** Actionable — 2 of 3 signals resolved, 1 needs Paperclip admin

---

## Signal 1: DEV Issue Blockade — CONFIRMED, NOT FLEET-CRITICAL

| Metric | Value |
|---|---|
| DEV Paperclip issues | 102 (up from 98 at scan time) |
| Status | ALL blocked |
| Fleet DEV# tickets impacted | 0 |
| Issue types | 102 MAS- Linear product tickets (Terraza/Forma) |

**Root cause:** DEV's Paperclip adapter is `external_api` with error `"Process adapter missing command"`. The adapter points to `http://172.19.0.1:8642` which can't reach DEV's gateway process. DEV is running fine on the default gateway (PID 169, Telegram connected) — this is purely a Paperclip adapter configuration issue.

**Fix:** Switch DEV's Paperclip adapter from `external_api` to `hermes_gateway` (same as Jericho, Researcher, Analyst, Intelligence). This requires Paperclip admin — either Carlos via Paperclip UI or a direct API call with admin credentials.

**Impact:** These are Linear product pipeline tickets. They were mirrored into Paperclip but none can be processed because the adapter is broken. DEV works fine via Telegram for actual fleet tasks — these 102 blocked issues don't block fleet operations.

---

## Signal 2: Researcher Crash-Loop — RESOLVED

| Metric | Value |
|---|---|
| Config telegram_platform refs | 0 |
| Down file | Present |
| S6 service | down (signal SIGTERM) |
| Gateway restarts today | 0 |

**Resolution:** The telegram_platform was removed from Researcher's config.yaml and a down file was placed. The s6 service is stopped. Researcher runs as a Paperclip-native agent (hermes_gateway adapter) — no Telegram gateway needed. The earlier crash-loop was caused by having telegram_platform in config without a bot token.

---

## Signal 3: DNS Failures — LOW PRIORITY, CONTAINED

| Metric | Value |
|---|---|
| Total DNS errors | 8 |
| Source session | DEV (20260707_175442_6282ce) |
| Error type | ERR_NAME_NOT_RESOLVED |
| Fleet-wide | No |

All 8 DNS failures are from DEV's browser session (browser_navigate to tribunais.org.pt and similar). Not fleet-wide. Not recurring after the session.

---

## Bonus Fixes Applied During Investigation

| Action | Result |
|---|---|
| npm cache clean (_cacache) | Saved 122M (264M → 142M) |
| Analyst stale s6 service | Down file added, service stopped |
| Intelligence service dir | Confirmed absent (correct) |

Analyst's s6 service was dead for 5.6h (exitcode 0) — it's Paperclip-native and shouldn't have a gateway service at all. Down file prevents auto-restart on container boot.

---

## Fleet Health Summary

| Layer | Status |
|---|---|
| Jericho gateway | Running, PID 147, 5h37m uptime |
| Default gateway | Running, PID 169 |
| Researcher | Resolved — Paperclip-native, no crash-loop |
| Analyst | Stable — Paperclip-native, s6 service killed |
| Intelligence | Clean — no gateway service |
| Cron jobs | jobs.json present on disk |
| Disk | 90% overlay (Docker layers, not app data) |
| Bridge | 2 stale handoffs in archive |
| Inbox | 4 files, clean |

---

## Action Items

1. **Carlos/Paperclip Admin:** Switch DEV from `external_api` to `hermes_gateway` adapter — clears 102 blocked product tickets
2. **Jericho:** Push fixed Analyst + Researcher configs to fleet repo for restart survival
3. **Monitor:** DEV adapter fix will auto-unblock all 102 MAS- tickets
