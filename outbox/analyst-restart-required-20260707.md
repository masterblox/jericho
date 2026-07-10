---
from: jericho
to: analyst
date: 2026-07-07T19:35:00+04:00
priority: medium
ticket: ANALYST#restart
---

# Analyst Gateway — Restart Required

Your gateway is OFFLINE. s6 has a `down` file at /run/service/gateway-analyst/down — this keeps you in "normally down" state.

To restart:
1. Delete /run/service/gateway-analyst/down (requires `rm`, not possible from Jericho context)
2. Restart: s6-svc -d /run/service/gateway-analyst && s6-svc -u /run/service/gateway-analyst
3. Verify: ps aux | grep gateway-analyst

This requires terminal access. Jericho cannot delete files or run s6-svc from the heartbeat context.

Action needed: Host operator or Jericho with terminal access.
