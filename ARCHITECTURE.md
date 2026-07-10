# Jericho — Supreme Intelligence & Orchestration Layer

**Layer:** One step below Carlos. One step above all agents.
**Bus:** `/opt/data/jericho/`
**Vault:** `/opt/brain/` (synced via obsidian-git, ~10-30min)
**Mode:** Cron-driven intelligence aggregation + filesystem command dispatch

## Architecture

```
                          CARLOS
                             │
                    ┌────────┴────────┐
                    │    JERICHO      │  ← Supreme intelligence layer
                    │  (this system)  │
                    └───┬───┬───┬─────┘
                        │   │   │
           ┌────────────┼───┼───┼────────────┐
           ▼            ▼   ▼   ▼            ▼
        ┌──────┐   ┌──────┐ ┌──────┐   ┌─────────┐
        │ DEV  │   │  PA  │ │ IRIS │   │ DONALD  │  ← Leaf agents
        │infra │   │ ops  │ │design│   │ sales   │
        └──────┘   └──────┘ └──────┘   └─────────┘
```

### Two Flow Directions

**UPLINK (data → Jericho):**
Every automated report, watcher, synthesis, and health check routes its output to Jericho's inbox. Jericho aggregates, deduplicates, and produces a single intelligence snapshot for Carlos.

**DOWNLINK (Jericho → agents):**
Carlos gives Jericho a directive. Jericho decomposes it, dispatches to the correct agent lane via the conductor bridge outbox, and tracks completion.

## Bus Structure

```
/opt/data/jericho/
├── inbox/          # All uplink reports land here
│   ├── morning/    # Morning synthesis (DEV, PA, Iris)
│   ├── nightly/    # Vault processing results
│   ├── weekly/     # Weekly review
│   └── realtime/   # Watcher alerts (errors, PRs, costs, replies)
├── outbox/         # Downlink dispatches to agents
│   ├── dev/        # DEV lane commands
│   ├── pa/         # PA lane commands
│   ├── iris/       # Iris consult requests
│   ├── donald/     # Donald lane commands
│   └── fleet/      # Fleet-wide directives (upgrades, restarts)
├── state/          # Durable state files
│   ├── fleet.json  # Agent status, versions, health
│   ├── digest.json # Last digest timestamp per source
│   └── dispatch.json # Active dispatch tracking
├── dispatch/       # Active dispatch manifests
├── reports/        # Aggregated intelligence digests
│   ├── daily/      # Daily briefs for Carlos
│   └── weekly/     # Weekly summaries
├── intel/          # Cross-referenced intelligence
│   ├── people/     # Contact cross-references
│   ├── projects/   # Project state synthesis
│   └── signals/    # Early warning signals
└── health/         # Fleet health snapshots
    ├── versions.json
    ├── costs.json
    └── errors.json
```

## Subsystem Integration Registry

| # | Subsystem | Status | Integration Point | Spec |
|---|-----------|--------|-------------------|------|
| 1 | **Morning Synthesis** (DEV/PA/Iris) | Scripts exist, not running | `inbox/morning/` | `specs/01-morning-synthesis.md` |
| 2 | **Nightly Vault Processor** | Script exists, not running | `inbox/nightly/` | `specs/02-nightly-processor.md` |
| 3 | **Weekly Review** | Script exists, not running | `inbox/weekly/` | `specs/03-weekly-review.md` |
| 4 | **Iris Reply Watcher** | Cron paused | `inbox/realtime/iris-*.json` | `specs/04-iris-watcher.md` |
| 5 | **Error Log Watcher** | Script exists, not running | `inbox/realtime/errors-*.json` | `specs/05-error-watcher.md` |
| 6 | **GitHub PR Watcher** | Script exists, not running | `inbox/realtime/github-*.json` | `specs/06-github-watcher.md` |
| 7 | **Linear Change Watcher** | Script exists, not running | `inbox/realtime/linear-*.json` | `specs/07-linear-watcher.md` |
| 8 | **DeepSeek Cost Watcher** | Script exists, not running | `inbox/realtime/cost-*.json` | `specs/08-cost-watcher.md` |
| 9 | **Fleet Health Check** | Scaffold needed | `health/` | `specs/09-fleet-health.md` |
| 10 | **Nous Release Monitor** | Scaffold needed | `health/versions.json` | `specs/10-nous-monitor.md` |
| 11 | **Obsidian Vault Sync** | ✅ Active | `state/vault-sync.json` | `specs/11-vault-sync.md` |
| 12 | **Conductor Bridge** | ✅ Active (partial) | Bridge outbox → Jericho inbox | `specs/12-conductor-bridge.md` |
| 13 | **Memory Cross-Sync** | N/A (single profile) | Future: multi-profile | `specs/13-memory-sync.md` |
| 14 | **Agent Dispatch** | Scaffold needed | `dispatch/` → bridge outbox | `specs/14-agent-dispatch.md` |
| 15 | **MoA Preset (Jericho)** | ✅ Configured | `config.yaml` moa section | `specs/15-moa-preset.md` |
| 16 | **Vault RAG** | Script exists, on-demand | `intel/` cross-ref cache | `specs/16-vault-rag.md` |

## Operational Rhythm

```
08:00 UTC — Morning Synthesis fires (DEV, PA, Iris)
           → inbox/morning/{dev,pa,iris}-{date}.md
           → Jericho aggregates into reports/daily/{date}.md
           → Delivered to Carlos DM

09:00 UTC — Fleet Health Check
           → health/versions.json, costs.json
           → Alerts if: version drift, cost spike, agent silent >24h

Every 5m  — Realtime watchers (Iris replies, errors, PRs, Linear, costs)
           → inbox/realtime/{source}-{timestamp}.json
           → Jericho deduplicates, signals only

23:00 UTC — Nightly Vault Processor
           → inbox/nightly/{date}.md
           → Inbox filing, orphan detection, RAG rebuild, meeting processing

Friday   — Weekly Review
           → inbox/weekly/{date}.md
           → Git velocity, shipped tickets, decisions, blocked items
```

## Jericho Digest Format

Every morning, Jericho produces a single digest for Carlos:

```markdown
# Jericho — {date}

## Fleet
DEV v0.14.0 (3 behind) | PA: memory-only | Iris: memory-only | Donald: not found

## Since Yesterday
- Linear: {N} tickets moved, {M} new
- GitHub: {N} PRs, {M} commits across repos
- Vault: {N} notes changed, sync healthy
- Costs: ${X} DeepSeek, ${Y} FAL, ${Z} total

## Requiring Attention
- [ ] {urgent item}
- [ ] {blocked item}

## Signals
- Iris replied: {N} messages waiting
- DeepSeek cost: {status} vs 7-day avg
- Errors: {N} in last 24h
```

## Integration Principle

Every subsystem writes to Jericho's inbox in a standardized format:
- **Filename:** `{source}-{timestamp}.{md|json}`
- **Schema:** Frontmatter with `source`, `timestamp`, `priority`, `category`
- **Dedup:** Jericho tracks last-processed timestamps in `state/digest.json`

Jericho never edits other agents' memory or config directly. It communicates exclusively through:
1. The Jericho bus (filesystem)
2. The conductor bridge outbox (for agent dispatch)
3. Carlos's DM (for human-facing digests)

## Current State (2026-06-27)

**Active:** Obsidian vault sync, Hermes gateway, Figma MCP, MoA preset
**Paused:** All cron jobs, all watchers, iris consult runner
**Missing:** Jericho cron layer, fleet health check, Nous monitor, agent dispatch
**Critical:** Hermes v0.14.0 → v0.17.0 upgrade (3 versions, ~6 weeks behind)

## Boot Sequence

When Jericho is fully wired:

1. Gateway starts → `enforce-fleet-routing.py` pins model routing
2. Jericho cron layer activates → morning synthesis, watchers, health checks
3. Bridge watchers resume → Iris reply detection, engineer message routing
4. Fleet health → version check, memory pressure, error rate monitoring
5. Daily digest → Carlos gets one morning message, not N separate pings
