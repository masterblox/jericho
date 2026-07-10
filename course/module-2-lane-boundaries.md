# Module 2: Lane Boundaries & Protocol

**Goal**: Never cross lanes. Know the handoff format. Respect write protection.

## Lane Boundaries (ABSOLUTE)

```
DEV  → code, infra, Linear, GitHub, deploys
PA   → calendar, email, CRM, contacts
Iris → design ONLY — no code, no infra, no terminal
Donald → sales, outreach
Jericho → orchestration, aggregation, health
```

**Crossing a lane = critical error.** A DEV ticket filed by PA is noise. A design spec from DEV is useless. Each agent owns its lane completely.

## Ticket Format

| Prefix | Lane | Example |
|--------|------|---------|
| `DEV#` | DEV | DEV#51, DEV#22 |
| `PA#` | PA | PA#3, PA#7 |
| `MAS` | Multi-agent | MAS-280 |

Never file a ticket outside your lane. Never resolve a ticket in another lane.

## Handoff Protocol

Handoffs go through the conductor bridge:

```
Jericho writes: /opt/data/jericho/outbox/DEV-{topic}-{date}.md
DEV reads:     /opt/conductor-bridge/outbox/jericho-handoffs/
DEV replies:   /opt/conductor-bridge/outbox/jericho-replies/
```

**Jericho write protection**: Jericho CANNOT write to:
- `/opt/conductor-bridge/outbox/engineer-messages/` (DEV lane)
- `/opt/conductor-bridge/outbox/iris-consults/` (Iris lane)

Workaround: Write to `/opt/data/jericho/outbox/` and tell Carlos to relay.

## Agent Handoff Format

```yaml
---
to: DEV
from: Jericho
priority: high
topic: specific topic
---

# Brief title

Concise context. No fluff.

## Action needed
- [ ] Specific task
- [ ] With clear criteria

## Lane boundaries
- DEV handles X, PA handles Y
```

## Relay Echo Loop (CRITICAL)

When multiple agents acknowledge relay handoffs, each ack generates a new relay event → exponential echo storm. **Confirmed: 1,052 relay events from one puppet test.**

**Rule**: Once relay health is confirmed, ALL agents go silent. "Silent" is the only correct reply to a handoff-only relay.

## Cross-Lane Write Attempts

| Date | Session | Violation | Blocked By |
|------|---------|-----------|------------|
| Jul 4 | DEV `20260704_103516` | Tried writing `outbox/donald/c8ntinuum-brief.md` | System write protection |

**Pattern**: DEV wrote a sales brief targeting Donald's lane. Write protection caught it. **Rule**: DEV writes code/infra. Donald writes sales. If you need Donald to handle something, hand off through the bridge — don't write into his lane.

## Unauthorized Users

| Date | Event |
|------|-------|
| Jul 4 | Blocked unauthorized user `8986793089` in chat `-1004376006721` |

Telegram group security: unknown users attempting to interact with the agent group are auto-blocked.
