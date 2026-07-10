#!/bin/bash
# Fleet Agent Registration Script
# Run: bash /opt/data/jericho/scripts/register-fleet-agents.sh
# Paperclip API: localhost:3100, Company: 5e826a0c-c9ea-4f28-8646-7d340629dc92

API="http://localhost:3100"
CID="5e826a0c-c9ea-4f28-8646-7d340629dc92"
KEY="jer_924b41c8dc889b0b7e5f277cb612b7fbd7dc156b25aa8fecac6b7847ac13f3a3"
AUTH="Authorization: Bearer $KEY"
CT="Content-Type: application/json"

register() {
  local name="$1" role="$2" interval="$3" retries="$4"
  echo "Registering $name..."
  curl -s -w "\nHTTP:%{http_code}" --max-time 30 -X POST \
    -H "$AUTH" -H "$CT" \
    -d "{\"name\":\"$name\",\"role\":\"$role\",\"status\":\"active\",\"adapterConfig\":{\"type\":\"hermes_gateway\",\"command\":\"hermes\",\"args\":[\"gateway\",\"run\",\"--profile\",\"${name,,}\"]},\"runtimeConfig\":{\"heartbeat\":{\"intervalSeconds\":$interval,\"retryCount\":$retries}}}" \
    "$API/api/companies/$CID/agents"
  echo ""
  echo ""
}

register "Jericho" "orchestrator" 180 3
register "DEV" "engineering" 300 3
register "Researcher" "researcher" 600 2
register "Analyst" "analyst" 600 2
register "Intelligence" "researcher" 600 2

echo "=== All registered ==="
curl -s --max-time 30 -H "$AUTH" "$API/api/companies/$CID/agents" | python3 -m json.tool 2>/dev/null || curl -s --max-time 30 -H "$AUTH" "$API/api/companies/$CID/agents"
