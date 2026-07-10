#!/bin/bash
# Update MAS-21 (MAS-220) — work verified complete, close as done
KEY="jer_924b41c8dc889b0b7e5f277cb612b7fbd7dc156b25aa8fecac6b7847ac13f3a3"
BASE="http://hermes-vps.tailc4f632.ts.net:3100"
ISSUE="9169012e-56b6-467d-981b-d80e2defa149"
RUN="a1f4e5d4-ca18-4e50-be0c-e99c8dd424aa"

# 1. Post a comment with the verification 
echo "=== POSTING COMMENT ==="
curl -s -w "\nHTTP %{http_code}\n" \
  -X POST "${BASE}/api/issues/${ISSUE}/comments" \
  -H "Authorization: Bearer ${KEY}" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: ${RUN}" \
  -d '{"body":"## MAS-220 Verification — Work confirmed complete\n\nThe previous run (c1930c8a) timed out at 600s — the work was already shipped in PR #134. Verified against the current codebase:\n\n| Deliverable | File | Evidence |\n|---|---|---|\n| Full-bleed layout | page.tsx:74 | fixed inset-x-0 bottom-0 top-14 |\n| Height chain | Canvas.tsx:136 | height: \"100%\" |\n| Text tool surfaced | config.ts:128-130 | annotateActiveTool:\"text\" + enableTapToAddText:true + markupEditorTextInputMode:\"inline\" |\n| Tool-set cleanup | config.ts:83 | PINTURA_UTILS = [\"annotate\", \"frame\"] |\n| UserMenu z-index | UserMenu.tsx:75 | z-50 |\n| Revert disabled | config.ts:122 | enableButtonRevert: false |\n| Upscale | config.ts:142 | previewUpscale: true |\n\nNote: filter was dropped after issue authoring (code comment explains it is a no-op on the white base). This is intentional and documented in config.ts.\n\nClosing as done — no further action needed."}'

echo ""
echo ""

# 2. PATCH status to done
echo "=== PATCHING STATUS ==="
curl -s -w "\nHTTP %{http_code}\n" \
  -X PATCH "${BASE}/api/issues/${ISSUE}" \
  -H "Authorization: Bearer ${KEY}" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: ${RUN}" \
  -d '{"status":"done"}'
