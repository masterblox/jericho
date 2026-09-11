#!/usr/bin/env python3
"""
continuation/smoke_test.py — offline smoke for the continuation engine + the
hub digest change-gate. Uses temp state files and fixture paseo/bus data;
never touches live fleet state, paseo, ssh, or the Jarvis hub.

Run:  python3 ops/jericho-os/continuation/smoke_test.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent

FINISHED = HERE / "paseo-finished-digest.py"
PENDING = HERE / "paseo-pending-completions.py"
MARK = HERE / "paseo-mark-processed.py"
HUB = REPO / "hub" / "hub-fleet-digest.py"

fails = []


def ok(label):
    print("  PASS: " + label)


def check(cond, label):
    if cond:
        ok(label)
    else:
        fails.append(label)
        print("  FAIL: " + label)


def run(py, env, *args):
    r = subprocess.run([sys.executable, str(py), *args], capture_output=True, text=True, env=env, timeout=60)
    return r


def main():
    with tempfile.TemporaryDirectory(prefix="cont-smoke-") as td:
        t = Path(td)

        fixture = t / "paseo.json"
        fixture.write_text(json.dumps([
            {"shortId": "abc111", "status": "done", "name": "build-x"},
            {"shortId": "def222", "status": "failed", "name": "audit-y"},
            {"shortId": "ghi333", "status": "running", "name": "still-going"},
            {"shortId": "jkl444", "status": "idle", "name": "idle-z"},
        ]))
        env = dict(os.environ, PASEO_JSON_FILE=str(fixture))

        print("[1/4] paseo-finished-digest — deterministic finished set")
        r1 = run(FINISHED, env)
        check(r1.returncode == 0, "runs cleanly offline")
        lines = [l for l in r1.stdout.splitlines() if l.strip()]
        check("abc111|done|build-x" in lines and "def222|failed|audit-y" in lines,
              "finished agents listed (done + failed)")
        check(not any("ghi333" in l for l in lines), "running agent excluded")
        r2 = run(FINISHED, env)
        check(r1.stdout == r2.stdout, "output deterministic (change-gate friendly)")

        print("[2/4] paseo-pending-completions — unprocessed set")
        state = t / "paseo-completions-processed.txt"
        penv = dict(env, PASEO_PROCESSED_STATE=str(state))
        r = run(PENDING, penv)
        check("abc111|done|build-x" in r.stdout and "def222|failed|audit-y" in r.stdout,
              "both finished agents unprocessed → listed")
        # mark abc111 processed
        r = run(MARK, dict(penv), "abc111")
        check(r.returncode == 0 and "marked abc111" in r.stdout, "mark-processed works")
        # idempotent mark
        r = run(MARK, dict(penv), "abc111")
        check("marked abc111" in r.stdout, "re-mark is a no-op (still says marked)")
        check(Path(state).read_text().splitlines() == ["abc111"], "processed-set has exactly one id")
        r = run(PENDING, penv)
        check("abc111" not in r.stdout and "def222" in r.stdout,
              "processed agent drops out of pending; unprocessed stays")

        print("[3/4] paseo-mark-processed — usage guard")
        base = dict(penv)
        base.pop("PASEO_JSON_FILE", None)  # not needed for mark
        r = run(MARK, base)  # no args
        check(r.returncode != 0, "mark without an id exits non-zero (usage)")

        print("[4/4] hub-fleet-digest — change-gate (no token)")
        hs = t / "hubdigest.hash"
        henv = dict(os.environ, HUB_DIGEST_STATE=str(hs), HUB_CHAT="-100", HUB_THREAD="4",
                    JARVIS_ENV=str(t / "missing.env"))
        r1 = run(HUB, henv)
        check(r1.returncode == 0 and "HUB: board not posted (token missing)" in r1.stdout,
              "first run: posts fallback (no token) + DM copy")
        check(hs.exists() and hs.read_text().strip(), "change-gate state written")
        r2 = run(HUB, henv)
        check(r2.returncode == 0 and r2.stdout.strip() == "",
              "second run with same board: silent (unchanged hash, no spam)")

        print()
        if fails:
            print("CONTINUATION SMOKE: %d FAILURE(S): %s" % (len(fails), "; ".join(fails)))
            return 1
        print("CONTINUATION SMOKE: all checks passed")
        return 0


if __name__ == "__main__":
    sys.exit(main())
