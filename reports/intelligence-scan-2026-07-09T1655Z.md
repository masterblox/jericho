# Intelligence Cross-Lane Scan — 2026-07-09 16:55 UTC (20:55 Dubai)

Wake: Empty heartbeat. Paperclip State 4 zombie socket — no issues assignable.
Run ID: c99cd018-3192-4cc0-9ba6-ea786f95f311
Agent: Intelligence (f2216417)

---

## PAPERCLIP: State 4 Zombie Socket — CRITICAL

- Raw socket: connect succeeds, recv times out after 5s — classic zombie LISTEN socket
- Health: HTTP 000 (curl exit 28) on both Tailscale and localhost
- All fleet agents blocked from issue pipeline
- Paperclip server process is dead; port 3100 (0C1C) LISTEN socket orphaned
- 9 deferred-close files queued in /opt/data/jericho/outbox/
- Recovery closer cron (8f3e069d48d7, every 30m, last run 16:10 OK) ready to process when Paperclip returns
- BLOCKER: Container-locked — no Docker socket, no root, no fuser. Host-level restart required.
- Previous intelligence wake (6800c309, 16:50 UTC) was also empty — this is the second consecutive empty heartbeat for Intelligence

## SYSTEM: Severe Memory Pressure — HIGH

| Metric | Value | Change |
|--------|-------|--------|
| Load (1m) | 21.57 | Down from 22.53 (zombie kill) |
| Swap | 100% (2.0/2.0Gi) | No change |
| RAM free | 2.1Gi | Up from 708Mi (+1.4Gi reclaimed) |
| LSP zombies | 3 remaining | 6 killed, 3 reinfected |
| SIGTERMs total | 22 | +0 since last scan |
| Memory overflow | 1 event | Historical, current usage ~52% |

- Gateway-default SIGTERM'd at 14:32 and 16:03 under s6 supervision (load 18.59 and 17.41 respectively)
- 6 LSP zombies killed: 2 tsserver (~800MB + ~500MB), 2 typescript-language-server, 1 yaml-language-server, 1 typingsInstaller
- 3 remain — LSP reinfection from this scan session's tool use
- Root fix: disable Hermes LSP integration (`hermes config set lsp.enabled false`)

## GATEWAYS: Normal — OK

- 2 running: Jericho (pid 162, 406MB, ~2.3h uptime) + default (pid 31568, 577MB, ~47min uptime)
- All non-running gateways "not started yet" — normal consolidated fleet model
- s6/ps discrepancy: none detected — both gateways under s6 supervision

## LOGS: Minor — LOW

- 401 OpenRouter errors in agent.log (MoA auth header missing)
- MoA service likely not running — gateways fall back to direct provider calls
- Impact: LOW per fleet-intelligence skill guidance

## BRIDGE & VAULT: Stale but Expected — MEDIUM

- Last conductor bridge handoff: Jul 9 09:45 UTC (7+ hours ago)
- Jericho outbox: 9 deferred-close files (agents working locally)
- Vault: 3 markdown files modified in last 24h
- Pattern: agents producing local work, unable to sync through Paperclip

## DISK: Manageable — OK

- 89% used (68G/77G), 8.8G free
- Improved from 92% in prior scan

## ACTIONS TAKEN

1. Killed 6 zombie LSP processes (~1.4Gi RAM reclaimed, load dropped 0.96 points)
2. Verified Paperclip zombie socket via raw socket probe
3. Confirmed gateway health — both Jericho and default stable

## RECOMMENDATIONS

1. Paperclip: Host-level restart required (container-locked, cannot fix from within)
2. Memory: Disable LSP integration to stop zombie reinfection cycle
3. When Paperclip recovers: recovery closer cron will auto-process 9 queued deferred closes
4. No gateway intervention needed — both running stable under s6
