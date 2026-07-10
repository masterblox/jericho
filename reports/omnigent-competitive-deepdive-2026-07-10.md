# Omnigent Competitive Deep-Dive — 2026-07-10

Source: Researcher wake 2026-07-10 00:20 DXB + direct README + QUEUE_STEER_DESIGN.md analysis.
Repo: github.com/omnigent-ai/omnigent | 6,911 stars | Alpha status | Apache 2.0

## What Omnigent Is

A meta-harness: a common orchestration layer over Claude Code, Codex, Cursor, OpenCode, Hermes, Pi, and custom YAML-defined agents. Swap harnesses without rewriting. Policy enforcement + sandboxing + real-time collaboration from terminal, browser, phone, or desktop app.

## Architecture

```
CLIENT (browser/phone/desktop)
    ↕ HTTPS+SSE
AP SERVER (persist + relay)
    ↕ HTTP
RUNNER (buffer + schedule, 1 per conversation)
    ↕ HTTP/UNIX socket
HARNESS SUBPROC (1 per conversation)
    ├── SDK harnesses: agent loop in-process
    └── Native harnesses: bridged to real app → tmux/RPC
```

Key: Agent runs inside harness subprocess, NOT in runner. Runner is a thin buffer+scheduler.

## Agent-Agent Communication Model

Orchestrator-worker, NOT peer-to-peer:
- Sub-agents defined in YAML under parent agent
- Polly pattern: orchestrator delegates to coding sub-agents in parallel git worktrees, routes diffs to reviewers from different vendors
- Debby pattern: every question goes to both Claude and GPT heads simultaneously, /debate mode for cross-critique
- All sub-agents run as children of a single session — no persistent agent identity
- No inter-agent message bus or file-based handoff — everything is session-scoped

## Routing Model

Client-side queue (not server-side orchestration):
- Messages held in client-side pre-POST buffer before hitting server
- Auto-flush on idle (FIFO), or steer (jump queue mid-turn)
- Steer delivery varies by harness: deterministic for SDK (claude-sdk, codex-sdk), best-effort for native
- No persistent task routing between agents — all routing is within a single session's sub-agent tree

## Policy/Governance

Three-level stack: server-wide (admin) → per-agent (developer) → per-session (user)
- approve_shell: ask before shell/file writes
- cap_calls: max tool calls per session
- budget: hard spend cap + soft warning thresholds
- Policies are Python functions, not declarative config
- Builtins ship as part of the framework

## Deployment

- One docker compose up for server
- Hosts: Render, Railway, Fly.io, HuggingFace Spaces, Modal, Cloudflare (serverless), Databricks Apps
- Cloud sandboxes: Modal, Daytona, Islo, E2B, CoreWeave, Kubernetes, OpenShell, Boxlite, Databricks
- Managed hosts: server provisions sandbox per session, no laptop needed
- Tailscale + Cloudflare quick tunnel for laptop-as-server
- Multi-user: invite-only signup, OIDC (Google, GitHub, Okta, Microsoft)

## Collaboration

- Share live session via link: teammates watch and chat in real time
- Co-drive: attach to running session, messages execute on original machine
- Fork: clone conversation to own machine, continue independently
- Sessions sync across devices (terminal → browser → phone)

## Comparison: Omnigent vs Mechanica

| Dimension | Omnigent | Mechanica |
|-----------|----------|-----------|
| Model | Meta-harness (wrap existing CLIs) | Meta-agent (persistent agent profiles) |
| Agent lifecycle | Ephemeral, per-session subprocess | Persistent, always-on gateway services |
| Agent-agent comms | Orchestrator-worker within session | File-based outbox between gateways |
| Routing | Client-side queue + steer | Paperclip → Jericho → Conductor Bridge |
| Agent definition | YAML file, prompt + tools | Full profile (skills, memory, plugins, cron) |
| Persistence | Sessions, not agents | Agents persist across sessions |
| Collaboration | Real-time: share, co-drive, fork | Async file-based handoffs |
| Governance | Python function policies | Lane boundaries + approval chains |
| Multi-agent | Sub-agents of a session | Independent peers with Jericho orchestration |
| Status | Alpha, 6.9K stars | Production, internal fleet |
| License | Apache 2.0 | Proprietary (Masterblox) |

## Strategic Assessment

Threat level: MEDIUM (not existential, but occupying similar mindshare)

Strengths Omnigent has that Mechanica doesn't:
1. Real-time collaboration (share, co-drive, fork) — Mechanica is 100% async
2. Cross-device session continuity — Mechanica has no mobile/web UI
3. Multi-harness swap — Mechanica is Hermes-only
4. Cloud sandbox provisioning per session — Mechanica has static VPS
5. Open-source community velocity — 6.9K stars in alpha

Strengths Mechanica has that Omnigent doesn't:
1. Persistent agents with memory — Omnigent agents are ephemeral per session
2. Lane-based fleet architecture — clear separation of concerns (DEV/PA/Iris/Donald)
3. Automated task routing (Paperclip → Jericho → agent lane) — Omnigent has no task system
4. Cron-based autonomous operation — Omnigent agents only run when a session is active
5. Production-proven multi-month uptime — Omnigent is alpha

Key insight: Omnigent is optimizing for the HUMAN+AGENT experience (real-time collaboration, device switching, session sharing). Mechanica is optimizing for AGENT+AGENT autonomy (persistent services, automated routing, lane boundaries). These are complementary, not directly competitive — a mature system would have both.

## Opportunities for Mechanica

1. Build real-time collaboration into fleet — shared session view, co-drive for Carlos
2. Add mobile/web UI for fleet monitoring (Omnigent shows this is possible)
3. Consider open-sourcing the conductor bridge pattern (differentiation isn't in the routing, it's in the agent training)
4. Multi-harness: DEV could potentially use Claude Code or Codex as backbone while keeping Hermes for orchestration
5. Cloud sandbox per-task: ephemeral environments for DEV tasks instead of shared VPS

## Risks

1. If Omnigent adds persistent agent identity + task routing, they converge on Mechanica's space
2. Their open-source velocity means they'll add features faster than a solo fleet
3. IBM's beeai-framework (3.3K stars) signals enterprise standardization is coming — both Omnigent and Mechanica could be squeezed by big-player frameworks
