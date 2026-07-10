# SPEC-14: Agent Dispatch System

**Subsystem:** Jericho → agent command dispatch
**Source:** Carlos directive → Jericho decomposition
**Target:** `/opt/conductor-bridge/outbox/{lane}/`
**Frequency:** On-demand (Carlos-initiated)
**Status:** ❌ Scaffold needed

## Integration

### Dispatch Flow
1. Carlos gives directive to Jericho (via DM)
2. Jericho decomposes into lane-specific tasks
3. Dispatch manifest written to `dispatch/{id}.json`
4. Individual tasks routed to agent outboxes
5. Jericho tracks completion via state/digest

### Dispatch Manifest Schema
```json
{
  "id": "jericho-dispatch-001",
  "directive": "Prepare LaunchRail v2 deployment",
  "created": "2026-06-27T10:00:00Z",
  "tasks": [
    {
      "lane": "dev",
      "task": "Audit deploy config, fix stale settings",
      "status": "pending",
      "bridge_file": "conductor-bridge/outbox/engineer-messages/dispatch-001-dev.md"
    },
    {
      "lane": "iris",
      "task": "Update landing page with v2 features",
      "status": "pending",
      "bridge_file": "conductor-bridge/outbox/iris-consults-queue/dispatch-001-iris.md"
    }
  ],
  "status": "dispatched"
}
```

### Lane Routing Rules
| Directive type | Primary lane | Secondary |
|---|---|---|
| Infra/code/deploy | DEV | — |
| Calendar/email/contacts/CRM | PA | DEV for tech setup |
| Design/visual/UI/deck | Iris | DEV for implementation |
| Sales/outreach/client | Donald | PA for scheduling |
| Fleet-wide (upgrades) | DEV | All agents |

### Decomposition Rules
- Single-lane directive: dispatch directly, no manifest needed
- Multi-lane directive: create manifest, dispatch parallel tasks
- Sequential dependency: manifest tracks order (task B after task A)

### Verification
- [ ] Dispatch manifest created for multi-lane directives
- [ ] Bridge files appear in correct agent outbox
- [ ] Jericho tracks completion
