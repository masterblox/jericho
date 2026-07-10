# INTEL Scan — 2026-07-09 12:50 DXB (UTC+4)

## Paperclip: ZOMBIE SOCKET (CRITICAL)

- HTTP 000 on all endpoints (Tailscale + localhost, health + authenticated)
- Raw HTTP/1.0 probe: connect succeeds, recv times out after 5s
- /proc/net/tcp shows port 3100 (0C1C) in LISTEN state, inode 295189632
- Stage: zombie socket — Paperclip server process crashed, kernel has not cleaned up the LISTEN socket
- No process holds the socket inode — orphaned
- Duration: approximately 3 days now (first noted 2026-07-07)
- Recovery blocked: inside container — no Docker socket, no root, no fuser. Requires host-level intervention to kill the orphaned socket and restart Paperclip server.
- All fleet agents (DEV, PA, Iris, Donald, Researcher, Analyst) are stalled — no issues can be fetched, created, or updated.

## Gateway Fleet: CLEAN

- Jericho + Default only — matches consolidated model
- s6: both up and supervised
- Donald: correctly down (only s6-log, no process)
- Researcher/Analyst/Iris/Intelligence/Juridico: all "down (not started yet)" — baseline

## Disk: 93% (HIGH)

- 6.0G free on 77G overlay
- Swap: 1842MB / 2047MB (90% utilized) — severe
- Load average: 16.46 / 16.21 / 16.89 — severe memory pressure
- Container cleanup candidates: ~600MB node_modules (global npm, lsp dirs) — marginal
- Real problem: host-level Docker overlay layers — not fixable from container

## Memory: OK

- No "memory would be at" or "over the limit" events in agent.log
- No memory overflow — Jericho memory writes are flowing

## Bridge: ACTIVE

- Last handoff: PA21-goliath-mcp-unreachable.md (Jul 9 09:43 DXB)
- Jericho outbox: researcher wake handoffs through today
- Bridge is flowing — agents are generating output, just can't deliver via Paperclip

## Agent Logs: CLEAN

- No errors, failures, or warnings in agent.log
- No zombie LSP processes (tsserver, typescript-language-server, etc.)

## Vault: LOW ACTIVITY

- 5 .md files modified in last 24h
- Low vault activity is downstream of Paperclip being dead — agents can't get work

## MoA: DOWN (LOW)

- No MoA process, no response on localhost:8765
- Gateways fall back to direct provider calls — minor latency on first attempt only

## Recommended Actions

1. **BLOCKED: Host-level Paperclip recovery** — kill orphaned port 3100 socket, restart Paperclip server. Cannot be done from inside container.
2. **HIGH: Host-level disk cleanup** — `docker system prune -a` or droplet expansion. Container cleanup is marginal.
3. **MEDIUM: Kill chromium browser processes** — ~800MB from this wake session's browser, will self-clean on session exit.

## Scan Metadata

- Agent: Intelligence (f2216417)
- Paperclip status: ZOMBIE SOCKET — delivered directly (Paperclip unavailable)
- Run ID: 426c63f4-6a84-4dba-a9f5-78fd3a84d667
