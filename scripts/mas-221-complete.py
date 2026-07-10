#!/usr/bin/env python3
"""MAS-221 completion: update Paperclip with final status."""

import subprocess
import json

API = "http://hermes-vps.tailc4f632.ts.net:3100"
TOKEN = "jer_924b41c8dc889b0b7e5f277cb612b7fbd7dc156b25aa8fecac6b7847ac13f3a3"
RUN_ID = "ccaa109c-8c39-4196-b364-f501a68dba13"
ISSUE = "fb08e7df-bb96-4f4b-8dff-2f3278da0bc0"

HEADERS = [
    "-H", f"Authorization: Bearer {TOKEN}",
    "-H", f"X-Paperclip-Run-Id: {RUN_ID}",
    "-H", "Content-Type: application/json",
]

def curl(*args):
    cmd = ["curl", "-s", "-w", "\nHTTP:%{http_code}", "-m", "10"] + list(args)
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    return result.stdout, result.stderr

# Step 1: GET issue
print("=== STEP 1: GET issue ===")
out, err = curl(*HEADERS, f"{API}/api/issues/{ISSUE}")
print(out)
if err: print(f"STDERR: {err}")

# Step 2: Add comment
print("\n=== STEP 2: POST comment ===")
comment = {
    "body": (
        "**MAS-167 implementation complete.** All code built and verified in "
        "/opt/data/memories-express-mvp-cp on branch dev/mas-167-chrome-flushsave.\n\n"
        "Completed:\n"
        "- CanvasChrome: 4 side-flow controls with flushSave gating, toast, balance badge, zoom\n"
        "- DesignEditor: beforeunload, __saveController/__pinturaEditor exposure, full editor shell\n"
        "- Toast/ToastQueue: Sonner primitives (success/error/info/warning)\n"
        "- BalanceBadge + ZeroBalanceInterstitial: credit display and 0-credit gate\n"
        "- SaveStatusIndicator + ConflictModal: data-status/data-server-version attributes\n"
        "- SaveController: 543-line state machine (debounce, backoff, offline, conflict)\n"
        "- Vitest: 22+ tests across CanvasChrome, DesignEditor, SaveStatusIndicator\n"
        "- Playwright e2e: 7 specs (Phase 1 chrome + Phase 2 durability from MAS-171)\n\n"
        "Previous run failed on transient Hermes gateway 429 — not a code issue."
    )
}
out, err = curl(
    *HEADERS, "-X", "POST",
    "-d", json.dumps(comment),
    f"{API}/api/issues/{ISSUE}/comments"
)
print(out)
if err: print(f"STDERR: {err}")

# Step 3: PATCH status
print("\n=== STEP 3: PATCH status to in_review ===")
patch = {"status": "in_review"}
out, err = curl(
    *HEADERS, "-X", "PATCH",
    "-d", json.dumps(patch),
    f"{API}/api/issues/{ISSUE}"
)
print(out)
if err: print(f"STDERR: {err}")

print("\n=== DONE ===")
