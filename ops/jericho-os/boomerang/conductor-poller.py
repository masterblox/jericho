#!/usr/bin/env python3
"""
Boomerang Conductor cloud poller.

Every 3 minutes (root cron /etc/cron.d/boomerang-conductor):
  1. GET https://api.conductor.build/v0/workspaces (Bearer from
     load_conductor_env.sh; the API requires a curl user-agent or it 403s).
  2. Compare each workspace {state, lastActivityAt} against the persisted state
     file (/srv/hermes/data/boomerang/conductor-state.json).
  3. On STATE change, emit a boomerang "workspace_state" event
     (title "<NAME>: <old>-><new>").

Behaviour:
  - First run with no prior state file = baseline snapshot (no events).
  - Silent (no stdout, no events) when nothing changed.
"""
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("CONDUCTOR_API_URL", "https://api.conductor.build/v0/workspaces")
STATE = os.environ.get("CONDUCTOR_STATE", "/srv/hermes/data/boomerang/conductor-state.json")
STATE_TMP = STATE + ".tmp"
EMIT = os.environ.get("BOOMERANG_EMIT", "/srv/hermes/data/boomerang/emit.py")
ENV_LOADER = os.environ.get(
    "CONDUCTOR_ENV_LOADER",
    "/srv/hermes/data/scripts/load_conductor_env.sh",
)

# Offline smoke-test hook: when set, read a pre-baked JSON workspace list from
# this file instead of calling the Conductor API (needs no credentials).
FIXTURE = os.environ.get("CONDUCTOR_FIXTURE", "")


def _bearer():
    out = subprocess.run(
        ["bash", "-lc", f"source {ENV_LOADER}; echo $CONDUCTOR_API_KEY"],
        capture_output=True, text=True, timeout=15,
    )
    return out.stdout.strip()


def _fetch():
    if FIXTURE:
        with open(FIXTURE, encoding="utf-8") as fh:
            return json.load(fh)
    key = _bearer()
    req = urllib.request.Request(
        BASE,
        headers={
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
            "User-Agent": "curl/8.5.0",
            "X-Conductor-Client": "curl/8.5.0",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json.loads(resp.read().decode())
    return body.get("data") or []


def _load_state():
    if os.path.exists(STATE):
        with open(STATE, encoding="utf-8") as fh:
            return json.load(fh)
    return {}


def _save_state(state):
    # atomic replace so a crash mid-write never corrupts the state file
    with open(STATE_TMP, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2, sort_keys=True)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(STATE_TMP, STATE)


def _emit(name, old, new):
    payload = {
        "source": "conductor",
        "event": "workspace_state",
        "title": f"{name}: {old}->{new}",
        "url": None,
        "details": f"workspace state changed {old} -> {new}",
    }
    r = subprocess.run([sys.executable, EMIT, json.dumps(payload)],
                       capture_output=True, text=True, timeout=20)
    if r.returncode != 0:
        print(f"conductor-poller: emit failed rc={r.returncode}: {r.stderr.strip()}", file=sys.stderr)


def main():
    try:
        ws = _fetch()
    except Exception as exc:  # noqa: BLE001
        print(f"conductor-poller: fetch failed: {exc}", file=sys.stderr)
        return 1

    prev = _load_state()
    first_run = not prev

    new_state = {}
    changes = []
    for w in ws:
        wid = w.get("id") or w.get("name") or "?"
        entry = {
            "name": w.get("name") or wid,
            "state": w.get("state"),
            "lastActivityAt": w.get("lastActivityAt"),
        }
        new_state[wid] = entry
        if not first_run:
            old = prev.get(wid)
            if old is not None and old.get("state") != entry["state"]:
                changes.append((entry["name"], old.get("state"), entry["state"]))

    _save_state(new_state)

    if first_run:
        print(f"conductor-poller: baseline snapshot of {len(ws)} workspace(s); no events emitted")
        return 0

    for name, old, new in changes:
        _emit(name, old, new)
        print(f"conductor-poller: state change {name}: {old}->{new}")

    # silent when unchanged (no output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
