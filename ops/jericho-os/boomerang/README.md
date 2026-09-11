# Boomerang — the inbound bus

Boomerang is the **inbound event transport** of Jericho OS. It turns external
signals — GitHub webhooks, Conductor cloud workspace state — into one durable,
append-only JSONL event bus that the continuation engine (or any lane) can
consume.

```
external                                     host (root, /srv/hermes/data/boomerang/)
────────                                     ──────────────────────────────────────
 GitHub webhook ──> Caddy ──> 127.0.0.1:9124 ──> github-webhook.py ─┐
                                                                     ├─> emit.py ─> events.jsonl
 Conductor API ──> conductor-poller.py (cron */3) ──────────────────┘
```

## Files (this directory)

| File | Role | Live install |
|---|---|---|
| `github-webhook.py` | HTTP receiver, HMAC-verified, POST-only | `/srv/hermes/data/boomerang/github-webhook.py` |
| `emit.py` | **THE only sanctioned append path** to the bus | `/srv/hermes/data/boomerang/emit.py` |
| `conductor-poller.py` | cloud workspace state poller (root cron */3) | `/srv/hermes/data/boomerang/conductor-poller.py` |
| `boomerang-finished-digest.py` | tier-1 MONITOR (changes wake continuation) | `profiles/dev/scripts/` |
| `boomerang-pending-completions.py` | tier-1 CONTEXT (unprocessed bus events) | `profiles/dev/scripts/` |
| `boomerang-mark-event.py` | mark a bus event processed | `profiles/dev/scripts/` |
| `github-webhook.service` | systemd unit template (receiver) | `/etc/systemd/system/github-webhook.service` |
| `load_conductor_env.sh.example` | **template only** — the real env loader is host-only, never committed | `/srv/hermes/data/scripts/load_conductor_env.sh` |
| `caddy-route.md` | webhook routing + GitHub registration runbook | — |

## Bus format (state conventions)

One JSON object per line in `/srv/hermes/data/boomerang/events.jsonl`.
`emit.py` enforces the exact key set and fixed order on disk:

```
id, at, source, event, title, url, details, processed
```

- `source` is a frozen enum: `github | conductor | linear | paseo`.
- `processed` starts `false`. Consumers (the continuation engine) mark an
  event handled by appending its `id` to
  `/opt/data/profiles/dev/state/boomerang-events-processed.txt`
  (`boomerang-mark-event.py`). Nothing rewrites the JSONL in place — the
  bus is append-only, the processed-set is the cursor.
- Concurrent emitters (webhook thread + cron poller) are safe: `emit.py`
  appends under an exclusive `flock` + `fsync`.

## Receiver normalizations (frozen — do not silently extend)

| GitHub event | Boomerang event | Notes |
|---|---|---|
| `pull_request` closed & merged | `pr_merged` | title "PR #N merged: …" |
| `pull_request` closed & unmerged | `pr_closed_unmerged` | |
| `workflow_run` completed | `ci_completed` | carries `conclusion`, PR# if present |
| push to default branch | `push_main` | |
| anything else | *(silent)* | acked 200, nothing emitted |

Every unverified or unparseable POST is acked 200 (never retries into the
bus); bad signatures get 401 and a log line.

## Conductor poller conventions

- Every 3 min (root cron `/etc/cron.d/boomerang-conductor`).
- **First run with no state = baseline snapshot, no events.** After that, a
  workspace `state` change emits `workspace_state` (`"<name>: <old>-><new>"`).
- Silent (no output, no events) when nothing changed — keeps the
  change-gated continuation engine quiet.
- State is persisted atomically to `conductor-state.json` (tmp + fsync +
  rename).
- The API key is read at runtime from `load_conductor_env.sh`
  (`CONDUCTOR_API_KEY`); Conductor requires a curl-like User-Agent.

## Continuation link

The continuation engine watches this bus: `boomerang-finished-digest.py`
(monitor) wakes the cron, `boomerang-pending-completions.py` (context) hands
the unprocessed events to it, and `boomerang-mark-event.py` records what it
handled. See `../continuation/README.md`.

## Tests

`python3 boomerang/smoke_test.py` — offline smoke: emit validation, receiver
HMAC + normalizations, poller baseline + state-change, using temp files and a
fixtures dir. Never touches the live bus, live secret, or live service.
