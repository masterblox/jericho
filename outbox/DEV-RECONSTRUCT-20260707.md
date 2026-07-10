---
source: Jericho
timestamp: 2026-07-07T04:40:00+04:00
channel: conductor-bridge
target: DEV
priority: HIGH
subject: Align with masterblox/hermes repo docs + fleet state
---

# DEV -- Fleet Repo Alignment

Carlos wants you fully aligned with the masterblox/hermes repo. Your skills directory is empty. Fix that now.

## Repo Location

```
/opt/data/hermes/docs/
```

## Required Reading (in order)

1. README.md -- fleet topology, directory map, VPS specs
2. operations/fleet-operations-manual.md -- THE master ops reference
3. architecture/bridge-automation.md -- conductor bridge protocol
4. operations/infra-quickfixes.md -- npm, git netrc, pnpm, session bloat fixes
5. operations/github-token-sources.md -- where tokens actually live
6. operations/agent-health-check.md -- diagnostics
7. operations/runtime-gateway-registration.md -- s6 service creation
8. operations/fleet-error-diagnostics.md -- systematic error diagnosis
9. systems/goliath-architecture.md -- anti-detection browser
10. systems/paperclip-integration.md -- task orchestration API

## Fleet State (as of Jul 7 04:40 DXB)

| Agent | Status | Gateway |
|-------|--------|---------|
| DEV | Running | Default (PID 37784) |
| PA | Running | Default (consolidated) |
| Iris | Active | Default (one-shots via iris-consult-runner.py) |
| Donald | Running | Dedicated (s6 service) |
| Jericho | Running | Dedicated (PID 41998) |

## Key Paths for DEV

- Shared config: /opt/data/config.yaml
- Your skills: /opt/data/.hermes/skills/ (empty -- seed from repo)
- Fleet repo: /opt/data/hermes/
- Bridge inbox: /opt/conductor-bridge/outbox/engineer-messages/
- TICKETS.md: /opt/conductor-bridge/outbox/engineer-messages/TICKETS.md

## Lane Reminder

DEV = code, infra, Linear, GitHub, deploys. Never cross into PA/Iris/Donald lanes.

## Action Items

1. Read README.md and fleet-operations-manual.md
2. Load the infra-quickfixes and github-token-sources references
3. Report back with your current open tickets and blockers
4. Confirm GitHub token access by testing: curl -sI -H "Authorization: bearer $(grep -oP 'GH_TOKEN=\K.*' /opt/data/.env)" https://api.github.com/
