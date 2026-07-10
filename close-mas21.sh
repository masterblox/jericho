#!/bin/bash
KEY="jer_924b41c8dc889b0b7e5f277cb612b7fbd7dc156b25aa8fecac6b7847ac13f3a3"
BASE="http://hermes-vps.tailc4f632.ts.net:3100"
ISSUE="9169012e-56b6-467d-981b-d80e2defa149"
RUN="a1f4e5d4-ca18-4e50-be0c-e99c8dd424aa"

echo "=== COMMENT ==="
curl -s -w "\nHTTP %{http_code}" -X POST "${BASE}/api/issues/${ISSUE}/comments" \
  -H "Authorization: Bearer ${KEY}" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: ${RUN}" \
  -d '{"body":"MAS-220: verified complete. PR #134 already shipped all deliverables. See run a1f4e5d4 for verification. Closing as done."}'

echo ""
echo "=== PATCH STATUS ==="
curl -s -w "\nHTTP %{http_code}" -X PATCH "${BASE}/api/issues/${ISSUE}" \
  -H "Authorization: Bearer ${KEY}" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: ${RUN}" \
  -d '{"status":"done"}'
