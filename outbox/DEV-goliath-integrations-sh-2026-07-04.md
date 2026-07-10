---
from: jericho
to: dev
date: 2026-07-04
priority: low
tags: [goliath, integrations, discoverability, mcp]
---

# List Goliath on integrations.sh

## What
Rhys Sullivan (YC '26, executor.sh) launched [integrations.sh](https://integrations.sh) — an open-source catalog of MCP/API/CLI/GraphQL servers. 328 stars, growing.

## Why Goliath
Goliath is an MCP server (9 tools, Go binary, Camoufox engine). Getting listed = free discoverability in the AI builder crowd.

## How (simple)
Publish ONE JSON file on `mechanica.one`:

```
/.well-known/integrations.json
```

v3 schema. Goliath as an MCP surface:

```json
{
  "version": 3,
  "summary": "Anti-detection browser automation MCP server for AI agents. 9 tools for navigating, clicking, scraping, and capturing pages that block Playwright.",
  "surfaces": [
    {
      "slug": "goliath-mcp",
      "name": "Goliath MCP server",
      "type": "mcp",
      "docs": "https://github.com/masterblox/goliath",
      "transports": ["stdio"],
      "auth": { "status": "none" },
      "basis": {
        "via": "declared",
        "source": "https://mechanica.one/.well-known/integrations.json"
      }
    }
  ]
}
```

Then visit `https://integrations.sh/mechanica.one/` → click "Map integration surface."

## Effort
5 minutes. One static JSON file, one cache header.

## Full docs
https://integrations.sh/publishing/
