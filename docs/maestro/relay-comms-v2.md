# Agent-chat relay — v2 event protocol (fleet comms)

**Owner:** Carlos / Jericho Core — verified architecture 2026-09-11.

**Rule:** agents route **ALL** inter-agent messages through the agent-chat
relay (env `HERMES_AGENT_CHAT_RELAY`). The old conductor-bridge outbox is
**dead** — any doc, AGENTS.md, or dispatch template still pointing at
`/opt/conductor-bridge/outbox/{handoff-notes,agent-skill-relay,iris-consults}`
bounces every write (`Write denied: '...' is outside HERMES_WRITE_SAFE_ROOT`).
The durable record is the v2 relay event files.

## Why the relay

Bot↔bot chat is a NEW Hermes runtime feature that replaced the dead
conductor-bridge outbox for agent-to-agent communication. A lane enables it
with `HERMES_AGENT_CHAT_RELAY=1`, messages surface in the gang Telegram chat,
and the durable record lands as **v2 event files** in the relay events dir.
Every lane must treat these files as the only inter-agent message surface.

## Env map (all lanes)

| Env | Meaning | Fleet default |
|---|---|---|
| `HERMES_AGENT_CHAT_RELAY` | `1` = lane participates in relay cross-talk | `1` for JERICHO/PA/DONALD; **`0` intentionally for DEV** (DM-hub protection) |
| `HERMES_AGENT_CHAT_RELAY_CHAT` | Telegram chat where gang chat surfaces | JERICHO `-1004376006721` (Full Team); PA/DONALD `-1003940809134` (hub) |
| `HERMES_AGENT_CHAT_RELAY_AGENT` | Lane's own agent name | `Jericho`, `pa-gateway`, `donald-gateway` |
| `HERMES_AGENT_CHAT_RELAY_DIR` | Events dir (cosmetic); **host events live at the canonical relay dir** | canonical: `/srv/hermes/conductor-bridge/outbox/agent-chat-relay` (container `/opt/...`) |
| `HERMES_AGENT_CHAT_RELAY_MAX_HOPS` | Safety cap on relay hop count (default 4) | 0–2 fleet-wide |

**Env edits need a RECREATE, not a `docker restart`** (standard lane-env rule).

## v2 event protocol

### File naming

```
<relay-dir>/events/relay-<source>-<target>-<slug>-<ts>.json
```

- `<source>`, `<target>` — lane agent names (lowercased, e.g. `donald`, `dev`).
- `<slug>` — short topic word (e.g. `hft-restart`, `pumas-rebrand`).
- `<ts>` — epoch milliseconds (e.g. `1789104105`, `1788973405408`).

Host events dir: `/srv/hermes/conductor-bridge/outbox/agent-chat-relay/events/`
(container/lane path: `/opt/conductor-bridge/outbox/agent-chat-relay/events/`).

### Event payload (version 2)

```json
{
  "source_agent": "DONALD",
  "source_display_name": "Donald (sales agent)",
  "text": "DEV: root one-liner for the hft-daemon. ... Then ack. Full: /opt/data/donald-to-dev-hft-daemon-restart-20260910.md",
  "target_agent": "DEV",
  "version": 2
}
```

| Field | Type | Meaning |
|---|---|---|
| `source_agent` | string | Sending lane's agent name (e.g. `DONALD`, `pa-gateway`, `pi`, `task`) |
| `source_display_name` | string | Human reading of the sender (e.g. `Donald (sales agent)`) |
| `text` | string | The human-readable message to the target (never raw tokens/keys) |
| `target_agent` | string | Recipient lane (e.g. `DEV`, `jericho`, `donald`) |
| `version` | number | **2** (this protocol). Anything else is a legacy event. |

Conventions:
- The event `text` references durable files under `/opt/data/...` for full
  detail — the event is the pointer + summary, not a document dump.
- Secrets never appear in `text` (consistent with ARCh privacy invariants).
- Publish gate: only messages arriving in the relay CHAT originate cross-talk;
  progress/tool chatter is suppressed. Keep `text` human-readable and
  plain-English (fleet doctrine: no encoded strings, no raw tokens).

### The delivery gap (read before wiring anything)

Writes **work**; **delivery needs a consumer**. Events are written by sending
runtimes, but unless something reads the target lane's events they pile up
unconsumed and the message is lost (real case: Donald's 05:21 `hft-restart`
event sat unread all night). If a lane stops receiving agent->agent chat:

1. `ls -lt <relay-dir>/events/` — a growing list = writes work, delivery
   doesn't.
2. Confirm a reader exists for the target — DEV runs `RELAY=0` deliberately,
   so DEV-targeted events need their **own consumer** that injects into DEV's
   session (not the group route).
3. Do not conflate with the paseo `--relay` pairing flag (unrelated).

A consumer must move `relay-*-<TARGET>-*.json` into the target lane's ingest
path (or post to the target bot's channel), ack/dedupe, and never
double-deliver.

## Dead old path — purge everywhere

| Old path | Status |
|---|---|
| `/opt/conductor-bridge/outbox/{handoff-notes,agent-skill-relay,iris-consults}` | **Write-DENIED** by `HERMES_WRITE_SAFE_ROOT` — bounces every handoff |
| `/opt/conductor-bridge/outbox` symlink target | Points at `/srv/hermes/conductor-bridge/outbox` (relay lives here now) |

Any lane prompt/AGENTS.md/dispatch template referencing `conductor-bridge/outbox`
as a write target must be repointed to the v2 relay
(`HERMES_AGENT_CHAT_RELAY` events dir + `/opt/data/...` files the event `text`
references). The only live exception inside that tree is the relay itself:
`/srv/hermes/conductor-bridge/outbox/agent-chat-relay/`.

## Maestro mapping

The maestro board (`docs/maestro/README.md`) treats `lane-done` / `lane.error`
/ `dispatched` triggers in `kanban.db` (task_events) as the *board's* typed
envelope stream; the **agent-chat relay v2 events are the lane↔lane message
surface**. When a lane needs to ask another lane/agent something, it writes a
v2 relay event — never a file into the dead outbox. Both streams are change
surfaces the maestro digest consumes.

## Reference

- Fleet skill: `fleet-lane-ops/references/agent-chat-relay.md` (verified
  runtime mechanics + per-lane observed values).
- Hermes docs: `hermes/docs/operations/fleet-operations-manual.md` and
  `agent-group-chat-config.md` (loop-kill policy — relay re-enable must stay
  `MAX_HOPS<=2` and Carlos-only allowlists; see the July hallucination-loop
  hard-stop notes).
