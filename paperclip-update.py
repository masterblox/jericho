import json, urllib.request

PAPERCLIP_BASE = "http://hermes-vps.tailc4f632.ts.net:3100"
API_KEY = "jer_924b41c8dc889b0b7e5f277cb612b7fbd7dc156b25aa8fecac6b7847ac13f3a3"
ISSUE_ID = "ac1c2648-5126-43db-9fa4-2a7c0df921d9"
RUN_ID = "2c28dd58-5835-45a7-805e-b2f8e6137210"

comment_body = """## DEV heartbeat — MAS-188 files created

Previous run timed out (root cause: missing auditLog.ts). All files created this heartbeat.

**New files (10):**
- lib/services/admin/auditLog.ts — logAdminAction helper
- supabase/migrations/20260707000000_add_processed_at_to_support_ticket.sql
- lib/trpc/routers/admin-support.ts — list, byId, markProcessed procedures
- app/(public)/contact/page.tsx — public contact form
- app/(public)/contact/actions.ts — server action (validate, rate-limit, insert, Resend)
- app/(admin)/admin/support/page.tsx — admin inbox
- lib/services/email/templates/SupportTicketConfirmation.tsx — email template
- tests/api/contact-submit.test.ts — 7 tests
- tests/app/admin/support.test.ts — 4 tests

**Modified (1):**
- lib/trpc/router.ts — registered admin.support router

**Remaining:** Run .hermes/mas-188-commit.sh to commit+push. Then create PR [MAS-188].
"""

comment_url = f"{PAPERCLIP_BASE}/api/issues/{ISSUE_ID}/comments"
data = json.dumps({"body": comment_body}).encode()
req = urllib.request.Request(comment_url, data=data, method="POST")
req.add_header("Authorization", f"Bearer {API_KEY}")
req.add_header("Content-Type", "application/json")
req.add_header("X-Paperclip-Run-Id", RUN_ID)

try:
    resp = urllib.request.urlopen(req)
    print(f"Comment: {resp.status}")
except urllib.error.HTTPError as e:
    print(f"Comment error: {e.code} — {e.read().decode()[:300]}")

patch_url = f"{PAPERCLIP_BASE}/api/issues/{ISSUE_ID}"
patch_data = json.dumps({"status": "in_review"}).encode()
patch_req = urllib.request.Request(patch_url, data=patch_data, method="PATCH")
patch_req.add_header("Authorization", f"Bearer {API_KEY}")
patch_req.add_header("Content-Type", "application/json")
patch_req.add_header("X-Paperclip-Run-Id", RUN_ID)

try:
    patch_resp = urllib.request.urlopen(patch_req)
    print(f"Status: {patch_resp.status}")
except urllib.error.HTTPError as e:
    print(f"Patch error: {e.code} — {e.read().decode()[:300]}")
