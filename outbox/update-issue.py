import urllib.request
import json

PAPERCLIP_BASE = "http://hermes-vps.tailc4f632.ts.net:3100"
API_KEY = "jer_924b41c8dc889b0b7e5f277cb612b7fbd7dc156b25aa8fecac6b7847ac13f3a3"
ISSUE_ID = "6520e8f8-841d-4e20-a523-bdb9ebb03789"
RUN_ID = "36a36c37-6287-4c57-b960-1fdc699e1f05"

COMMENT = (
    "MAS-52 / MAS-239 Complete Audit\n\n"
    "Verdict: ALREADY IMPLEMENTED. Previous run (34b51bfc) failed with "
    "gateway 429 before inspecting the repo. Full file-by-file audit "
    "confirmed every deliverable exists.\n\n"
    "Complete inventory:\n"
    "- DB: claim_scheduled_jobs (FOR UPDATE SKIP LOCKED) + sweep_stale_scheduled_jobs\n"
    "- Dispatcher: lib/services/jobs/dispatcher.ts (claim-dispatch-complete/retry/dead)\n"
    "- Handlers: 12 kinds registered, 4 real + 8 stubs\n"
    "- Routes: /api/cron/run-jobs, /api/cron/sweep, /api/cron/expire-generation-jobs\n"
    "- Env: CRON_SECRET in lib/env.ts + docs/build-plan/env.md\n"
    "- Tests: 11 pgTAP (claim) + 10 pgTAP (sweep) + 10 vitest (dispatcher) "
    "+ 5 vitest (run-jobs) + 5 vitest (sweep)\n\n"
    "Intentional divergences from MAS-52 spec:\n"
    "1. vercel.json DELETED - scheduling moved to Cloudflare Cron Worker (MAS-241)\n"
    "2. Route is /api/cron/run-jobs not /api/cron/scheduled-jobs\n"
    "3. Dispatcher at lib/services/jobs/ (repo convention)\n"
    "4. Handler stubs throw NOT_IMPLEMENTED (no silent drops)\n\n"
    "Remaining ops: CRON_SECRET on Vercel Production + redeploy. Routes 401 without it.\n\n"
    "Disposition: in_review. No code changes needed."
)

def do_request(method, path, body=None):
    url = f"{PAPERCLIP_BASE}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {API_KEY}")
    req.add_header("Content-Type", "application/json")
    if body is not None:
        req.add_header("X-Paperclip-Run-Id", RUN_ID)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()
        try:
            return e.code, json.loads(body_text)
        except:
            return e.code, {"error": body_text[:500]}

print("=== ADDING COMMENT ===")
status, body = do_request("POST", f"/api/issues/{ISSUE_ID}/comments", {"body": COMMENT})
print(f"Status: {status}")
print(json.dumps(body, indent=2)[:800])

print("\n=== UPDATING STATUS TO in_review ===")
status, body = do_request("PATCH", f"/api/issues/{ISSUE_ID}", {"status": "in_review"})
print(f"Status: {status}")
print(json.dumps(body, indent=2)[:800])
