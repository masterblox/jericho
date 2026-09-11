# Hub — fleet board digest + delivery + relay conventions

This module owns the **human-facing fleet board**: one plain-English digest of
all fleet state, posted to the Jarvis hub, change-gated so it never spams.

| File | Role |
|---|---|
| `hub-fleet-digest.py` | build + change-gate + post the fleet board |
| `DELIVERY.md` | **the delivery rules doc** (chat identity, change gate, token handling, quiet rules, relay conventions) |

Read `DELIVERY.md` first — it is the contract for where the board goes, when
it's allowed to post, and how the Jarvis token is discovered (at runtime,
never in this repo).

## Relationship to the rest of Jericho OS

- **Maestro board** (`ops/maestro/board.py`, docs/maestro, branch
  `masterblox/maestro-wiring`): the durable flip/verify/archive loop. This
  digest is its reporting half — reference, don't duplicate.
- **Relay v2** (`docs/maestro/relay-comms-v2.md`): the lane↔lane message
  surface. The digest is outbound reporting; the relay is inter-agent
  messaging. They do not mix.

## Tests

`continuation/smoke_test.py` also covers the digest's change-gate
(hash-stable silence) against a temp state file, with no token present.
