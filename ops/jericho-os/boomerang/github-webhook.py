#!/usr/bin/env python3
"""
Boomerang GitHub webhook receiver.

Persistent listener, LANE-SCOPED to the boomerang transport layer.
- Binds 127.0.0.1:9124 (caddy strips /webhooks/dev/github and proxies here).
- POST / only. Verifies X-Hub-Signature-256 HMAC against the shared secret in
  /srv/hermes/data/boomerang/.github_secret (0600 root). Unverified -> 401.
- Normalizes events and forwards them to the boomerang event bus via the ONLY
  sanctioned append path: /srv/hermes/data/boomerang/emit.py.

Frozen normalizations (see brief boomerang-webhooks.md):
  pull_request action=closed & merged=true   -> pr_merged
  pull_request action=closed & merged=false  -> pr_closed_unmerged
  workflow_run action=completed              -> ci_completed (conclusion, PR# if present)
  push to the repo default branch            -> push_main
Everything else returns 200 without emitting (deliberately silent).
"""
import hashlib
import hmac
import json
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Canonical live values; env overrides exist so smoke tests never touch the
# live secret/bus. BOOMERANG_EMIT may point at a test emit.py whose
# BOOMERANG_EVENTS points at a scratch bus file.
HOST = os.environ.get("BOOMERANG_HOST", "127.0.0.1")
PORT = int(os.environ.get("BOOMERANG_PORT", "9124"))
SECRET_FILE = os.environ.get("BOOMERANG_SECRET_FILE", "/srv/hermes/data/boomerang/.github_secret")
EMIT = os.environ.get("BOOMERANG_EMIT", "/srv/hermes/data/boomerang/emit.py")


def _secret():
    with open(SECRET_FILE, encoding="utf-8") as fh:
        return fh.read().strip()


def _emit(payload):
    """Forward a normalized event to the bus via emit.py."""
    r = subprocess.run(
        [sys.executable, EMIT, json.dumps(payload)],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        print(f"github-webhook: emit failed rc={r.returncode}: {r.stderr.strip()}", flush=True)
        return None
    print(f"github-webhook: emitted {payload.get('event')} -> {r.stdout.strip()[:140]}", flush=True)
    return r.stdout.strip()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # silence access log
        pass

    # -- plumbing ----------------------------------------------------------
    def _read_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n > 0 else b""

    def _hmac_ok(self, body):
        given = self.headers.get("X-Hub-Signature-256", "")
        if not given.startswith("sha256="):
            return False
        mac = hmac.new(_secret().encode(), body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(given[len("sha256="):], mac)

    def _send(self, code):
        self.send_response(code)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        self._send(405)  # receiver is POST-only

    def do_POST(self):
        body = self._read_body()
        event = self.headers.get("X-GitHub-Event", "")
        if not self._hmac_ok(body):
            print("github-webhook: rejected (bad/missing X-Hub-Signature-256)", flush=True)
            self._send(401)
            return
        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except Exception as exc:  # noqa: BLE001
            print(f"github-webhook: unparseable body: {exc}", flush=True)
            payload = {}
        handled = self._normalize(event, payload)
        self._send(200)
        if not handled:
            print(f"github-webhook: unhandled {event} action={payload.get('action')}; acked 200", flush=True)

    # -- normalization -----------------------------------------------------
    def _normalize(self, event, p):
        repo = ((p.get("repository") or {}).get("full_name")) or "?"

        if event == "pull_request" and p.get("action") == "closed":
            pr = p.get("pull_request") or {}
            num, title = pr.get("number"), (pr.get("title") or "")
            merged = bool(pr.get("merged"))
            if merged:
                etype, headline = "pr_merged", f"PR #{num} merged: {title} - {repo}"
            else:
                etype, headline = "pr_closed_unmerged", f"PR #{num} closed unmerged: {title} - {repo}"
            _emit({"source": "github", "event": etype, "title": headline,
                   "url": pr.get("html_url"),
                   "details": f"repo={repo} merged={merged}"})
            return True

        if event == "workflow_run" and p.get("action") == "completed":
            wr = p.get("workflow_run") or {}
            name = wr.get("name") or wr.get("display_title") or "?"
            conclusion = wr.get("conclusion") or "?"
            prs = wr.get("pull_requests") or []
            pr_num = prs[0].get("number") if (prs and isinstance(prs[0], dict)) else None
            details = f"repo={repo} conclusion={conclusion}"
            if pr_num:
                details += f" pr={pr_num}"
            _emit({"source": "github", "event": "ci_completed",
                   "title": f"CI {conclusion}: {name} - {repo}",
                   "url": wr.get("html_url"), "details": details})
            return True

        if event == "push":
            ref = p.get("ref", "")
            default_branch = (p.get("repository") or {}).get("default_branch") or "main"
            if ref == f"refs/heads/{default_branch}":
                head = (p.get("head_commit") or {})
                msg = (head.get("message") or "").splitlines()[0][:80]
                details = f"{repo} {ref}"
                if p.get("pusher"):
                    details += f" by {(p.get('pusher') or {}).get('name') or '?'}"
                _emit({"source": "github", "event": "push_main",
                       "title": f"push to {default_branch} on {repo}: {msg or 'commit'}",
                       "url": head.get("url") or (p.get("repository") or {}).get("html_url"),
                       "details": details})
                return True
            return False

        return False


if __name__ == "__main__":
    print(f"github-webhook: listening on {HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
