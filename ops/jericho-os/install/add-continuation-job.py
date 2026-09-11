#!/usr/bin/env python3
"""
add-continuation-job.py — merge the Jericho OS continuation job into a lane's
cron/jobs.json, backup-first and idempotent.

This is a DELIBERATE, separate step from the script installer: the cron
system owns jobs.json, so the continuation installer does NOT write it. Use
this helper when you actually want the job live after a rebuild.

Usage:
  add-continuation-job.py [--jobs PATH] [--template PATH] [--dry-run]
      --jobs       target jobs.json (default /srv/hermes/data/profiles/dev/cron/jobs.json)
      --template   job template (default ../continuation/continuation-job.json)
      --scripts-dir  what %SCRIPTS_DIR% resolves to in the prompt
                   (default /srv/hermes/data/profiles/dev/scripts)

Behaviour:
  * skips if a job with the same id already exists (idempotent)
  * backs up jobs.json to jobs.json.bak-jericho-os-<UTC> before any write
  * renders %SCRIPTS_DIR% into the prompt
  * --dry-run prints the plan, changes nothing
"""
from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--jobs", default="/srv/hermes/data/profiles/dev/cron/jobs.json")
    ap.add_argument("--template", default=None)
    ap.add_argument("--scripts-dir", default="/srv/hermes/data/profiles/dev/scripts")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    jobs_p = Path(args.jobs)
    tpl_p = Path(args.template) if args.template else (
        Path(__file__).resolve().parent.parent / "continuation" / "continuation-job.json"
    )

    if not tpl_p.is_file():
        print(f"FATAL: template not found: {tpl_p}", file=__import__("sys").stderr)
        return 2
    if not jobs_p.is_file():
        print(f"FATAL: jobs.json not found: {jobs_p}", file=__import__("sys").stderr)
        return 2

    template = json.loads(tpl_p.read_text(encoding="utf-8"))
    job = template["jobs"][0]
    job_id = job["id"]

    # render prompt placeholder (only inside the prompt)
    text = job.get("prompt", "")
    if "%SCRIPTS_DIR%" in text:
        job["prompt"] = text.replace("%SCRIPTS_DIR%", args.scripts_dir)

    data = json.loads(jobs_p.read_text(encoding="utf-8"))
    jobs = data.setdefault("jobs", [])
    existing = [j for j in jobs if j.get("id") == job_id]
    if existing:
        print(f"job '{job_id}' already present ({len(existing)} entry) — nothing to do")
        return 0

    if args.dry_run:
        print(f"[dry-run] would add job '{job_id}' to {jobs_p} (scripts_dir={args.scripts_dir})")
        print("[dry-run] no changes made")
        return 0

    ts = now_utc()
    bak = jobs_p.with_name(f"{jobs_p.name}.bak-jericho-os-{ts}")
    shutil.copy2(jobs_p, bak)
    print(f"backup: {jobs_p} -> {bak}")

    jobs.append(job)
    data["updated_at"] = f"{datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')}"
    tmp = jobs_p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    tmp.replace(jobs_p)
    print(f"added job '{job_id}' to {jobs_p} (backup at {bak.name})")
    return 0


if __name__ == "__main__":
    import sys

    sys.exit(main())
