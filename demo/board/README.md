# demo/board — the self-running board (maestro-mode slice)

**Repo-only demo. Nothing here touches the fleet runtime: no systemd, no docker,
no crons, no sockets. Pure stdlib Python + JSON.**

This is the one night-slice that proves the "self-running board" core of the
maestro vision: **dispatch a job -> the board runs it -> auto-archive -> one-line
report**. The middleman (manual status updates, manual archiving, manual
reporting) is the thing being automated — that is the whole point, per
[PLAN-FLEET-CONTEXT-REMEDIATION.md](../../PLAN-FLEET-CONTEXT-REMEDIATION.md):
the fleet's problem was never the models, it was the forgotten plumbing between
them.

The board's lifecycle mirrors the architecture's authority loop
([ARCHITECTURE.md](../../ARCHITECTURE.md)) in the smallest honest form:

```
queued ──claim──▶ running ──exit 0──▶ done ──▶ archive ──▶ report
                     │                └─▶ failed ──▶ archive ──▶ report
                     ├─ lease expires (daemon died) ──▶ queued (recovered)
                     └─ live lease held by another run ──▶ skipped
```

A **board** is one JSON file of jobs. The **daemon** (`board.py run`) reads it,
drives each job through the state machine, writes status back to the file at
every transition, auto-archives terminal jobs, appends an audit line to
`journal.log`, and prints one line per finished job plus a persisted report.

## Files

| Path | What it is |
|---|---|
| `board.py` | The whole slice: daemon + CLI + built-in self-tests (stdlib only) |
| `examples/hello-fleet.json` | A hand-authored, committed board you can run |
| `sample-output/` | A real run's output, committed so you can read it without running |
| `tmp/` (gitignored) | Where the runbook puts scratch boards and generated output |

## Run it (3 lines)

```bash
python3 demo/board/board.py seed   demo/board/tmp/live-board.json
python3 demo/board/board.py run    demo/board/tmp/live-board.json
python3 demo/board/board.py report demo/board/tmp/live-board.json
```

Or verify the slice itself (no network, no keys, runs in ~0.5s):

```bash
python3 demo/board/board.py test
```

And the three extra read-eyes commands:

```bash
python3 demo/board/board.py view    demo/board/tmp/live-board.json   # open work
python3 demo/board/board.py archive demo/board/tmp/live-board.json   # lane-done, manual
python3 demo/board/board.py report --json demo/board/tmp/live-board.json  # machine-readable
```

Run the committed example directly (it writes its output under
`examples/archive|reports|artifacts|journal.log`, which are gitignored):

```bash
python3 demo/board/board.py run demo/board/examples/hello-fleet.json
```

## The loop, mapped to the maestro vision

| Vision step | This slice |
|---|---|
| **dispatch** | `seed` (or any script that writes board JSON) — the stand-in for the future plan→board dispatcher |
| **run** | real `subprocess` execution of each job's `argv`; status written to the board file at every transition |
| **lane-done** | a job leaving `queued` and landing in `done`/`failed` |
| **auto-archive** | `run` moves terminal jobs out of the open board into `archive/<board>/<id>.json`, automatically |
| **report** | one line per finished job + a persisted dated report under `reports/` |

## What's honest about it (read before you demo it as anything real)

- **No fake wrappers.** Every job runs as a real subprocess on this machine.
  `argv` is an explicit command list. There is no implicit shell — if you want a
  pipeline, spell it: `["bash","-c","..."]`.
- **Real restart recovery.** If a daemon dies mid-job (simulate: Ctrl-C between
  passes), the job stays `running` with an expired lease and the next `run`
  recovers it to `queued` and completes it — the board on disk is the truth,
  memory is not. This is the fleet's restart-amnesia lesson
  (PLAN-FLEET-CONTEXT-REMEDIATION.md §"Session dump on restart") in 15 lines.
- **Evidence, not just status.** Full stdout/stderr of each run goes to an
  artifact file under `artifacts/<run-id>/` (the fleet stores evidence, not just
  queue state — ARCHITECTURE.md §Execute); the board record keeps only a tail.
- **Atomic writes.** The board file is written via tmp+rename, so a crash mid-write
  cannot tear the only state. Cheap and correct for a single daemon.

## What this demo deliberately does NOT do (the next-slice list)

| Limitation | Why | Where it lives next |
|---|---|---|
| No double-run guard across two live daemons | leases recover stale claims but don't prevent a race | an `O_EXCL` claim file / real lock |
| No retries / backoff | `failed` is terminal here | add `max_retries` + requeue |
| No dependency graph | jobs run in file order | a `depends_on` pass |
| No Approve gate | dispatch is manual (`seed`) | the explicit Approve-before-run step |
| No cost / runtime ceilings | ARCHITECTURE wants them | a `budget_ms` field |
| No lane routing | the board doesn't know who should run a job | a `lane` field + per-lane executor |

**The recommended next slice** is the one the board currently leaves to a human:
**"plan -> dispatch"** — a small `planner.py` that turns a mission plan JSON
(intent, acceptance, capability, lane) into board jobs with an explicit
`approve` gate before `run`, mirroring ARCHITECTURE.md §Plan/Approve-Once. That
closes the loop at the front so the board is self-running from end to end rather
than from the middle.

## Tidy up

The repo change is fully contained in `demo/board/`. Remove the folder (and the
`demo/` row you may have added to `INDEX.md`) and nothing else changes.

## Sample output

`sample-output/` holds a real run of this exact seed, committed. Read
`sample-output/README` first — the run's own `report.txt` and `journal.log` show
the exact shape the loop produces.
