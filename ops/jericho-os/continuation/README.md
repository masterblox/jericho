# Continuation engine — the tier-1 trigger

The continuation engine is DEV's **tier-1 CI/CD continuation module**: the
cron job that wakes whenever a paseo agent finished or a new boomerang bus
event arrived, and decides what to keep going (merge-on-green, dispatch the
next step, diagnose a failure, mark-nothing).

```
monitor (change-gated)             context (what changed)          action
──────────────────────             ───────────────────────         ──────
paseo-finished-digest.py  ──>  paseo-pending-completions.py ──>    continuation
boomerang-finished-digest.py ─>  boomerang-pending-completions.py ─> job (DEV cron)
                                                                      marks paseo/bus
```

## Files (this directory)

| File | Role | Live install |
|---|---|---|
| `paseo-finished-digest.py` | paseo-only MONITOR: finished agents, deterministic | `profiles/dev/scripts/` |
| `paseo-pending-completions.py` | paseo-only CONTEXT: finished-but-unprocessed agents | `profiles/dev/scripts/` |
| `paseo-mark-processed.py` | record a paseo agent as handled | `profiles/dev/scripts/` |
| `continuation-job.json` | the DEV cron job definition (`jobs.json` entry, templated) | merged into `profiles/<lane>/cron/jobs.json` |

The boomerang bus monitor/context/mark trio lives in
`../boomerang/` (they also feed this engine — the live continuation job's
`script` is `boomerang-pending-completions.py` with monitor
`boomerang-finished-digest.py`, which covers bus **and** paseo in one pass).
The `paseo-*` scripts here are the paseo-only forms (a second, independent
monitor/context pair kept for setups that don't need the bus).

## The processed-set cursor

Completion state is a plain "handled ids" file, never a rewrite of live
state:

- Paseo: `/opt/data/profiles/dev/state/paseo-completions-processed.txt`
  — one paseo `shortId` per line, appended by `paseo-mark-processed.py`.
- Bus: `/opt/data/profiles/dev/state/boomerang-events-processed.txt`
  — one event `id` per line, appended by `boomerang-mark-event.py`
  (in `../boomerang/`).

"Unprocessed" = finished agent / bus event whose id is **not** in the set.
Both context scripts are deterministic diff builders against these sets, so a
second run without changes prints identical output → the change gate stays
quiet.

## Continuation rules (from the live job prompt)

- **Judge claims vs receipts**: no artifact (HTTP 200, merged SHA, test pass,
  file path) = UNVERIFIED. Never take a bare claim.
- **Continue, don't summarize**: green PR → merge-on-green (repo-bound gate
  first); verified next step → dispatch it now; failed → diagnose and
  re-dispatch ONE corrected attempt or escalate in the one-liner.
- **Known NOOPs**: test/smoke build events; `shortId 9bfbb182` (Michael-AI
  gate-ping handles it); Carlos's personal test tabs; children of a still-
  running parent.
- **Constraints**: DEV lane only; never restart other lanes; no fleet-wide
  docker/compose lifecycle; never touch other agents' profiles. Final reply
  is exactly one short plain-English line (or `NOOP`).

## Installing the job

The installer (`install/install-continuation.sh`) installs the three scripts
and provides `continuation-job.json`. Merging it into a live
`profiles/<lane>/cron/jobs.json` is a **separate, guarded step** (the cron
system owns that file): the job template sets `%SCRIPTS_DIR%` to the DEV
profile scripts dir; the helper only merges backup-first and never runs the
job. See `REBUILD.md` for the full sequence.

## Tests

`python3 continuation/smoke_test.py` — offline smoke: paseo digest/context/
mark against a fixture JSON + temp processed-set, plus the hub change-gate
(hash) behaviour. Never touches live fleet state.
