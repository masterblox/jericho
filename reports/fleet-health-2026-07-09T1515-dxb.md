# Fleet Health Scan — 2026-07-09 15:15 DXB (UTC+4)

## Paperclip: CRITICAL — Stage 3 Zombie Socket

- Port 3100: LISTEN (0A) in /proc/net/tcp
- Raw HTTP/1.0 socket: connect succeeds, recv times out → zombie socket confirmed
- All curl endpoints return HTTP 000 (health no-auth, health with auth, issue list)
- **Recovery impossible from inside container.** Host must kill zombie socket + restart Paperclip server.
- Paperclip-recovery-closer cron (8f3e069d48d7): running every 30m but check_auth_working() returns False — stays silent (correct)

## System Load: CRITICAL — 19.67 on 2 CPUs

- 1min: 19.67, 5min: 19.99, 15min: 19.76 — 10x CPU capacity
- 23 SIGTERMs logged in agent.log, last batch at 14:32 (loadavg_1m=18.59)
- Root cause: cascading — high load triggers s6 SIGTERMs, gateways restart, load spikes again
- Current gateways stable for ~40 min since 14:33 restart

## Gateway State: OK

- gateway-default: up (pid 178, 61MB) — s6 managed with --replace
- gateway-jericho: up (pid 162, 403MB) — s6 managed with --replace  
- All others: down (not started yet) — correct for consolidated-fleet model
- No Donald unexpectedly-up anomaly

## Memory: Resolved from HIGH

- Fixed during scan: killed tsserver (930MB) + typescript-language-server (146MB) + typingsInstaller (88MB)
- Before: 4.9G used / 403M free
- After: 3.7G used / 1.2G free — 1.1GB freed
- Swap: 1.6G/2.0G (80%) — persistent, will drain over time
- 2 LSP processes remain (this session's own typescript-language-server)

## Memory Overflow: Historical (not current)

- 1 event at 14:16: "memory would be at 32,729/32,000" — batch write transient spike
- Current usage: ~50% — not a crisis

## Disk: 88% — Watch

- 68G/77G, 9.5G free — below 90% threshold but approaching

## Cron Jobs: Mixed

- Running OK: bridge-poller (3m), linear-consume (30m), night-watch (6h), researcher-daily-scan (3h), paperclip-recovery-closer (30m)
- Paused (from Jul 8 outage): intelligence-signal-scan, morning-briefing, voice-ingest
- Nightly-synthesis: last ran Jul 8, next at 18:30 DXB today

## Bridge Outbox: Active

- 4 recent handoffs: MAS-512, MAS-337, mas-325, MAS-66 — agents are working despite Paperclip outage

## Actions Taken

1. Killed LSP zombies — freed 1.1GB RAM
2. Paperclip Stage 3 confirmed — container-locked, needs host intervention

## Actions Needed

1. **Host-level**: Kill zombie port 3100 socket + restart Paperclip server (CRITICAL)
2. **After Paperclip recovery**: Unpause intelligence-signal-scan (889e60424327) and morning-briefing (907f22a9dd8b) — both paused since Jul 8
3. **Watch**: Disk at 88% — if it crosses 90%, run node_modules cleanup before host-level docker prune
4. **Watch**: Load at 19.67 — gateways may SIGTERM again if Paperclip recovery triggers wake flood
