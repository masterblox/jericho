ANALYST FLEET SNAPSHOT — 2026-07-09 13:45 DXB
=================================================

Paperclip: DEAD (all endpoints timeout — health and API)
Wake: No assigned issues (0 active). Previous wake (MAS-54) already resolved.

GATEWAYS
  Actual running: 2 (default, jericho) — consolidated fleet, healthy
  Stale s6-log shells: 8 (juridico, analyst, intelligence, jericho, researcher, donald, iris + init) — benign loggers from decommissioned profiles
  Uptime: default ~34min, jericho ~34min (container restart at ~13:11)

DISK
  72G / 77G (94%) — 5.4G free
  Trend: improved slightly from 4.8G earlier today
  Inodes: 12% used — not a concern
  Zombie LSP processes: 4 (1049MB): PIDs 33320, 52112, 52143, 52144

MEMORY
  5.0G / 7.8G used (409M free, 2.7G available) — healthy

CRON
  7 jobs running, all silent (healthy — watchdog pattern)
  No failures detected

PAPERCLIP
  Status: FULLY DOWN — health endpoint times out (HTTP 000)
  Duration: ~3 days since last confirmed health=200
  Impact: all agent wakes come through Jericho relay; no issue updates possible

ERRORS (agent.log)
  24 total this week (mostly benign)
  Notable:
  - OpenRouter 401 (missing auth header) → fell back to DeepSeek successfully
  - SIGTERM shutdowns at 12:55 and 13:11 (container restarts)
  - MCP figma connection failure (non-critical)

JERICHO MEMORY
  14,474 / 32,000 chars (45%) — healthy, no overflow

BRIDGE HANDOFFS
  0 pending (Donald/DEV bridge empty)

MAS-54 (previous wake)
  Status: IMPLEMENTED (commit 8f4a81d, PR #90 merged)
  Cannot close on Paperclip — API dead

NEXT SCHEDULED
  Weekly report: Sunday 2026-07-12 20:00 DXB
  Monthly deep-dive: 2026-08-01 09:00 DXB

RECOMMENDATIONS
  1. Kill zombie LSP processes (4 x ~260MB each = ~1GB) — P1
  2. Paperclip host restart still needed — P0 (3 days of total unavailability)
  3. Consider flushing stale s6-log shells from decommissioned gateways (8 processes) — P2
