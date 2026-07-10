# Analyst Fleet Health Snapshot — 2026-07-09T19:57 DXB

Wake: Analyst agent (23ce64e7) heartbeat. Paperclip zombie socket — 8+ hours.

## Paperclip: ZOMBIE SOCKET — P0 CRITICAL
Port 3100 state 0A (LISTEN), zero response. Process dead, orphaned socket. Health endpoint times out. 40 deferred Paperclip closes queued in outbox.

## Gateways: 8/8 SUPERVISED — STABLE
All 8 s6 services up (juridico, analyst, intelligence, jericho, researcher, donald, iris, default). Actual hermes processes: jericho (PID 162, 1h24m uptime, 380MB RSS, 12.6% CPU), default (PID 178, 1h24m uptime, 58MB RSS, 0.4% CPU). No SIGTERM in 5.5 hours (last at 14:32 DXB).

## Load: HIGH but STABLE
16.82/16.36/16.88 — above SIGTERM threshold but no kills. Slightly improved from 18.40 at 19:00 snapshot.

## Memory: 4.1Gi used (52%)
Down from 4.5Gi after LSP cleanup (tsserver, ts-ls, typingsInstaller killed, ~400MB freed).

## Swap: 98% — CRITICAL
2.0Gi/2.0Gi used, only 39Mi free. Up from 72.5% at 19:00 (+25.5pp in 56 min). Trending toward OOM.

## Disk: 89% (68G/77G)
Up 1% from 19:00. 8.9G free.

## Bridge: 185 outbox files, 54 stale (>24h)
40 deferred Paperclip closes blocked on zombie socket.

## Zombies: 0
Clean — no zombie processes.

## Jericho Memory: 45.6% (14,589/32,000 chars)
Under 70% compaction threshold. One stale overflow event at 14:16 (batch write).

## Agent Log: Clean
21 ERROR/SIGTERM events total, last SIGTERM at 14:32. No ERROR lines.

## Actions

P0: Host restart Paperclip (zombie socket, 8+ hours)
P1: Clear node_modules (~1.2GB) to free disk
P1: Process 40 deferred closes after Paperclip recovery
P2: Monitor swap — at 98%, OOM kill imminent
