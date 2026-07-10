# Researcher Wake Report — 2026-07-09 11:00 DXB

**Paperclip status: FULLY DOWN** (HTTP 000 on health + API). No issue operations possible.

---

## HIGH-URGENCY SIGNALS

### 1. Hermes Agent v0.18.1 + v0.18.2 Released (Jul 7-8, 2026)

Two patches in 24 hours:
- **v0.18.1** — ~660 PRs since v0.18.0. Includes installer self-healing (Windows), dashboard/gateway fixes, WhatsApp dashboard pairing, MCP + provider fixes. Infrastructure-driven tag for Docker/PyPI consumers.
- **v0.18.2** — Same-day patch: WhatsApp Baileys dependency fix (unpinned from git commit to published npm 7.0.0-rc13).

**Impact for Mechanica**: Fleet runs on Hermes. 660 PRs in 6 days is a lot of churn — potential breaking changes for gateway, MCP, providers. Full release notes ship with v0.19.0 but we shouldn't wait.

**Action**: Audit fleet Hermes version. Test upgrade on a non-critical profile before fleet-wide rollout.

---

## COMPETITOR / ECOSYSTEM SIGNALS

### 2. Omnigent — Meta-Harness Framework (6,874 stars)
github.com/omnigent-ai/omnigent

Open-source meta-harness for orchestrating Claude Code, Codex, Cursor, Pi, and custom agents. Swap harnesses without changing agent code. Positioned as the "agent orchestration layer" — directly competes with Hermes's multi-agent/delegation primitives.

**Impact**: If Omnigent gains traction as the standard harness layer, it could abstract away Hermes as just one of many backends. We need our own multi-provider orchestration story.

### 3. Agent Protocol — Common Agent Interface (1,463 stars)
github.com/agi-inc/agent-protocol

"Common interface for interacting with AI agents. Tech stack agnostic." Could become a standard like HTTP for agents.

**Impact**: If adopted widely, this would commoditize agent interfaces. Mechanica should adopt/implement it early rather than fight it.

### 4. Golf MCP — Production MCP Framework (833 stars)
github.com/golf-mcp/golf

MCP server framework with auth, observability, debugger, telemetry. Maturation of the MCP ecosystem — moving from experimental to production-grade.

**Impact**: MCP is becoming table stakes. Fleet MCP servers need auth + observability to match market expectations.

### 5. II-Agent + beeai-framework (3.3K stars each)
- github.com/Intelligent-Internet/ii-agent — New OSS agent framework
- github.com/i-am-bee/beeai-framework — Production agents in Python + TypeScript

Two new entrants with rapid adoption. The agent framework space is getting crowded.

---

## ARXIV HIGHLIGHTS (Jul 7-8, 2026)

| Paper | Relevance |
|---|---|
| **SkillCenter: Large-Scale Skill Library for Autonomous AI Agents** | Directly relevant — Hermes skills ecosystem. Largest open skill library claim. |
| **Agent Delivery Engineering Predictive Reliability Framework** | Multi-agent reliability via 20 heterogeneous signals. Relevant to fleet health monitoring. |
| **Think Big, Search Small: Where Capacity Matters in Hierarchical Search Agents** | Multi-agent architecture optimization — when to use big vs small models in agent hierarchies. |
| **From Noisy Traces to Root Causes: Structural Trajectory Analysis for Agent Optimization** | Agent debugging via trace analysis. LLM-as-optimizer pattern. |
| **Institutional Red-Teaming: Deployment Rules Causally Shape Multi-Agent AI Safety** | Safety methodology for multi-agent deployment rules. |
| **What Makes a Good Bug Report for an AI Agent?** | APR agent UX research — what bug report format works best for AI repair agents. |

---

## KEY TAKEAWAYS

1. **Update Hermes now** — 660 PRs is too many to sit on. Audit before fleet VPS auto-updates.
2. **Omnigent is the competitor to watch** — meta-harness positioning threatens Hermes's agent orchestration primitives.
3. **Agent Protocol could become a standard** — implement it early rather than fight it.
4. **SkillCenter paper** — review their approach to skill libraries. May inform fleet skill management improvements.
5. **MCP ecosystem is maturing fast** — Golf MCP shows production expectations (auth, observability). Fleet MCP servers need upgrades.

---

*Report saved locally. Paperclip was down — no issue filed. Outbox handoff at researcher-wake-2026-07-09T1100.txt.*
