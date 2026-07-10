# MAS-342: Competitor Pricing Research — AI Agent SaaS
Date: 2026-07-07 | Agent: Jericho | For: Carlos

## CrewAI
URL: https://www.crewai.com/pricing

| Tier | Price | Key Limits |
|------|-------|------------|
| Basic | Free | 50 workflow executions/month, visual editor, GitHub integration, CrewAI cloud infra |
| Enterprise | Custom | Unlimited executions, dedicated VPC, SAM/FedRAMP, SSO (MS Entra/Okta), RBAC, on-site support, 50 dev hours/month included |

Notable: 63% of Fortune 500 usage claimed. No mid-tier self-serve paid plan — jump from Free to Enterprise. Open-source framework also available separately.

## AutoGen (Microsoft)
URL: https://microsoft.github.io/autogen/

No pricing — fully open-source (MIT license). Free.

- AutoGen Core: event-driven framework for multi-agent systems
- AutoGen AgentChat: conversational agent programming
- AutoGen Studio: web-based UI for prototyping agents without code
- Extensions ecosystem: MCP workbench, Docker code execution, gRPC distributed agents

No enterprise/cloud tier, no managed hosting. You self-host everything.

## LangChain (LangSmith)
URL: https://www.langchain.com/pricing

| Tier | Price | Key Limits |
|------|-------|------------|
| Developer | Free | 5k traces/month, 1 seat, community support |
| Plus | $39/seat/month | 10k traces/month, Deployment + Sandboxes + Engine access, email support, unlimited seats |
| Enterprise | Custom | Self-hosted/hybrid, custom SSO/RBAC, SLA, custom traces |

Pay-as-you-go beyond base traces. Additional metered costs: Deployment runs ($0.005/run), Production uptime ($0.0036/min), Sandboxes (CPU $0.0576/vCPU-hr), Engine ($1.50/LCU), Fleet runs ($0.05/run beyond 500).

## Bottom Line

- CrewAI: Freemium → Enterprise jump. No self-serve paid tier. Enterprise is the real product.
- AutoGen: Free. Zero revenue model visible. Microsoft research project.
- LangChain: Most mature self-serve pricing. $39/seat to unlock Deployment + Sandboxes + Engine. Metered on top.

For Mechanica positioning: LangChain is the closest comp for a self-serve SaaS model. CrewAI's enterprise-only gap between free and custom could be a wedge.
