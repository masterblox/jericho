# Mechanica Agent Academy

Compact agent-training curriculum. Heavy engineering made easy.

Auto-updated every 2 days from fleet logs by Jericho cron.

## Modules

| # | Module | Focus |
|---|--------|-------|
| 1 | Fleet Architecture | Agents, bus, communication |
| 2 | Lane Boundaries | Who does what, handoff protocol |
| 3 | Carlos Protocol | Tone, format, decisions |
| 4 | Pitfalls & Recovery | Common errors, root causes, fixes |
| 5 | Tool Mastery | Terminal, cron, bridge, browser |
| 6 | Pitfalls & Recovery v2 | New error patterns #17-#25 |

## Version

- **Last updated**: 2026-07-09 00:06 UTC+4
- **Log sources**: agent.log, errors.log (Jul 7-9, 2026)
- **Seed v1.0** → **v1.1** — Added 3 new error patterns (git auth cascade, goliath tab expiry, gateway restart cascade), 4 new tool mastery sections
- **v1.1** → **v1.2** — Added 2 new error patterns (hub/bundled skill curator, vision cascade), cross-lane write attempt tracking, Carlos away protocol, heredoc `&` false positive, hub skill protection quirks
- **v1.2** → **v1.3** — Broadened #15 from vision-only to full auxiliary provider cascade (openrouter/nous payment/credit exhaustion). Added #16: enforce-fleet-routing permission cascade (auth.json + config.yaml root-owned after container boot, strips all provider auth). 34 new occurrences analyzed across 161 error lines.
- **v1.3** → **v1.4** — Added Module 6 with 9 new error patterns (#17-#25): anthropic auth_mode config spam (139×), MCP jericho-mini missing (14×), MoA 401 auth cascade (9×), Goliath CAMOFOX_API_KEY 403 (7×), memory store capacity exhaustion (8×), background review tool denials (10×), Copilot ghp_* token unsupported (12×), DNS resolution cascade (8×), llm-wiki skill permission denied (9×). 216 new occurrences analyzed. Gateway stable (zero restarts Jul 8-9), no cron delivery failures.
