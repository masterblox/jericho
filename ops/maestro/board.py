#!/usr/bin/env python3
"""
board.py — JERICHO OS: self-running maestro board over the fleet kanban kernel.

This is the promotion of the demo slice (demo/board/board.py) into a real
service. The demo drove a JSON board file with subprocess "jobs"; this board
owns the SAME loop shape but reads and writes the fleet's durable kernel
(kanban.db, the live board at /srv/hermes/data/kanban.db):

    dispatch -> (lane runs the card) -> lane-done verdict -> flip -> report

The "lane" is the fleet worker that executes the card (a paseo Pi lane or a
kanban-kernel worker). This board's job is deliberately the middle plumbing —
read the kernel's truth, flip done cards with evidence, auto-dispatch open
cards, write lane-done triggers, and report. It does NOT reimplement the
kernel's claim locks, heartbeats, circuit breaker, or goal mode; it leases
them (RECON G4 / BLUEPRINT-MAESTRO §6.4).

Data model
----------
A *card* = one row in `tasks` (stored statuses: new | done | blocked |
archived — plus the kernel's `running` when a Hermes dispatcher claims a
card directly via `claim_task`).
A *run*  = one row in `task_runs` (the lane's attempt ledger; the kernel's
per-attempt record: running | done | blocked | crashed | timed_out | failed |
released, with an `outcome` and `summary`/`error`).

In-flight visibility (reader convention — board-inprogress)
----------------------------------------------------------
A card a lane is actively working keeps its STORED status (usually `new`)
while its run is `running` — so a naive status read makes busy work look
idle. Readers must therefore map a card to **in_progress** while:
  1. it has a live `running` run (`task_runs.status='running'`, `ended_at`
     NULL, claim not expired) — the maestro ``dispatch_card`` path, or
  2. its card status is `running` — the kernel ``claim_task`` path, or
  3. its kernel claim markers are set (`current_run_id` + `started_at` +
     `claim_lock` all non-NULL and the pointed-to run is live).
This is a pure READ mapping: stored statuses are never rewritten to fake
in-flight. ``board.py view`` and the fleet dashboard apply it.
A *trigger* = one row in `task_events` (audit trail: dispatched, lane-done,
released, archived, ...). Every state change this board makes is recorded as
an event row, so the board is fully auditable from the kernel it reads.

Self-run loop (`run`, one pass)
------------------------------
  1. recover   — stale `running` runs with expired claims -> `released`
                 (restart-amnesia guard; the board never trusts memory)
  2. flip      — open cards whose lane finished -> card `done` (with
                 evidence bound into `result`) or `blocked` (with the failure
                 reason), plus a **lane-done** trigger event
  3. dispatch  — `new` cards with no lane at work get a claimed `running`
                 run + a **dispatched** trigger (handed to the fleet lane)

Everything is idempotent: a settled board re-runs as a no-op, and a live
lease is never touched (no double-dispatch).

Standalone hooks (used by the Hub command plane hooks, see
docs/maestro/README.md):
  board.py dispatch --card <id>   # auto-dispatch one open card
  board.py verify   --card <id> --status done|blocked --evidence <text>
                                  # write a lane-done trigger + flip a card
  board.py archive  --card <id>   # move a terminal card to archived

Runbook:
  python3 ops/maestro/board.py run               # one self-run pass
  python3 ops/maestro/board.py run --interval 30 # daemon (watch) mode
  python3 ops/maestro/board.py view              # open cards + lane state
  python3 ops/maestro/board.py report            # flip summary, human/JSON
  python3 ops/maestro/board.py test              # built-in self-tests

The default DB is the live board; override with --db or $KANBAN_DB (tests use
a scratch DB, never the live board).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import time
import unittest
import uuid
from datetime import datetime, timezone
from pathlib import Path

BOARD_NAME = "maestro"
DEFAULT_DB = "/srv/hermes/data/kanban.db"
LEASE_SECONDS_DEFAULT = 3600          # a dispatched run holds its claim this long
MAX_DISPATCH_ATTEMPTS_DEFAULT = 3     # releases before a card waits for a human
DEFAULT_INTERVAL = 0.0                # 0 = one pass; >0 = daemon loop
CARD_OPEN = {"new"}
CARD_TERMINAL = {"done", "blocked", "archived"}
RUN_LIVE = {"running"}
RUN_TERMINAL_SUCCESS = {"done"}
RUN_TERMINAL_FAILED = {"blocked", "crashed", "timed_out", "failed", "gave_up"}
RUN_TERMINAL = RUN_TERMINAL_SUCCESS | RUN_TERMINAL_FAILED


# --------------------------------------------------------------------------
# A faithful subset of the fleet kanban kernel schema (for scratch boards).
# The real /srv/hermes/data/kanban.db has extra columns; the board only reads
# and writes the columns below, so it works on both without migration.
# --------------------------------------------------------------------------

KANBAN_SCHEMA_SUBSET = """
CREATE TABLE tasks (
    id                   TEXT PRIMARY KEY,
    title                TEXT NOT NULL,
    body                 TEXT,
    assignee             TEXT,
    status               TEXT NOT NULL,
    priority             INTEGER DEFAULT 0,
    created_at           INTEGER NOT NULL,
    started_at           INTEGER,
    completed_at         INTEGER,
    workspace_kind       TEXT NOT NULL DEFAULT 'scratch',
    tenant               TEXT,
    result               TEXT,
    idempotency_key      TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    last_failure_error   TEXT,
    max_runtime_seconds  INTEGER
);
CREATE TABLE task_runs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id             TEXT NOT NULL,
    profile             TEXT,
    step_key            TEXT,
    status              TEXT NOT NULL,
    claim_lock          TEXT,
    claim_expires       INTEGER,
    worker_pid          INTEGER,
    max_runtime_seconds INTEGER,
    last_heartbeat_at   INTEGER,
    started_at          INTEGER NOT NULL,
    ended_at            INTEGER,
    outcome             TEXT,
    summary             TEXT,
    metadata            TEXT,
    error               TEXT
);
CREATE TABLE task_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    TEXT NOT NULL,
    run_id     INTEGER,
    kind       TEXT NOT NULL,
    payload    TEXT,
    created_at INTEGER NOT NULL
);
CREATE TABLE task_comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    TEXT NOT NULL,
    author     TEXT NOT NULL,
    body       TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_runs_task   ON task_runs(task_id, started_at);
CREATE INDEX idx_events_task ON task_events(task_id, created_at);
CREATE INDEX idx_comments_task ON task_comments(task_id, created_at);
"""


def now_epoch() -> int:
    return int(time.time())


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def connect(db_path: str) -> sqlite3.Connection:
    """Open the board DB. row_factory = dict-like rows for readable code."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = OFF")
    return conn


# --------------------------------------------------------------------------
# Reads
# --------------------------------------------------------------------------

def open_cards(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM tasks WHERE status IN ('new', 'blocked') ORDER BY created_at"
    ).fetchall()


def display_cards(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    """Cards the READER surfaces: open (new/blocked) plus kernel in-flight
    (status 'running'), so live work is visible on the checklist.
    Display-only — write-side dispatch/flip keep operating on ``open_cards``
    (new/blocked); showing a card here never mutates it.
    """
    return conn.execute(
        "SELECT * FROM tasks WHERE status IN ('new', 'blocked', 'running')"
        " ORDER BY created_at"
    ).fetchall()


def runs_for(conn: sqlite3.Connection, task_id: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM task_runs WHERE task_id = ? ORDER BY id", (task_id,)
    ).fetchall()


def latest_run(runs: list[sqlite3.Row]):
    return runs[-1] if runs else None


def display_state(conn: sqlite3.Connection, card: sqlite3.Row) -> str:
    """Poster state for a card — READERS ONLY, never stored.

    Returns ``in_progress`` while a lane is actively at work on the card,
    else the card's stored status. See the module's "In-flight visibility"
    convention: a live ``running`` run, the kernel's card status
    ``running``, or the kernel claim markers (current_run_id + started_at +
    claim_lock set together by ``claim_task``, pointing at a live run) all
    mean the card is in flight even if its stored status says ``new``.

    ``card`` is a ``SELECT *`` row; the claim columns may be absent on
    scratch/test boards, so their presence is guarded.
    """
    if card["status"] == "running":
        return "in_progress"
    live = conn.execute(
        "SELECT 1 FROM task_runs WHERE task_id = ? AND status = 'running'"
        " AND ended_at IS NULL"
        " AND (claim_expires IS NULL OR claim_expires >= ?) LIMIT 1",
        (card["id"], now_epoch()),
    ).fetchone()
    if live is not None:
        return "in_progress"
    if ("current_run_id" in card.keys()
            and card["current_run_id"] is not None
            and card["started_at"] is not None
            and card["claim_lock"] is not None):
        # Kernel claim markers are only in-progress while the pointed-to
        # run is still live — a stale pointer after completion is not.
        pointed = conn.execute(
            "SELECT 1 FROM task_runs WHERE id = ? AND status = 'running'"
            " AND ended_at IS NULL LIMIT 1",
            (int(card["current_run_id"]),),
        ).fetchone()
        if pointed is not None:
            return "in_progress"
    return card["status"]


def event(conn: sqlite3.Connection, task_id: str, kind: str,
          run_id: int | None = None, payload: dict | None = None) -> None:
    conn.execute(
        "INSERT INTO task_events (task_id, run_id, kind, payload, created_at)"
        " VALUES (?, ?, ?, ?, ?)",
        (task_id, run_id, kind, json.dumps(payload or {}), now_epoch()),
    )


def comment(conn: sqlite3.Connection, task_id: str, author: str, body: str) -> None:
    conn.execute(
        "INSERT INTO task_comments (task_id, author, body, created_at)"
        " VALUES (?, ?, ?, ?)",
        (task_id, author, body, now_epoch()),
    )


# --------------------------------------------------------------------------
# Step 1 — recover stale claims (restart-amnesia guard)
# --------------------------------------------------------------------------

def recover_stale(conn: sqlite3.Connection) -> int:
    """A `running` run whose claim expired means its lane died silently.
    Release it (status -> released) so the card can be re-dispatched, exactly
    like the demo board's stale-lease recovery. Live leases are never touched.
    """
    recovered = 0
    rows = conn.execute(
        "SELECT * FROM task_runs WHERE status = 'running'"
        " AND claim_expires IS NOT NULL AND claim_expires < ?",
        (now_epoch(),),
    ).fetchall()
    for run in rows:
        conn.execute(
            "UPDATE task_runs SET status = 'released', outcome = 'reclaimed',"
            " ended_at = ? WHERE id = ?",
            (now_epoch(), run["id"]),
        )
        event(
            conn, run["task_id"], "released",
            run_id=run["id"],
            payload={"reason": "stale claim", "claim_expires": run["claim_expires"]},
        )
        comment(
            conn, run["task_id"], BOARD_NAME,
            f"released stale run #{run['id']} (claim expired)",
        )
        recovered += 1
    return recovered


# --------------------------------------------------------------------------
# Step 2 — flip done cards with evidence (lane-done)
# --------------------------------------------------------------------------

def _evidence(run: sqlite3.Row) -> str:
    """Prefer the lane's own summary; fall back to error text, then a bare
    receipt. Evidence is always bound so a flipped card is never evidence-less.
    """
    for field in ("summary", "error"):
        value = run[field]
        if value and str(value).strip():
            return str(value).strip()
    return (
        f"lane-done run #{run['id']} outcome={run['outcome'] or run['status']} "
        f"completed at {now_iso()}"
    )


def flip_terminal_cards(conn: sqlite3.Connection) -> dict:
    """For every OPEN card whose lane reached a terminal run, flip the card:
    done (evidence bound into `result`) or blocked (failure reason bound into
    `last_failure_error`), and write the *lane-done trigger* the fleet watches.
    Returns totals: {flipped_done, flipped_blocked, unchanged}.
    """
    totals = {"done": 0, "blocked": 0, "unchanged": 0}
    for card in open_cards(conn):
        if card["status"] not in CARD_OPEN:
            continue
        runs = runs_for(conn, card["id"])
        if not runs:
            continue
        run = latest_run(runs)
        if run["status"] in RUN_LIVE:
            continue  # lane still at work — never flip a live card
        if run["status"] not in RUN_TERMINAL:
            continue  # released/planned: nothing to flip yet

        if run["status"] in RUN_TERMINAL_SUCCESS:
            conn.execute(
                "UPDATE tasks SET status = 'done', completed_at = ?, result = ?"
                " WHERE id = ?",
                (run["ended_at"] or now_epoch(), _evidence(run), card["id"]),
            )
            totals["done"] += 1
            outcome_text = "verified"
        else:
            failure = run["error"] or run["summary"] or (
                f"run #{run['id']} ended {run['status']}"
            )
            conn.execute(
                "UPDATE tasks SET status = 'blocked', last_failure_error = ?"
                " WHERE id = ?",
                (str(failure), card["id"]),
            )
            totals["blocked"] += 1
            outcome_text = "blocked"

        # The lane-done trigger — the event streams and hub watchdogs consume.
        event(
            conn, card["id"], "lane-done", run_id=run["id"],
            payload={
                "run_id": run["id"],
                "outcome": run["outcome"] or run["status"],
                "card_status": outcome_text,
                "evidence": _evidence(run),
                "ended_at": run["ended_at"],
                "board": BOARD_NAME,
            },
        )
        comment(
            conn, card["id"], BOARD_NAME,
            f"lane-done (run #{run['id']}): card -> {outcome_text}",
        )
    return totals


# --------------------------------------------------------------------------
# Step 3 — auto-dispatch open cards
# --------------------------------------------------------------------------

def dispatch_card(
    conn: sqlite3.Connection,
    card_id: str,
    lease_seconds: int = LEASE_SECONDS_DEFAULT,
    max_attempts: int = MAX_DISPATCH_ATTEMPTS_DEFAULT,
) -> dict:
    """Hand one open `new` card to the fleet: claim a `running` run and write
    a `dispatched` trigger. Bounded by the number of prior (released/terminal)
    attempts so an impossible card parks instead of spinning forever.
    Returns a result dict: {card, action, run_id?, reason?}.
    """
    card = conn.execute("SELECT * FROM tasks WHERE id = ?", (card_id,)).fetchone()
    if card is None:
        return {"card": card_id, "action": "none", "reason": "no such card"}
    if card["status"] not in CARD_OPEN:
        return {"card": card_id, "action": "none", "reason": f"card {card['status']}"}

    runs = runs_for(conn, card_id)
    if runs and latest_run(runs)["status"] in RUN_LIVE:
        return {"card": card_id, "action": "none", "reason": "already in flight"}

    attempts = sum(1 for r in runs if r["status"] != "running")  # released/terminal
    if attempts >= max_attempts:
        return {
            "card": card_id,
            "action": "parked",
            "reason": f"max dispatch attempts ({max_attempts}) reached",
        }

    now = now_epoch()
    cur = conn.execute(
        "INSERT INTO task_runs (task_id, status, claim_lock, claim_expires,"
        " started_at) VALUES (?, 'running', ?, ?, ?)",
        (
            card_id,
            f"maestro-dispatch:{uuid.uuid4().hex[:12]}",
            now + lease_seconds,
            now,
        ),
    )
    run_id = cur.lastrowid
    event(
        conn, card_id, "dispatched", run_id=run_id,
        payload={
            "run_id": run_id,
            "dispatcher": BOARD_NAME,
            "lease_seconds": lease_seconds,
            "max_attempts": max_attempts,
            "attempt": attempts + 1,
        },
    )
    return {
        "card": card_id,
        "action": "dispatched",
        "run_id": run_id,
        "attempt": attempts + 1,
    }


def auto_dispatch(conn: sqlite3.Connection, **kwargs) -> list[dict]:
    """Auto-dispatch every open `new` card with no lane at work. Returns the
    per-card results so callers (and tests) can inspect the outcome.
    """
    results = []
    for card in open_cards(conn):
        if card["status"] != "new":
            continue
        results.append(dispatch_card(conn, card["id"], **kwargs))
    return results


# --------------------------------------------------------------------------
# Verify + archive (the Hub command-plane hooks' durable half)
# --------------------------------------------------------------------------

def verify_card(
    conn: sqlite3.Connection,
    card_id: str,
    status: str = "done",
    evidence: str | None = None,
    run_id: int | None = None,
) -> dict:
    """Manual lane-done verify (used by the Hub `verify` hook): flip a card
    with an explicit evidence string and write the lane-done trigger.
    """
    card = conn.execute("SELECT * FROM tasks WHERE id = ?", (card_id,)).fetchone()
    if card is None:
        raise SystemExit(f"no such card: {card_id}")
    if status not in ("done", "blocked"):
        raise SystemExit(f"verify status must be done|blocked, got {status!r}")
    if card["status"] == "archived":
        raise SystemExit(f"card {card_id} is already archived")
    if card["status"] == status:
        # idempotent: re-verifying an already-flipped card never re-emits a trigger
        return {"card": card_id, "status": card["status"], "card_status": status, "noop": True}
    if run_id is None:
        runs = runs_for(conn, card_id)
        run_id = runs[-1]["id"] if runs else None
    evidence = evidence or _verify_default_evidence(run_id, status)
    if status == "done":
        conn.execute(
            "UPDATE tasks SET status = 'done', completed_at = ?, result = ?"
            " WHERE id = ?",
            (now_epoch(), evidence, card_id),
        )
        card_status = "verified"
    else:
        conn.execute(
            "UPDATE tasks SET status = 'blocked', last_failure_error = ?"
            " WHERE id = ?",
            (evidence, card_id),
        )
        card_status = "blocked"
    event(
        conn, card_id, "lane-done", run_id=run_id,
        payload={
            "run_id": run_id,
            "card_status": card_status,
            "evidence": evidence,
            "board": BOARD_NAME,
            "manual": True,
        },
    )
    comment(conn, card_id, BOARD_NAME, f"verify({status}): {evidence}")
    return {"card": card_id, "status": card["status"], "card_status": status}


def _verify_default_evidence(run_id: int | None, status: str) -> str:
    if run_id is not None:
        return f"verified via hub hook (run #{run_id}) -> {status}"
    return f"verified via hub hook -> {status}"


def archive_card(conn: sqlite3.Connection, card_id: str) -> dict:
    """Move a terminal card (done/blocked) to archived so the open board stays
    clean. Never archives an open card by itself — archive is an explicit final
    closing step for finished work.
    """
    card = conn.execute("SELECT * FROM tasks WHERE id = ?", (card_id,)).fetchone()
    if card is None:
        raise SystemExit(f"no such card: {card_id}")
    if card["status"] not in CARD_TERMINAL:
        raise SystemExit(
            f"card {card_id} is {card['status']!r}; only done/blocked/archived"
            " cards can be archived"
        )
    if card["status"] == "archived":
        return {"card": card_id, "action": "noop", "reason": "already archived"}
    conn.execute("UPDATE tasks SET status = 'archived' WHERE id = ?", (card_id,))
    event(
        conn, card_id, "archived",
        payload={"board": BOARD_NAME, "from": card["status"]},
    )
    comment(conn, card_id, BOARD_NAME, f"archived (from {card['status']})")
    return {"card": card_id, "action": "archived", "from": card["status"]}


# --------------------------------------------------------------------------
# The self-run loop
# --------------------------------------------------------------------------

def run_board(
    conn: sqlite3.Connection,
    interval: float = DEFAULT_INTERVAL,
    lease_seconds: int = LEASE_SECONDS_DEFAULT,
    max_attempts: int = MAX_DISPATCH_ATTEMPTS_DEFAULT,
    max_passes: int | None = None,
) -> dict:
    """Drive the board: recover -> flip -> dispatch -> report totals.
    `interval > 0` loops (daemon/watch mode) until the board settles or an
    optional `max_passes` cap is hit. Returns diagnosed totals per pass.
    """
    pass_number = 0
    while True:
        pass_number += 1
        recovered = recover_stale(conn)
        flipped = flip_terminal_cards(conn)
        dispatched = auto_dispatch(
            conn, lease_seconds=lease_seconds, max_attempts=max_attempts
        )
        active = sum(1 for d in dispatched if d["action"] == "dispatched")
        conn.commit()
        totals = {
            "pass": pass_number,
            "recovered": recovered,
            "flipped_done": flipped["done"],
            "flipped_blocked": flipped["blocked"],
            "dispatched": active,
        }
        print_parsed(totals)
        if interval <= 0:
            return totals
        if max_passes is not None and pass_number >= max_passes:
            return totals
        time.sleep(max(0.25, interval))


def print_parsed(totals: dict) -> None:
    print(
        f"[{BOARD_NAME}] pass={totals['pass']} recovered={totals['recovered']} "
        f"flipped(done={totals['flipped_done']},blocked={totals['flipped_blocked']}) "
        f"dispatched={totals['dispatched']}"
    )


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def open_board(args) -> sqlite3.Connection:
    db = args.db or os.environ.get("KANBAN_DB", DEFAULT_DB)
    if not os.path.exists(db):
        raise SystemExit(f"board DB not found: {db} (use --db or $KANBAN_DB)")
    return connect(db)


def cmd_run(args) -> int:
    conn = open_board(args)
    run_board(
        conn,
        interval=args.interval,
        lease_seconds=args.lease,
        max_attempts=args.max_attempts,
        max_passes=args.max_passes,
    )
    conn.close()
    return 0


def cmd_view(args) -> int:
    conn = open_board(args)
    cards = display_cards(conn)
    if not cards:
        print("board: no open cards (new/blocked/running)")
        return 0
    for card in cards:
        state = display_state(conn, card)
        runs = runs_for(conn, card["id"])
        live = [r for r in runs if r["status"] in RUN_LIVE]
        latest = latest_run(runs)
        run_state = (
            f"LIVE run #{latest['id']} (lease to {latest['claim_expires']})"
            if live
            else (
                f"{latest['status']} run #{latest['id']}"
                if latest
                else "no run yet"
            )
        )
        print(
            f"  {state:<11} {card['id']:<16} {run_state:<45}"
            f" {card['title'][:40]}"
        )
    conn.close()
    return 0


def cmd_report(args) -> int:
    conn = open_board(args)
    counts = {
        row["status"]: row["n"]
        for row in conn.execute(
            "SELECT status, COUNT(*) AS n FROM tasks GROUP BY status"
        ).fetchall()
    }
    # Reader convention: cards with a live running run are in progress even
    # when their stored status says 'new' (see display_state).
    in_progress = sum(
        1 for c in display_cards(conn) if display_state(conn, c) == "in_progress"
    )
    triggers = conn.execute(
        "SELECT * FROM task_events WHERE kind = 'lane-done' OR kind = 'dispatched'"
        " ORDER BY id DESC LIMIT 25"
    ).fetchall()
    rows = []
    for t in reversed(triggers):
        payload = json.loads(t["payload"] or "{}")
        rows.append(
            {
                "at": datetime.fromtimestamp(t["created_at"], timezone.utc)
                .isoformat(),
                "kind": t["kind"],
                "task": t["task_id"],
                "run_id": t["run_id"],
                **payload,
            }
        )
    counts["in_progress"] = in_progress
    if args.json:
        print(json.dumps({"counts": counts, "events": rows}, indent=2))
    else:
        print(f"{BOARD_NAME} board counts: " + " ".join(
            f"{k}={v}" for k, v in sorted(counts.items())
        ))
        print(f"last {len(rows)} dispatch/lane-done triggers:")
        for row in rows:
            print(
                f"  {row['at']}  {row['kind']:<10} {row['task']:<16}"
                f" {row.get('card_status') or row.get('outcome') or ''}"
            )
    conn.close()
    return 0


def cmd_dispatch(args) -> int:
    conn = open_board(args)
    result = dispatch_card(conn, args.card, lease_seconds=args.lease,
                           max_attempts=args.max_attempts)
    conn.commit()
    conn.close()
    print(json.dumps(result, indent=2) if args.json else plain_result(result))
    return 0 if result["action"] != "none" else 1


def cmd_verify(args) -> int:
    conn = open_board(args)
    result = verify_card(
        conn, args.card,
        status=args.status,
        evidence=args.evidence,
        run_id=args.run,
    )
    conn.commit()
    conn.close()
    if result.get("noop"):
        print(f"card {result['card']} already {result['card_status']} (no-op)")
        return 0
    print(
        f"verified card {result['card']}: {result['card_status']}"
        f"{' — ' + args.evidence if args.evidence else ''}"
    )
    return 0


def cmd_archive(args) -> int:
    conn = open_board(args)
    result = archive_card(conn, args.card)
    conn.commit()
    conn.close()
    print(
        result.get("reason")
        or f"archived card {result['card']} (from {result['from']})"
    )
    return 0 if result.get("action") != "noop" else 1


def plain_result(result: dict) -> str:
    if result.get("action") == "dispatched":
        return (
            f"dispatched card {result['card']} -> run #{result['run_id']}"
            f" (attempt {result['attempt']})"
        )
    if result.get("action") == "parked":
        return f"parked card {result['card']}: {result.get('reason')}"
    return f"card {result['card']}: {result.get('reason')}"


def main(argv=None) -> int:
    p = argparse.ArgumentParser(
        prog="board.py",
        description="JERICHO OS: self-running maestro board over kanban.db",
    )
    p.add_argument("--db", help=f"board DB path (default $KANBAN_DB or {DEFAULT_DB})")
    p.add_argument("--lease", type=int, default=LEASE_SECONDS_DEFAULT,
                   help="seconds a dispatched run holds its claim")
    p.add_argument("--max-attempts", type=int, default=MAX_DISPATCH_ATTEMPTS_DEFAULT,
                   help="dispatch attempts before a card parks")
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run", help="self-run loop: recover + flip + dispatch")
    r.add_argument("--interval", type=float, default=DEFAULT_INTERVAL,
                   help=">0 = daemon/watch mode sleeping N seconds between passes")
    r.add_argument("--max-passes", type=int, default=None,
                   help="cap the number of passes (loop guard)")
    r.set_defaults(func=cmd_run)

    v = sub.add_parser("view", help="show open cards and their lane state")
    v.set_defaults(func=cmd_view)

    rep = sub.add_parser("report", help="board counts + recent dispatch/lane-done triggers")
    rep.add_argument("--json", action="store_true")
    rep.set_defaults(func=cmd_report)

    d = sub.add_parser("dispatch", help="auto-dispatch one open card (Hub hook)")
    d.add_argument("--card", required=True)
    d.add_argument("--json", action="store_true")
    d.set_defaults(func=cmd_dispatch)

    ver = sub.add_parser("verify", help="manual lane-done verify + flip (Hub hook)")
    ver.add_argument("--card", required=True)
    ver.add_argument("--status", choices=["done", "blocked"], default="done")
    ver.add_argument("--evidence", default=None)
    ver.add_argument("--run", type=int, default=None, help="run id to bind the verdict to")
    ver.set_defaults(func=cmd_verify)

    a = sub.add_parser("archive", help="move a terminal card to archived (Hub hook)")
    a.add_argument("--card", required=True)
    a.set_defaults(func=cmd_archive)

    t = sub.add_parser("test", help="run built-in self-tests on a scratch board")
    t.set_defaults(func=cmd_test)

    args = p.parse_args(argv)
    return args.func(args)


# --------------------------------------------------------------------------
# Built-in self-tests (stdlib unittest, scratch DB — never the live board)
# --------------------------------------------------------------------------

def cmd_test(args) -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(BoardTest)
    result = unittest.TextTestRunner(verbosity=2, buffer=True).run(suite)
    return 0 if result.wasSuccessful() else 1


class BoardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="maestro-board-test-"))
        self.db_path = self.tmp / "kanban.db"
        conn = sqlite3.connect(self.db_path)
        conn.executescript(KANBAN_SCHEMA_SUBSET)
        conn.commit()
        conn.close()
        self.conn = connect(str(self.db_path))

    def tearDown(self):
        self.conn.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _card(self, task_id="card-1", status="new", title="Test card"):
        self.conn.execute(
            "INSERT INTO tasks (id, title, status, created_at) VALUES (?, ?, ?, ?)",
            (task_id, title, status, now_epoch()),
        )
        self.conn.commit()

    def _run(self, task_id, status="done", outcome="completed", summary="merged",
             ended_at=None, error=None, claim_expires=None):
        started = now_epoch() - 60
        self.conn.execute(
            "INSERT INTO task_runs (task_id, status, started_at, ended_at,"
            " outcome, summary, error, claim_expires)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (task_id, status, started, ended_at or now_epoch(), outcome, summary,
             error, claim_expires),
        )
        self.conn.commit()
        return self.conn.execute(
            "SELECT * FROM task_runs WHERE task_id = ? ORDER BY id DESC LIMIT 1",
            (task_id,),
        ).fetchone()

    # --- flip done cards with evidence + lane-done trigger ---------------

    def test_flip_done_card_binds_evidence_and_lane_done_trigger(self):
        self._card("c1")
        run = self._run("c1", status="done", outcome="completed",
                        summary="MERGED to main e1e01b1")
        totals = flip_terminal_cards(self.conn)
        self.conn.commit()
        self.assertEqual(totals["done"], 1)
        self.assertEqual(totals["blocked"], 0)
        card = self.conn.execute(
            "SELECT * FROM tasks WHERE id='c1'"
        ).fetchone()
        self.assertEqual(card["status"], "done")
        self.assertIn("MERGED to main e1e01b1", card["result"])
        self.assertIsNotNone(card["completed_at"])
        trigger = self.conn.execute(
            "SELECT * FROM task_events WHERE kind='lane-done'"
        ).fetchone()
        self.assertIsNotNone(trigger)
        payload = json.loads(trigger["payload"])
        self.assertEqual(payload["run_id"], run["id"])
        self.assertEqual(payload["card_status"], "verified")
        self.assertIn("MERGED to main e1e01b1", payload["evidence"])

    def test_failed_run_flips_blocked_with_reason_and_trigger(self):
        self._card("c2")
        run = self._run("c2", status="failed", outcome="timed_out",
                        summary="", error="timeout after 30s")
        flip_terminal_cards(self.conn)
        self.conn.commit()
        card = self.conn.execute(
            "SELECT * FROM tasks WHERE id='c2'"
        ).fetchone()
        self.assertEqual(card["status"], "blocked")
        self.assertIn("timeout after 30s", card["last_failure_error"])
        trigger = self.conn.execute(
            "SELECT * FROM task_events WHERE kind='lane-done'"
        ).fetchone()
        self.assertEqual(json.loads(trigger["payload"])["card_status"], "blocked")

    def test_live_run_is_never_flipped(self):
        self._card("c3")
        self._run("c3", status="running", outcome=None, summary=None,
                  claim_expires=now_epoch() + 3600)
        flip_terminal_cards(self.conn)
        self.assertEqual(
            self.conn.execute("SELECT status FROM tasks WHERE id='c3'").fetchone()[0],
            "new",
        )

    # --- auto-dispatch open cards ----------------------------------------

    def test_auto_dispatch_creates_claimed_run_and_trigger(self):
        self._card("c4")
        results = auto_dispatch(self.conn)
        self.conn.commit()
        self.assertEqual(results[0]["action"], "dispatched")
        run = self.conn.execute(
            "SELECT * FROM task_runs WHERE task_id='c4'"
        ).fetchone()
        self.assertEqual(run["status"], "running")
        self.assertTrue(run["claim_lock"].startswith("maestro-dispatch:"))
        self.assertGreater(run["claim_expires"], now_epoch())
        trigger = self.conn.execute(
            "SELECT * FROM task_events WHERE kind='dispatched'"
        ).fetchone()
        self.assertEqual(json.loads(trigger["payload"])["run_id"], run["id"])

    def test_auto_dispatch_skips_already_terminal_and_in_flight(self):
        self._card("c5", status="done", title="Done card")
        self._card("c6")
        self._run("c6", status="running", claim_expires=now_epoch() + 3600)
        results = auto_dispatch(self.conn)
        # c5 (done) is terminal and skipped; c6 is already in flight -> no action
        self.assertEqual([r["action"] for r in results], ["none"])
        self.assertEqual(results[0]["reason"], "already in flight")
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM task_runs").fetchone()[0], 1
        )

    # --- recovery + bounded re-dispatch ----------------------------------

    def test_stale_claim_recovered_then_redispatched(self):
        self._card("c7")
        stale = self._run("c7", status="running", claim_expires=now_epoch() - 10)
        self.assertEqual(recover_stale(self.conn), 1)
        self.assertEqual(
            self.conn.execute(
                "SELECT status FROM task_runs WHERE id=?", (stale["id"],)
            ).fetchone()[0],
            "released",
        )
        results = auto_dispatch(self.conn)
        self.assertEqual(results[0]["action"], "dispatched")  # idle -> re-trigger
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM task_runs").fetchone()[0], 2
        )

    def test_redispatch_is_bounded_by_max_attempts(self):
        self._card("c8")
        for _ in range(MAX_DISPATCH_ATTEMPTS_DEFAULT):
            self._run("c8", status="released", outcome="reclaimed")
        results = auto_dispatch(self.conn, max_attempts=MAX_DISPATCH_ATTEMPTS_DEFAULT)
        self.assertEqual(results[0]["action"], "parked")
        runs = self.conn.execute(
            "SELECT COUNT(*) FROM task_runs WHERE status='running'"
        ).fetchone()[0]
        self.assertEqual(runs, 0)

    # --- end-to-end pass + idempotency -----------------------------------

    def test_run_board_end_to_end_flip_and_dispatch_and_idempotent_rerun(self):
        self._card("e1")  # no run -> will be auto-dispatched
        self._card("e2")
        self._run("e2", status="done", outcome="completed", summary="shipped")
        totals = run_board(self.conn)
        self.assertEqual(totals["recovered"], 0)
        self.assertEqual(totals["flipped_done"], 1)  # e2 flipped
        self.assertEqual(totals["dispatched"], 1)    # e1 handed to a lane
        # Second pass on the settled board is a no-op.
        second = run_board(self.conn)
        self.assertEqual(second["flipped_done"], 0)
        self.assertEqual(second["dispatched"], 0)
        self.assertEqual(second["recovered"], 0)

    # --- verify + archive hooks ------------------------------------------

    def test_verify_hook_flips_with_explicit_evidence(self):
        self._card("v1")
        result = verify_card(self.conn, "v1", status="done",
                             evidence="PR merged; checks green")
        self.assertEqual(result["card_status"], "done")
        self.assertIn("PR merged", self.conn.execute(
            "SELECT result FROM tasks WHERE id='v1'"
        ).fetchone()[0])
        trigger = self.conn.execute(
            "SELECT * FROM task_events WHERE kind='lane-done'"
        ).fetchone()
        self.assertTrue(json.loads(trigger["payload"])["manual"])

    def test_verify_hook_is_idempotent(self):
        self._card("v2")
        verify_card(self.conn, "v2", status="done", evidence="shipped")
        second = verify_card(self.conn, "v2", status="done", evidence="again")
        self.assertTrue(second.get("noop"))
        self.assertEqual(
            self.conn.execute(
                "SELECT COUNT(*) FROM task_events WHERE kind='lane-done'"
            ).fetchone()[0],
            1,  # re-verify never re-emits a trigger
        )

    def test_archive_moves_terminal_card_only(self):
        self._card("a1", status="done")
        self._card("a2", status="new")
        archive_card(self.conn, "a1")
        self.assertEqual(
            self.conn.execute("SELECT status FROM tasks WHERE id='a1'").fetchone()[0],
            "archived",
        )
        with self.assertRaises(SystemExit):
            archive_card(self.conn, "a2")  # open card is not archived directly


if __name__ == "__main__":
    sys.exit(main())
