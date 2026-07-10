# Fleet Cost Analysis — July Week 1 (Jul 1-7, 2026)

Generated: 2026-07-07 12:30 UTC+4 (Dubai)
Run: 748edf2b-5037-4ecf-be31-2145fa365e36

## TLDR

Fleet cost is negligible (< $1 for the week). The real cost is context destruction from gateway restarts — 35 combined restarts this week wiped all accumulated agent session context. Gateways stable for 54 hours since the Jul 6 cascade ended.

## Gateway Uptime

| Gateway | PID | Uptime | RSS | PCPU | Status |
|---|---|---|---|---|---|
| Jericho | 138 | 54h 00m | 682 MB | 3.1% | Stable |
| Default (DEV/PA/Iris/Donald) | 155 | 54h 00m | 73 MB | 0.3% | Stable |
| Figma MCP | 226 | 53h | 45 MB | 0.0% | Running |

## Restart History (July)

| Day | Jericho | Default | Cause |
|---|---|---|---|
| Jul 2 | 5 | 2 | SIGTERM cascade |
| Jul 5 | 0 | 0 | — |
| Jul 6 | 15 | 9 | Container restart cascade |
| Jul 7 | 2 | 2 | Today (boot + one cycle) |
| **Total** | **22** | **13** | — |

Current streak: 54h stable (no restarts since Jul 5 ~11:32 UTC).

## Context Compression (Accuracy Degradation)

| Gateway | Compressions | Status |
|---|---|---|
| Default | 9 | Degraded — sessions need /new |
| Jericho | 0 | Clean |

Default gateway crossed 150K-token threshold 9 times Jul 2-6. Each compression reduces accuracy. 3+ compressions = mandatory restart.

## Cron Efficiency

| Metric | Count |
|---|---|
| Total cron ticks | 3,284 |
| Silent (no_agent, empty stdout) | 3,276 |
| LLM invocations | 8 |
| Silent ratio | 99.76% |

All 8 LLM runs were legitimate scheduled jobs (morning briefing, nightly synthesis, research scans). No spurious LLM waste detected.

## API Cost Estimate

Model: DeepSeek v4-pro ($0.14/M input, $0.28/M output)

| Component | Est. Tokens | Est. Cost |
|---|---|---|
| 8 cron LLM runs (~130K/run) | ~1.04M total | $0.22 |
| 4-5 interactive sessions (~130K/session) | ~0.65M total | $0.14 |
| **Week total** | **~1.69M** | **~$0.36** |

No per-request token tracking in gateway logs — this is a conservative estimate based on compression thresholds. Actual cost likely lower since most sessions don't reach 150K tokens before /new.

## Error Breakdown (358 total)

| Category | Count | Type |
|---|---|---|
| Infra noise | 147 | Auxiliary client fallbacks, tool registry checks, auth.json perms, Telegram get_updates |
| Real errors | 211 | Mixed |
| By agent: DEV | 2 | — |
| By agent: PA | 1 | — |
| Gateway-level | 62 | Errors/failures/disconnects |

Bulk of real errors are provider/auth infrastructure (Codex OAuth cache, OpenRouter/Nous payment errors) — not agent behavior issues. DEV and PA are not producing error storms.

## Resource Usage

| Resource | Current | Threshold | Status |
|---|---|---|---|
| RAM | 4.4G / 7.8G (56%) | 90% | OK |
| Disk | 66G / 77G (86%) | 85% (Owl) | WATCH |
| Swap | 969M / 2.0G (47%) | 80% | OK |

Disk at 86% — above Owl Protocol threshold. Cleanup targets (squashfs-root, AppImage, turbopack, playwright) already pruned. Docker overlay accounts for ~55G of the 66G used. App data is ~10G. No safe auto-cleanup remaining.

## Fleet Summary

| Metric | Jul Wk1 | Trend |
|---|---|---|
| API spend | ~$0.36 | Negligible |
| Gateway restarts | 35 | High (cascade-driven) |
| Context compressions | 9 | Degrading default gateway |
| Cron efficiency | 99.76% silent | Excellent |
| Real errors | 211 | Mixed infra, not agent |
| Stability (current run) | 54h | Good |

## Action Items

1. Default gateway needs /new — 9 compressions, accuracy degraded
2. Disk at 86% — no auto-cleanup targets left. Only option is expanding DO droplet or removing large repos/foxsy assets
3. Codex OAuth cache stale — causing auxiliary client fallback errors on every vision/fallback attempt. Clear auth.json
4. Gateway restart cascade root cause still not fixed — 22 Jericho restarts this week erases all accumulated intelligence
