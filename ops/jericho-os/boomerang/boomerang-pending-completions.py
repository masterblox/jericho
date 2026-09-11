#!/usr/bin/env python3
"""boomerang-pending-completions — cron CONTEXT script (tier-1 continuation).
Lists (a) unprocessed finished paseo agents, (b) unprocessed boomerang bus events.
"""
import json
import os
import subprocess

PASEO_STATE = os.environ.get(
    "PASEO_PROCESSED_STATE",
    "/opt/data/profiles/dev/state/paseo-completions-processed.txt",
)
BUS_STATE = os.environ.get(
    "BOOMERANG_PROCESSED_STATE",
    "/opt/data/profiles/dev/state/boomerang-events-processed.txt",
)
FIN = {"idle", "done", "finished", "complete", "completed", "stopped", "failed", "error"}

# Offline smoke-test hooks: read paseo/ssh fixtures from files when set.
PASEO_JSON_FILE = os.environ.get("PASEO_JSON_FILE", "")
BUS_JSONL_FILE = os.environ.get("BOOMERANG_JSONL_FILE", "")


def load(path):
    try:
        with open(path) as f:
            return {l.strip() for l in f if l.strip()}
    except FileNotFoundError:
        return set()


def paseo_ls():
    if PASEO_JSON_FILE:
        with open(PASEO_JSON_FILE, encoding="utf-8") as fh:
            return json.load(fh)
    r = subprocess.run(["ssh", "host", "paseo ls -a --json"], capture_output=True, text=True, timeout=90)
    return json.loads(r.stdout)

def bus_tail():
    if BUS_JSONL_FILE:
        with open(BUS_JSONL_FILE, encoding="utf-8") as fh:
            return fh.read()
    r = subprocess.run(["ssh", "host", "tail -n 200 /srv/hermes/data/boomerang/events.jsonl 2>/dev/null"], capture_output=True, text=True, timeout=60)
    return r.stdout

def main():
    # --- paseo ---
    try:
        data = paseo_ls()
        agents = data if isinstance(data, list) else data.get("agents", [])
        done = load(PASEO_STATE)
        pend = sorted(
            "%s|%s|%s" % (a.get("shortId", "?"), (a.get("status") or "").lower(), (a.get("name") or "?")[:80])
            for a in agents
            if (a.get("status") or "").lower() in FIN and a.get("shortId", "?") not in done
        )
        print("UNPROCESSED FINISHED PASEO AGENTS:")
        print("\n".join(pend) if pend else "(none)")
    except Exception as e:
        print("PASEO: error reading state (%s)" % e)
    # --- bus ---
    try:
        out = bus_tail()
        done = load(BUS_STATE)
        pend = []
        for line in out.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except Exception:
                continue
            if ev.get("id") in done:
                continue
            pend.append("%s | %s | %s | %s" % (ev.get("id", "?"), ev.get("source", "?"), ev.get("event", "?"), (ev.get("title") or "")[:110]))
        print("UNPROCESSED BUS EVENTS:")
        print("\n".join(pend[-25:]) if pend else "(none)")
    except Exception as e:
        print("BUS: error reading events (%s)" % e)


if __name__ == "__main__":
    main()
