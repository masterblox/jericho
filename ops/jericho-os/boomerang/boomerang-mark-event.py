#!/usr/bin/env python3
"""boomerang-mark-event <event-id> — mark a bus event as handled."""
import os
import sys

STATE = os.environ.get(
    "BOOMERANG_PROCESSED_STATE",
    "/opt/data/profiles/dev/state/boomerang-events-processed.txt",
)


def main():
    if len(sys.argv) < 2:
        print("usage: boomerang-mark-event.py <event-id>")
        sys.exit(1)
    eid = sys.argv[1].strip()
    done = set()
    try:
        with open(STATE) as f:
            done = {l.strip() for l in f if l.strip()}
    except FileNotFoundError:
        pass
    if eid not in done:
        with open(STATE, "a") as f:
            f.write(eid + "\n")
    print("marked " + eid)


if __name__ == "__main__":
    main()
