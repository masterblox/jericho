# Fleet Intelligence Scan — 2026-07-09T20:40:32Z (00:40 Dubai)

**Delivery:** Direct (Paperclip Stage 3 zombie — unreachable)

---

## CRITICAL

### 1. Severe Memory Pressure — Load 16.27 / Swap 100%
- **Load average:** 16.27 / 16.85 / 18.36 on 2-CPU VPS
- **Memory:** 7079MB used of 7941MB (862MB available)
- **Swap:** 2047MB / 2047MB (100% utilized)
- **Risk:** Gateways at risk of s6 SIGTERM under load spikes. Default gateway already experienced 3 "Interrupted during API call" events and 10 restarts between 12:26–17:09 UTC today. Jericho had 11 restarts between 11:00–14:33 UTC.
- **Root cause:** Zombie LSP processes (see HIGH #2). Two tsserver instances consuming 1.1GB + 831MB alone.

### 2. Paperclip Stage 3 — Zombie Socket (Fleet Coordination DEAD)
- Port 3100 in LISTEN state (0C1C in /proc/net/tcp)
- Raw socket connect() succeeds but recv() times out (5s)
- HTTP_CODE 000 on all endpoints (localhost + Tailscale)
- **Fleet impact:** All agent wake routing dead. DEV, Researcher, Analyst, Intelligence — no agent can receive work or report status. Paperclip-recovery-closer cron (every 30m) is hitting the same wall.
- **Blocker:** Host-level restart required. Container-locked (no Docker socket, no root, no fuser).
- **Stage history:** Degradation was progressive — auth-middleware deadlock → keep-alive handler wedged → now zombie socket.

---

## HIGH

### 3. Disk at 91% — 7.4GB Remaining
- overlay: 77G total, 70G used (91%)
- Container cleanup potential: node_modules in repos (architect-ai, memories-express-mvp-cp), npm cache, stale sessions
- If container cleanup recovers <5%, host-level `docker system prune -a` needed

### 4. Zombie LSP Processes — 2.5GB+ RAM Waste
8 processes found:

| PID | Process | RAM | Uptime |
|-----|---------|-----|--------|
| 68276 | tsserver (architect-ai) | 1123MB | 2h39m |
| 87719 | tsserver (memories-express) | 831MB | 1h51m |
| 68275 | tsserver partialSemantic | 116MB | 2h39m |
| 87718 | tsserver partialSemantic | 114MB | 1h51m |
| 68314 | typingsInstaller | 55MB | 2h39m |
| 87733 | typingsInstaller | 43MB | 1h51m |
| 68263 | typescript-language-server | 22MB | 2h39m |
| 87706 | typescript-language-server | 22MB | 1h51m |

**Total: ~2.3GB.** These are the primary drivers of swap exhaustion. Per fleet-intelligence skill: cleanup warranted immediately under current conditions. Root fix: disable Hermes LSP integration (`hermes config set lsp.enabled false`).

### 5. Default Gateway Crash-Wave (Stabilized)
- 10 "Gateway Starting" events since 12:26 UTC
- 3 "Interrupted during API call" events (14:00, 16:49, 17:01)
- 7 MoA 401 compression failures (MoA down — see MoA note)
- Currently stable since 17:09 (PID 55970, 0.3% CPU, 74MB)
- Risk: running with `--replace` flag outside s6 supervision → no auto-restart on crash

---

## MEDIUM

### 6. Bridge Drought — 11h+ No Cross-Agent Handoffs
- Engineer messages last updated: 09:45 UTC (TICKETS.md) — 11h ago
- jericho-handoffs: empty (0 files)
- jericho-replies: empty (0 files)
- Jericho outbox active (researcher-wake, deferred-close files within last 15 min) but no cross-agent bridging

### 7. Silo Pattern: Vault Updates Without Handoffs
- DEV/MEMORY.md, PA/USER.md, PA/MEMORY.md updated in last 24h
- Zero cross-agent handoffs in bridge
- Agents working in their own lanes with no coordination

### 8. Jericho Gateway Earlier Crash-Wave (Now Stable)
- 11 restarts between 11:00–14:33 UTC today
- Stable since 14:33 (PID 162, 509MB, 10.2% CPU)
- Running with `--replace` outside s6 supervision

### 9. Cron: jericho-morning-briefing HTTP 402 (Insufficient Balance)
- Last run: Jul 8 05:00 UTC — error: RuntimeError: HTTP 402
- DeepSeek API credits may be depleted for that job
- Next run: Jul 10 05:00 UTC

### 10. Both Gateways Outside s6 Supervision
- Jericho PID 162: `--replace` flag, running since 14:33
- Default PID 55970: `--replace` flag, running since 17:09
- s6-svstat not available in container (command not found)
- Both lack crash auto-restart

---

## LOW

### MoA Service Down
- No MoA process running
- localhost:8765 — connection refused
- Impact: 401 errors in default gateway logs (compression aborted × 7). Gateways fall back to direct provider calls. Added latency on first attempt only.

---

## Fleet State Summary

| Component | Status | Detail |
|-----------|--------|--------|
| Jericho Gateway | 🟡 Running (outside s6) | PID 162, stable since 14:33 |
| Default Gateway | 🟡 Running (outside s6) | PID 55970, stable since 17:09 |
| Paperclip | 🔴 Stage 3 Zombie | Port LISTEN, no response |
| Load | 🔴 16.27 | 2-CPU VPS |
| Swap | 🔴 100% | 2047/2047MB |
| Disk | 🟠 91% | 7.4GB free |
| Bridge | 🟠 Drought 11h+ | No cross-agent handoffs |
| Zombie LSP | 🔴 8 processes | 2.3GB RAM |
| MoA | 🟡 Down | Fallback active |
| Cron | 🟢 12 jobs active | 1 HTTP 402 error stale |

---

## Recommended Actions (for Jericho)

1. **IMMEDIATE: Host-level Paperclip restart** — Only recoverable from outside container. Zombie socket on port 3100. All fleet coordination blocked.
2. **HIGH: Kill zombie LSP processes** — `pkill -f tsserver; pkill -f typescript-language-server; pkill -f typingsInstaller`. Will free ~2.3GB RAM and reduce swap pressure. Expect reinfection from active Hermes sessions; disable LSP for permanent fix.
3. **HIGH: Container disk cleanup** — Remove node_modules from non-active repos, clear npm cache, stale sessions.
4. **MEDIUM: Re-establish s6 supervision** — Stop `--replace` processes, remove down files, restart via s6-svc.
5. **MEDIUM: Check DeepSeek API credits** — jericho-morning-briefing HTTP 402 since Jul 8.

---

*Paperclip unavailable during scan — delivered directly. No Paperclip issue filed.*
