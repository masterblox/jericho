# INTEL Scan — 2026-07-09 17:33 DXB (UTC+4)

## Paperclip Status: CRITICAL — ZOMBIE SOCKET

- Raw socket: connect OK, recv timeout → orphaned port 3100
- /proc/net/tcp confirms LISTEN (0A) with multiple stuck connections
- Container cannot recover: no Docker socket, no root, no fuser
- 64 deferred-close JSONs queued in /opt/data/jericho/outbox/
- Host-level Paperclip restart required

## Gateway Health

| Gateway | PID | Uptime | RAM | State |
|---------|-----|--------|-----|-------|
| jericho | 162 | 3h 00m | 399MB | stable |
| default | 55970 | 24m | 175MB | restarted after SIGTERM |
| researcher | — | — | — | down (not started) — expected |
| analyst | — | — | — | down (not started) — expected |
| iris | — | — | — | down (not started) — expected |
| donald | — | — | — | down (not started) — expected |
| intelligence | — | — | — | down (not started) — expected |
| juridico | — | — | — | down (not started) — expected |

Consolidated fleet model intact — only jericho + default running. No anomalies.

## Load & Memory: HIGH

- Load: 16.50 / 16.74 / 17.11 (2 CPUs → 8x overload)
- RAM: 4.2G / 7.8G used, 3.5G available
- Swap: 1.8G / 2.0G (90% utilized)
- 5 default-gateway SIGTERMs today caused by s6 under load:
  - 14:10 (load 24.79), 14:32 (18.59), 14:32 (double), 16:03 (17.41), 17:09 (15.13)
- 24 total SIGTERMs in agent.log

## Bridge: STALE

- Last conductor-bridge update: 09:45 DXB (7.5+ hours ago)
- Expected: Paperclip dead → null-null orphan cascade → no agent has work → bridge silent

## Disk

- 68G / 77G (89%) — approaching 90% threshold, 8.7G remaining

## Zombie Processes

- No LSP zombies (tsserver/typescript-language clean)
- figma-mcp running as default gateway child (90MB, 11min old) — under threshold
- goliath MCP running as default gateway child

## Deferred Close Backlog

- 64 paperclip-deferred-close-*.json files queued
- Recovery closer cannot process until Paperclip host restart

## Outbox Activity (today)

- 17:32 analyst-wake-resolution
- 17:32 MAS-511-wake7-resolution
- 17:32 researcher-wake
- 17:31 paperclip-deferred-close-MAS-313.json

## Recommended Actions

1. CRITICAL: Host-level Paperclip restart (zombie socket on :3100)
2. HIGH: Investigate load — 16+ on 2 CPUs is unsustainable; gateways keep getting SIGTERM'd
3. MEDIUM: Once Paperclip recovers, recovery-closer will process 64 deferred closes — expect load spike
4. MEDIUM: Disk at 89% — preemptively clean node_modules if it hits 90%

## Wake Metadata

- Agent: intelligence (f2216417)
- Trigger: heartbeat wake (empty identity block, no task content)
- Paperclip unreachable — delivered directly via wake transport
