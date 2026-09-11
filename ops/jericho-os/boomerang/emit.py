#!/usr/bin/env python3
"""
Boomerang event bus emitter — THE ONLY sanctioned way to append to
/srv/hermes/data/boomerang/events.jsonl.

Usage:
  emit.py '{"source":"github","event":"pr_merged","title":"...",...}'
  echo '{"source":"github","event":"pr_merged","title":"..."}' | emit.py

Behaviour:
  - Auto-fills: id (unique), at (ISO8601 UTC), processed=false.
  - Validates the exact allowed keys and that source is one of the frozen enum
    (github|conductor|linear|paseo). Rejects unknown/missing fields.
  - Appends one JSON object per line with an exclusive flock + fsync so
    concurrent emitters (webhook thread, cron poller) never interleave lines.
  - Prints the final line to stdout on success; exit code 0.

Key order on disk is fixed: id, at, source, event, title, url, details, processed.
"""
import datetime
import fcntl
import json
import os
import sys
import uuid

# Canonical bus path; override for smoke tests / alternate spools.
EVENTS = os.environ.get("BOOMERANG_EVENTS", "/srv/hermes/data/boomerang/events.jsonl")

REQUIRED = ["source", "event", "title"]
ALLOWED = {"id", "at", "source", "event", "title", "url", "details", "processed"}
SOURCES = {"github", "conductor", "linear", "paseo"}
KEY_ORDER = ["id", "at", "source", "event", "title", "url", "details", "processed"]


def _now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def main(argv):
    if len(argv) > 1 and argv[1].strip():
        raw = argv[1]
    else:
        raw = sys.stdin.read()
    raw = (raw or "").strip()
    if not raw:
        print("emit: usage: emit.py '<json>' or pipe one JSON line on stdin", file=sys.stderr)
        return 2
    try:
        ev = json.loads(raw)
    except Exception as exc:  # noqa: BLE001
        print(f"emit: bad json: {exc}", file=sys.stderr)
        return 2

    unknown = sorted(set(ev) - ALLOWED)
    if unknown:
        print(f"emit: unknown keys (allowed={sorted(ALLOWED)}): {unknown}", file=sys.stderr)
        return 2
    missing = [k for k in REQUIRED if ev.get(k) in (None, "")]
    if missing:
        print(f"emit: missing required keys: {missing}", file=sys.stderr)
        return 2
    if ev["source"] not in SOURCES:
        print(f"emit: invalid source '{ev['source']}' (must be one of {sorted(SOURCES)})", file=sys.stderr)
        return 2

    ev.setdefault("id", f"emit-{uuid.uuid4().hex}")
    ev["at"] = _now_iso()
    ev["processed"] = False
    line = json.dumps({k: ev.get(k) for k in KEY_ORDER}, ensure_ascii=False)

    parent = os.path.dirname(EVENTS)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(EVENTS, "a", encoding="utf-8") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            fh.write(line + "\n")
            fh.flush()
            os.fsync(fh.fileno())
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)

    print(line)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except BrokenPipeError:
        sys.exit(0)
