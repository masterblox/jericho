# Omnigent Competitive Deep-Dive — 2026-07-10 UTC+4

Source: researcher-wake-2026-07-10T0020 ACTION, executed via Researcher empty wake 533f45d4.

## Vital Signs

| Metric | Value |
|--------|-------|
| Repo | omnigent-ai/omnigent |
| Stars | 6,916 |
| Forks | 924 |
| Language | Python |
| License | Apache 2.0 |
| Created | 2026-06-11 (28 days ago) |
| Last Commit | 2026-07-09 |
| Open Issues | 543 |
| Total Files | 3,360 (572 Python source) |
| Status | Alpha |
| PyPI | omnigent (published) |
| Install | curl pipe sh, uv, pip, homebrew |

## What They Are

Omnigent is an open-source meta-harness — an orchestration layer that wraps existing AI coding agents (Claude Code, Codex, Cursor, OpenCode, Hermes, Pi, Qwen, Kimi, Copilot, Goose, Antigravity/Gemini) under a unified interface. Users swap harnesses without rewriting prompts, policies, or tool configs. They position as the universal remote control for coding agents — not building better agents, but providing the layer above them.

Their killer demo: Polly, a multi-agent orchestrator that delegates ALL coding to sub-agents in isolated git worktrees, with cross-vendor review (Codex reviews Claude's PR, Hermes reviews Codex's PR, etc.).

## Architecture

### Core Model: Server-Runner-Client

```
Client (CLI/TUI/WebUI/Mobile) <-> Server (FastAPI + WS + SSE) <-> Runner (harness subprocess)
                                                                  -> Sandbox (bwrap/seatbelt)
```

The **Server** is the control plane: session CRUD, auth, WebSocket events, artifact storage, policy enforcement. Lives in `omnigent/server/`.

The **Runner** is the data plane: owns harness subprocesses, MCP connections, OS environments, sub-agent inboxes. Lives in `omnigent/runner/`. Exposes a FastAPI subset that the server tunnels to via WebSocket.

The **Sandbox** layer (`omnigent/inner/`) isolates agents with bwrap (Linux), seatbelt (macOS), or Windows Job Objects. 13 cloud sandbox providers: Modal, Daytona, E2B, Islo, CoreWeave, Kubernetes, OpenShell, Boxlite, Databricks, Cloudflare, Fly.io, Railway, Render.

### Agent-Agent Communication Model

**Async Inbox Pattern.** Supervisor agents spawn sub-agents via `sys_session_send(title, purpose, args)`. Each sub-agent gets:
- Isolated git worktree (no file conflicts)
- Own session with independent harness
- Optional model override for cost/quality routing
- One of three purposes: `implement`, `review`, `explore`

Communication is one-way async: supervisor dispatches, sub-agent runs to completion autonomously, result lands in supervisor's inbox via `sys_read_inbox`. No turn-by-turn driving, no shared context window. The sub-agent can be monitored live through the UI's Subagents panel.

Key: this is NOT real-time multi-agent conversation. It's dispatch → autonomous run → result collection. The supervisor never "talks to" the sub-agent mid-run. This is simpler but less flexible than true agent-agent dialogue.

### Routing Model

Session-based routing, not agent-based:
1. User creates session → assigned to a host (local machine or managed sandbox)
2. Session has one agent (the "brain" harness)
3. If agent has sub-agents declared, they can be spawned as child sessions
4. Child sessions inherit parent's server context but get isolated execution
5. Fork creates independent copy; co-drive shares the SAME session (dangerous for multi-agent)
6. Switch-agent swaps the brain harness mid-session (idle-only)

There is no concept of "fleet routing" or agent-specific lanes. Sessions are fungible containers; the agent YAML determines behavior. This is both a strength (flexibility) and weakness (no specialization persistence).

### Policy/Governance

Three-level stacking:
- **Server-wide** (admin sets defaults for everyone)
- **Per-agent** (YAML `policies:` block in agent spec)
- **Per-session** (user toggles in UI or via chat)

Built-in policies: shell approval, file write gates, token budget caps, tool call limits. Custom policies possible via Python function handlers.

The policy engine checks every action BEFORE execution. Mechanica's lane boundaries are conceptually similar but enforced at the agent identity level rather than the policy level.

### Harness Abstraction

Each supported agent gets an `inner/*_harness.py` file:

| Harness | Module | Mode |
|---------|--------|------|
| Claude Code | `claude_sdk_harness.py` / `claude_native_harness.py` | SDK + native tmux |
| Codex | `codex_harness.py` / `codex_native_harness.py` | SDK + native tmux |
| Cursor | `cursor_harness.py` / `cursor_native_harness.py` | SDK + native tmux |
| Hermes | `hermes_harness.py` / `hermes_native_harness.py` | SDK + native tmux |
| OpenCode | `opencode_native_harness.py` | native tmux |
| Pi | `pi_harness.py` / `pi_native_harness.py` | headless + native |
| Copilot | `copilot_harness.py` | SDK |
| Antigravity | `antigravity_harness.py` / `antigravity_native_harness.py` | SDK + native |
| Kimi | `kimi_harness.py` / `kimi_native_harness.py` | SDK + native |
| Qwen | `qwen_harness.py` | SDK |
| Goose | `goose_harness.py` | SDK |
| Kiro | `kiro_native_harness.py` | native |
| OpenAI Agents | `openai_agents_sdk_harness.py` | SDK |

This is comprehensive — 13 harness types. Mechanica wraps 0 external coding agents.

## Competitive Gap Analysis

### What Omnigent Has That Mechanica Doesn't

| Capability | Mechanica Status |
|------------|-----------------|
| Desktop app (macOS native) | None |
| Mobile web UI (phone-friendly) | Telegram only |
| Real-time session sharing | None |
| Co-drive (two humans, one agent) | None |
| Session fork | None |
| Cross-vendor review (Codex reviews Claude) | DEV is single-agent |
| 13 cloud sandbox providers | None |
| Self-hosted server with multi-user auth | Paperclip only (centralized) |
| Single-command install (curl pipe sh) | Complex multi-container setup |
| Policy engine (cost caps, tool limits) | Lane boundaries only |
| Model switching mid-session | Fixed per agent |
| 13 harness wrappers | 0 (only native Hermes agents) |
| Community (924 forks, Discord) | Private fleet |

### What Mechanica Has That Omnigent Doesn't

| Capability | Omnigent Status |
|------------|----------------|
| Production task management (Paperclip) | None — sessions are ephemeral |
| Persistent agent memory across sessions | Sessions are isolated |
| Agent specialization with trained skills | YAML agents are generic |
| Cross-lane intelligence synthesis (Jericho) | No synthesis layer |
| Cron-based autonomous operation | Sessions require user initiation |
| Linear/GitHub integration for ticket tracking | None |
| Multi-day autonomous agent runs | Session model is interactive |
| Telegram-native deployment (no server needed) | Requires server deploy |
| Fleet health monitoring and self-healing | No fleet concept |
| Agent lane boundaries (DEV/PA/Iris/Donald) | No lane concept |
| Deep agent training (10K+ context memory) | Generic YAML prompts |

## Key Strategic Insight

Omnigent and Mechanica are converging on the same market from opposite directions:

- **Omnigent**: Horizontal orchestration — wrap ALL the agents, let users mix and match. Breadth over depth. The "universal remote control."
- **Mechanica**: Vertical specialization — deeply trained fleet agents with persistent memory, lane boundaries, and autonomous operation. Depth over breadth. The "specialist team."

The threat is that Omnigent can add depth (persistent memory, specialization, autonomous scheduling) faster than Mechanica can add breadth (13 harness wrappers, desktop UI, cloud sandboxes). They have 6,916 stars and 924 forks in 28 days — their community velocity exceeds our development velocity.

However, Omnigent's architecture has a fundamental limit: session isolation means agents can't build persistent expertise. Every session is a clean slate. Mechanica's agents accumulate context over weeks/months. This is a durable moat IF we ship it visibly.

## Recommendations

1. **Don't chase the harness wrapper game.** Omnigent's 13-harness breadth is a commodity play — any orchestrator can wrap CLIs. Our moat is trained specialization and persistent context. Double down on agent memory, cross-session learning, and Paperclip integration.

2. **Ship a web UI fallback.** Telegram is great but mobile-only web access (even read-only session monitoring) would close the "check on agents from anywhere" gap. Doesn't need to be Omnigent-level — just session status + recent output.

3. **Document our lane boundary model publicly.** Omnigent's policy engine is YAML-based and generic. Mechanica's lane boundaries (DEV=code, PA=ops, Iris=design) are enforced at the agent identity level with cross-lane intelligence synthesis. This is architecturally novel — write it up as a design philosophy.

4. **Watch their multi-agent inbox pattern.** Polly's dispatch → autonomous run → inbox result model is strong. If we ever add multi-agent delegation (DEV spawns sub-DEV), this is the pattern to follow. It avoids the shared-context hallucination loops that killed our group chat experiment.

5. **Track their community velocity.** 6,916 stars in 28 days = ~247 stars/day. At this rate they hit 10K stars within 2 weeks. Their Discord + GitHub activity will determine whether this is sustainable or a launch spike. Set a cron to track weekly.

6. **The Hermes-native harness is notable.** Omnigent wraps Hermes Agent as a first-class harness alongside Claude and Codex. This means Hermes (Nous Research) is positioned as a peer to the big players — and Omnigent users can try Hermes without leaving their workflow. Could be a partnership opportunity or a threat depending on Nous's strategy.

---

Competitive deep-dive completed via Researcher empty wake 533f45d4. Paperclip unreachable (health timeout). Prior Researcher wake ACTION processed.
