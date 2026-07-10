ANALYST FLEET SNAPSHOT — 2026-07-09 18:31 DXB (14:31 UTC)
═══════════════════════════════════════════════════
Run ID: a3e06753-dcbf-4c1b-b252-87f549c0e387
Paperclip: HEALTH-ONLY (200 health, 401 on all authenticated endpoints)

GATEWAYS
  default    UP   pid 197  uptime 21m  (s6)
  jericho    UP   pid 167  uptime 21m  (s6)
  juridico   DOWN (not started yet) — s6-log alive, no gateway process
  analyst    s6-log only (consolidated fleet — no dedicated gateway)
  researcher s6-log only (consolidated fleet — no dedicated gateway)
  iris       s6-log only (consolidated fleet — no dedicated gateway)
  donald     s6-log only (consolidated fleet — no dedicated gateway)
  intelligence s6-log only (consolidated fleet — no dedicated gateway)

DISK: 92% (6.2G free on 77G overlay) — elevated, unchanged from earlier
MEMORY: 7.8G total, 3.8G used, 4.0G available — healthy

JERICHO MEMORY: 15,576/32,000 (48.7%) — healthy
  1 overflow event at 14:16 UTC (transient spike, batch would hit 32,729)
  No compaction needed (<70% threshold)

ERRORS (last 30 min):
  CRITICAL: OpenRouter HTTP 401 on z-ai/glm-5.2 — 7 failures in 15 min
    Model: z-ai/glm-5.2 via openrouter (PA lane default in enforce-fleet-routing.py L31)
    Fallback chain: deepseek-v4-pro → deepseek-v4-flash should catch these
    Root cause: either API key expired or model removed from OpenRouter

STALE OUTBOX:
  Bridge: 7 files (oldest: DEV-JERICHO-GROUPCHAT-POSTMORTEM.md ~11 days)
  Jericho: 10 files (oldest: DEV-relay-iris-image-editing ~7 days)

PAPERCLIP ISSUES: Unreachable (401 on /api/companies/{id}/issues)
  Cannot determine assigned issues or queue depth

RECOMMENDATIONS:
  1. z-ai/glm-5.2 model dead on OpenRouter — swap PA lane to tencent/hy3-preview or remove
     the z-ai/glm-5.2 leg entirely. Fallback chain is masking the failures but adding latency.
  2. Juridico gateway down (not started yet) — either fix s6 service or remove the profile.
  3. Disk at 92% — monitor, flag if hits 95%.
  4. Stale outbox files >7 days — auto-purge or archive.
