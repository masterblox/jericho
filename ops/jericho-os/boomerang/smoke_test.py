#!/usr/bin/env python3
"""
boomerang/smoke_test.py — offline smoke for the inbound bus.

Exercises, against temp files only (never the live bus, live secret, or live
service):
  1. emit.py validation + append (flock-safe path)
  2. github-webhook.py HMAC verify + frozen normalizations
  3. conductor-poller.py baseline + state-change emit

Safety invariants (hard):
  * every bus/secret path used here lives inside one tempdir
  * os.environ is swapped to the isolated temp env before the in-process
    webhook module runs, so its emit.py subprocess CANNOT inherit the live
    bus/secret
  * the live bus line count is read before and after — if it changed, the
    test fails loudly (nothing may reach the live events.jsonl)

Run:  python3 ops/jericho-os/boomerang/smoke_test.py
"""
from __future__ import annotations

import hashlib
import hmac
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
EMIT = HERE / "emit.py"
WEBHOOK = HERE / "github-webhook.py"
POLLER = HERE / "conductor-poller.py"

fails = []


def ok(label):
    print("  PASS: " + label)


def check(cond, label):
    if cond:
        ok(label)
    else:
        fails.append(label)
        print("  FAIL: " + label)


def load(path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def emit(events_file, payload):
    assert not Path(events_file).is_file() or str(events_file).startswith("/tmp/"), \
        "test create bus must be under /tmp"
    env = dict(os.environ, BOOMERANG_EVENTS=str(events_file))
    r = subprocess.run([sys.executable, str(EMIT), json.dumps(payload)],
                       capture_output=True, text=True, env=env, timeout=30)
    return r


def read_lines(path):
    if not Path(path).is_file():
        return []
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def live_bus_count():
    try:
        return len(Path("/srv/hermes/data/boomerang/events.jsonl").read_text().splitlines())
    except Exception:
        return -1


def main():
    # Safety guard: this test must never run against the live bus env.
    if os.environ.get("BOOMERANG_EVENTS", "").startswith("/srv/hermes/data/boomerang"):
        print("REFUSE: BOOMERANG_EVENTS points at the live bus — aborting.")
        return 2
    before_live = live_bus_count()

    with tempfile.TemporaryDirectory(prefix="boom-smoke-") as td:
        t = Path(td)

        print("[1/3] emit.py — validation + append")
        events = t / "events.jsonl"
        r = emit(events, {"source": "github", "event": "pr_merged", "title": "t1"})
        check(r.returncode == 0, "emit accepts a valid event")
        lines = read_lines(events)
        check(len(lines) == 1 and lines[0]["source"] == "github", "appends one line at `processed:false`")
        check(lines[0]["processed"] is False and lines[0]["id"], "auto id + processed=false")
        check("at" in lines[0] and lines[0]["at"].endswith("Z"), "auto UTC timestamp")
        keys = list(lines[0].keys())
        check(keys == ["id", "at", "source", "event", "title", "url", "details", "processed"],
              "fixed key order on disk (%s)" % keys)
        # rejection paths
        r = emit(events, {"source": "nope", "event": "x", "title": "y"})
        check(r.returncode == 2 and "invalid source" in r.stderr.lower(), "rejects unknown source")
        r = emit(events, {"source": "github", "title": "no event"})
        check(r.returncode == 2 and "missing required" in r.stderr.lower(), "rejects missing required")
        r = emit(events, {"source": "github", "event": "pr_merged", "title": "z", "bogus": 1})
        check(r.returncode == 2 and "unknown keys" in r.stderr.lower(), "rejects unknown keys")

        print("[2/3] github-webhook.py — HMAC + normalizations")
        secret = "smoke-secret-" + uuid.uuid4().hex
        secret_file = t / ".github_secret"
        secret_file.write_text(secret)
        bus2 = t / "events2.jsonl"
        assert str(secret_file).startswith(td) and str(bus2).startswith(td), \
            "test secret+bus must be inside the tempdir"

        # Swap the whole process env to the isolated temp env BEFORE loading the
        # module: its emit.py subprocess then inherits ONLY temp paths. Restored
        # afterwards. Nothing in this block can touch /srv/hermes/data/boomerang.
        saved = dict(os.environ)
        os.environ.clear()
        os.environ.update({
            "BOOMERANG_SECRET_FILE": str(secret_file),
            "BOOMERANG_EMIT": str(EMIT),
            "BOOMERANG_EVENTS": str(bus2),
            "BOOMERANG_PORT": "0",  # never bound in this test
        })
        try:
            importlib.invalidate_caches()
            mod = load(WEBHOOK)

            class Fake:
                def __init__(self, headers):
                    self.headers = headers

                def _hmac_ok(self, body):
                    return mod.Handler._hmac_ok(self, body)

                def _normalize(self, event, payload):
                    return mod.Handler._normalize(self, event, payload)

            body = json.dumps({"repository": {"full_name": "masterblox/jericho"},
                               "pull_request": {"number": 7, "title": "Fix x", "merged": True,
                                                "html_url": "https://x"}}).encode()
            bad = Fake({"X-Hub-Signature-256": "sha256=" + "0" * 64})
            check(bad._hmac_ok(body) is False, "rejects bad signature")
            good = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
            fode = Fake({"X-Hub-Signature-256": "sha256=" + good})
            check(fode._hmac_ok(body) is True, "accepts valid signature")

            f = Fake({})
            f._normalize("pull_request", {"action": "closed", "repository": {"full_name": "o/r"},
                                          "pull_request": {"number": 41, "title": "ship",
                                                           "merged": True, "html_url": "https://u"}})
            f._normalize("pull_request", {"action": "closed", "repository": {"full_name": "o/r"},
                                          "pull_request": {"number": 9, "title": "wip",
                                                           "merged": False, "html_url": "https://u2"}})
            f._normalize("workflow_run", {"action": "completed", "repository": {"full_name": "o/r"},
                                          "workflow_run": {"name": "ci", "conclusion": "success",
                                                           "html_url": "https://wc",
                                                           "pull_requests": [{"number": 5}]}})
            f._normalize("push", {"ref": "refs/heads/main",
                                  "repository": {"full_name": "o/r", "default_branch": "main"},
                                  "head_commit": {"message": "bump\nmore", "url": "https://c"},
                                  "pusher": {"name": "car"}})
            handled = f._normalize("push", {"ref": "refs/heads/branch",
                                            "repository": {"full_name": "o/r", "default_branch": "main"}})
            check(handled is False, "unhandled event returns False (silent)")
        finally:
            os.environ.clear()
            os.environ.update(saved)

        assert bus2.is_file(), "webhook emits went outside the tempdir (no bus file written)"
        check(str(bus2).startswith(td), "webhook bus path stayed inside the tempdir")
        evs = {e["event"]: e for e in read_lines(bus2)}
        check(len(read_lines(bus2)) == 4, "exactly 4 normalized emits")
        check(evs["pr_merged"]["title"].startswith("PR #41 merged:"), "pr_merged normalized")
        check(evs["pr_closed_unmerged"]["title"].startswith("PR #9 closed unmerged:"), "pr_closed_unmerged normalized")
        check("pr=5" in evs["ci_completed"]["details"] and evs["ci_completed"]["title"].startswith("CI success:"),
              "ci_completed normalized (+pr)")
        check(evs["push_main"]["title"].startswith("push to main") and "bump" in evs["push_main"]["title"],
              "push_main normalized")

        print("[3/3] conductor-poller.py — baseline + state-change")
        ws = t / "ws.json"
        ws.write_text(json.dumps([
            {"id": "w1", "name": "alpha", "state": "building", "lastActivityAt": "2026-09-11T00:00:00Z"},
            {"id": "w2", "name": "beta", "state": "ready", "lastActivityAt": "2026-09-11T00:00:00Z"},
        ]))
        state = t / "state.json"
        bus3 = t / "events3.jsonl"
        base_env = dict(os.environ, CONDUCTOR_FIXTURE=str(ws), CONDUCTOR_STATE=str(state),
                        BOOMERANG_EMIT=str(EMIT), BOOMERANG_EVENTS=str(bus3))
        r = subprocess.run([sys.executable, str(POLLER)], capture_output=True, text=True,
                           env=base_env, timeout=30)
        check(r.returncode == 0 and "baseline" in r.stdout.lower() and not read_lines(bus3)
              and not bus3.is_file(),
              "first run = baseline snapshot, no events")
        ws.write_text(json.dumps([
            {"id": "w1", "name": "alpha", "state": "ready", "lastActivityAt": "2026-09-11T00:01:00Z"},
            {"id": "w2", "name": "beta", "state": "ready", "lastActivityAt": "2026-09-11T00:00:00Z"},
        ]))
        r = subprocess.run([sys.executable, str(POLLER)], capture_output=True, text=True,
                           env=base_env, timeout=30)
        evs3 = read_lines(bus3)
        check(r.returncode == 0 and len(evs3) == 1 and evs3[0]["event"] == "workspace_state"
              and evs3[0]["title"] == "alpha: building->ready", "state change emits workspace_state")
        r = subprocess.run([sys.executable, str(POLLER)], capture_output=True, text=True,
                           env=base_env, timeout=30)
        check(r.returncode == 0 and len(read_lines(bus3)) == 1, "no change → silent (no events)")

    # Hard invariant: the live bus must be untouched.
    after_live = live_bus_count()
    check(after_live == before_live,
          "live bus unchanged (before=%s after=%s)" % (before_live, after_live))

    print()
    if fails:
        print("BOOMERANG SMOKE: %d FAILURE(S): %s" % (len(fails), "; ".join(fails)))
        return 1
    print("BOOMERANG SMOKE: all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
