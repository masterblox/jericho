# Maestro — how the fleet runs 24/7

**Owner:** Carlos / Jericho Core — live board truth: `/srv/hermes/data/kanban.db`

This is the operating manual for the **maestro board loop** promoted from
`demo/board/` into a real fleet service. The fleet runs on one durable loop:

```
dispatch -> lane -> verdict -> flip -> report
```

A card is dispatched, a lane runs it, an **independent** verdict comes back
with evidence, the card is flipped to `done`/`blocked` in the board, and the
flip is reported (one line, plain English, change-gated). The middleman this
loop removes is the same one `PLAN-FLEET-CONTEXT-REMEDIATION.md` identified as
the fleet's real problem: *manual status updates, manual archiving, manual
reporting*.

## Repo: the two halves

The loop is implemented twice-compatible (repo owns the durable logic; the
running fleet glue feeds it the same envelopes):

| Half | Where | What it does |
|---|---|---|
| Durable board service | `ops/maestro/board.py` | Reads `kanban.db`, flips done cards **with evidence**, auto-dispatches open cards, writes **lane-done triggers**, reports. stdlib-only; self-tests via `python3 ops/maestro/board.py test`. |
| Hub command-plane hooks | `apps/jericho/bridge/src/hub/*` | `dispatch` / `verify` / `archive` (+ `ack`) as first-class hub commands on the #21 Hub backend — the in-memory, receipt-bound operator surface. |
| Comms | `docs/maestro/relay-comms-v2.md` | All inter-agent messages route through the agent-chat relay; v2 event protocol documented there. |
| Canonical board doctrine | `fleet-status-board` skill | How the human-facing board/digest is formatted (one message, hot-first, plain English). |

The Hub hooks and the board share the same lifecycle vocabulary:

| Hook | Hub receipt transition | Durable board effect |
|---|---|---|
| `dispatch` | planned/approved → `dispatched` | `ops/maestro/board.py dispatch --card <id>` claims a `running` run + writes a `dispatched` trigger |
| `verify` | dispatched → `verified` or `failed` (verdict + evidence) | `ops/maestro/board.py verify --card <id> --status done|blocked --evidence ...` flips the card + writes a `lane-done` trigger |
| `archive` | verified/failed → `archived` | `ops/maestro/board.py archive --card <id>` closes the finished card |
| `ack` (alerts) | alert → acknowledged | consumed by fleet watchdogs / hub digest |

## The loop, step by step

### 1. Dispatch
Open cards (`status = 'new'`) are auto-dispatched by `board.py run` (one pass,
or `--interval N` for watch/daemon mode):

- The board creates a `task_runs` row (`status='running'`, claim
  `maestro-dispatch:<id>`, `claim_expires = now + lease`) — the card is now
  claimed and visible to the lane executor.
- A `task_events` row `kind='dispatched'` records the trigger.
- Dispatch is **bounded**: a card that is recovered/released more than
  `--max-attempts` (default 3) times **parks** instead of spinning forever. A
  card is only dispatched while `status='new'`; live leases are never touched
  and terminal cards are never re-dispatched.
- Lifecycle of the claim: if the lane silently dies, the lease expires and the
  next pass recovers it (`running -> released`), then re-dispatches. The board
  never trusts memory — **idle is re-triggered, never assumed** (doctrine 6).

### 2. Lane
The lane is the fleet worker (a paseo Pi lane or a kanban-kernel worker). It
takes the claim, does the work, and writes its outcome into the SAME
`task_runs` row (`status=done|blocked|...`, `outcome`, `summary`/`error`,
`ended_at`). The maestro board does **not** execute the lane — it leases the
kernel. Tier policy (BLUEPRINT-MAESTRO §6.1): default Pi fast (T1);
escalations and conductor-cloud (T4) always require Carlos's explicit
confirmation (premium-delegation prohibition, AGENTS.md).

### 3. Verdict
`lane.done` is the universal "the worker finished, judge it" signal. The board
(and the Hub `verify` hook) require an **independent verdict with evidence** —
a bare worker claim is never trusted:

- Success (`run.status=done` / `outcome=completed`) → the card's `result`
  column is bound from the lane's `summary` (git sha, artifact path, report
  line).
- Failure (`blocked|crashed|timed_out|failed|gave_up`) → the card goes
  `blocked` and the failure text lands in `last_failure_error`.
- Every verdict is written as a `task_events` row `kind='lane-done'` with the
  evidence payload, plus a dated comment on the card.

### 4. Flip
The board's `flip_terminal_cards` moves the open card to `done` (with
`completed_at`) or `blocked` — the durable kanban status mirrors the kernel's
1:1 status map.

### 5. Report
`ops/maestro/board.py report` (human or `--json`) prints the board counts and
the recent `dispatch`/`lane-done` triggers. When wired live, fleet reporting
goes to the Jarvis hub (`-1003940809134`, thread 4) as **one change-gated
digest** in the canonical board format (`fleet-status-board` skill): one
message, hot-first, plain English, only when something changed (no-op silence).

## Night sweep

A scheduled `--interval` pass runs the same loop unattended (BLUEPRINT-MAESTRO
§5.6 digest loop at 08:00/21:00, and the per-card watch loop on the board):

1. **Recover** — any card whose lane died with an expired lease is recovered
   and re-dispatched; nothing is lost to restart amnesia (the board on disk is
   the truth, memory is not).
2. **Flip** — accumulated lane-done verdicts from overnight lanes are flipped
   to `done`/`blocked` with evidence.
3. **Dispatch** — cards that appeared during the day are claimed and handed to
   lanes.
4. **Report** — a change-gated digest summarizes only what actually changed:
   `done:` / `dispatched:` / `needs you:` lines, `$cost today`, and the
   interactive `[y] run <tier> <title>` confirm surface for anything that
   needs Carlos. Silent when nothing changed.

Budget gates from `maestro-policy.json` (tier/daily/weekly caps) and the
circuit breaker stay the hard ceilings: an over-budget or `consecutive_failures`
over-limit card is **parked with a reason and surfaced once**, never
silently re-run.

## The paseo-100% rule

> **Every dispatched paseo lane returns a verdict — 100% of dispatched work
> answers back, and nothing is counted done without one.**

The fleet's single most expensive failure mode is a lane that goes quiet and
is then *assumed* done (or silently forgotten). The paseo-100% rule is the
contract that eliminates that entire class:

1. **No silent lanes.** A lane that finishes or dies always leaves an
   answer-back: a terminal `task_runs` row with `outcome` + `summary`/`error`,
   a `lane-done` trigger, or a `lane.error` envelope. Silence is never read as
   success.
2. **Idle is not done.** An idle lane is a dead signal, not a completed task.
   The board recovers expired leases and **re-dispatches** — it never trusts
   "nothing happened" as "it worked".
3. **100% means verification, not claims.** Every flip to `done` requires
   **evidence** bound into the card (`result`/`summary`). A worker's own
   success claim is not a verdict — the maestro verifier is independent of the
   lane that worked (BLUEPRINT-MAESTRO §5.3).
4. **The 100% is bounded, not open-ended.** A card that cannot produce a
   verdict after `--max-attempts`/circuit limits **parks as needs-human with a
   reason** — it does not spin, and it is never silently counted done or
   dropped. Every parked card is surfaced once in the digest.
5. **The digest only counts verified flips.** `report`/digest lines for
   `done` come exclusively from evidence-backed `lane-done` flips, never from
   claimed-but-unverified lanes.

## Getting started (repo, no fleet writes)

The board service is safe to exercise against a **scratch** DB (tests do this
automatically; the live board is never written by `test`):

```bash
# 1. self-tests (stdlib only, scratch DB)
python3 ops/maestro/board.py test

# 2. inspect your current board without writing
python3 ops/maestro/board.py --db /path/to/kanban.db view
python3 ops/maestro/board.py --db /path/to/kanban.db report --json

# 3. one real self-run pass (recover -> flip -> dispatch)
python3 ops/maestro/board.py --db /path/to/kanban.db run

# 4. watch / night-sweep mode
python3 ops/maestro/board.py --db /path/to/kanban.db run --interval 60
```

Hub hooks (TypeScript) are exercised by `apps/jericho/bridge/tests/hub-dispatch-hooks.test.ts`
(`pnpm --filter bridge test`). Kubernetes/macOS-only bridge tests (e.g.
`keychain`) cannot run on a Linux VPS and are unrelated to the maestro loop.

## Related blueprints

- `ops/maestro/board.py` — the durable board service (this manual's §1 half).
- `docs/maestro/relay-comms-v2.md` — the agent-chat relay v2 event protocol
  (all inter-agent messages route through it; the conductor-bridge outbox is
  dead).
- Blueprints: `/srv/hermes/data/pi-runs/jericho-ig/BLUEPRINT-CORE.md` (the
  brain), `BLUEPRINT-MAESTRO.md` (the automation layer this manual operates),
  `RECON.md` (state + gap map).
- Living doctrine: repository `AGENTS.md` premiums-delegation rule + the
  `fleet-status-board` skill (canonical human board format).
