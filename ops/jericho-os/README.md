# Jericho OS — fleet orchestration flows

**Canonical home of every Jericho OS / maestro flow** (PUBLIC repo — no
secrets; env templates only).

Jericho OS ("real life demo Jarvis by Masterblox") is the multi-agent fleet
operating system. This directory holds the **fleet orchestration layer** —
the durable flows that make the fleet self-running:

```
 inbound            trigger                       execute                    report
───────            ─────────                     ────────                   ────────
 boomerang   ──>   continuation    ──>  pi-dispatch + maestro board   ──>   hub digest
 (event bus)       (tier-1 cron)        (worker dispatcher)                (fleet board)
```

| Module | Flow | What it does |
|---|---|---|
| [`boomerang/`](boomerang/) | inbound bus | GitHub webhooks + Conductor cloud state → one durable JSONL event bus (`events.jsonl`) |
| [`continuation/`](continuation/) | tier-1 continuation | DEV cron that wakes when a paseo agent finished / a bus event arrived, and keeps it going (merge-on-green, dispatch next, diagnose) |
| [`pi-dispatch/`](pi-dispatch/) | Pi on demand | any lane hands an engineering task to a disposable Pi worker → answer file back in the lane's folder |
| [`hub/`](hub/) | fleet board digest | one change-gated plain-English board of all fleet state, posted to the Jarvis hub |
| [`install/`](install/) | rebuild | idempotent, backup-first installers (receiver unit, poller cron, continuation cron, pi-dispatch spool) |

The **maestro board** (`ops/maestro/board.py`, `docs/maestro/*` — on branch
`masterblox/maestro-wiring`, commit `b6c83f8`) is the kernel-facing flip /
verify / archive half: it reads the fleet kanban (`kanban.db`), auto-dispatches
open cards, flips done cards **with evidence**, and reports. These flows are
the transport/trigger/execution machinery around it — reference it, don't
duplicate it (see [MAESTRO.md](MAESTRO.md) for the boundary).

## The flows

### 1. Boomerang — inbound bus

External signals in, one durable append-only stream out:

```
GitHub webhook ──> Caddy (/webhooks/dev/github) ──> 127.0.0.1:9124
                                                     github-webhook.py (HMAC)
                                                          │   emit.py (flock+fsync)
Conductor API ──> conductor-poller.py (root cron */3) ──▶ ┴─> /srv/hermes/data/boomerang/events.jsonl
```

- `emit.py` is the **only** sanctioned append path to `events.jsonl`; the bus
  key order is frozen (`id, at, source, event, title, url, details,
  processed`), `source` is a frozen enum (`github|conductor|linear|paseo`).
- Receiver normalizations are frozen: `pr_merged`, `pr_closed_unmerged`,
  `ci_completed`, `push_main`. Everything else acks 200 silently.
- Consumers track a processed-set (append-only id list), never rewrite the bus.
- Details: `boomerang/README.md`, `boomerang/caddy-route.md`.

> **Operator step — register the hook on THIS repo.** `masterblox/jericho`
> itself still has **no** GitHub webhook to the bus. The live receiver is fed
> only by hooks on `masterblox/hermes`, `Mechanica-Labs/mechanica-openbot`,
> and `Mechanica-Labs/architect-ai`, all posting to
> `https://crm.mechanica.one/webhooks/dev/github`. Until a hook is registered
> on `masterblox/jericho` (same payload URL, same pattern; events
> `pull_request`, `workflow_run`, `push`), PR / CI / push events on **this**
> repo will NOT reach `events.jsonl` and the continuation engine will not
> react to them. Register it by hand (Repo → Settings → Webhooks — steps in
> `boomerang/caddy-route.md`). Nothing in this repo registers it automatically.

### 2. Continuation engine — tier-1 trigger

A change-gated DEV cron ("Jericho OS — continuation engine", every 2 min):
`boomerang-finished-digest.py` / `paseo-finished-digest.py` (monitors) wake it;
`boomerang-pending-completions.py` / `paseo-pending-completions.py` (context)
hand it the unprocessed finished paseo agents and unprocessed bus events. The
agent then judges claims vs receipts and **continues** — merge on green,
dispatch the verified next step, diagnose failures, mark handled
(`paseo-mark-processed.py`, `boomerang-mark-event.py`). Final reply is one
short line (or `NOOP`).

### 3. Pi-dispatch — Pi for every agent

A lane writes one request file into its own `pi-dispatch/requests/`; a single
host dispatcher (`/etc/cron.d/pi-dispatch`, every 2 min) ingests it, fires a
disposable Paseo Pi tab labeled with the lane (max 5 concurrent), polls it,
and delivers the answer **exactly once** to `<lane>/pi-dispatch/answers/`.
Every request ends `done | stale (~6h) | failed`. Secret-like requests are
quarantined, never fired. Details: `pi-dispatch/README.md`.

### 4. Hub board digest

`hub-fleet-digest.py` builds one plain-English fleet board and posts it to the
Jarvis hub (`HUB_CHAT` / `HUB_THREAD`), change-gated by a state hash — silent
when nothing changed. Token read at runtime from the Jarvis `.env`; if missing,
falls back to printing the board for a DM cron. Delivery rules:
`hub/DELIVERY.md`. Lane↔lane messages are separate: the agent-chat relay v2
protocol (`docs/maestro/relay-comms-v2.md`).

## Install (rebuild)

From a repo checkout:

```sh
bash ops/jericho-os/install/install-all.sh --dry-run   # plan first
bash ops/jericho-os/install/install-all.sh             # apply
```

This installs (all idempotent, backup-first):

- **boomerang**: receiver + systemd unit (`github-webhook.service`), poller
  cron (`/etc/cron.d/boomerang-conductor`), event scripts, env templates.
- **continuation**: paseo + boomerang digest/context/mark scripts + the job
  definition template (the job itself is merged into a lane's `jobs.json`
  with `install/add-continuation-job.py`, a deliberate separate step).
- **hub**: digest script + delivery rules.
- **pi-dispatch**: canonical spool + dispatcher + per-lane surfaces + skills +
  host cron (delegates to `pi-dispatch/install.sh`).

Runbook: **[REBUILD.md](REBUILD.md)**.

## Environment variables (all templated — set on the host, never commit)

| Variable | Meaning | Set by |
|---|---|---|
| `BOOMERANG_ROOT` | boomerang install root | installer default `/srv/hermes/data/boomerang` |
| `BOOMERANG_SECRET_FILE` | GitHub webhook HMAC secret file | operator (0600 root) |
| `BOOMERANG_EVENTS` | bus JSONL path (default inside `BOOMERANG_ROOT`) | installer default |
| `BOOMERANG_EMIT` | emit.py path (also the poller's) | installer |
| `CONDUCTOR_ENV_LOADER` / `CONDUCTOR_API_KEY` | Conductor cloud API key loader | operator (template `boomerang/load_conductor_env.sh.example`) |
| `CONDUCTOR_STATE` | poller state file | installer |
| `SCRIPTS_DIR` | DEV profile scripts dir | installer default `/srv/hermes/data/profiles/dev/scripts` |
| `STATE_DIR` | processed-set state dir (`paseo-completions-processed.txt`, `boomerang-events-processed.txt`, `.hub-digest-hash`) | installer |
| `HUB_CHAT` / `HUB_THREAD` | Jarvis hub group / topic for the fleet board | operator |
| `JARVIS_ENV` | Jarvis data root `.env` holding `TELEGRAM_BOT_TOKEN` | Jarvis bot install |
| `HUB_DIGEST_STATE` | matching game hash file for the change-gate | installer |
| `PI_SPOOL` | pi-dispatch spool root (`/srv/hermes/data/pi-requests`) | `pi-dispatch/lanes.json` |
| `HERMES_AGENT_CHAT_RELAY*` | lane↔lane relay env (v2 protocol, see relay doc) | lane config |

Override any installer path by exporting it first. None of these are
credentials committed to the repo — the only secrets live on the host at the
paths above.

## Operate (runbook)

Quick-take operations for each flow:

- **Bus/health**: `tail -50 /srv/hermes/data/boomerang/github-webhook.log`;
  `wc -l /srv/hermes/data/boomerang/events.jsonl`; since the bus is
  append-only you can count/digest without locking.
- **Poller**: `tail -5 /srv/hermes/data/boomerang/conductor-poller.log`;
  cat `/srv/hermes/data/boomerang/conductor-state.json`.
- **Continuation**: the DEV cron "Jericho OS — continuation engine" reports
  one line per pass; pending items via
  `python3 <SCRIPTS_DIR>/boomerang-pending-completions.py`.
- **Pi-dispatch**: `tail -50 /srv/hermes/data/pi-requests/_system/dispatch.log`;
  state `/srv/hermes/data/pi-requests/_system/state.json`; run once
  `python3 <spool>/_system/dispatch.py` (add `--dry-run` to change nothing).
- **Hub digest**: run `python3 <SCRIPTS_DIR>/hub-fleet-digest.py` — silent =
  board unchanged; `hub post OK` = posted; the token fallback line = token
  missing.
- **Tests**: `python3 boomerang/smoke_test.py`,
  `python3 continuation/smoke_test.py`, `bash pi-dispatch/test_cap.sh`,
  `bash pi-dispatch/test_dispatch.sh`.

## Relationship to existing pi machinery

- Reuses DEV's proven `pi-subordinate-agent` route (hyperfusion Pi provider,
  high thinking) and the answer-back discipline generalized for any lane
  (`pi-dispatch/README.md` §"Relationship to existing pi machinery").
- The `hermes` repo keeps the fleet chassis; `ops/jericho-os/pi-dispatch/`
  there is the same module as this copy (PR #279). This repo is the canonical
  home — hermes may point at it, not fork it.
