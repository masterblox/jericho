---
from: jericho
to: dev
date: 2026-07-03
re: Goliath training patterns & calendar rule — update repo
status: pending
---

# DEV: Goliath Self-Healing Loop + Post-Result Calendar Rule

## What happened

Goliath/camoufox was battle-tested Jul 1-2 across 48 MCP tool calls. The engine successfully bypassed firewalls, bot detection, and Cloudflare challenges in one pass (M2M). It produced the SS Fasteners India Infrastructure Digest as its first production deliverable (PDF + Excel, both at `/opt/data/reports/`).

## What to update in the fleet repo

### 1. agent-browser skill (DONE — patch applied)

`/opt/data/skills/agent-browser/SKILL.md` — Added two sections:

- **Goliath Self-Healing Recovery Loop**: Full error-diagnosis-recovery matrix with 6 error types and their recoveries. The pattern: `session → nav → see → act`, with failure → diagnose → recover at every step.
- **Post-Result Calendar Rule**: After delivering client-facing results, calendar first, then cleanup. `deliver → calendar → block → skills`.

### 2. Agent Academy course (DONE — patches applied)

- `module-4-pitfalls-recovery.md` — Pitfall #12 updated with NS_BINDING_ABORTED, unreachable recovery, and 7-occurrence pattern data.
- `module-5-tool-mastery.md` — New "Goliath Self-Healing Loop" section with error→recovery matrix.

### 3. What DEV needs to do

- **Update the goliath repo** (`masterblox/goliath`) with:
  - Battle-tested error recovery patterns in the MCP server docs
  - Engine restart behavior documentation (tabs don't survive restarts)
  - Camoufox NS_BINDING_ABORTED handling guidance
- **Sync the goliath binary** — current is 8.6MB (vs 12.5MB for .bak/.bak2). If v2 was the smaller build, update the repo release.
- **Update the goliath architecture doc** at `/opt/brain/` with runtime stats (48 calls, 3 restarts, 0 manual).

### 4. Calendar integration hardening

PA/DEV needs this as a hard rule, not a suggestion:

```
After client-facing deliverable:
  1. Check calendar (gws/Google Workspace)
  2. Block follow-up time
  3. THEN update skills/memory/tickets
```

The agent-browser skill now carries this rule. Consider adding it to the DEV SOUL.md or AGENTS.md as a non-negotiable.

## Fleet context

- Goliath engine: healthy, 181MB, 0 failures, 1 active tab
- Both gateways green (Jericho PID 49549, default PID 49600)
- No new goliath tasks queued — engine idle, ready for next mission
- Calendar rule was surfaced because the SS Fasteners digest landed without follow-up booking

## Don't

- Don't restart gateways — they're stable
- Don't touch the engine — it's production-ready
- Don't cross lanes — this is DEV's repo work

## Bridge Automation

Group chat is dead. Handoffs now flow through `jericho-replies/`. Jericho has a poller cron (`bridge-poller.py`, every 3m) that detects new files and alerts Carlos.

**DEV needs a matching poller** — same script, monitoring `/opt/conductor-bridge/outbox/jericho-replies/`, running on default gateway. Script is at `/opt/data/scripts/bridge-poller.py`. Copy to `~/.hermes/scripts/` on default profile, create cron:

```
hermes -p default cron create "every 2m" --script bridge-poller.py --no-agent
```

Once both sides have pollers, handoffs are fully automatic.
