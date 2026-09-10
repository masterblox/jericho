#!/usr/bin/env python3
"""
board.py — JERICHO OS demo: the self-running board (maestro-mode slice)

The whole "maestro as a product" loop, brought down to one thin, repo-only
slice that runs with zero dependencies and zero fleet access:

        dispatch -> run -> lane-done -> auto-archive -> report

A "board" is one JSON file holding a list of jobs. This daemon reads the file,
drives each job `queued -> running -> done|failed`, auto-archives terminal
jobs out of the open board, appends an audit line to a journal, and prints
one line per finished job plus a persisted report.

For the demo, jobs are delivered by `seed` (the stand-in for the missing
dispatch step), a human, or any script that writes board JSON. My scope is
deliberately the middle of the loop — status, archive, report — because that
is the "middleman" PLAN-FLEET-CONTEXT-REMEDIATION.md says is the actual
problem: not the models, the forgotten plumbing in between.

Blueprint debt (honest, read README.md in this folder):
  * `argv` is an explicit command list; there is NO implicit shell. Want a
    pipeline? Spell it: ["bash","-c","..."].
  * The write is atomic (tmp + rename), so a killed daemon cannot tear the
    board, but two daemons racing one board CAN double-run a job. Leases mark
    stale `running` jobs for recovery (mirrors the fleet's restart-amnesia
    problem) rather than solving the race. Real fix: an O_EXCL claim file.
  * No retries, no dependency graph, no cost tracking, no Approve gate. Those
    are real fleet features and deliberately out of this slice.

Runbook (3 lines):
    python3 demo/board/board.py seed   demo/board/tmp/live-board.json
    python3 demo/board/board.py run    demo/board/tmp/live-board.json
    python3 demo/board/board.py report demo/board/tmp/live-board.json
Or verify the slice itself:
    python3 demo/board/board.py test
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
from datetime import datetime, timezone
from pathlib import Path

BOARD_VERSION = 1
OPEN_STATUSES = ("queued", "deferred", "running")
TERMINAL_STATUSES = ("done", "failed")

_TS = "%Y-%m-%dT%H:%M:%SZ"
_TAIL_CHARS = 400
_TAIL_LINES = 6
_DEFAULT_TIMEOUT = 30
_DEFAULT_LEASE = 60


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime(_TS)


def stamp() -> str:  # for report filenames; local time is fine here
    return datetime.now().strftime("%Y%m%d-%H%M%S")


# --------------------------------------------------------------------------
# I/O: board files + runtime channels (all live next to the board file)
# --------------------------------------------------------------------------

def read_board(path: Path) -> dict:
    """Load + validate + fill defaults for a board file."""
    p = Path(path)
    with open(p) as f:
        board = json.load(f)
    if board.get("version") != BOARD_VERSION:
        raise SystemExit(
            f"{p}: unsupported board version {board.get('version')} (want {BOARD_VERSION})"
        )
    for job in board.get("jobs", []):
        if not job.get("id"):
            raise SystemExit(f"{p}: every job needs a non-empty 'id'")
        job.setdefault("title", " ".join(job.get("argv", ["<empty argv>"])))
        job.setdefault("status", "queued")
        job.setdefault("timeout_seconds", _DEFAULT_TIMEOUT)
        if job["status"] not in (OPEN_STATUSES + TERMINAL_STATUSES):
            job["status"] = "queued"  # forgiving on unknown statuses
    # An empty `jobs` list is a valid end state: the board's work was archived.
    return board


def write_board(path: Path, board: dict) -> None:
    """Atomic write (tmp + rename) so a crash mid-write cannot tear the board."""
    p = Path(path)
    tmp = p.with_name(p.name + ".tmp")
    with open(tmp, "w") as f:
        json.dump(board, f, indent=2)
        f.write("\n")
    os.replace(tmp, p)


def channels(board_path: Path) -> dict:
    """Runtime output lands next to the board file; nothing touches the fleet."""
    d = Path(board_path).resolve().parent
    return {
        "archive": d / "archive" / Path(board_path).stem,
        "reports": d / "reports",
        "artifacts": d / "artifacts",
        "journal": d / "journal.log",
    }


def append_journal(ch: dict, text: str) -> None:
    ch["journal"].parent.mkdir(parents=True, exist_ok=True)
    with open(ch["journal"], "a") as f:
        f.write(f"{now_iso()}  {text}\n")


def tail(text: str, chars: int = _TAIL_CHARS, lines: int = _TAIL_LINES) -> str:
    """Keep a small, readable slice of a command's output for the board record."""
    snippet = text[-chars:]
    return "\n".join(snippet.splitlines()[-lines:])


# --------------------------------------------------------------------------
# The board's state machine
# --------------------------------------------------------------------------

def claim(job: dict, owner: str, lease_seconds: int) -> None:
    """Try-before-run claim. `lease_expires_at` lets a later run recover a
    daemon that died mid-job instead of leaving the job stuck 'running'."""
    job["status"] = "running"
    job["lease_owner"] = owner
    job["leased_at"] = now_iso()
    job["started_at"] = now_iso()
    job["lease_expires_at"] = time.time() + lease_seconds


def recover_expired(jobs, ch: dict, board_name: str) -> int:
    """Restart recovery: stale `running` leases go back to `queued`.

    Mirrors PLAAN's restart-amnesia: the fleet wipes context on restart; here
    the board holds the truth on disk, so a dead daemon's work is never lost.
    """
    recovered = 0
    for job in jobs:
        if job["status"] == "running" and time.time() > job.get("lease_expires_at", 0):
            owner = job.get("lease_owner", "?")
            job["status"] = "queued"
            job["recovered_from"] = owner
            for k in ("lease_owner", "leased_at", "started_at", "lease_expires_at"):
                job.pop(k, None)
            append_journal(
                ch,
                f"board={board_name} job={job['id']} running->queued "
                f"(recovered, stale lease owner={owner})",
            )
            recovered += 1
    return recovered


def run_job(board_path: Path, ch: dict, board_name: str, job: dict, run_id: str) -> str:
    """Run one job's wrapped command and record status + evidence.

    Returns the terminal status. Full stdout/stderr go to an artifact file
    (evidence); the board record keeps only a short tail so the board stays
    small and readable.
    """
    argv = list(job.get("argv", []))
    started = time.monotonic()
    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=job.get("timeout_seconds", _DEFAULT_TIMEOUT),
        )
        status = "done" if proc.returncode == 0 else "failed"
        reason = None
        exit_code = proc.returncode
        stdout, stderr = proc.stdout or "", proc.stderr or ""
    except FileNotFoundError:
        status, reason = "failed", f"executable not found: {argv[0] if argv else '?'}"
        exit_code, stdout, stderr = None, "", ""
    except subprocess.TimeoutExpired as e:
        status = "failed"
        reason = f"timeout after {job.get('timeout_seconds', _DEFAULT_TIMEOUT)}s"
        exit_code = None
        stdout, stderr = e.stdout or "", e.stderr or ""
    except Exception as e:  # last resort: never let one bad job kill the daemon
        status, reason = "failed", f"{type(e).__name__}: {e}"
        exit_code, stdout, stderr = None, "", ""

    duration_ms = int((time.monotonic() - started) * 1000)
    job.update(
        {
            "status": status,
            "exit_code": exit_code,
            "reason": reason,
            "stdout_tail": tail(stdout),
            "stderr_tail": tail(stderr),
            "finished_at": now_iso(),
            "duration_ms": duration_ms,
            "runner": run_id,
        }
    )

    artifact_dir = ch["artifacts"] / run_id
    artifact_dir.mkdir(parents=True, exist_ok=True)
    artifact_file = artifact_dir / f"{job['id']}.json"
    with open(artifact_file, "w") as f:
        json.dump(
            {
                "board": board_name,
                "job_id": job["id"],
                "argv": argv,
                "status": status,
                "reason": reason,
                "exit_code": exit_code,
                "duration_ms": duration_ms,
                "started_at": job["started_at"],
                "finished_at": job["finished_at"],
                "stdout": stdout,
                "stderr": stderr,
            },
            f,
            indent=2,
        )
    job["artifact"] = str(artifact_file)

    append_journal(
        ch,
        f"board={board_name} job={job['id']} queued->{status} exit={exit_code} "
        f"{duration_ms}ms{f' ({reason})' if reason else ''}",
    )
    return status


def archive_terminal(board: dict, board_path: Path, ch: dict) -> int:
    """lane-done auto-archive: terminal jobs leave the open board and land as
    individual files in the archive dir. The open board stays small; completed
    work is out of the way but never deleted."""
    kept, archived = [], 0
    archive_dir = ch["archive"]
    archive_dir.mkdir(parents=True, exist_ok=True)
    for job in board["jobs"]:
        if job["status"] in TERMINAL_STATUSES:
            with open(archive_dir / f"{job['id']}.json", "w") as f:
                json.dump(job, f, indent=2)
                f.write("\n")
            append_journal(
                ch, f"board={Path(board_path).stem} job={job['id']} archived ({job['status']})"
            )
            archived += 1
        else:
            kept.append(job)
    board["jobs"] = kept
    return archived


# --------------------------------------------------------------------------
# Reporting
# --------------------------------------------------------------------------

def one_line(job: dict) -> str:
    """The one-line per-job report the loop promises."""
    flag = "OK" if job["status"] == "done" else "FAIL"
    if job.get("reason"):
        detail = job["reason"]
    elif job.get("exit_code") is not None:
        detail = f"exit={job['exit_code']}"
    else:
        detail = "?"
    ms = job.get("duration_ms", "?")
    title = (job.get("title") or job.get("id", "?"))[:44]
    return f"  [{flag}] {job.get('id','?'):<12} {detail[:28]:<28} {ms:>7}ms  \"{title}\""


def write_report(board_path: Path, ch: dict, board_name: str, run_id: str, totals: dict) -> Path:
    """Snapshot the terminal jobs (from the archive) into a dated report file."""
    lines = []
    for p in sorted(ch["archive"].glob("*.json")):
        with open(p) as f:
            lines.append(one_line(json.load(f)))
    text = "\n".join(
        [
            f"BOARD REPORT  board={board_name}  run={run_id}  at={now_iso()}",
            "queued={q} done={d} failed={f} deferred={de} recovered={r}".format(
                q=totals.get("queued", 0), d=totals.get("done", 0),
                f=totals.get("failed", 0), de=totals.get("deferred", 0),
                r=totals.get("recovered", 0),
            ),
            "---",
            *(lines or ["(nothing archived yet)"]),
            "",
        ]
    )
    ch["reports"].mkdir(parents=True, exist_ok=True)
    rp = ch["reports"] / f"{board_name}-{stamp()}.txt"
    with open(rp, "w") as f:
        f.write(text)
    return rp


# --------------------------------------------------------------------------
# Core: the daemon pass
# --------------------------------------------------------------------------

def run_board(
    board_path: Path,
    run_id: str | None = None,
    interval: float = 0.0,
    lease: int = _DEFAULT_LEASE,
) -> dict:
    """Drive a board to completion: run queued jobs, auto-archive, persist a
    report. `interval > 0` turns this into a loop (daemon mode); 0 = one pass.
    Returns per-status totals so callers (and tests) can inspect the outcome.
    """
    ch = channels(board_path)
    run_id = run_id or uuid.uuid4().hex[:12]
    ch["journal"].parent.mkdir(parents=True, exist_ok=True)
    append_journal(ch, f"board={board_path.stem} RUN start run_id={run_id}")

    totals = {"queued": 0, "done": 0, "failed": 0, "deferred": 0, "recovered": 0}
    while True:
        board = read_board(board_path)
        totals["recovered"] += recover_expired(board["jobs"], ch, board_path.stem)
        ran_any = False
        for job in board["jobs"]:
            if job["status"] != "queued":
                if job["status"] == "deferred":
                    totals["deferred"] += 1
                continue  # actively running/held: never double-run
            totals["queued"] += 1
            claim(job, run_id, lease)
            write_board(board_path, board)  # status write: queued -> running
            status = run_job(board_path, ch, board_path.stem, job, run_id)
            totals[status] += 1
            ran_any = True
            write_board(board_path, board)  # status write: running -> done|failed
            print(one_line(job))

        archived = archive_terminal(board, board_path, ch)
        if archived:
            write_board(board_path, board)  # board now holds open work only

        if interval <= 0:
            break
        time.sleep(max(0.25, interval))  # daemon mode: wait for more work

    write_report(board_path, ch, board_path.stem, run_id, totals)
    append_journal(ch, f"board={board_path.stem} RUN end run_id={run_id}")
    return totals


# --------------------------------------------------------------------------
# CLI subcommands
# --------------------------------------------------------------------------

def cmd_seed(args) -> int:
    """Write a fresh demo board. Real, executable jobs — no fake wrappers.
    `job-002` hashes its own board file at run time (evidence the board watched
    itself change), which makes a good demo but is obviously a toy, not magic.
    """
    path = Path(args.board).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    jobs = [
        {
            "id": "job-001",
            "title": "Greet the fleet from lane DEV",
            "argv": [sys.executable, "-c", "print('hello from lane DEV — task done')"],
        },
        {
            "id": "job-002",
            "title": "Hash the board at run time (self-evidence)",
            "argv": [
                sys.executable,
                "-c",
                "import hashlib, sys\n"
                "print('board sha256:', hashlib.sha256(open(sys.argv[1], 'rb').read()).hexdigest())",
                str(path),
            ],
        },
        {
            "id": "job-003",
            "title": "Wrapped sleep (shows duration tracking)",
            "argv": [sys.executable, "-c", "import time; time.sleep(0.4); print('slept 0.4s')"],
        },
        {
            "id": "job-004",
            "title": "Fail loudly with stderr (shows failure capture)",
            "argv": [sys.executable, "-c", "import sys; print('ouch: demo error', file=sys.stderr); sys.exit(3)"],
        },
        {
            "id": "job-005",
            "title": "Missing executable (shows ENOENT capture)",
            "argv": ["definitely-not-a-real-binary-xyz"],
        },
    ]
    board = {
        "version": BOARD_VERSION,
        "board": path.stem,
        "created_at": now_iso(),
        "jobs": jobs,
    }
    write_board(path, board)
    print(f"seeded {len(jobs)} jobs -> {path}")
    return 0


def cmd_run(args) -> int:
    board_path = Path(args.board).resolve()
    try:
        run_board(board_path, interval=args.interval, lease=args.lease)
    except KeyboardInterrupt:
        print("\n(stopped by interrupt; board is safe on disk, run again to continue)")
        return 130
    return 0


def cmd_view(args) -> int:
    board = read_board(Path(args.board).resolve())
    print(f"board: {args.board}  open jobs: {len(board['jobs'])}")
    for j in board["jobs"]:
        ms = j.get("duration_ms", "-")
        extra = f" (recovered from {j['recovered_from']})" if "recovered_from" in j else ""
        print(f"  {j['status']:<9} {j.get('id',''):<12} {str(ms):>7}ms  {j.get('title','')[:48]}{extra}")
    return 0


def cmd_archive(args) -> int:
    board_path = Path(args.board).resolve()
    ch = channels(board_path)
    board = read_board(board_path)
    n = archive_terminal(board, board_path, ch)
    if n:
        write_board(board_path, board)
    print(f"archived {n} terminal job(s) from {board_path.stem} -> {ch['archive']}")
    return 0


def cmd_report(args) -> int:
    ch = channels(Path(args.board).resolve())
    jobs = []
    for p in sorted(ch["archive"].glob("*.json")):
        with open(p) as f:
            jobs.append(json.load(f))
    jobs.sort(key=lambda j: j.get("finished_at", ""))
    if args.json:
        print(json.dumps(jobs, indent=2))
    else:
        for j in jobs:
            print(one_line(j))
        print(f"\narchived terminal jobs: {len(jobs)}  (archive: {ch['archive']})")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(
        prog="board.py",
        description="JERICHO OS demo: self-running board (maestro-mode slice).",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("seed", help="write a fresh demo board at PATH")
    s.add_argument("board")
    s.set_defaults(func=cmd_seed)

    r = sub.add_parser("run", help="drive the board: run queued jobs, auto-archive, report")
    r.add_argument("board")
    r.add_argument("--lease", type=int, default=_DEFAULT_LEASE,
                   help="seconds before a stale `running` job is treated as crashed and requeued")
    r.add_argument("--interval", type=float, default=0.0,
                   help=">0 runs as a daemon loop, sleeping N seconds between passes (0 = one pass)")
    r.set_defaults(func=cmd_run)

    v = sub.add_parser("view", help="show open jobs on the board")
    v.add_argument("board")
    v.set_defaults(func=cmd_view)

    a = sub.add_parser("archive", help="move terminal jobs to the archive (auto-run by `run`)")
    a.add_argument("board")
    a.set_defaults(func=cmd_archive)

    rep = sub.add_parser("report", help="one-line report of archived (terminal) jobs")
    rep.add_argument("board")
    rep.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    rep.set_defaults(func=cmd_report)

    t = sub.add_parser("test", help="run the built-in self-test suite (stdlib unittest)")
    t.set_defaults(func=cmd_test)

    args = p.parse_args(argv)
    return args.func(args)


# --------------------------------------------------------------------------
# Built-in self-tests (no new dependencies)
# --------------------------------------------------------------------------

def cmd_test(args) -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(BoardTest)
    result = unittest.TextTestRunner(verbosity=2, buffer=True).run(suite)
    return 0 if result.wasSuccessful() else 1


class BoardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="board-test-"))
        self.board_path = self.tmp / "board.json"

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _seed(self, jobs):
        write_board(
            self.board_path,
            {"version": BOARD_VERSION, "board": "test", "created_at": now_iso(), "jobs": jobs},
        )

    def _ok(self, n=1):
        return [{"id": f"j{i}", "argv": [sys.executable, "-c", "pass"]} for i in range(n)]

    def test_run_done_and_auto_archived_and_reported(self):
        self._seed(self._ok(2) + [{"id": "bad", "argv": [sys.executable, "-c", "sys.exit(9)"]}])
        totals = run_board(self.board_path)
        self.assertEqual(totals["done"], 2)
        self.assertEqual(totals["failed"], 1)
        board = read_board(self.board_path)
        self.assertEqual(board["jobs"], [])  # open board is clean after a run
        archived = list((self.tmp / "archive" / "board").glob("*.json"))
        self.assertEqual(len(archived), 3)
        report = list((self.tmp / "reports").glob("*.txt"))
        self.assertEqual(len(report), 1)
        self.assertIn("[OK]", report[0].read_text())
        self.assertIn("[FAIL]", report[0].read_text())
        journal = (self.tmp / "journal.log").read_text()
        self.assertIn("j0 queued->done", journal)

    def test_stale_lease_recovered_then_ran(self):
        # A previous daemon died mid-job: lease expired -> must be requeued and run.
        self._seed(
            [
                {
                    "id": "stuck",
                    "argv": [sys.executable, "-c", "pass"],
                    "status": "running",
                    "lease_owner": "dead-daemon",
                    "lease_expires_at": time.time() - 10,
                }
            ]
        )
        totals = run_board(self.board_path)
        self.assertEqual(totals["recovered"], 1)
        self.assertEqual(totals["done"], 1)
        self.assertIn("running->queued (recovered", (self.tmp / "journal.log").read_text())

    def test_live_lease_not_double_run(self):
        # A concurrent alive daemon holds the lease: we must NOT touch the job.
        self._seed(
            [
                {
                    "id": "busy",
                    "argv": [sys.executable, "-c", "pass"],
                    "status": "running",
                    "lease_owner": "live-other",
                    "lease_expires_at": time.time() + 3600,
                }
            ]
        )
        totals = run_board(self.board_path)
        self.assertEqual(totals["done"], 0)
        self.assertEqual(read_board(self.board_path)["jobs"][0]["status"], "running")
        self.assertNotIn("queued->done", (self.tmp / "journal.log").read_text())

    def test_missing_executable_is_failed_not_crash(self):
        self._seed([{"id": "ghost", "argv": ["definitely-not-real-binary-xyz"]}])
        totals = run_board(self.board_path)
        self.assertEqual(totals["failed"], 1)
        archived = json.loads(
            (self.tmp / "archive" / "board" / "ghost.json").read_text()
        )
        self.assertIn("executable not found", archived["reason"])

    def test_board_survives_rerun(self):
        # A second invocation on an already-run board must be a clean no-op,
        # proving the board file on disk is durable, not in-memory state.
        self._seed(self._ok(1))
        run_board(self.board_path)
        second = run_board(self.board_path)
        self.assertEqual(second["done"], 0)
        self.assertEqual(second["queued"], 0)


if __name__ == "__main__":
    sys.exit(main())
