# INTEL Scan — 2026-07-09 12:27 DXB (UTC+4)

Status: CRITICAL — 4 actionable items, Paperclip unreachable (Stage 3)

## Paperclip: Stage 3 Zombie Socket

- Port 3100 LISTEN (0C1C in /proc/net/tcp, st=0A), 5 established connections hanging
- Raw socket HTTP/1.0 GET /api/health → recv TIMEOUT (5s) on both localhost and Tailscale
- connect() succeeds but nothing responds — the Paperclip process is dead, kernel holds zombie socket
- Health endpoint returned 000 via curl (no auth), 000 via curl (with auth)
- BLOCKED: Cannot be recovered from inside container. Host operator must: kill zombie socket (fuser -k 3100/tcp), restart Paperclip server
- All fleet agents blocked on Paperclip operations (issue creation, status updates, comments)

## Load: 19.25 (CRITICAL)

- 1min: 19.25 / 5min: 18.30 / 15min: 17.83
- 19 runnable processes, 760 total threads
- gateway-default SIGTERM'd at 12:25:47 (load 18.81), back up at 12:26 (13s recovery)
- Cascade risk: sustained load >18 will trigger more s6 SIGTERMs
- Top consumers: jericho gateway (334MB, 8.6% CPU), default gateway (175MB, 11.3% CPU), figma-developer-mcp (108MB), npm exec (95MB)

## Disk: 94% (5.0GB / 77GB)

- Unchanged from prior scans
- Container cleanup marginal — host-level Docker layers are the bulk
- Write failures imminent below 95%

## Swap: 80% (1.6GB / 2.0GB used)

- SwapFree: 432MB
- MemAvailable: 4.0GB (deceptive — swap pressure tells real story)
- Gateways are competing for memory under high load

## Memory Overflow: Today

- 2026-07-09 11:47 DXB — write blocked at 32,281/32,000
- Current usage: 13,372/32,000 (41%) — transient spike, now resolved
- 8 overflow events total since Jul 6, most recent 40min ago
- Impact: fleet state writes may have been dropped during spike

## Fleet Architecture: Nominal

- gateway-jericho: up (s6, pid 166, 572s)
- gateway-default: up (s6, pid 2365, ~60s — just restarted after SIGTERM)
- All other gateways: down (not started yet) — correct for consolidated fleet
- No zombie LSP processes
- Bridge active: 138 files in engineer outbox, 70 in jericho outbox
- Researcher active (wakes at 11:54, 12:10, 12:15), Analyst snapshot at 11:49

## MoA: Down

- No process, connection refused on :8765
- Impact LOW — gateways fall back to direct provider calls

## Notable: Figma MCP Running

- figma-developer-mcp (108MB) + npm exec (95MB) active on default gateway
- Foxsy asset work in progress
- Minor but contributes to memory pressure

## Recommended Actions

1. HOST: Restart Paperclip (kill zombie socket, restart server) — blocks all fleet agents
2. HOST: docker system prune -a or droplet expansion — disk at 94%
3. Investigate load 19 root cause — is this compute-bound or IO-wait?
4. Compact Jericho memory — 41% now but spike-prone

Paperclip unavailable — delivered directly on wake transport.
