#!/bin/bash
# Quick Paperclip API test
API_KEY="jer_924b41c8dc889b0b7e5f277cb612b7fbd7dc156b25aa8fecac6b7847ac13f3a3"
BASE="http://hermes-vps.tailc4f632.ts.net:3100"
RUN_ID="98508c7c-101d-4a18-b1af-aade251aaaad"

echo "=== Testing Paperclip API ==="
echo "1. GET /api/health"
curl -s -o /dev/null -w "HTTP %{http_code} (time: %{time_total}s)\n" --connect-timeout 5 --max-time 10 \
  -H "Authorization: Bearer $API_KEY" \
  "$BASE/api/health" 2>&1 || echo "FAILED"

echo "2. GET /api/agents/me"
curl -s -o /dev/null -w "HTTP %{http_code} (time: %{time_total}s)\n" --connect-timeout 5 --max-time 10 \
  -H "Authorization: Bearer $API_KEY" \
  "$BASE/api/agents/me" 2>&1 || echo "FAILED"

echo "3. GET /api/companies/5e826a0c-c9ea-4f28-8646-7d340629dc92/issues?limit=5"
curl -s -o /dev/null -w "HTTP %{http_code} (time: %{time_total}s)\n" --connect-timeout 5 --max-time 10 \
  -H "Authorization: Bearer $API_KEY" \
  "$BASE/api/companies/5e826a0c-c9ea-4f28-8646-7d340629dc92/issues?limit=5" 2>&1 || echo "FAILED"

echo "4. TCP check port 3100"
timeout 3 bash -c 'echo >/dev/tcp/127.0.0.1/3100' 2>&1 && echo "PORT OPEN" || echo "PORT CLOSED"

echo "5. Check for listening socket on 3100"
ss -tlnp 2>/dev/null | grep 3100 || echo "No listener on 3100"
