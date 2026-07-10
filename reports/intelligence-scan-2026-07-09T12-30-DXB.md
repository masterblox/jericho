# INTEL Scan — 2026-07-09 12:30 DXB (UTC+4)

Status: Paperclip zombie socket — delivered directly (Paperclip unreachable)

## CRITICAL: Paperclip Stage 3 Zombie Socket

- Raw socket probe: connect_ex=0 (success), recv timed out after 5s
- Port 3100 (0C1C) in LISTEN state — orphaned socket, no responding process
- 12+ stale connections in TIME_WAIT from prior failed attempts
- Both Tailscale hostname and localhost return HTTP 000
- Duration: >3 days now (since Jul 6). This is a host-level failure.
- BLOCKED: Container has no Docker socket, no root, no fuser. Cannot recover from inside.

## HIGH: System Load 16.81

- Load average: 16.81 / 17.29 / 17.50
- Swap: 1.6G/2.0G (80%) — severe memory pressure
- Free RAM: 217Mi
- Root cause: high load is chronic (>17 for all intervals). Not a transient spike.

## HIGH: Disk 94%

- Overlay: 77G total, 72G used, 5.2G free (94%)
- Unchanged from prior scan — container-level cleanup already exhausted

## MEDIUM: auth.json Permission Denied

- /opt/data/auth.json: Permission denied for hermes user
- All OAuth providers (Codex) blocked
- DeepSeek (current provider) not affected — uses API key, not OAuth
- Fix: chown hermes:hermes /opt/data/auth.json

## MEDIUM: OpenRouter 401

- Fallback provider (openrouter, gemini-3-flash) returning 401 Missing Authentication header
- Primary DeepSeek is working — impact is fallback-only

## Gateway State (Consolidated Fleet)

- Jericho gateway: RUNNING (PID 166, s6-supervised)
- Default gateway: RUNNING (PID 2365, outside s6 — --replace flag)
- Donald/Iris/Researcher/Analyst/Intelligence/Juridico: s6 supervisors present, no gateway processes — NORMAL for consolidated fleet
- No LSP zombies detected

## Bridge Activity

- Conductor bridge: active, last handoff Jul 9 09:45 (TICKETS.md, PA21)
- Jericho outbox: active, recent researcher/analyst wakes today

## Memory

- No overflow events in agent.log
- Agent log clean aside from auth.json warnings

## Actions Needed

1. HOST-LEVEL: Restart Paperclip server (zombie socket on port 3100)
2. HOST-LEVEL: docker system prune or droplet expansion (disk 94%)
3. CONTAINER: chown hermes:hermes /opt/data/auth.json
4. CONTAINER: Fix OpenRouter API key/auth header

Paperclip unavailable during this scan — report delivered directly.
