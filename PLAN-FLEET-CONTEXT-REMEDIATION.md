# Fleet Fix — No More Bullshit

**Date:** 4 July 2026, 22:00 DXB
**Problem:** 92 restarts in 6 days. Agents can't remember anything. 3 gateways burning 1.2GB for zero throughput.
**Deadline:** This week.

---

## What's Actually Broken

The fleet runs like a server room nobody visits — all infrastructure, no output.

| Reality | Cost |
|---|---|
| 3 Python gateways sitting idle, waiting for Telegram pings | 1.2GB RAM, 24/7 |
| Linear watcher fires 48x/day — all 4 snapshots today identical | API calls, CPU, disk writes |
| Bridge poller fires 480x/day — 0 handoffs today | Process spawn overhead |
| Gateway restarts wipe all session context | Agents start from zero every time |
| Memory not shared across agents or sessions | 20KB total persisted vs 100s of MB of context burned |
| TypeScript LSP zombie running 6 days with no coding session | 635MB (killed today) |

**Net:** Paying for persistent AI agents. Getting stateless one-shot workers.

## What We Do

### Today (done)

- [x] Kill TypeScript LSP zombie — 635MB freed
- [x] Throttle Linear consume: 30m → 2h
- [x] Throttle Bridge poller: 3m → 15m

### Tomorrow

1. **Kill Donald's gateway.** 230MB, zero activity, can revive in 2 minutes when sales push starts. Write a 5-line script that boots it on demand.

2. **Session dump on restart.** Gateway writes compressed session summary to disk before any restart. Next boot loads it. Prevents cold starts. ~50 lines of Python in the gateway shutdown hook.

3. **Watchdog reform.** Current behavior: watchdog detects problem → auto-restart → wipes context → worse. New behavior: watchdog detects problem → alerts Jericho inbox → Jericho decides. Kill zombies first, restart last.

### This Week

4. **Merge Jericho into default gateway.** 682MB → shared process. Saves 300-400MB, eliminates separate restart vector, simpler watchdog surface. One `hermes -p jericho` vs two gateway processes.

5. **Unified memory.** Single SQLite at `/opt/data/fleet-memory.db`. Every agent writes to it via the `memory` tool. Loaded on session start. Survives restarts. Stops the amnesia cycle.

6. **Cron context.** Cron jobs inherit agent's last session checkpoint as context. No more blind cron runs with zero awareness of what the agent was doing.

## The Core Insight

The fleet's architecture assumes it's a busy multi-agent operation. It's not. It's Carlos + occasional DEV work with long quiet periods. Everything should scale DOWN to idle gracefully, not burn resources pretending to be busy.

**The real fix is reducing the number of things that can restart.** Every restart vector is a context shredder. 1 gateway = 1 restart vector. 0 unnecessary cron fires = 0 process churn. Memory on disk = survives anything.

## What This Costs (vs Doing Nothing)

| | Now | After |
|---|---|---|
| RAM | 4.4GB | ~2.5GB |
| Gateway processes | 3 | 1 |
| Cron fires/day | ~530 | ~120 |
| Restart vectors | 3 gateways + s6 + SIGTERM cascade | 1 gateway |
| Agent memory survival | No | Yes (SQLite + checkpoints) |
| Cold starts after restart | 100% | ~10% |

## What I Need From Carlos

1. **Kill Donald now?** (230MB, zero downside)
2. **Merge Jericho into default?** (architectural change, I need a GO)
3. **ANTHROPIC_API_KEY?** (for Claude Code — useful for DEV lane heavy lifting)
