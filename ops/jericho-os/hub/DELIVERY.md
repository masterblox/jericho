# Hub delivery rules — where the fleet board goes and how

This module owns **one thing every fleet operator cares about:** a single
plain-English board of all fleet state, posted to the Jarvis hub for Carlos —
without spamming him when nothing changed.

## What it posts

`hub-fleet-digest.py` builds a compact human-readable board
("🛰️ *JERICHO OS* — fleet board") and posts it to the Jarvis hub as **one
change-gated message**. It also prints the same digest to stdout (a cron can
deliver that to Carlos's DM).

## Delivery rules (non-negotiable)

1. **Change-gate.** A SHA-256 of the board text is stored in
   `HUB_DIGEST_STATE` (`/opt/data/profiles/dev/.hub-digest-hash`). If the hash
   is unchanged since the last run, the script returns **silently** — it never
   posts an identical board. No spam.
2. **One message, hot-first, plain English.** The board is one message in the
   canonical format: hot items first, short lines, phone-readable.
3. **Token is never in the repo.** The Jarvis bot token is read at runtime
   from `${JARVIS_HOME}/.env` (the Jarvis data root),
   `TELEGRAM_BOT_TOKEN=...` line. The digest script locates it; if the token
   or `.env` is missing it does **not** fail — it prints
   "HUB: board not posted (token missing). DM copy below." with the board so
   a DM-delegated cron can still deliver it.
4. **Hub identity is config, not secret.** `HUB_CHAT` (`-1003940809134`, the
   hub group) and `HUB_THREAD` (`4`, the DEV/fleet topic) are environment
   variables with the live values as defaults.
5. **No log-spam.** A successful post prints exactly `hub post OK`.

## Messaging between lanes (relay conventions)

The digest is the *human-facing* outbound surface. For agent↔agent messages
use the **agent-chat relay v2** protocol (`docs/maestro/relay-comms-v2.md` in
this repo, on branch `masterblox/maestro-wiring`): every inter-agent message
is a `relay-<src>-<dst>-<slug>-<ts>.json` event file; the old
conductor-bridge outbox is dead and write-denied. The two streams do not mix:
the digest is reporting, the relay is messaging.

## Relationship to the maestro board

`hub-fleet-digest.py` is the reporting half of the fleet-status-board
doctrine. The durable flip/verify/archive half is the maestro board service
(`ops/maestro/board.py` + Hub command-plane hooks, see `docs/maestro/README.md`).
This digest is deliberately read-mostly: it reports what the fleet is doing
and keeps the human in the loop when something needs a call. Reference the
maestro docs — do not duplicate the board loop here.
