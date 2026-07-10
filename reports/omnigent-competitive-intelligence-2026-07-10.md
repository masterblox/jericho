# Omnigent Competitive Intelligence — July 10, 2026

Source: Live GitHub analysis triggered by researcher TOP SIGNAL (researcher-wake-2026-07-10T0020-DXB).

## Vital Signs

| Metric | Value |
|--------|-------|
| Stars | 6,915 |
| Forks | 924 |
| Language | Python |
| License | Apache 2.0 |
| Status | Alpha |
| Created | June 11, 2026 (1 month old) |
| Last commit | July 9, 2026 (yesterday) |
| Open issues | 544 |
| Total files | 3,360 |
| Deploy targets | 14 (Docker, K8s, Fly, Render, Railway, Modal, Cloudflare, HF Spaces, E2B, Daytona, Islo, Databricks, Boxlite, OpenShell) |
| PyPI | omnigent (published) |

## What They Are

Omnigent is an open-source meta-harness — a common orchestration layer that sits on top of existing coding agent harnesses (Claude Code, Codex, Cursor, OpenCode, Hermes, Pi, Kimi, Qwen, Copilot, Antigravity). Users swap harnesses without rewriting agents, enforce policies across them, and collaborate in real time from any device. Think "fleet orchestration for coding agents" — directly overlapping with Mechanica's agent orchestration territory.

## Architecture Deep-Dive

### 1. Agent Model

Agents are defined via a self-contained directory (the "Agent Image Spec"):
- config.yaml: LLM config, interaction contract, tools, policies
- AGENTS.md: Identity and behavior instructions
- skills/: Named skill markdown files
- tools/: Python/TypeScript functions + MCP servers
- agents/: Recursive sub-agent images

Sub-agents are declared as tools in the parent's config.yaml:
```yaml
tools:
  agents:
    - researcher
    - reviewer
```
The parent delegates tasks to them. Sub-agents inherit the harness/model of the parent but can override. This is a tree model — one supervisor, N workers.

### 2. Agent-Agent Communication

No messaging bus. No outbox/inbox pattern. No conductor bridge. Communication is:
- Parent → child: Direct tool-call delegation
- Child → parent: Return value (text result)
- Cross-agent: Not supported natively — go through the human
- Multi-agent orchestration example (Polly): parent plans, spawns parallel sub-agents in git worktrees, routes diffs to cross-vendor reviewers

This is Mechanica's weakest point that Omnigent also hasn't solved. Both systems lack agent-to-agent messaging without a human relay.

### 3. Harness Model

Omnigent wraps existing harnesses rather than replacing them. It runs agents through:
- SDK harnesses (claude-sdk, codex-sdk, cursor-sdk, copilot-sdk): Direct library integration
- Native harnesses (claude-native, codex-native, hermes-native): tmux/PTY wrappers that drive the real CLI

The "meta" aspect: same agent YAML works across harnesses by swapping `executor.harness`. You write the agent once, run it through Claude Code, Codex, or Hermes interchangeably.

### 4. Session Model

Client-side message queue with steering. Before messages hit the server, they sit in a browser-side queue. Users can edit, delete, reorder, or steer (push now, jump queue) before POST. This is fundamentally different from Mechanica's server-side linear conversation model.

Steering semantics per harness:
- SDK harnesses: deterministic mid-turn injection via `_live_response_id`
- Native codex/claude: verified live-pane paste
- Other natives: best-effort (mechanism exists, not verified)

Steering is non-interrupt — the message folds in at the next breakpoint, doesn't cancel the running turn. Distinct from the Interrupt button.

### 4. Governance/Policies

Three-level policy engine:
- Server-wide (admin)
- Per-agent spec (developer)
- Per-session (end user)

Policy types: cost budgets, tool-call limits, OS-tool approval gates, skill blocks, sandbox enforcement, PII scanning. Builtins are Python callables registered via dotted path. Policies compose in order — a DENY from any level short-circuits.

This is more sophisticated than Mechanica's per-agent guardrail skills. Policies are declarative, composable, and enforceable at the server level.

### 5. Deployment

14 deployment targets including serverless (Cloudflare), managed sandboxes (Modal, Daytona, E2B, Databricks), and self-hosted (Docker, K8s). The server can provision sandboxes per session ("managed hosts") — no persistent VPS needed. Multi-user with OIDC auth (Google, GitHub, Okta, Microsoft).

### 6. Collaboration

- Share: send a link to a live session, teammates watch and chat
- Co-drive: teammate attaches to your session, messages execute on your machine
- Fork: clone a conversation and continue independently

## Competitive Gap Analysis

### What Omnigent Has That Mechanica Doesn't

| Capability | Omnigent | Mechanica |
|-----------|----------|-----------|
| Multi-harness swap (same agent, different backend) | Core feature — swap `executor.harness` | Fleet is Hermes-only |
| Declarative agent spec (YAML) | Agent Image Spec with recursive sub-agents | Ad-hoc per-agent config.yaml + skills |
| Policy engine (server/agent/session) | 3-tier composable policy engine with builtins | Per-agent guardrail skills only |
| Real-time collaboration | Share, co-drive, fork | None |
| Cross-device (phone, browser, terminal, desktop) | Web UI + desktop app + mobile | Telegram-only UI (mobile works via Telegram) |
| Managed sandboxes (server provisions per session) | 14 deploy targets, disposable sandboxes | Single VPS |
| Client-side message queue with steering | Edit/delete/reorder/steer before POST | Linear server-side conversation |
| Vendor diversity | 10+ harnesses (Claude, Codex, Cursor, Pi, Hermes, Kimi, Qwen, Copilot, Antigravity, OpenCode) | Hermes only |
| Open-source community | Apache 2.0, 924 forks, 544 open issues, public Discord | Private fleet |
| Self-update | `omni upgrade` auto-detects install method | Manual git pulls |
| OIDC multi-user | Google, GitHub, Okta, Microsoft | Single-user Carlos |

### What Mechanica Has That Omnigent Doesn't

| Capability | Mechanica | Omnigent |
|-----------|-----------|----------|
| Persistent fleet agents (DEV, PA, Iris, Donald) | Long-running agents with persistent identity/memory | Session-scoped, no persistent identity |
| Linear ticket integration | Full Linear sync, ticket-driven workflow | No ticket system integration |
| Paperclip task management | Issue lifecycle, heartbeat, routing | No equivalent |
| Conductor bridge (agent-agent messaging) | File-based outbox/inbox pattern | None — agents can't message each other |
| Cron-based autonomous work | Scheduled jobs per agent | No cron/scheduling |
| Obsidian vault integration | /opt/brain persistent knowledge | No persistent knowledge base |
| Cross-lane intelligence (Jericho aggregation) | Fleet-wide signal detection | None |
| Domain specialization (ops, design, sales, dev) | 4 specialized lanes | General-purpose coding agents only |
| Telegram-native | Full Telegram integration | Browser/terminal/desktop, no chat platform |
| VPS self-hosted | Own infrastructure | Cloud/SaaS model (self-host option exists) |
| Competitor monitoring (researcher) | Automated competitive intelligence | None |

## Key Strategic Insight

Omnigent is NOT a fleet orchestration competitor — it's a **harness interoperability layer**. They're solving "run the same agent through different backends" while Mechanica solves "run a fleet of persistent, domain-specialized agents that coordinate autonomously." 

The Venn diagram overlap is narrow: both orchestrate multiple AI agents. But Omnigent's agents are session-scoped coding assistants while Mechanica's are persistent employees with domains, tickets, and autonomous work cycles.

The real threat vector: Omnigent has explosive community growth (6,915 stars in 1 month) and could expand into persistent agent orchestration. Their policy engine and multi-harness model would give them a head start. If they add cron/scheduling + persistent agent identity + agent-agent messaging, they enter Mechanica's territory from below.

The opportunity: Omnigent's 10+ harness support means Mechanica agents could theoretically run through Omnigent as an additional deployment surface. The `hermes` and `hermes-native` harnesses already exist in their codebase.

## Recommendations

1. MONITOR Omnigent's agent-agent communication roadmap. Their current model is parent-child tree only. If they add peer-to-peer messaging or an event bus, that's a direct threat.

2. WATCH their GitHub Issues for "persistent agents" or "cron" feature requests. Those are the expansion signals into Mechanica's territory.

3. CONSIDER integrating Mechanica as an Omnigent harness provider. The `hermes` harness already exists — making Mechanica agents runnable through Omnigent would give us access to their UI, collaboration, and sandbox infrastructure.

4. DO NOT panic. Omnigent is session-scoped coding orchestration. Mechanica is persistent employee fleet orchestration. Different use cases, limited overlap today.

5. STEAL their policy engine architecture. The 3-tier composable policy model (server/agent/session) is cleaner than Mechanica's ad-hoc guardrail skills. Could be adapted for fleet-wide governance.

---

Analysis complete. Report at /opt/data/jericho/reports/omnigent-competitive-intelligence-2026-07-10.md
Run ID: 0634221d-d2fb-415d-9046-04c170584759
