#!/usr/bin/env python3
"""paseo-finished-digest — cron MONITOR.
Prints a deterministic digest of FINISHED paseo agents (non-archived).
Output changes ONLY when an agent finishes, errors, or is archived → wakes the trigger agent.
"""
import json
import os
import subprocess
import sys

FIN = {"idle", "done", "finished", "complete", "completed", "stopped", "failed", "error"}

# Offline smoke-test hook: when set, read paseo `ls --json` output from a
# file instead of `ssh host paseo` (no live fleet access needed).
PASEO_JSON_FILE = os.environ.get("PASEO_JSON_FILE", "")

def paseo_ls():
    if PASEO_JSON_FILE:
        with open(PASEO_JSON_FILE, encoding="utf-8") as fh:
            return json.load(fh)
    r = subprocess.run(
        ["ssh", "host", "paseo ls -a --json"],
        capture_output=True, text=True, timeout=90,
    )
    return json.loads(r.stdout)

def main():
    try:
        data = paseo_ls()
    except Exception:
        print("PARSE-ERROR")
        return
    agents = data if isinstance(data, list) else data.get("agents", [])
    rows = []
    for a in agents:
        st = (a.get("status") or "").lower()
        if st in FIN:
            rows.append("%s|%s|%s" % (a.get("shortId", "?"), st, (a.get("name") or "?")[:70]))
    print("\n".join(sorted(rows)) if rows else "(no finished agents)")

if __name__ == "__main__":
    main()
