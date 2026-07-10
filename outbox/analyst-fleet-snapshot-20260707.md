# Analyst Fleet Health Snapshot
**2026-07-07 19:09 UTC (23:09 DXB)**

## Gateways

| Profile | PID | Uptime | Status |
|---------|-----|--------|--------|
| default | 169 | 6h34m | running |
| researcher | 15876 | 14m | running (recent restart) |
| jericho | 20312 | 5m | running (fresh) |
| analyst | — | — | DEAD |
| donald | — | — | DEAD |
| iris | — | — | DEAD |
| pa | — | — | DEAD |

Analyst gateway crash-looped. Log shows repeated starts at 12:06 UTC, no current process. Last log entry at 12:06:37 — dead for ~7 hours.

## Resources

- Disk: 69G/77G (90%) — critical, unchanged
- Memory: 4.0G/7.8G used, 608M free, swap 1.8G/2.0G — swap pressure high
- CPU: normal load

## Paperclip Issues

| Status | Count |
|--------|-------|
| todo | 228 |
| blocked | 106 |
| done | 11 |
| in_progress | 2 |
| in_review | 1 |
| **Total** | **348** |

Assigned to Analyst: 0

## Bridge

Conductor bridge outbox (jericho-handoffs): EMPTY — 0 files, 0 stale. Bridge is clean.

## Jericho Outbox

19 files pending. Oldest: 2026-06-30 (DEV-RECONSTRUCT). The outbox has been accumulating with no automated relay. Key stale items: DEV-blocked-pipeline-20260707, analyst-mas-243-complete, analyst-mas-243-URGENT.

## Errors

974 total in agent.log. Recent pattern: `providers.anthropic: unknown config keys ignored: auth_mode` (harmless config warning, repeated on every gateway boot). No critical errors in recent window.

## Assessment

1. Analyst/Donald/Iris/PA gateways all dead — only default, researcher, and jericho are running. 3 of 7 gateways alive.
2. 106 blocked issues in Paperclip — the DEV pipeline blockade persists (was 98, now 106).
3. Jericho outbox accumulating with no automated relay — 19 files.
4. Disk at 90% is the hard ceiling — no further cleanup possible without droplet expand.
5. Researcher gateway restarted 14 min ago — still unstable.
