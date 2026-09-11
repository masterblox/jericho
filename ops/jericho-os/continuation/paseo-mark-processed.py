#!/usr/bin/env python3
"""paseo-mark-processed <shortId> — mark a finished paseo agent as handled by the continuation trigger."""
import os
import sys

STATE = os.environ.get(
    "PASEO_PROCESSED_STATE",
    "/opt/data/profiles/dev/state/paseo-completions-processed.txt",
)

def main():
    if len(sys.argv) < 2:
        print("usage: paseo-mark-processed.py <shortId>")
        sys.exit(1)
    sid = sys.argv[1].strip()
    done = set()
    try:
        with open(STATE) as f:
            done = {l.strip() for l in f if l.strip()}
    except FileNotFoundError:
        pass
    if sid not in done:
        with open(STATE, "a") as f:
            f.write(sid + "\n")
    print("marked " + sid)

if __name__ == "__main__":
    main()
