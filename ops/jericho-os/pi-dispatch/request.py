#!/usr/bin/env python3
"""
pi-dispatch — request engineering help from the Pi worker lane.

This helper writes a request file into THIS lane's pi-dispatch surface
(`<lane-home>/pi-dispatch/requests/<id>.json`). The fleet host dispatcher
(cron, every 2 min) picks it up, launches a Paseo Pi tab labeled with this
lane, tracks it, and writes the answer back to
`<lane-home>/pi-dispatch/answers/<id>.md`.

The lane never talks to Paseo or the host directly — it only writes one file.

Usage (run from inside this lane, e.g. through the file/terminal toolset):
  python3 <this>/request.py "<task prompt>" [--title "Short title"]
  python3 <this>/request.py --status          list pending + answered ids
  python3 <this>/request.py --check <id>      show that request's answer path
  python3 <this>/request.py --help

Guardrails:
  * NEVER put API keys, tokens, passwords or secrets in a task prompt or title.
    The request file is read by the host dispatcher and paraphrased into a
    worker prompt. Secrets in a request get the request QUARANTINED (not fired).
  * Keep the prompt self-contained: the worker runs in its own sandbox with
    only the paths you name (absolute paths on this box work).
  * The worker answers in plain Markdown; a small task takes a few minutes.
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
LANE_FILE = HERE / "lane.json"


def lane_name() -> str:
    try:
        d = json.loads(LANE_FILE.read_text())
        return d.get("lane", "unknown")
    except Exception:
        return "unknown"


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def do_submit(task: str, title: str) -> None:
    lane = lane_name()
    rid = uuid.uuid4().hex[:12]
    if not task.strip():
        print("error: empty task prompt", file=sys.stderr)
        sys.exit(2)
    if any(k in task.lower() or k in title.lower()
           for k in ("api_key", "api-key", " secret ", " token ", " password ",
                     "bearer ", "sk-", "ghp_")):
        print("WARNING: your prompt looks like it may contain a secret. "
              "Refusing to write it (the dispatcher would quarantine it anyway).",
              file=sys.stderr)
        sys.exit(2)
    req = {
        "id": rid,
        "requester": lane,
        "title": title.strip() or task.strip()[:60],
        "prompt": task.strip(),
        "created_at": now_iso(),
        "status": "queued",
    }
    outdir = HERE / "requests"
    outdir.mkdir(parents=True, exist_ok=True)
    path = outdir / ("%s.json" % rid)
    path.write_text(json.dumps(req, indent=2) + "\n")
    print("pi-dispatch request written: %s" % path)
    print("  id:     %s" % rid)
    print("  lane:   %s" % lane)
    print("  answer: %s/answers/%s.md" % (HERE, rid))
    print("  (the host dispatcher picks this up within ~2 minutes)")


def do_status() -> None:
    lane = lane_name()
    print("lane: %s" % lane)
    pend = sorted((HERE / "requests").glob("*.json")) if (HERE / "requests").is_dir() else []
    print("queued on this lane: %d" % len(pend))
    for p in pend:
        try:
            d = json.loads(p.read_text())
            print("  %s  %s  %s" % (d.get("id", "?"), d.get("title", ""), d.get("created_at", "")))
        except Exception:
            print("  %s (unreadable)" % p.name)
    ansdir = HERE / "answers"
    if ansdir.is_dir():
        anss = sorted(ansdir.glob("*.md"))
        print("answered: %d" % len(anss))
        for p in anss:
            print("  %s" % p.name)


def do_check(rid: str) -> None:
    ans = HERE / "answers" / ("%s.md" % rid)
    if ans.is_file():
        print("answer for %s: %s" % (rid, ans))
        print("---")
        print(ans.read_text()[:4000])
    else:
        print("no answer yet for %s (check back in a few minutes)" % rid)
        q = HERE / "requests" / ("%s.json" % rid)
        print("request still queued: %s" % q.is_file())


def main():
    ap = argparse.ArgumentParser(description="pi-dispatch lane request helper")
    ap.add_argument("task", nargs="?", default=None, help="task prompt for Pi")
    ap.add_argument("--title", default="", help="short human-readable title")
    ap.add_argument("--status", action="store_true", help="list queued + answered")
    ap.add_argument("--check", metavar="ID", default=None, help="show a request's answer")
    args = ap.parse_args()

    if args.status:
        do_status()
        return 0
    if args.check:
        do_check(args.check)
        return 0
    if not args.task:
        ap.print_help()
        return 1
    do_submit(args.task, args.title)
    return 0


if __name__ == "__main__":
    sys.exit(main())
