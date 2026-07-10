# Intelligence Cross-Lane Scan — 2026-07-09 15:15 DXB (UTC+4)

**Agent:** Intelligence (f2216417)
**Run ID:** 28672a29-50bf-4ff3-ad56-16e4c20ed5f3
**Wake type:** Heartbeat (Paperclip Stage 3 — zombie socket, no issues fetchable)
**Paperclip status:** BLOCKED — zombie socket (connect OK, recv timeout, health=000)

---

## CRITICAL — Paperclip Stage 3 Zombie Socket

Paperclip HTTP server process is dead but port 3100 remains in LISTEN state (kernel zombie socket). All fleet agents (DEV ~98 issues, Researcher, Analyst, Intelligence) are blocked. No issue API available — cannot create, read, or update issues.

- Health (Tailscale): 000
- Health (localhost): 000
- Raw socket HTTP/1.0 probe: connect succeeds, recv times out after 5s
- /proc/net/tcp: port 0C1C st=0A (LISTEN) — orphaned socket

**Blocker:** Paperclip server requires host-level restart. Cannot be performed from inside Docker container — no Docker socket, no root, no fuser, SO_REUSEADDR won't clear zombie LISTEN sockets.

This has been Stage 3 since at least early today (all recovery-closer runs skipped due to auth check failure). Previous Stage 2c (POST timeout but mutations may complete) was observed ~14:57 DXB.

## CRITICAL — System Load: 18.66/19.11/19.43

Running on 2 CPUs. Load of 19 = ~10x oversubscription. Processes in run queue: 19. This is the root cause of gateway instability and timeouts.

## CRITICAL — Swap at 85% (1.7G/2.0G)

Memory exhaustion driving load spike. Free memory: 515MB. Gateways at risk of SIGTERM under continued load.

## HIGH — Gateway Restart Pattern

Both gateways restarted twice in 23 minutes:
- 14:10: default + jericho restart
- 14:33: default + jericho restart (current)

SIGTERM count in agent.log: 20 total. Pattern suggests s6 is timing out gateways under severe load, then restarting them.

## HIGH — Disk: 88% (68G/77G)

Container-level cleanup candidates: node_modules in repos (architect-ai ~908MB, memories-express-mvp-cp ~1013MB), npm cache, Playwright browsers, stale sessions. But container cleanup freed only 973MB last time (94%→93%). The real problem is host-level Docker overlay layers — 50GB+ gap between df and du.

## MEDIUM — Default Gateway Compression Failures

Default gateway log shows repeated 401 errors on MoA compression:
```
Compression aborted: Error code: 401 - Missing Authentication header
```

MoA likely not running (no process found in ps). Impact: LOW — gateways fall back to direct provider calls. But repeated compression failures waste cycles under already-high load.

## MEDIUM — Zombie LSP Processes (Self-Reinfection)

Killed 4 LSP processes (~524MB total: 2x tsserver, typescript-language-server, typingsInstaller). 2 respawned immediately — self-reinfection from current session's LSP integration. Can't prevent without disabling LSP in config. Freed ~100MB (4.0→3.9G resident, swap 1.8→1.7G).

## LOW — Vault Activity

4 files modified in last 24h: Designer MEMORY, DEV MEMORY, PA USER, PA MEMORY. Low cross-agent activity. This is a downstream effect of Paperclip outage — no agent has work assigned.

## LOW — Bridge Activity

Conductor bridge: last update 09:45 DXB (TICKETS.md, PA21). Jericho outbox: active today (15:04-15:08 DXB) with Paperclip deferred-close payloads.

## Gateway Status (Consolidated Fleet Baseline)

| Gateway | s6 State | Process | Notes |
|---------|----------|---------|-------|
| default | up (pid 178) | running --replace | Outside s6 supervision |
| jericho | up (pid 162) | running --replace | Outside s6 supervision |
| researcher | down (not started) | — | Consolidated model — correct |
| analyst | down (not started) | — | Consolidated model — correct |
| intelligence | down (not started) | — | Consolidated model — correct |
| donald | down (not started) | — | Consolidated model — correct |
| iris | down (not started) | — | Consolidated model — correct |
| juridico | down (not started) | — | Infrastructure ready — correct |

**Fleet architecture compliance:** PASS. Only default + jericho running per consolidated model. No rogue Donald/Researcher/Analyst processes.

## Recommended Actions (for Jericho / Carlos)

1. BLOCKED: Paperclip needs host-level restart — `docker restart paperclip` or equivalent on VPS host
2. After Paperclip recovery: expect SIGTERM cascade from queued wake flood. Prioritize Paperclip mutations (status updates) over scans during recovery window.
3. Kill zombie LSP processes during peak load (recurring maintenance — kills free ~500MB but reinfection is inevitable)
4. Consider disabling Hermes LSP integration: `hermes config set lsp.enabled false` — eliminates reinfection
5. Disk at 88% — monitor. If it reaches 90%, host-level `docker system prune -a` required
6. Memory overflow count: 1 in agent.log (likely historical, confirm with memory tool)

---

**Paperclip unavailable — delivered directly via wake transport.**
**No Paperclip issue filed (API unreachable).**
