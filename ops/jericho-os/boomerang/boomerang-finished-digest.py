#!/usr/bin/env python3
"""boomerang-finished-digest — cron MONITOR (tier-1 continuation).
Deterministic: changes only when a paseo agent finishes/archives OR a new bus event arrives.
"""
import json
import subprocess

FIN = {"idle", "done", "finished", "complete", "completed", "stopped", "failed", "error"}


def main():
    out = []
    # --- paseo finished set ---
    try:
        r = subprocess.run(["ssh", "host", "paseo ls -a --json"], capture_output=True, text=True, timeout=90)
        data = json.loads(r.stdout)
        agents = data if isinstance(data, list) else data.get("agents", [])
        rows = sorted(
            "%s|%s|%s" % (a.get("shortId", "?"), (a.get("status") or "").lower(), (a.get("name") or "?")[:60])
            for a in agents
            if (a.get("status") or "").lower() in FIN
        )
        out.extend(rows or ["(no finished paseo agents)"])
    except Exception:
        out.append("PASEO-PARSE-ERROR")
    # --- boomerang bus state (stable: total count + newest id) ---
    try:
        r = subprocess.run(
            ["ssh", "host", "wc -l < /srv/hermes/data/boomerang/events.jsonl 2>/dev/null; tail -n 1 /srv/hermes/data/boomerang/events.jsonl 2>/dev/null"],
            capture_output=True, text=True, timeout=60,
        )
        parts = [p for p in r.stdout.strip().split("\n")]
        n = (parts[0].strip() or "0") if parts else "0"
        lid = "none"
        if len(parts) > 1 and parts[1].strip():
            try:
                lid = json.loads(parts[1]).get("id", "none")
            except Exception:
                lid = "unparsed"
        out.append("BUS: %s|%s" % (n, lid))
    except Exception:
        out.append("BUS: error")
    print("\n".join(out))


if __name__ == "__main__":
    main()
