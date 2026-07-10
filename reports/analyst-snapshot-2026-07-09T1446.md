# Analyst Fleet Health Snapshot

**Timestamp**: 2026-07-09 14:45 DXB (10:45 UTC)

## Analyst Fleet Health Snapshot — 2026-07-09 14:45 DXB

### CRITICAL — Null-Null Orphan Cascade (ALL 200 issues)

Every issue returned by Paperclip has `assignedAgentId: null`. Not a per-issue problem — this is a fleet-wide data integrity failure where ALL assignments evaporated simultaneously. Every agent in the fleet shows zero assigned issues. Every PATCH will return 403 "outside authorization boundary."

Status distribution: 140 blocked, 34 in_progress, 14 todo, 12 done.

**Blocker**: Paperclip admin DB intervention required. Cannot be fixed from inside the container. All fleet agents are paralyzed — no agent can receive work, no issue status can be updated.

### HIGH — SIGTERM Cascade on gateway-default

20 SIGTERMs in agent.log, with 3 clusters today (13:11, 14:10, 14:32 DXB). All targeting gateway-default. Load averages at kill time: 24.31, 24.79, 18.59 — well above the s6 15-threshold. Gateway is alive now (pid 178, uptime ~700s) but another SIGTERM is likely given current load.

### HIGH — System Load 17+

Current load: 17.23 / 18.68 / 19.46 on 2 CPUs. Above the 15-threshold where s6 starts SIGTERMing gateways. Contributing factors: swap pressure (68%), zombie LSP processes, and the null-assignment cascade causing idle-poll cycles.

### MEDIUM — Disk at 88%

67G/77G used on overlay (host-level). 9.6G remaining. Approaching 90% threshold. Container cleanup candidates: node_modules in repos (architect-ai ~908MB, memories-express-mvp-cp ~1013MB).

### MEDIUM — Swap at 68%

1.4G/2.0G swap used. Below the 80% s6-kill threshold but elevated.

### LOW — Memory at 48%

Jericho memory: 15,418/32,000 chars (48%). 1 stale overflow event in logs. No compaction needed — the overflow was transient.

### Healthy
- Gateways: default + jericho running per consolidated fleet model. All others down (correct).
- Bridge: active handoffs from today (09:45 DXB)
- Jericho outbox: active queue (deferred Paperclip closes from 14:38-14:43)
- Zombie processes: 1 small tsserver (0.9%, 1min uptime) — not actionable

### Paperclip Timeline Today
- 10:38 DXB: Healthy (api_key_working=true, 0 issues assigned)
- 13:30 DXB: Auth deadlock (health=200, Bearer endpoints timeout)
- 14:33 DXB: Gateways restarted (post-SIGTERM cascade)
- 14:45 DXB: Partially recovered (issue list works 200 results in 49s) but NULL-ASSIGNED CASCADE

### Recommended Action
1. **P0**: Host-level Paperclip admin DB intervention to restore issue assignments
2. **P0**: Monitor for another SIGTERM cascade — kill zombie LSP processes preemptively if load exceeds 20
3. **P1**: Clear node_modules from stale repos to recover ~2GB disk
4. **P2**: After assignments are restored, audit which issues were mid-flight when the cascade hit