# Omnigent Deep-Dive: Architecture, Threat Assessment & Signals for Carlos
**2026-07-10 | Analyst: Jericho Research | Source: GitHub API, README, AGENT_YAML_SPEC.md, POLICIES.md, QUEUE_STEER_DESIGN.md**

---

## 1. Agent-to-Agent Communication: Orchestrator-Worker (Not Peer-to-Peer)

Omnigent uses a **strict orchestrator-worker model**, not a peer-to-peer mesh or pub/sub bus.

- **Sub-agents as tools**: A parent/supervisor agent defines child agents in YAML. The supervisor invokes sub-agents like tools — spawning them, passing inputs, and receiving results back. No sub-agent-to-sub-agent direct communication exists.
- **Session-scoped lifecycle**: All sub-agents live and die within a single conversation session. There is no persistent agent identity across sessions. Agents are ephemeral subprocesses under the harness.
- **Polly pattern** (their flagship example): An orchestrator delegates to multiple coding sub-agents (Claude Code, Codex, Pi) in parallel git worktrees, then routes diffs to reviewer agents from different vendors. This is the closest thing to a "fleet" — but it's a single session's tree, not persistent lanes.
- **Debby pattern**: Every question goes to both Claude and GPT heads simultaneously; `/debate` mode enables cross-critique between them.
- **No inter-agent message bus**: No file-based handoff, no shared state, no event stream between agents. Everything flows through the orchestrator's session context.

**Implication for Mechanica**: Omnigent's model is fundamentally session-scoped and reactive. Mechanica's persistent lane agents (DEV, PA, Iris, Donald) with file-based outbox handoffs and Jericho orchestration is a different architecture class. But Omnigent's Polly pattern is a proto-fleet — if they make sub-agents persistent and independently addressable, they converge on Mechanica's space.

---

## 2. Routing/Dispatch Model: Client-Side Queue + Steer

Omnigent's routing is **client-side, ephemeral, and intra-session** — not a server-side task dispatcher.

```
User types message
    ↓
Client-side pre-POST buffer (edit/delete/reorder queue)
    ↓
Auto-flush on idle (FIFO) — or STEER (jump queue mid-turn)
    ↓
AP SERVER → RUNNER (1 per conversation) → HARNESS SUBPROC
    ↓
Harness subprocess executes agent loop (SDK in-process or native via tmux/RPC)
```

- **Steer mechanism**: Messages can be injected mid-turn into the agent's execution. For SDK harnesses (claude-sdk, codex-sdk), this is deterministic — the message lands at a known point in the agent loop. For native harnesses (CLI apps via send-keys/tmux), it's best-effort.
- **No persistent task routing**: There is no queue, no work-item lifecycle, no agent handoff between sessions. Every session is self-contained.
- **No server-side orchestration**: The server (AP + Runner) is a thin relay. All intelligence lives in the client-side queue and the harness subprocess. The runner is a buffer + scheduler, not an orchestrator.

**Implication for Mechanica**: Omnigent has no equivalent to Paperclip → Jericho → Conductor Bridge routing. Mechanica's lane-based routing (issue detected → Paperclip classifies → Jericho dispatches → DEV/PA/Iris/Donald executes → results aggregated) is a fundamentally different paradigm. This is Mechanica's strongest differentiator. Omnigent would need to build: (a) persistent task queues, (b) agent addressing/discovery, (c) work-item lifecycle management, and (d) cross-session state. None of these exist today.

---

## 3. Policy Enforcement & Sandboxing: Three-Level Python Function Stack

Omnigent implements guardrails as a **three-level declarative policy stack** evaluated in order:

| Level | Scope | Set By | Precedence |
|-------|-------|--------|-----------|
| Session | Per-conversation | User | Evaluates FIRST — can short-circuit server policies |
| Agent | Per-agent definition | Developer (YAML) | Evaluates second |
| Server | Global | Admin | Evaluates last |

**Built-in policy handlers** (Python functions, not declarative config):
- `approve_shell` — ask before any shell command or file write
- `cap_calls` — hard limit on tool invocations per session
- `budget` — hard spend cap + soft warning thresholds (cost-aware)
- `github_write_restrict` — block/approve GitHub write operations
- `google_drive_access` — scope Google Drive access
- `ask_on_os_tools` — gate all OS-level tool access

**Verdict model**: DENY / ASK / ALLOW — policies return one of three verdicts. The first DENY stops execution.

**Sandboxing**: Omnigent supports disposable cloud sandboxes per session:
- **Managed hosts**: Modal, Daytona, Islo, E2B, CoreWeave, Kubernetes, OpenShell (NVIDIA), Boxlite, Databricks
- **Provisioning**: Server provisions a fresh sandbox per session; no persistent state leaks between sessions
- **Isolation**: Each harness subprocess runs inside its sandbox, not on the runner/server

**Implication for Mechanica**: Omnigent's policy engine is more formal than Mechanica's (ad-hoc per-skill guardrails). The three-level stacking with DENY/ASK/ALLOW verdicts is clean. Mechanica should consider adopting a similar formal policy model — especially cost budgets and tool caps. However, Omnigent's sandboxing is a strength Mechanica should match: running DEV/PA/Iris/Donald in disposable sandboxes instead of a single VPS would improve isolation and scalability.

---

## 4. Real-Time Collaboration: Share, Co-Drive, Fork

Omnigent has a **real-time multiplayer model** that Mechanica entirely lacks:

- **Session sharing**: Generate a share link; teammates watch the agent work live, with real-time streaming of agent output. Chat runs alongside the agent session.
- **Co-driving**: A teammate attaches to a running session. Their messages execute on the *owner's machine* — they share the same filesystem, shell, and agent context. This is a trust-based model (co-driver has full access to the owner's environment).
- **Fork**: Clone a conversation at any point and continue independently on your own machine. Useful for exploring alternative approaches without disrupting the original session.
- **Cross-device continuity**: Sessions sync across terminal (CLI), browser (localhost:6767), mobile (optimized web), and desktop app (macOS native). Messages, sub-agents, terminals, and files stay in sync.
- **Transport**: HTTPS + SSE (Server-Sent Events) between client and server. The web UI is served on port 6767.

**Implication for Mechanica**: This is Omnigent's most user-facing advantage. Mechanica is 100% async (file-based handoffs between lanes, Telegram notifications). For a solo operator (Carlos), real-time collaboration is less critical — but shared session view for fleet monitoring and co-pilot capabilities would be valuable additions. The fork model is worth studying: being able to branch a DEV session for parallel exploration without disrupting the main lane.

---

## 5. Comparison to Mechanica Fleet Orchestration

### Architecture Models

| Dimension | Omnigent | Mechanica |
|-----------|----------|-----------|
| **Orchestration model** | Meta-harness (wrap existing CLIs) | Meta-agent (persistent agent profiles) |
| **Agent lifecycle** | Ephemeral, per-session subprocess | Persistent, always-on gateway services |
| **Agent identity** | None — agents live/die with session | Full profiles (skills, memory, plugins, cron) |
| **Agent-agent comms** | Orchestrator-worker, session-scoped | File-based outbox between independent peers |
| **Routing** | Client-side queue + steer | Paperclip → Jericho → Conductor Bridge → lane |
| **Task management** | None — no work-item lifecycle | Paperclip: issue tracking, classification, handoffs |
| **Persistence** | Sessions only (client-side localStorage for drafts) | Cross-session memory injection via Hermes |
| **Policy** | 3-level Python function stack (DENY/ASK/ALLOW) | Ad-hoc per-skill guardrails |
| **Collaboration** | Real-time: share, co-drive, fork | Async file handoffs |
| **Sandboxing** | Disposable cloud sandboxes per session | Single VPS, no isolation between lanes |
| **Multi-device** | CLI, browser, mobile, desktop | Telegram only |
| **Multi-harness** | Claude Code, Codex, Cursor, OpenCode, Hermes, Pi | Hermes only |
| **Cron/autonomy** | None — agents only run when session active | Cron system with chaining, context injection |
| **Cross-lane synthesis** | None | Jericho aggregates across all lanes |
| **Maturity** | Alpha (28 days old) | Production (multi-month uptime) |
| **License** | Apache 2.0 | Proprietary (Masterblox) |

### Key Architectural Differences

1. **Session-scoped vs persistent**: Omnigent treats agents as tools within a session. Mechanica treats agents as persistent services with independent identity, memory, and scheduling. This is the fundamental philosophical divide.

2. **Reactive vs autonomous**: Omnigent agents only execute when a human opens a session. Mechanica agents run autonomously via cron, watching for work and self-initiating.

3. **Horizontal vs vertical specialization**: Omnigent's meta-harness model lets you swap any underlying agent (Claude, Codex, Hermes) for any task. Mechanica's lane model gives each agent a specialized domain (DEV for code, PA for ops, Iris for design, Donald for sales) with deep training.

4. **Product vs platform**: Omnigent is a product — one `docker compose up` gives you a full agent orchestration environment. Mechanica is a platform — a set of interconnected services forming a business operating system.

---

## Threat Assessment

### Threat Level: MEDIUM (convergent, not existential)

**Why it's not existential (today)**:
- Omnigent has no task routing, no persistent agents, no cron/autonomy, no cross-lane synthesis, no memory system, no Linear integration. These are Mechanica's entire value proposition.
- Omnigent optimizes for human+agent collaboration. Mechanica optimizes for agent+agent autonomy. Different use cases, different buyers.

**Why it's convergent (tomorrow)**:
- 6,913 stars in 28 days = massive community velocity. 544 open issues = aggressive development pace.
- Polly pattern (parallel worktrees, cross-vendor review) is a proto-fleet. Adding persistence + addressing → direct competitor.
- Hermes is listed as a first-class harness (`omnigent hermes`). This validates Hermes but also means Omnigent users can run Hermes agents without Mechanica.
- Apache 2.0 license means anyone can fork and build a Mechanica-like fleet on top of Omnigent's orchestration layer.

### Attack Surface: Where Omnigent Could Hurt Mechanica

| Vector | Risk | Timeline |
|--------|------|----------|
| Add persistent agent identity + task queues | HIGH | 3-6 months |
| Add cron/scheduling layer | HIGH | 6-12 months |
| Build cross-session memory | MEDIUM | 3-6 months |
| Add Linear/Jira integration | MEDIUM | 2-4 months |
| Enterprise SSO + compliance features | LOW (alpha) | 12+ months |
| IBM beeai-framework standardizes the space | HIGH (external) | 6-12 months |

---

## Actionable Signals for Carlos

### Immediate (This Week)

1. **Study the Polly/Debby patterns**. Clone Omnigent, run the Polly example. Understand how they orchestrate parallel worktrees with cross-vendor review. This is the closest analog to Mechanica's fleet and may reveal architectural insights.

2. **Test Hermes-as-harness**. Run `omnigent hermes` and see what the Hermes integration looks like from the Omnigent side. What features of Hermes are exposed? What's missing? This informs whether Omnigent is a distribution channel or a threat.

3. **Monitor 3 GitHub signals daily**:
   - New issues tagged `enhancement` that mention "persistent", "memory", "schedule", "cron", "task", or "routing"
   - PRs that touch `src/omnigent/runner/` or `src/omnigent/agent/` (these are where persistent agent identity would land)
   - New releases — watch for version bumps beyond alpha

### Short-Term (2-4 Weeks)

4. **Evaluate cloud sandboxing for Mechanica**. Running DEV/PA/Iris/Donald in disposable Modal or Daytona sandboxes (instead of shared VPS) would:
   - Improve isolation (a runaway agent can't affect other lanes)
   - Enable per-task resource limits (CPU, memory, time)
   - Match a capability Omnigent already ships

5. **Formalize Mechanica's policy engine**. Adopt a similar three-level model (fleet-wide → per-lane → per-task) with DENY/ASK/ALLOW verdicts. Current ad-hoc per-skill guardrails work but don't scale to multi-user scenarios.

6. **Build a fleet monitoring dashboard**. Omnigent's web UI (localhost:6767) shows what's possible. Even a read-only view of all lane statuses, recent outputs, and Jericho signals would be valuable. Doesn't need to be real-time collaborative — just visible.

### Medium-Term (1-3 Months)

7. **Consider exposing Mechanica as an Omnigent integration**. If Omnigent users can connect to Mechanica-managed Hermes agents, that turns a competitor into a distribution channel. "Run your fleet through Omnigent's UI, powered by Mechanica's lane intelligence."

8. **Accelerate the fleet's unique moats**. These are features Omnigent can't replicate quickly because they require deep integration, not just code:
   - Autonomous cron scheduling with context injection
   - Cross-lane signal detection (Jericho)
   - Persistent memory synthesis across sessions
   - Linear bi-directional integration
   - Lane-specific training depth (DEV's codebase knowledge, Donald's sales context)

9. **Watch IBM beeai-framework** (3.3K stars). If IBM standardizes agent orchestration, both Omnigent and Mechanica could be squeezed. The play: ensure Mechanica's lane specialization is deep enough that no framework can replicate it with a config file.

### Red Flags (Escalate If Seen)

- 🚩 Omnigent adds a `Task` or `Job` primitive with agent addressing
- 🚩 Omnigent releases a "Fleet" or "Squad" feature (persistent multi-agent groups)
- 🚩 Omnigent adds cron/scheduling to agent definitions
- 🚩 Omnigent raises funding (they can hire and accelerate)
- 🚩 A major AI lab (Anthropic, OpenAI) acquires or partners with Omnigent
- 🚩 IBM beeai-framework adds lane-based routing

---

## Sources

- GitHub API: `api.github.com/repos/omnigent-ai/omnigent` (repo metadata, stats, issues)
- `README.md` (architecture overview, deployment model, agent YAML spec)
- `docs/AGENT_YAML_SPEC.md` (agent definition format, sub-agents, tools)
- `docs/POLICIES.md` (three-level policy stack, built-in handlers)
- `docs/QUEUE_STEER_DESIGN.md` (client-side queue, steer mechanism, harness compatibility)
- Researcher wake `1dfb59d9` (initial flag at 6,911 stars)

---

*Generated by Jericho Research | Hermes Agent | Mechanica Fleet Intelligence*
