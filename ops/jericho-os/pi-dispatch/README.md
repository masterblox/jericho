# pi-dispatch — "Pi for every agent"

Engineering help on demand for the whole fleet. Every lane (jericho,
pa/angela, donald, iris, dev, and future lanes) can hand an engineering-heavy
task to a disposable Pi worker and get the finished result back in its own
answers folder — no relaying through Carlos, no lane leaving its lane.

This is one module of **Jericho OS**. It ships here so ops can install and
audit it; its runtime lives in the shared spool on this host.

## Architecture

```
 lane (jericho/pa/donald/iris/dev)          host side (one dispatcher)
  ──────────────────────────────            ───────────────────────────────
  pi-dispatch/request.py "<task>"           /srv/hermes/data/pi-requests/
      │ writes <id>.json                        _system/dispatch.py  (cron, 2 min)
      ▼                                          │ ingest -> <lane>/inbox/<id>.json
  <lane-home>/pi-dispatch/requests/             │ fire  -> paseo agent run
      │                                          │          --cwd <spool>/<lane>/work/<id>
      (host cron picks it up)                    │          --title pi-dispatch:<lane>:<id>
                                                 │          --label requester=<lane>
                                                 │          (max 5 concurrent tabs)
                                                 │ poll  -> status FIN?
                                                 └─ deliver once ->
               <lane-home>/pi-dispatch/answers/<id>.md
               <spool>/<lane>/answers/<id>.md
```

- **Requests** are files a lane writes in its OWN home (least power). It never
  talks to Paseo or runs host commands.
- **Labels come from `--cwd`** — every tab runs in
  `<spool>/<lane>/work/<id>/`, so the tab is durably labeled with the
  requesting lane even before `--label` survives.
- **The tab writes its answer** to `ANSWER.md` in its cwd (prompt-mandated,
  sentinel `PI_DISPATCH_DONE`); the dispatcher reads it, with a Paseo-log
  fallback.
- **Exactly once**: `delivered_at` is stamped in state.json; a finished
  request is never redelivered by a later cron run.
- **No fire-and-forget**: every request ends `done`, `stale` (~6h) or
  `failed`, with a durable row in state.json.
- **No chat**: the dispatcher never messages anyone. Automation lines live in
  state + `_system/dispatch.log`.
- **No secrets**: request files are sniffed; suspicious ones are quarantined
  under `_system/_quarantine/` and never fired.
- **Sandbox**: tabs only get their spool cwd; `/repos` is read-only.

## Files

| File | Purpose |
|---|---|
| `lanes.json` | lane registry (home, display, mirror, remote); spool + tuning |
| `dispatch.py` | the ONE host dispatcher (the only thing that fires tabs) |
| `request.py` | per-lane request helper (copied into each lane's home) |
| `skill/SKILL.md` | the lane skill: how to request, guardrails |
| `install.sh` | idempotent file-level installer (see below) |

## Install (idempotent, additive)

From the repo root (or the spool copy):

```sh
bash ops/jericho-os/pi-dispatch/install.sh
```

It ONLY: creates the spool, copies files, writes `/etc/cron.d/pi-dispatch`,
installs a skill into each lane's skills tree, and gives each lane a
`pi-dispatch/` surface. It does NOT touch any agent config/routing/memory and
does NOT restart any lane, container or service. Backups are taken before any
existing file is overwritten.

## Operate

- Status/logs: `tail -50 /srv/hermes/data/pi-requests/_system/dispatch.log`
- State: `/srv/hermes/data/pi-requests/_system/state.json`
- Run once manually: `python3 /srv/hermes/data/pi-requests/_system/dispatch.py`
  (add `--poll-only` to only poll/deliver, `--dry-run` to change nothing)
- Answers, canonical: `/srv/hermes/data/pi-requests/<lane>/answers/<id>.md`
- Answers, lane surface: `<lane-home>/pi-dispatch/answers/<id>.md`
- Quarantined requests (secret-like / malformed):
  `/srv/hermes/data/pi-requests/_system/_quarantine/`

### Adding a future lane
1. Give it a `pi-dispatch/` surface + skill in its own data root (copy from
   any existing lane, or re-run `install.sh` after adding it to `lanes.json`).
2. Add it to `lanes.json` (`home` = its data root). The dispatcher and cron
   need no other change.

### Remote lanes (buzz, paperclip)
They have no data root on this host. The spool dirs exist so requests can be
dropped, but the full loop needs the same dispatcher files on their own host.
Documented as a gap — see the install report.

## Recovery

- **Dispatcher dead** → reinstall cron: run `install.sh`; or manually
  `python3 <spool>/_system/dispatch.py`.
- **Paseo daemon down** → `paseo daemon start` (host); dispatcher logs will
  show fire failures and retry up to 3 times, then mark the request `failed`.
- **Answer missing for >6h** → the request is marked `stale`; re-request.
- **Everything must move to a new VPS** → copy `/srv/hermes/data/pi-requests`
  to the new box, re-run `install.sh` there, and keep `lanes.json` pointing at
  the lane data roots on that box.

## Relationship to existing pi machinery

- Reuses the proven route from DEV's `pi-subordinate-agent` skill
  (hyperfusion provider `pi/hyperfusion/deepseek-ai/DeepSeek-V4-Flash-0731`,
  high thinking) and the answer-back discipline (state stamps, ~6h stale)
  from `pi-answer-fast.py`, generalized so ANY lane can dispatch without its
  own 20-line answer-back script.

- Belongs in `ops/jericho-os/` because it is fleet orchestration on the same
  footing as boomerang/continuation: one host-side watcher turning a file
  event into a finished Paseo tab. It does NOT write to the boomerang bus so
  the two stay independent.
