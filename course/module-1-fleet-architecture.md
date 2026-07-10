# Module 1: Fleet Architecture

**Goal**: Understand the agent fleet — who runs where, on what, and how they talk.

## The Stack

```
Carlos (CEO, Dubai UTC+4)
        |
    Jericho (Orchestrator)
   /    |     |     \
DEV    PA    Iris  Donald
```

| Agent | Lane | Model | Gateway |
|-------|------|-------|---------|
| **DEV** | Code, infra, Linear, GitHub, deploys | DeepSeek v4-pro | default (PID 12040) |
| **PA** | Calendar, email, CRM, contacts | DeepSeek v4-pro | default (consolidated) |
| **Iris** | Design ONLY | GLM-5.2 + Claude Opus | default (consolidated) |
| **Donald** | Sales, outreach | DeepSeek v4-pro | default (consolidated) |
| **Jericho** | Orchestration, aggregation | DeepSeek v4-pro | jericho (PID 15242) |
| **Engineer** | Mac-local heavy lifting | Big model | Mac native |

## Key Concept: Not Docker Containers

The fleet runs in **one Hermes container**. PA, Iris, Donald are consolidated into the default gateway. Only Jericho has its own gateway process. `docker ps` will fail from inside the container.

## The Bus

```
/opt/data/jericho/          ← Jericho operational directory
/opt/conductor-bridge/outbox/ ← Agent handoff channel
/opt/brain/                  ← Vault (Obsidian sync, mostly read-only)
```

## Communication Rules

- **Agent-to-agent**: conductor bridge outbox ONLY. Never DM agents directly.
- **Jericho → agents**: Write to `/opt/data/jericho/outbox/`, dispatch via bridge
- **DEV → Jericho**: `outbox/jericho-handoffs/`
- **Jericho → DEV**: `outbox/jericho-replies/`
- **No group chats** — killed after hallucination loops

## What Each Agent Can AND Can't Do

| Agent | CAN | CANNOT |
|-------|-----|--------|
| DEV | Code, infra, git, terminals | Calendar, design, sales |
| PA | Calendar, email, CRM | Code, infra, design |
| Iris | Design, images, Figma | Code, infra, terminals |
| Donald | Sales, outreach, pitches | Code, design, infra |
| Jericho | Aggregate, dispatch, health | Direct agent-to-agent DM |

## Memory Architecture

- Each agent has `MEMORY.md` in the vault at `/opt/brain/Memory/Agent/{agent}/`
- DEV's memory is the largest (208 lines) — longest training history
- Memory is always-loaded, compact, and injected into every turn
- Detailed history belongs in vault notes, client dossiers, or skills
