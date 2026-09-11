#!/usr/bin/env python3
"""paseo-pending-completions — cron CONTEXT script.
Prints finished paseo agents that have NOT yet been processed by the continuation trigger.
"""
import json
import os
import subprocess

STATE = os.environ.get(
    "PASEO_PROCESSED_STATE",
    "/opt/data/profiles/dev/state/paseo-completions-processed.txt",
)
FIN = {"idle", "done", "finished", "complete", "completed", "stopped", "failed", "error"}

# Offline smoke-test hook: read paseo `ls --json` from a file instead of ssh.
PASEO_JSON_FILE = os.environ.get("PASEO_JSON_FILE", "")

def load_processed():
    try:
        with open(STATE) as f:
            return {l.strip() for l in f if l.strip()}
    except FileNotFoundError:
        return set()

def paseo_ls():
    if PASEO_JSON_FILE:
        with open(PASEO_JSON_FILE, encoding="utf-8") as fh:
            return json.load(fh)
    r = subprocess.run(["ssh", "host", "paseo ls -a --json"], capture_output=True, text=True, timeout=90)
    return json.loads(r.stdout)

def main():
    try:
        data = paseo_ls()
    except Exception:
        print("PARSE-ERROR fetching paseo state")
        return
    agents = data if isinstance(data, list) else data.get("agents", [])
    done = load_processed()
    pending = []
    for a in agents:
        st = (a.get("status") or "").lower()
        sid = a.get("shortId", "?")
        if st in FIN and sid not in done:
            pending.append("%s|%s|%s" % (sid, st, (a.get("name") or "?")[:80]))
    if pending:
        print("UNPROCESSED FINISHED AGENTS:")
        print("\n".join(sorted(pending)))
    else:
        print("(no unprocessed completions)")

if __name__ == "__main__":
    main()
