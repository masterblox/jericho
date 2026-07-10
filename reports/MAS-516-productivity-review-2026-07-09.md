# MAS-516 — Productivity Review: MAS-514 (INTEL-6)

## Verdict: Productive — close as expected pattern

## Source Trigger
Paperclip detected high churn on MAS-514: 10 runs / 2 assignee comments in 1h and 6h windows, with a 7-run no-comment streak.

## Root Cause: Paperclip Degradation, Not Agent Inefficiency

Every run in the sample was a recovery wake. The trigger chain:
1. MAS-514 (INTEL-6) was opened during Paperclip Stage 3 collapse
2. Agents completed real remediation work but couldn't post comments or close the issue
3. Paperclip's liveness system detected `in_progress` with no terminal close and kept waking the issue
4. Each wake agent correctly audited state, found prior work completed, and attempted close

Paperclip was Stage 3 (port listen, no process) for early runs, then Stage 4 (health 200 on HTTP/1.1 but authenticated endpoints timeout) for later runs. No agent could mutate issue state, so no-comment streaks are fully expected.

## Run-by-Run Audit

| # | Run ID (short) | Status | Actual Work |
|---|---------------|--------|-------------|
| 1 | 95d883b5 | succeeded/blocked | Initial scan — killed 5 zombie LSPs, freed 730MB, diagnosed Paperclip Stage 3 |
| 2-6 | various | succeeded | Recovery wakes — verified prior work, attempted close (Paperclip unreachable) |
| 7 | f7613584 | succeeded | Deferred close JSON created, state verification table, resolution report |
| 8 | 0ec399ea | succeeded/plan_only | Liveness continuation — flagged for concrete actions |
| 9 | 107d0a66 | succeeded/plan_only | Same liveness continuation (duplicate fire) |
| 10 | c785ba44 | succeeded/needs_followup | Killed MCP orphans (figma-mcp, goliath, yaml-ls), restarted default gateway (592MB→114MB), updated deferred close |
| 11 | 39f7eac5 | running | Concerned about load re-spike to 20.25 — load settled to 15.96 by 17:11 |

## Concrete Remediation Delivered

- Round 1 (run 1): Killed 5 zombie LSPs → freed 730MB, memory 4.5Gi→3.5Gi
- Round 2 (run 10): Killed 3 MCP orphans, restarted default gateway → freed 478MB RSS
- Net: Load 17.12→15.79, swap 100%→91%, 1.2GB+ reclaimed

## Cost Analysis

Total token cost across sampled runs: negligible (gateway-billed, no external API costs). The 10 runs are a cost of Paperclip degradation, not agent inefficiency — refusing to process recovery wakes would miss the round-2 remediation that actually improved the system state.

## Disposition

Close as productive. This pattern is 100% expected when Paperclip is Stage 3-4. Every run contributed to diagnosis and remediation. The churn metric is a false positive caused by Paperclip's own degradation preventing terminal state transitions. Snooze window would mask future genuine churn on this issue type.

## Resolution Artifacts

- Resolution report: /opt/data/jericho/reports/MAS-514-resolution-2026-07-09.md
- Deferred close: /opt/data/jericho/outbox/paperclip-deferred-close-MAS-514.json
- Recovery closer cron: active every 30m

## Re-Wake 2026-07-09T17:30Z

Paperclip re-woke MAS-516 via continuation (`issue_continuation_needed`). Reason: deferred close from run b8a094fd never applied because Paperclip is 000 (fully dead — health endpoint returns 000, no process listening). 

Verification on re-wake:
- Review report intact (2,972 bytes)
- Deferred close JSON intact and valid (772 bytes, target_status: done)
- Recovery closer cron active (8f3e069d48d7, every 30m, last ok 17:16 UTC)
- 80+ deferred closes queued — systemic backlog from extended Paperclip outage
- No new facts, no new runs to audit — prior disposition stands unchanged

Action: acknowledged wake, no changes needed. Deferred close will apply when Paperclip recovers.
