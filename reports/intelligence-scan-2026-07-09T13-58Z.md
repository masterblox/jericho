# INTEL Scan — 2026-07-09 13:58Z (17:58 DXB)

Paperclip unavailable — delivered directly (auth-middleware deadlock, Stage 2)

## Fleet Health Summary

| Signal | Level | Detail |
|--------|-------|--------|
| Paperclip | CRITICAL | Stage 2 auth deadlock — health=200, all auth endpoints timeout |
| System Load | CRITICAL | 18.25 load on 2 CPUs (9x core count) |
| Swap Pressure | CRITICAL | 90% utilized (1.8G/2.0G), only 249MB free |
| Disk | HIGH | 93% (5.7G free of 77G overlay) — host-level Docker layers |
| SIGTERM Cascade | HIGH | 12 events in agent.log, latest at 13:11 with load 24.31 |
| Gateways | OK | Consolidated model intact: Jericho + Default running, all others down |
| Bridge Activity | OK | Active today: TICKETS.md, PA21 outbox, MAS-227, mas-319 |
| Memory Overflow | OK | No events in agent.log |
| Vault Activity | LOW | 4 .md files modified in last 24h |

## Actions Taken This Scan

1. Killed 4 LSP zombie processes (2x tsserver, typescript-language-server, typingsInstaller) — freed ~600MB RAM
2. Removed node_modules from architect-ai (233MB) and memories-express-mvp-cp (1004MB) — rebuildable via pnpm install
3. Cleaned npm cache (109MB)
4. Disk: 94% → 93% (marginal — host-level Docker layers are the real consumer)

## Detailed Findings

### Paperclip: Stage 2 Auth-Middleware Deadlock
- `curl localhost:3100/api/health` → 200 (no auth)
- `curl localhost:3100/api/health` with Bearer token → timeout (rc=28)
- Raw socket HTTP/1.0 to `/api/health` → 200 OK
- Raw socket HTTP/1.0 to `/api/agents/{id}` with auth → timeout
- Port 3100 LISTEN with ~30 active connections — server process alive but auth handler frozen
- Same state as 13:30Z wake payload (degraded-auth-deadlock) — no recovery in 28 minutes
- BLOCKED: Cannot file Paperclip issues, add comments, or query assigned issues
- Recovery requires host-level Paperclip server restart

### System Load (CRITICAL)
- Current: 18.25 on 2 CPUs
- Peak at 13:11 boot: 24.31 (triggered s6 SIGTERM cascade)
- Root cause: Paperclip recovery flood + LSP processes + gateway memory pressure
- Load is trending down (20.75 → 18.25 after LSP kill) but still severe

### Swap Pressure (CRITICAL)
- 90% utilized, only 249MB remaining
- Gateways at risk of OOM kills if load spikes again
- LSP kill freed 600MB but swap not reduced — pages are resident
- Next load spike will exhaust swap and trigger OOM killer

### Disk (HIGH — host-level blocker)
- 93% after container cleanup (freed ~300MB net)
- Container-level cleanup exhausted — node_modules, npm cache removed
- 50GB+ gap between df (71GB used) and du (~20GB used) = host-level Docker overlay layers
- BLOCKED: Requires host-level `docker system prune -a` or droplet expansion
- Cannot be performed from inside container (no docker.sock, unprivileged UID)

### SIGTERM Cascade Pattern
- 12 SIGTERM events in agent.log
- Pattern: Paperclip recovers → gateways flood wake requests → load spikes >20 → s6 SIGTERMs gateways → load drops → s6 restarts → cycle repeats
- Latest at 13:11 affected both default and jericho gateways (parent: s6-supervise)
- Both gateways currently up and stable (2720s uptime)

### Consolidated Fleet Model
- gateway-jericho: up (pid 171, --replace flag) 
- gateway-default: up (pid 213, --replace flag)
- gateway-researcher/analyst/iris/donald/intelligence/juridico: down (not started yet) — expected
- No Donald-unexpectedly-up or gateway-count anomalies
- s6-log processes exist for all 8 services (harmless)

### Bridge Activity
- Active today: TICKETS.md (Jul 9 09:45), PA21-handoff, MAS-227 status, mas-319 resolution
- Recent jericho/outbox activity within last hour
- No >24h siloing detected

### MCP Tool Warning
- Figma MCP failed to connect at 13:13:12 (CancelledError)
- 9 tools registered from 1 server, 1 failed
- Low priority — figma-developer-mcp process exists and running

## Recommendations

1. IMMEDIATE: Host operator must restart Paperclip server (auth-middleware deadlock Stage 2)
2. IMMEDIATE: Host-level `docker system prune -a` or droplet expansion (disk 93%)
3. When Paperclip recovers: expect SIGTERM cascade — prioritize issue status updates over scans
4. Monitor swap — 249MB remaining is critical threshold
5. Load is trending down; no additional LSP cleanup needed

## Paperclip State (for next scan)
- paperclip_status: degraded-auth-deadlock (Stage 2)
- api_key_working: False
- health_noauth: 200
- health_auth: timeout
- port_3100: LISTEN (server alive, auth handler frozen)
