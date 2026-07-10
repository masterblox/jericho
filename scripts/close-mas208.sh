#!/bin/bash
# Close MAS-208 as done
API_KEY="jer_924b41c8dc889b0b7e5f277cb612b7fbd7dc156b25aa8fecac6b7847ac13f3a3"
RUN_ID="c8d87012-9e22-4011-97d9-d776160b1ad6"
BASE="http://hermes-vps.tailc4f632.ts.net:3100"
ISSUE_ID="24e6d8b8-e8a6-41d9-b714-72aeb41165e5"

# 1. PATCH to done
curl -s -X PATCH "${BASE}/api/issues/${ISSUE_ID}" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: ${RUN_ID}" \
  -d '{"status":"done"}'

echo ""

# 2. Add closing comment
curl -s -X POST "${BASE}/api/issues/${ISSUE_ID}/comments" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: ${RUN_ID}" \
  -d '{"body":"MAS-208 complete. Implementation verified on disk:\n\n- `/account/designs/new/` route deleted entirely (no GET-time row creation)\n- `createDesignAction` server action in `_actions.ts` with auth + workgroup gating + FORBIDDEN handling\n- Dashboard, designs list, team templates, library tabs all wired via `<form action={createDesignAction}>`\n- Vitest: `createDesignAction.test.ts` (auth, workgroup, FORBIDDEN)\n- Playwright e2e: `designs-create.spec.ts` (click start-a-memory, wait for URL)\n\nNo path to mint rows from a GET request remains. Refresh/back/prefetch/bots safe."}'

echo ""
