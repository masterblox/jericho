# Omnigent Competitive Deep-Dive
2026-07-10 00:40 UTC+4 | Intelligence Agent f2216417

## Vital Signs

| Metric | Value |
|--------|-------|
| Stars | 6,915 |
| Forks | 924 |
| Created | 2026-06-11 (30 days ago) |
| Last commit | 2026-07-09 |
| Language | Python |
| License | Apache 2.0 |
| Open issues | 544 |
| Repo size | 70 MB |
| Commits/d | ~70 (2,100+ in 30 days) |
| Package | PyPI: omnigent (alpha) |
| Top topics | agent-orchestration, multi-agent, agent-governance, sandbox |

## What They Are

Omnigent is an open-source meta-harness — an orchestration layer sitting above individual coding agents. You describe an agent in YAML (model, harness, tools, skills, policies, sub-agents), and Omnigent runs it. It supports Claude Code, Codex, Cursor, OpenCode, Hermes, Pi, and custom agents. Sessions sync across terminal, browser, phone, and native desktop app. Multi-user collaboration with shared sessions, co-driving, and forking. Policy-based governance at three levels. Cloud sandbox deployment to 10+ providers.

Mechanica equivalent: This is a direct competitor to Mechanica's fleet orchestration model. Omnigent provides the harness-switching layer plus governance plus collaboration — all the things Mechanica builds via Jericho + gateway system but packaged as an installable CLI.

## Architecture

### Core Model: Server → Runner → Harness

Three-tier runtime:
1. Server: HTTP API + WebSocket for session management, agent storage, collaboration, auth
2. Runner: Per-conversation subprocess spawned by the server. Binds to a Unix socket (or TCP on Windows). Contains the agent loop, policy engine, tool manager.
3. Harness: The actual coding agent runtime (Claude Code, Codex, Cursor, etc.). Runs inside the runner's process or as a separate subprocess managed by the runner.

### Agent-Agent Communication

Omnigent's sub-agent model is hierarchical, not P2P:
- Agents declare sub-agents in YAML under `tools.<name>: type: agent`
- Sub-agents are spawned as new conversations with their own runner
- Parent delegates via a tool call — sub-agent gets its own harness, model, tools
- No direct agent-to-agent channel — all communication flows through the parent agent's turn loop
- Sub-agents can have sub-agents (recursive), depth is configurable
- Polly (example agent): orchestrator delegates to parallel coding agents, then routes diffs to a reviewer from a different vendor

This is structurally similar to Mechanica's Jericho → leaf agent model but with a key difference: Omnigent's agents are all within one session tree, while Mechanica's fleet has persistent agent identities with cross-session memory.

### Policy/Governance Engine

Three enforcement levels, evaluated in order:
1. Session (user-configured, evaluates first)
2. Agent spec (developer-declared in YAML)
3. Server-wide (admin-configured, evaluates last)

Verdicts: ALLOW, DENY, ASK (pause for approval). DENY short-circuits. Policies compose: multiple active at once.

Builtin policies include:
- max_tool_calls_per_session (rate limiting)
- ask_on_os_tools (file/shell approval gate)
- cost_budget (spend cap + soft warning thresholds)
- block_skills (deny-list specific skills)
- enforce_sandbox (force sandbox config)
- deny_pii_in_llm_request (PII scanning)
- github_policy (repo/branch write gating)
- gdrive_policy (Google Drive access control)

This is more mature than Mechanica's current policy layer. Fleet guardrails (Donald's guardrail skill, enforce-fleet-routing.py) are comparable in intent but less systematic.

### Harness Plugin Architecture

23 harnesses total, 4 P0 SDK harnesses verified live (claude-sdk, codex, pi, openai-agents). Community plugins via Python entry points (`omnigent.community.harness`). Each harness declares capabilities: integration_mode, elicitation, resume, effort, model_family, auth, subagents, interrupt, streaming. Harness bench verifies declared vs actual capabilities.

Notable: Hermes is listed as a supported harness (`omnigent hermes`). This means Omnigent users can run Hermes agents through Omnigent's orchestration layer. Mechanica runs on Hermes — Omnigent can wrap Mechanica's own runtime.

### Sandbox Model

Per-platform sandboxing:
- Linux: bubblewrap (bwrap) — filesystem + network isolation, seccomp filters
- macOS: seatbelt sandbox
- Windows: Job Objects (process tree containment only, no FS/network isolation)

Egress proxy system for network control: CA, cert generation, rules-based allow/deny.

### Deployment

10+ sandbox providers: Modal, Daytona, Islo, E2B, CoreWeave, Kubernetes, OpenShell, Boxlite, Databricks, Fly.io, Railway, Render, Hugging Face Spaces, Cloudflare, Docker. Server provisions sandboxes per session ("managed hosts"). Database options: SQLite (local), PostgreSQL (production). OIDC auth (Google, GitHub, Okta, Microsoft).

## Competitive Gap Analysis

### What Omnigent Has That Mechanica Doesn't

| Capability | Omnigent | Mechanica |
|-----------|----------|-----------|
| Multi-harness orchestration | Claude Code, Codex, Cursor, OpenCode, Hermes, Pi + custom | Hermes only (single runtime) |
| Mobile access | Full web UI on phone, desktop app | Telegram bot only |
| Real-time collaboration | Share sessions, co-drive, fork | No multi-user sessions |
| Cloud sandbox deploy | 10+ providers, one-click | VPS-only (single host) |
| Policy engine | Declarative, 3-level, 8+ builtins | Guardrail skills (ad-hoc) |
| Sandbox isolation | bwrap/seatbelt per agent | Container-level only |
| Install experience | One curl command | Manual Hermes setup |
| Agent YAML spec | Standardized, portable | Custom config per agent |
| OIDC auth | Google/GitHub/Okta/Microsoft | None |
| Harness bench | Automated capability verification | None |

### What Mechanica Has That Omnigent Doesn't

| Capability | Mechanica | Omnigent |
|-----------|-----------|----------|
| Persistent agent fleet | DEV, PA, Iris, Donald — always-on identities | Agents are session-scoped |
| Cross-session memory | Memory across sessions, cron jobs | Sessions are isolated |
| Cross-agent routing | Jericho orchestration layer | Only within session tree |
| Paperclip task system | Issue tracking + agent dispatch | No built-in task system |
| Cron-based automation | Scheduled agents, watchdog scripts | No cron equivalent |
| Linear/GitHub integration | Full bidirectional sync | GitHub tools only via MCP |
| Vault/Obsidian sync | Persistent knowledge base | No knowledge management |
| Domain-specialized agents | Sales (Donald), Design (Iris), Ops (PA) | General-purpose agents |
| Telegram native | Primary UI for all agents | No messaging platform |
| Fleet health monitoring | Jericho watches all agents | Server health only |

## Key Strategic Insight

Omnigent is executing a "commoditize the harness" strategy. By making Claude Code, Codex, Cursor, and Hermes interchangeable plug-ins, they're positioning Omnigent as the control plane and reducing each individual harness to a commodity. If they succeed, the value moves from "which agent is best" to "who orchestrates them best." Mechanica's fleet model is vulnerable to this — Omnigent can wrap Hermes, which means it can wrap Mechanica's entire fleet indirectly.

But Omnigent's weakness is session-scoped agents with no persistent identity. Mechanica's fleet agents (DEV, PA, Iris, Donald) have memory, context, and learned behaviors across sessions. Omnigent agents reset every session. This is the wedge: Omnigent is a better orchestrator for short-lived agent tasks; Mechanica is a better platform for persistent agent employees.

The 6,915 stars in 30 days is the real signal. This is not a toy — it's growing faster than most agent frameworks. The velocity (70 commits/day) means the gap in the "what they have that we don't" column is widening, not narrowing.

## Recommendations

1. Treat Omnigent as a primary competitor. Monitor weekly. Their harness bench + policy engine are the two subsystems to watch most closely.

2. Exploit their session-scope weakness. Mechanica's persistent-agent advantage should be deepened: better cross-session memory, better fleet coordination, better agent identity. This is the one axis Omnigent cannot easily copy — it requires architectural changes to their session model.

3. Consider Omnigent integration as a harness option. If Omnigent can wrap Hermes, Mechanica could potentially run DEV/PA/Iris/Donald through Omnigent's orchestration layer for harness flexibility while keeping fleet identity on the Mechanica side. This would be a "commoditize the complement" counter-move.

4. The policy engine is worth studying. Their three-level evaluation order (session → spec → server) with ALLOW/DENY/ASK is cleaner than Mechanica's ad-hoc guardrail skills. Consider a similar declarative policy model for fleet agents.

5. Watch the "Hermes" harness entry. If Omnigent ships a polished Hermes integration before Mechanica has its own polished orchestration layer, Omnigent becomes the default way to run Hermes agents.

6. The sandbox per-agent model (bwrap/seatbelt) is superior to Mechanica's container-level isolation. If Mechanica ever offers multi-tenant agent hosting, this is the pattern to follow.
