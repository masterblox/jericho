# Analyst Fleet Health Snapshot

**Timestamp**: 2026-07-09 19:00 DXB (15:00 UTC)
**Previous snapshot**: 2026-07-09 14:45 DXB (delta: +4h15m)

## Paperclip: ZOMBIE SOCKET (CRITICAL — unchanged)

Port 3100 in LISTEN but zero response. Raw HTTP/1.0 probe also dead. Paperclip process crashed, left orphaned socket. Host-level restart required (container has no Docker socket, no root, no fuser). Same state for 8+ hours.

## Gateways: STABLE (improvement)

Default (pid 178) + Jericho (pid 162) both up 26 min via s6. Last SIGTERM 14:33 DXB. No new terminations. Both within consolidated fleet baseline.

Analyst gateway: running outside s6 (--replace, pid not in s6). Token-locked by default gateway. Harmless — cron jobs only.

## Load: HIGH but STABLE

18.40 / 19.37 / 19.79 on 2 CPUs. Above the 15-threshold where s6 SIGTERMs gateways, but no kill in 26 min. Was 17/18/19 four hours ago — slightly worse.

## Memory: IMPROVED

4.6Gi → 3.9Gi used after LSP zombie cleanup. Available: 3.1Gi → 3.9Gi. 4 LSP processes killed (tsserver x2 948MB, typescript-language-server 60MB, typingsInstaller 88MB). Total freed: ~700MB.

## Swap: ELEVATED

1.5G/2.0G = 72.5% (was 68%). Below 80% kill threshold but trending up. LSP cleanup helped — monitor.

## Disk: 88% — UNCHANGED

67G/77G. Cleanup candidates identified: memories-express-mvp-cp/node_modules (1013MB), jericho/lsp/node_modules (107MB), /opt/data/lsp/node_modules (105MB). Total recoverable: ~1.2GB (would move disk to ~86%).

## Bridge: STALE

Last handoff at 09:45 DXB — 9+ hours. Jericho outbox has 9 deferred Paperclip closes queued from 14:48-14:58. None can process without Paperclip.

## Agent Log Errors

- MoA 401 (Missing Authentication header) — MoA service not running, gateways falling back to direct provider calls. LOW impact.
- MCP figma keepalive failure — benign.

## Jericho Memory

1 stale overflow event in agent.log. Current usage likely healthy (was 48% at 14:45). No compaction needed.

## Recommended Actions

1. P0: Host operator must restart Paperclip. Port zombie since ~10:38 DXB.
2. P1: Clear node_modules to free ~1.2GB disk before hitting 90% threshold.
3. P2: After Paperclip recovers, process 9 deferred closes in jericho outbox.
4. Monitor: Load at 18+ with swap rising. If load exceeds 22 or swap exceeds 80%, expect another SIGTERM cascade.
