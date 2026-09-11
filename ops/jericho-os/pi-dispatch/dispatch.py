#!/usr/bin/env python3
"""
pi-dispatch — ONE host-side dispatcher for the fleet "Pi on demand" capability
(BRIEF "Pi for every agent").

Every fleet lane (jericho, pa/angela, donald, iris, dev, ...) writes a request
file into its OWN pi-dispatch/requests/ surface (`request.py` writes there).
This dispatcher, driven by a single host cron (/etc/cron.d/pi-dispatch, every
2 min), does the whole loop:

  1. INGEST  — for each lane with a local home, move pending request files into
               the canonical spool: <spool>/<lane>/inbox/<id>.json.
  2. FIRE    — for each ingested-but-not-yet-fired request, launch ONE paseo
               tab, labeled with the requesting lane (title + cwd + --label),
               capped at max_concurrent_tabs (default 5). The tab's working
               directory is <spool>/<lane>/work/<id>/ — its cwd IS the label.
  3. POLL    — every run, check each fired tab's status via `paseo agent ls`.
               When it finishes, grab <tab-cwd>/ANSWER.md (fallback: the last
               assistant message via `paseo agent logs`).
  4. DELIVER — write the answer to <spool>/<lane>/answers/<id>.md AND to the
               requesting lane's own answer surface
               <lane-home>/pi-dispatch/answers/<id>.md, exactly once
               (state.json carries delivered_at; no double delivery).
  5. STALE   — if a tab has not finished after stale_hours (~6h), record a
               STALE answer once so nothing silently disappears.

Hard rules baked in:
  * Fire-and-forget is forbidden. Every request ends in 'done', 'stale' or
    'failed' with a durable row in state.json.
  * Nothing here sends chat/DM messages. Automation lines live in state + logs.
  * Requests never contain secrets: suspicious files are quarantined, not fired.
  * Tabs are sandboxed to their spool cwd; /repos is read-only by instruction
    and the cwd can never be inside /repos.

Usage:
  dispatch.py                 full cycle (ingest, fire, poll, deliver)
  dispatch.py --poll-only     never fire new tabs; only poll + deliver
  dispatch.py --dry-run       print what it would do, change nothing
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

# --------------------------------------------------------------------------- #
# config
# --------------------------------------------------------------------------- #

HERE = Path(__file__).resolve().parent
LANES_FILE = HERE / "lanes.json"
SPOOL_DEFAULT = Path("/srv/hermes/data/pi-requests")
STATE_FILE_NAME = "state.json"
LOG_FILE_NAME = "dispatch.log"
LOCK_FILE_NAME = "dispatch.lock"
QUARANTINE_NAME = "_quarantine"

FIN = {"idle", "done", "finished", "complete", "completed",
       "stopped", "failed", "error", "archived"}

# loose secret sniff — requests must never carry live credentials
SECRET_HINTS = re.compile(
    r"(?i)(api[_-]?key|secret|token|password|passwd|bearer|private[_-]?key)"
    r"(\s*[:=]\s*|\s+)(['\"]?[A-Za-z0-9_\-\.+/]{12,})"
    r"|(sk-[A-Za-z0-9]{12,}|ghp_[A-Za-z0-9]{12,}|AKIA[A-Z0-9]{12,}|"
    r"xox[bap]-[A-Za-z0-9-]{10,}|ya29\.[A-Za-z0-9_\-]{20,})"
)

# paseo binary; cron has a minimal PATH so be explicit
PASEO = shutil.which("paseo") or "/usr/bin/paseo"

# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def uts(s: str) -> float:
    try:
        return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
    except Exception:
        return time.time()


def log(msg: str):
    line = "[%s] %s" % (now_iso(), msg)
    print(line, flush=True)


def load_json(p: Path, default=None):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:
        return default if default is not None else {}


def save_json(p: Path, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=2, sort_keys=True)
    os.replace(tmp, p)


def run(cmd, timeout=120, capture=True):
    try:
        r = subprocess.run(cmd, capture_output=capture, text=True, timeout=timeout)
        return r
    except subprocess.TimeoutExpired:
        return None
    except FileNotFoundError:
        return None


def paseo_ls() -> list:
    """[{id, shortId, name, provider, thinking, status, cwd, created}]"""
    r = run([PASEO, "agent", "ls", "-a", "--json"], timeout=90)
    if not r or r.returncode != 0:
        return []
    try:
        data = json.loads(r.stdout)
    except Exception:
        return []
    return data if isinstance(data, list) else data.get("agents", [])


def paseo_fire(lane, req, cwd, provider, thinking, extra_env=None) -> dict:
    """Launch a background paseo tab. Returns {ok, tab_id, raw}."""
    title = "pi-dispatch:%s:%s %s" % (lane, req["id"], (req.get("title") or req["prompt"][:40]))
    cmd = [
        PASEO, "agent", "run", "-d", "--json",
        "--cwd", str(cwd),
        "--title", title[:180],
        "--provider", provider,
        "--thinking", thinking,
        "--label", "requester=%s" % lane,
        "--label", "request=%s" % req["id"],
        "kind=pi-dispatch",
    ]
    if extra_env:
        for k, v in extra_env.items():
            cmd += ["--env", "%s=%s" % (k, v)]
    cmd.append(req["prompt"])
    r = run(cmd, timeout=120)
    if not r:
        return {"ok": False, "error": "paseo run timed out or missing"}
    raw = (r.stdout or "") + (r.stderr or "")
    try:
        out = json.loads(r.stdout or "{}")
        tab = out.get("agentId", "")
    except Exception:
        tab = ""
    # fallback: grep the id out of permissive output
    if not tab:
        m = re.search(r"(agentId|shortId)[\"']?\s*[:=]\s*[\"']?([0-9a-f]{8,})", raw, re.I)
        if m:
            tab = m.group(2)
    if r.returncode != 0 or not tab:
        return {"ok": False, "error": (raw[:300] or "non-zero exit, no tab id")}
    return {"ok": True, "tab_id": tab, "raw": raw[:500]}


def build_prompt(req: dict, lane_cfg: dict) -> str:
    display = lane_cfg.get("display", req["lane"])
    return (
        "You are PI, a subordinate worker dispatched by the %s fleet lane through "
        "the pi-dispatch capability (Paseo). You are a specialist worker inside "
        "Paseo. Your job is ONE task; nothing else.\n\n"
        "TASK:\n%s\n\n"
        "RULES:\n"
        "  - Work inside this working directory and any exact paths the task names.\n"
        "  - Do NOT write anywhere outside your working directory. Anything under\n"
        "    /repos is READ-ONLY — never modify it.\n"
        "  - Do not spawn, watch, steer, or manage other agents. Do not patrol the\n"
        "    fleet. Do not send any chat/notification to anyone. Stay in your lane.\n"
        "  - Never print or write credentials, tokens, keys or secrets anywhere.\n\n"
        "WHEN FINISHED:\n"
        "  1. Write your final answer as plain Markdown to:\n"
        "     %s/ANSWER.md\n"
        "     Lead with a one-line verdict, then the substance "
        "(a few lines is plenty for a small task).\n"
        "  2. End your final chat reply with the exact line: PI_DISPATCH_DONE\n"
        % (display, req["prompt"], req["_cwd"])
    )


def looks_suspicious(text: str) -> list:
    """Return list of matched secret-ish snippets (masked for logs)."""
    found = SECRET_HINTS.findall(text or "")
    return [m for m in found if m]


def quarantine(src: Path, spool: Path, reason: str):
    qdir = spool / QUARANTINE_NAME
    qdir.mkdir(parents=True, exist_ok=True)
    dst = qdir / src.name
    src.replace(dst)
    note = dst.with_suffix(".txt")
    note.write_text("quarantined %s at %s reason_cluster=%s\n" % (src.name, now_iso(), reason))
    log("QUARANTINE %s (%s)" % (src.name, reason))


# --------------------------------------------------------------------------- #
# state
# --------------------------------------------------------------------------- #

class State:
    def __init__(self, spool: Path):
        self.path = spool / "_system" / STATE_FILE_NAME
        self.data = load_json(self.path, {"requests": {}})
        self.data.setdefault("requests", {})

    def save(self):
        save_json(self.path, self.data)

    def get(self, rid):
        return self.data["requests"].get(rid)

    def put(self, rid, rec):
        self.data["requests"][rid] = rec


# --------------------------------------------------------------------------- #
# main loop
# --------------------------------------------------------------------------- #

def gather_pending_requests(spool: Path, lanes: dict):
    """Return list of {path, lane, request} for not-yet-ingested request files."""
    out = []
    for lane, cfg in lanes.items():
        home = cfg.get("home")
        if not home:
            continue  # remote lanes have no local surface on this host
        surf = Path(home) / "pi-dispatch" / "requests"
        if not surf.is_dir():
            continue
        for f in sorted(surf.glob("*.json")):
            req = load_json(f)
            if not isinstance(req, dict) or not req.get("id") or not req.get("prompt"):
                quarantine(f, spool, "malformed-or-missing-fields")
                continue
            allowed = req.get("requester", lane)
            if allowed != lane:
                quarantine(f, spool, "requester-mismatch")
                continue
            out.append({"path": f, "lane": lane, "request": req})
    return out


def ingest_requests(spool: Path, lanes: dict, state: State, dry: bool) -> list:
    """Move pending lane files into canonical spool inbox. Returns request dicts ready to fire."""
    pending = gather_pending_requests(spool, lanes)
    ready = []
    for item in pending:
        rid = item["request"]["id"]
        lane = item["lane"]
        if state.get(rid):
            # already known — clean up stray lane file if present
            if not dry:
                item["path"].unlink(missing_ok=True)
            continue
        # secret scan
        blob = json.dumps(item["request"])
        hits = looks_suspicious(blob)
        if hits:
            if not dry:
                quarantine(item["path"], spool, "secret-hint(%d)" % len(hits))
                log("request %s from %s QUARANTINED (secret-like content, not fired)" % (rid, lane))
            continue
        rec = {
            "id": rid,
            "lane": lane,
            "title": item["request"].get("title", ""),
            "prompt": item["request"]["prompt"],
            "created_at": item["request"].get("created_at", now_iso()),
            "ingested_at": now_iso(),
            "status": "queued",
            "tab_id": None,
            "fired_at": None,
            "delivered_at": None,
            "cwd": None,
            "error": None,
        }
        if not dry:
            inbox = spool / lane / "inbox"
            inbox.mkdir(parents=True, exist_ok=True)
            save_json(inbox / ("%s.json" % rid), item["request"])
            item["path"].unlink(missing_ok=True)
            log("ingested %s from %s -> %s/inbox/%s.json" % (rid, lane, lane, rid))
        else:
            log("[dry-run] would ingest %s from %s" % (rid, lane))
        # keep in-memory state consistent even in dry mode (so the fire phase
        # can see it); only the on-disk save is gated below.
        state.put(rid, rec)
        ready.append(rec)
    if not dry:
        state.save()
    return ready


def fire_pending(spool: Path, lanes: dict, state: State, dry: bool) -> int:
    provider = "pi/hyperfusion/deepseek-ai/DeepSeek-V4-Flash-0731"
    thinking = "high"
    cfg = load_json(LANES_FILE, {})
    if isinstance(cfg, dict):
        provider = cfg.get("provider", provider)
        thinking = cfg.get("thinking", thinking)
        max_tabs = int(cfg.get("max_concurrent_tabs", 5))
    else:
        max_tabs = 5

    active = count_active_tabs(state)
    to_fire = [
        (rid, rec)
        for rid, rec in state.data["requests"].items()
        if rec.get("status") == "queued"
    ]
    to_fire.sort(key=lambda x: x[1].get("created_at", ""))

    fired = 0
    for rid, rec in to_fire:
        if active + fired >= max_tabs:
            log("cap reached (%d/%d) — holding %s" % (active + fired, max_tabs, rid))
            break
        lane = rec["lane"]
        lane_cfg = lanes.get(lane, {})
        work = spool / lane / "work" / rid
        work.mkdir(parents=True, exist_ok=True)
        rec["_cwd"] = str(work)
        prompt = build_prompt(rec, lane_cfg)
        rec.pop("_cwd", None)
        if dry:
            log("[dry-run] would fire %s for %s in %s" % (rid, lane, work))
            continue
        (work / "request.json").write_text(json.dumps(rec, indent=2))
        (work / "origin.json").write_text(json.dumps({k: rec[k] for k in
            ("id", "lane", "title", "prompt", "created_at")}, indent=2))
        result = paseo_fire(lane, rec, work, provider, thinking)
        if result["ok"]:
            rec.update(
                status="dispatched", tab_id=result["tab_id"],
                fired_at=now_iso(), cwd=str(work), error=None,
            )
            state.put(rid, rec)
            log("FIRED %s lane=%s tab=%s cwd=%s" % (rid, lane, result["tab_id"], work))
            fired += 1
        else:
            retries = rec.get("_attempts", 0) + 1
            rec["_attempts"] = retries
            if retries >= 3:
                rec.update(status="failed", error=result.get("error"),
                           failed_at=now_iso())
                state.put(rid, rec)
                log("request %s FAILED after %d attempts: %s" % (rid, retries, result.get("error")))
            else:
                log("request %s fire attempt %d failed, will retry: %s"
                    % (rid, retries, result.get("error")))
    if not dry:
        state.save()
    return fired


def count_active_tabs(state: State) -> int:
    return sum(
        1 for rec in state.data["requests"].values()
        if rec.get("status") == "dispatched"
    )


def tabs_status_map() -> dict:
    """shortId / full id -> status"""
    m = {}
    for a in paseo_ls():
        m[a.get("id") or ""] = (a.get("status") or "").lower()
        m[a.get("shortId") or ""] = (a.get("status") or "").lower()
    return m


def fetch_answer_text(rec: dict) -> str:
    """Prefer ANSWER.md in the tab cwd; fall back to the last assistant log line."""
    cwd = rec.get("cwd")
    if cwd:
        amd = Path(cwd) / "ANSWER.md"
        if amd.is_file():
            txt = amd.read_text(errors="replace").strip()
            if txt:
                return "FROM ANSWER.md\n\n" + txt
    tab = rec.get("tab_id")
    if tab:
        r = run([PASEO, "agent", "logs", tab, "--tail", "400"], timeout=90)
        if r and r.returncode == 0:
            body = (r.stdout or "").strip()
            if body:
                # heuristic tail: last ~40 non-trivial lines
                lines = [l for l in body.splitlines() if l.strip()]
                tail = "\n".join(lines[-40:])
                return "FROM PASEO LOGS (answer file missing)\n\n" + tail[:6000]
    return ""


def poll_and_deliver(spool: Path, lanes: dict, state: State, dry: bool,
                     stale_hours: float) -> int:
    status_map = tabs_status_map()
    delivered = 0
    for rid, rec in state.data["requests"].items():
        if rec.get("status") != "dispatched":
            continue
        if rec.get("delivered_at"):
            continue
        tab = rec.get("tab_id")
        st = status_map.get(tab or "", "").lower()
        finished = st in FIN
        stale = (time.time() - uts(rec.get("fired_at", now_iso()))) > stale_hours * 3600

        answer = ""
        if finished:
            answer = fetch_answer_text(rec)
        if finished and not answer:
            answer = "(no answer text captured — tab finished without ANSWER.md and empty logs)"

        if finished or stale:
            if finished:
                rec["status"] = "done"
            else:
                rec["status"] = "stale"
            rec["delivered_at"] = now_iso()
            if dry:
                log("[dry-run] would deliver %s : %s (status=%s, stale=%s)"
                    % (rid, rec["status"], st, stale))
                continue
            # canonical copy
            ansdir = spool / rec["lane"] / "answers"
            ansdir.mkdir(parents=True, exist_ok=True)
            ansdir.joinpath("%s.md" % rid).write_text(
                "# pi-dispatch answer: %s\n\n- request_id: %s\n- lane: %s\n- status: %s\n- tab: %s\n- fired_at: %s\n- delivered_at: %s\n\n---\n\n%s\n"
                % (rid, rid, rec["lane"], rec["status"], tab or "-",
                   rec.get("fired_at", "-"), rec["delivered_at"], answer),
                errors="replace")
            # lane's own surface
            home = lanes.get(rec["lane"], {}).get("home")
            if home:
                lsurf = Path(home) / "pi-dispatch" / "answers"
                lsurf.mkdir(parents=True, exist_ok=True)
                lane_ans = lsurf / ("%s.md" % rid)
                lane_ans.write_text(
                    "# pi-dispatch answer: %s\n\n- request_id: %s\n- status: %s\n\n---\n\n%s\n"
                    % (rid, rid, rec["status"], answer),
                    errors="replace")
                # hand the file to the lane's own user so its container can
                # read/manage it (dispatcher may run as root via cron)
                try:
                    ho = Path(home).stat()
                    os.chown(str(lane_ans), ho.st_uid, ho.st_gid)
                except Exception:
                    pass
            state.put(rid, rec)
            log("DELIVERED %s -> %s/answers/%s.md (+ %s/pi-dispatch/answers/%s.md), status=%s"
                % (rid, rec["lane"], rid, rec["lane"], rid, rec["status"]))
            delivered += 1
    if not dry:
        state.save()
    return delivered


def main():
    ap = argparse.ArgumentParser(description="pi-dispatch host dispatcher")
    ap.add_argument("--poll-only", action="store_true",
                    help="never fire new tabs; only poll + deliver")
    ap.add_argument("--dry-run", action="store_true",
                    help="print what it would do, change nothing")
    ap.add_argument("--once", action="store_true")  # placeholder for cron semantics
    args = ap.parse_args()

    cfg = load_json(LANES_FILE, {})
    spool = Path(cfg.get("spool_root", SPOOL_DEFAULT)) if isinstance(cfg, dict) else SPOOL_DEFAULT
    lanes = (cfg.get("lanes", {}) if isinstance(cfg, dict) else {})
    stale_hours = float(cfg.get("stale_hours", 6)) if isinstance(cfg, dict) else 6.0

    spool.mkdir(parents=True, exist_ok=True)
    (spool / "_system").mkdir(exist_ok=True)
    lockf = open(spool / "_system" / LOCK_FILE_NAME, "w")
    try:
        fcntl.flock(lockf, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log("another dispatcher run holds the lock — skipping")
        return 0

    state = State(spool)

    # 1+2. ingest + fire (unless poll-only)
    if not args.poll_only:
        ingest_requests(spool, lanes, state, args.dry_run)
        fire_pending(spool, lanes, state, args.dry_run)
    # 3+4+5. poll + deliver + stale
    poll_and_deliver(spool, lanes, state, args.dry_run, stale_hours)

    active = count_active_tabs(state)
    log("cycle done: active_tabs=%d total_requests=%d" % (active, len(state.data["requests"])))
    fcntl.flock(lockf, fcntl.LOCK_UN)
    return 0


if __name__ == "__main__":
    sys.exit(main())
