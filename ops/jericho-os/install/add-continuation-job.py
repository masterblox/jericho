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
      --force        proceed despite a same-name/different-id job collision
                     (only when the old job is deliberately dead)

Behaviour:
  * skips if a job with the same id already exists (idempotent)
  * REFUSES (exit 3) if a job with the same name exists under a different id:
    the template id (`jericho-os-continuation`) differs from the older live id
    of this same job (`aad03cdd19f5`), and stacking a second copy on a live
    jobs.json would DOUBLE-FIRE the continuation cron. Remove or migrate the
    old job first (cron admin / jobs.json), or pass --force only when the old
    job is deliberately dead.
  * backs up jobs.json to jobs.json.bak-jericho-os-<UTC> before any write
  * renders %SCRIPTS_DIR% into the prompt
  * --dry-run prints the plan, changes nothing
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
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
    ap.add_argument("--force", action="store_true",
                    help="proceed despite a same-name/different-id job collision "
                         "(only when the old job is deliberately dead)")
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

    job_name = job.get("name", "")

    # Idempotency by id: a job already under the new id is a no-op.
    same_id = [j for j in jobs if j.get("id") == job_id]
    if same_id:
        print(f"job '{job_id}' already present ({len(same_id)} entry) — nothing to do")
        return 0

    # Same-name / different-id collision — the double-fire trap the REBUILD
    # runbook warns about. The template id (`jericho-os-continuation`) differs
    # from the older live id of this same job (`aad03cdd19f5`), so the id-only
    # check above would not stop us from stacking a second, also-firing copy.
    collisions = [j for j in jobs if j.get("name") == job_name and j.get("id") != job_id]
    if collisions:
        old_ids = ", ".join(repr(j.get("id")) for j in collisions)
        warning = (
            f"job {job_name!r} already exists under a DIFFERENT id ({old_ids}).\n"
            f"  Adding {job_id!r} alongside it would DOUBLE-FIRE the continuation cron\n"
            f"  (both copies run every 2 min on the same box)."
        )
        if not args.force:
            print(
                "FATAL — " + warning + "\n"
                "  Remove or migrate the old job first (cron admin / jobs.json), then re-run.\n"
                "  To proceed anyway — only if the old job is deliberately dead — pass --force.",
                file=sys.stderr,
            )
            return 3
        print("WARNING — " + warning + "\n  Proceeding anyway because --force was given.", file=sys.stderr)

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
    sys.exit(main())
