# Fleet Intelligence Scan — 2026-07-10T14:39 UTC

**Paperclip issue:** 602f2c52-52ee-4a0e-8612-255208a9bd1d (created successfully)

---

## CRITICAL — Null-Null Orphan Cascade

**Evidence:** All 100 issues returned by Paperclip have `assignedAgentId: null` AND `projectId: null`. This is a fleet-wide Paperclip data integrity failure — NOT per-issue orphanage.

**Status distribution:**
| Status | Count |
|--------|-------|
| blocked | 72 |
| todo | 11 |
| in_progress | 9 |
| done | 8 |

**Impact:**
- Every fleet agent shows zero assigned issues
- Bridge drought (jericho-handoffs + jericho-replies empty for >6h) is a downstream effect
- Every PATCH returns 403 regardless of agent
- 72% of issues stuck in blocked

**Required:** Paperclip admin DB intervention. Cannot be resolved from inside Hermes container.

---

## HIGH — Cron Job Failures

| Job | Last Run | Error |
|-----|----------|-------|
| jericho-night-watch | Jul 10 11:04 UTC | Timeout after 120s |
| jericho-morning-briefing | Jul 8 05:00 UTC | HTTP 402 Insufficient Balance (3 days missed) |
| intelligence-signal-scan | Jul 10 01:00 UTC | Timeout after 3223s (stalled during init) |

---

## CLEAR — Gateway Health (Last 3h)

- Default gateway: 0 API interruptions, 1 restart (Jul 10 14:36 — scheduled)
- Jericho gateway: 0 API interruptions, 1 restart (Jul 10 14:36 — scheduled)
- Both gateways running: default (PID 199, 177MB), jericho (PID 157, 283MB)
- Consolidated fleet model intact — no Donald-up anomaly
- Load: 7.32, Swap: 7.2% — within norms

---

## MEDIUM — Bridge Drought

jericho-handoffs: 0 files, jericho-replies: 0 files. Latest outbox: Jul 10 03:58 UTC (~11h ago). Downstream of null-null cascade — agents have no assigned work.

---

## Fleet State Summary

| Metric | Value | Status |
|--------|-------|--------|
| Paperclip | Null-null cascade | CRITICAL |
| Default gateway | Running | OK |
| Jericho gateway | Running | OK |
| Issues assigned | 0/100 | CRITICAL |
| Issues blocked | 72/100 (72%) | HIGH |
| Bridge traffic | 0 in >6h | MEDIUM |
| Cron health | 3 jobs failing | HIGH |
| Load | 7.32 | OK |
| Swap | 7.2% | OK |
