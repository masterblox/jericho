# Maestro boundary — reconcile, don't duplicate

The `ops/maestro/` board service exists in this repo on branch
`masterblox/maestro-wiring` (commit `b6c83f8`, by the Jericho agent):

- `ops/maestro/board.py` — self-running board over the fleet kanban kernel
  (`/srv/hermes/data/kanban.db`): recover stale leases, flip done cards **with
  evidence**, auto-dispatch open cards, write `lane-done` triggers, report.
- Hub command-plane hooks (`apps/jericho/bridge/src/hub/*`): `dispatch` /
  `verify` / `archive` / `ack` receipts on the #21 Hub backend.
- `docs/maestro/README.md` — the operating manual ("dispatch -> lane ->
  verdict -> flip -> report", night sweep, the paseo-100% rule).
- `docs/maestro/relay-comms-v2.md` — the lane↔lane agent-chat relay v2 event
  protocol (replaces the dead conductor-bridge outbox).

**This directory (`ops/jericho-os/`) is the transport / trigger / reporting
layer that feeds and consumes the board.** It does NOT re-implement the
board loop. The boundary:

| Concern | Lives here |
|---|---|
| Board loop (flip/verify/archive, evidence-bound verdicts) | `ops/maestro/` (branch `masterblox/maestro-wiring`) |
| Event plumbing (hub events, protocol) | `apps/jericho/bridge/src/hub/*` |
| Inbound bus (webhooks + cloud state → events) | `ops/jericho-os/boomerang/` |
| Tier-1 continuation trigger | `ops/jericho-os/continuation/` |
| Worker dispatcher (Pi on demand) | `ops/jericho-os/pi-dispatch/` |
| Human fleet board digest + delivery rules | `ops/jericho-os/hub/` |

When the maestro branch merges to `main`, keep this boundary: flows here stay
thin over the board, and docs point at `docs/maestro/*` rather than copying
them. The one thing `ops/jericho-os/hub/` owns that mirrors part of the board
doc is the *reporting* half (the digest is read-mostly); the *durable flip*
half stays in `ops/maestro/`.

Both trees are PUBLIC — never commit secrets/tokens/keys. Env templates only.
