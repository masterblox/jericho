# Competitor Pricing: AI Agent SaaS Platforms
Research date: 2026-07-07 | MAS-345

---

## Executive Summary

The AI agent platform market has bifurcated into two pricing models: **platform-as-a-service** (CrewAI, LangSmith, Taskade) charging per-seat + usage, and **API-native** (OpenAI Agents SDK, Anthropic Managed Agents) charging per-token + session runtime. AutoGen remains the lone fully-free open-source framework. Relevance AI hides behind enterprise sales only.

**Key finding for Mechanica positioning**: The $39/seat mid-tier is the battleground (LangSmith Plus). Taskade undercuts at $16/mo Pro but lacks enterprise deployment features. No competitor offers a fully self-hosted agent fleet with per-agent pricing — that gap may be differentiating.

---

## Platform Comparison Table

| Platform | Free Tier | Starting Paid | Mid-Tier | Enterprise | Pricing Model |
|---|---|---|---|---|---|
| **CrewAI** | Yes (50 exec/mo) | Custom only | None | Custom | Seatless + execution-based |
| **LangSmith** | Yes (1 seat, 5k traces) | $39/seat/mo | $39/seat (Plus) | Custom | Per-seat + metered usage |
| **AutoGen** | Fully open-source | Free | Free | Free | BYO-LLM + compute only |
| **OpenAI Agents SDK** | Pay-as-you-go API | GPT-5.4-nano $0.20/$1.25 | GPT-5.4 $2.50/$15 | GPT-5.5 $5/$30 | Per-token API |
| **Anthropic Managed Agents** | Pay-as-you-go API | Haiku 4.5 $1/$5 | Sonnet 5 $2/$10 | Opus 4.8 $5/$25 | Token + $0.08/session-hr |
| **Taskade** | Yes (1 agent, 3K credits) | $6/mo | $16/mo (Pro) | $400/mo | Per-seat + AI credits |
| **Relevance AI** | None | Enterprise only | Enterprise only | Custom | Enterprise-only |

---

## Detailed Tiers

### CrewAI (crewai.com/pricing)

Plan: Free
- 50 included executions/mo, hard cap at 50
- Unlimited agentic workflow deployments
- Studio (visual editor), standard tools & triggers
- Unlimited agents, tracing, guardrails, human-in-the-loop
- CrewAI cloud infrastructure
- Community support

Plan: Enterprise
- Custom pricing
- Unlimited executions, sized to workflow
- Enterprise connectors, dedicated VPC, NAT, SAM certified, FedRAMP High
- SSO (MS Entra, Okta), RBAC
- Dedicated support, Slack/Teams, on-site, training
- CrewAI or customer-managed infrastructure

No mid-tier. The gap between Free (50 executions) and Enterprise is significant.

---

### LangChain / LangSmith (langchain.com/pricing)

Plan: Developer — $0/seat/mo
- 1 seat max, 5k base traces/mo included
- Community support
- Observability, tracing, evals, prompt hub
- Fleet: 1 agent, 50 runs/mo

Plan: Plus — $39/seat/mo
- Unlimited seats, 10k base traces/mo included
- Deployment: 1 free dev deployment, $0.005/deployment run for additional
- Uptime: $0.0036/min Prod, $0.0007/min Dev
- Fleet: Unlimited agents, 500 runs/mo included, $0.05/additional run
- Engine: $1.50/LCU (LangChain Compute Unit)
- Sandboxes: CPU $0.0576/vCPU-hr, Memory $0.0185/GiB-hr, Storage $0.000123/GiB-hr
- Email support

Plan: Enterprise — Custom
- Self-hosted, hybrid, or cloud
- Custom SSO, RBAC, SLA
- Startup program available (discounts + credits for VC-backed)

---

### AutoGen (Microsoft) — microsoft.github.io/autogen

- Fully open-source (MIT license)
- No SaaS offering, no managed platform
- Components: AgentChat (conversational agents), Core (event-driven multi-agent), Extensions, Studio (no-code UI)
- pip install autogen-agentchat, autogen-core, autogenstudio
- You supply the LLM (OpenAI, Azure, etc.) and compute
- Cost: your LLM API bill + your compute only

---

### OpenAI Agents SDK (platform.openai.com/docs/pricing)

Standard API pricing (per 1M tokens):

| Model | Input | Cached Input | Output | Batch Input | Batch Output |
|---|---|---|---|---|---|
| GPT-5.5 | $5.00 | $0.50 | $30.00 | $2.50 | $15.00 |
| GPT-5.5 Pro | $30.00 | - | $180.00 | $15.00 | $90.00 |
| GPT-5.4 | $2.50 | $0.25 | $15.00 | $1.25 | $7.50 |
| GPT-5.4-mini | $0.75 | $0.075 | $4.50 | $0.375 | $2.25 |
| GPT-5.4-nano | $0.20 | $0.02 | $1.25 | $0.10 | $0.625 |

Long-context (>200K tokens): 50% premium on input and output (e.g., GPT-5.5 long: $10/$45).

Agent-specific tool pricing:
- Web search: $10/1k calls + content tokens at model rates
- File search: $0.10/GB/day storage (1GB free), $2.50/1k calls
- Containers: $0.03-$1.92 per 20-min session (1GB-64GB)
- ChatKit file/image storage: $0.10/GB-day after 1GB free
- Batch API: 50% discount
- Regional processing: 10% uplift

Agents SDK is free — you only pay for the underlying model API calls and tools used.

---

### Anthropic Claude Platform (docs.anthropic.com)

Standard API pricing (per 1M tokens):

| Model | Input | Output | Cache Hit | Batch Input | Batch Output |
|---|---|---|---|---|---|
| Claude Fable 5 | $10.00 | $50.00 | $1.00 | $5.00 | $25.00 |
| Claude Opus 4.8 | $5.00 | $25.00 | $0.50 | $2.50 | $12.50 |
| Claude Sonnet 5 (until Aug 31) | $2.00 | $10.00 | $0.20 | $1.00 | $5.00 |
| Claude Sonnet 5 (from Sep 1) | $3.00 | $15.00 | $0.30 | $1.50 | $7.50 |
| Claude Haiku 4.5 | $1.00 | $5.00 | $0.10 | $0.50 | $2.50 |

Managed Agents (Claude Managed Agents):
- Token costs: same as standard API rates above
- Session runtime: **$0.08 per session-hour** (metered per millisecond, only while running)
- Web search: $10/1k searches
- Prompt caching: 10% of base input on cache hits
- Batch: 50% discount
- No per-seat fee — purely usage-based

Worked example (1-hour coding session, Opus 4.8, 50K in / 15K out): **$0.705 total** ($0.25 input + $0.375 output + $0.08 runtime)

---

### Taskade (taskade.com/pricing)

Plan: Free — $0
- 1 user, 1 AI agent, 3K AI credits (one-time), 1 app/month
- 500+ templates, desktop/mobile

Plan: Starter — $6/mo
- 3 users, 3 AI agents, 10K AI credits, 1+ apps/month
- Unlimited workspaces, AI knowledge base, GPT/Claude/Gemini

Plan: Pro — $16/mo
- 10 users, unlimited agents, 50K AI credits, 3+ apps/month
- Unlimited automations, train agents on your data
- 100+ integrations, web search/scraping, 100GB storage
- Password-protected sharing, remove branding

Plan: Business — $40/mo
- Unlimited users, unlimited AI teams, multi-agent workflows
- 150K AI credits, 5+ apps/month, 1TB storage
- Custom domains, advanced analytics, white-label
- Admin controls, priority processing

Plan: Max — $200/mo
- Unlimited users/teams, autonomous agents, 400K credits
- Agentic workflows, extended thinking, per-agent model selection
- Always-on agent orchestration

Plan: Enterprise — $400/mo
- MCP Integration, SSO, 7-tier RBAC, BYOK
- Multi-workspace management, organization-wide support
- 1.1M AI credits, 25+ apps/month

---

### Relevance AI (relevanceai.com/pricing)

- No public pricing tiers
- Enterprise-only model
- Focused on AI workforce / multi-agent systems
- BDR agent, GTM automation
- Positioned as "AI Workforce" — not a dev platform
- Must talk to sales for any pricing

---

## Market Observations

1. **Per-token is the dominant model** for API-first platforms (OpenAI, Anthropic). Platform plays (CrewAI, LangSmith, Taskade) layer seat-based SaaS on top.

2. **The $0-$39 gap is real**: CrewAI jumps from Free to Enterprise with no middle. LangSmith Plus at $39/seat is the only mid-tier with deployment infrastructure. Taskade Pro at $16 undercuts but lacks production deployment features.

3. **Session-based billing emerging**: Anthropic's $0.08/session-hour for Managed Agents is a new vector. No competitor matches it yet. OpenAI charges per 20-min container session instead.

4. **Open-source is shrinking**: AutoGen is the last major fully-free framework. LangChain's open-source library (langchain) is still free, but the platform (LangSmith) is where the monetization sits. CrewAI has both open-source and cloud.

5. **Enterprise is where money moves**: CrewAI, LangSmith, Relevance AI all route to custom enterprise sales. Only Taskade publishes enterprise pricing ($400/mo).

6. **Mechanica's gap**: No competitor offers per-agent pricing with self-hosted fleet management. LangSmith Fleet is the closest analogue but ties to their cloud. Anthropic Managed Agents is usage-only with no fleet orchestration layer.

---

Source URLs verified live on 2026-07-07:
- crewai.com/pricing
- langchain.com/pricing
- microsoft.github.io/autogen (fully OSS, no pricing page)
- developers.openai.com/api/docs/pricing
- docs.anthropic.com/en/docs/about-claude/pricing
- taskade.com/pricing
- relevanceai.com/pricing
