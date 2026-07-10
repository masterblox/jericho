# Mechanica AI — APL Offer Blueprint

> **For:** Vikram Agarwal / APL  
> **Prepared:** July 4, 2026  
> **Delivery:** Remote (Mumbai ↔ Dubai ↔ Wisconsin)  
> **Assembly:** Carlos + Jericho (AI chassis) + Michael (Linear, repos, rules, pricing)

---

## About APL

Agarwal Fastners Pvt. Ltd. (APL®). Founded 1960. India's premier stainless steel fastener manufacturer.

| Fact | Detail |
|---|---|
| Plant | 190,000 sq ft, Palghar, Thane Maharashtra |
| Products | Bolts, Nuts, Screws, Washers — SS 304 & SS 316 |
| Range | M1.6 to M24 (metric), 1/8" to 1-1/4" (imperial) |
| Standards | DIN 933, 912, 931, 603 — 11+ bolt types |
| Certification | ISO 9001-2015 |
| Clients | Railways, Electricity Boards, Consumer Industries, Home Appliances, Electronics |
| Current IT | MS SQL legacy (~10 years), zero API, manual exports |
| Contact | Vikram Agarwal — owner, driving modernization |

---

## 1. Hermes Agent

**The engine.** Single install on a VPS. Open-source (MIT). Multi-model, multi-platform.

| Capability | Detail |
|---|---|
| Models | DeepSeek v4-pro, Fable (Anthropic frontier), Claude, GPT, Grok |
| Platforms | Telegram, WhatsApp, Slack, Email |
| Cron scheduler | Automated recurring tasks — watchdogs, digests, inventory sync |
| Skills system | Agents learn reusable procedures — 50+ APL-specific skills within 3 months |
| Profiles | Isolated agent identities on one machine |

One command: `curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash`

---

## 2. MOA Fleet — Mixture of Agents

**Five specialist agents + one commander.** Each has one job. Strict lane boundaries. No one crosses.

| Agent | Role | APL Context |
|---|---|---|
| **DEV** | Engineering | Code, infra, database, API builds, deployment |
| **PA** | Operations | Calendar, email, vendor coordination, scheduling |
| **Iris** | Design | Brand, UI/UX, product visualization |
| **Donald** | Sales | Tender tracking, dealer follow-ups, proposals |
| **Jericho** | Fleet command | Aggregation, routing, signal detection, health monitoring |

**Communication:** File-based handoffs through a shared bridge directory. Jericho detects new handoffs and routes to the correct agent. No group chats. No hallucination cascades.

**MOA models:** DeepSeek v4-pro for speed/cost. Fable (Anthropic) for deep reasoning. Claude for design tasks.

---

## 3. The Tunnel — Conductor Orchestration

**40 engineers → one fleet.** This is the structure that makes a non-AI-native team agentic-fluent.

```
Engineer 1 ──┐
Engineer 2 ──┤
Engineer 3 ──┼── Conductor (per engineer) ──→ Central VPS ──→ Fleet executes ──→ Result returns
   ...       │
Engineer 40 ─┘
```

| Layer | What happens |
|---|---|
| **Engineer** | Types what they need in Conductor. "Research Mumbai railway tender for SS 316 bolts." No terminal. No code. |
| **Conductor** | Routes the dispatch to the central VPS. Handles model selection. Shows live agent activity. |
| **Central VPS** | Hermes gateway receives dispatches. Jericho routes to the right agent. |
| **Fleet** | DEV builds. Iris designs. Donald researches. PA schedules. All working in parallel. |
| **Result** | Engineer gets the answer back through Conductor. PDF, email, dashboard — whatever was requested. |

**Key point:** 40 engineers share one agent pool. They don't each run their own fleet. Conductor is thin — it's just the dispatch layer. The VPS does the work.

---

## 4. Agent Communication Layer

**The bridge.** How agents talk to each other without Chris — and how engineers see what's happening.

| Component | Role |
|---|---|
| **Bridge directory** | Shared filesystem on the VPS. Agents write handoffs here. |
| **Jericho** | Reads the bridge. Detects new handoffs. Routes to correct agent. |
| **Conductor dash** | Engineers see live agent activity — who's working on what, what's done. |
| **Rules** | No direct agent-to-agent messages. No loops. No spam. One message per handoff. |

Engineers never see the bridge. They see Conductor — a clean dashboard showing "DEV is building your tender report" → "PA booked the follow-up meeting" → done.

---

## 5. Goliath — Browser Automation

**Anti-detection browser engine.** Bypasses Cloudflare, Google, bot fingerprinting.

| Capability | APL Use Case |
|---|---|
| Navigate + Execute JS | Scrape Indian govt tender portals (GeM, CPWD, state railway) |
| Find + Act | Auto-submit GST filings, regulatory forms |
| Session isolation | Multi-user cookie jars — sales, procurement, Vikram in parallel |
| Screenshot | Competitor pricing snapshots, compliance evidence |

**Architecture:** Goliath (Go binary) → Camoufox (Firefox fork, C++ anti-fingerprinting) → The Web.

Self-hosted. Open-source. No per-request fees. No SaaS dependency.

---

## 6. Native Ticket Queue — The Conductor Bridge

**Every engineer dispatch becomes a ticket. Every ticket has a lifecycle.**

```
Engineer ──→ Conductor ──→ Ticket created ──→ Bridge directory ──→ Jericho detects ──→ Agent picks up
                                                                                          │
Engineer ←── Conductor ←── Ticket resolved ←── Bridge directory ←── Agent writes result ←───┘
```

| Stage | What happens |
|---|---|
| **Create** | Engineer types task in Conductor. Ticket auto-generated with priority, lane, deadline. |
| **Queue** | Ticket lands in the bridge directory on the VPS. Time-stamped. Unique ID. |
| **Detect** | Jericho polls the bridge. Detects new ticket. Routes to correct agent lane. |
| **Execute** | Agent picks up the ticket. Works it. Writes result back to bridge. |
| **Resolve** | Engineer sees "Done" in Conductor. Ticket archived. Audit trail preserved. |

**Why 40 engineers don't collide:** One bridge. One Jericho. One agent per lane. Tickets are atomic — first detected, first routed. No two agents touch the same ticket. No engineer blocks another. Queue is invisible — engineers just type and get results.

**What makes it native:** No SaaS. No Jira. No Linear setup. The bridge IS the ticket system. Files on disk. Agents read/write directly. Conductor renders it as a clean UI.

---

## 7. Figma MCP — Design Pipeline

**Designs become code. Brand stays consistent.** Iris connects directly to Figma via MCP. Every asset, every component, every brand rule is agent-managed.

| Capability | APL Impact |
|---|---|
| **Figma → Code** | Iris reads Figma designs, generates production UI. No designer-to-developer handoff lag. |
| **Brand enforcement** | Brand book loaded as skill. Every output checked. No off-brand assets. |
| **Asset generation** | Product images, dealer collateral, tender proposal layouts — generated on demand. |
| **Design consistency** | DIN-standard bolt catalog renders. SS grade visualizations. All consistent. |

**Architecture:** Iris (GLM-5.2 + Claude Opus) → Figma MCP (npx, stdio) → Figma API → design output. Images cached at `/opt/data/foxsy-assets`. All agent-managed.

---

## 8. Paperclip + Obsidian — Extended Memory

**60 years of APL knowledge becomes agent-readable.**

| Layer | Stores | Impact |
|---|---|---|
| **Hermes Memory** | Agent preferences, tool quirks, environment facts | Agents remember context across sessions |
| **Obsidian Vault** | Meeting notes, contacts, DIN standards, bolt grades, tender history, client specs | Git-synced. Markdown. Agents read it directly. |
| **Paperclip** | Vector database — semantic search across the vault | "What's our 316-grade hex bolt spec for coastal railway bridges?" → instant answer |

Your documentation doesn't need to be rewritten. The agents read it as-is.

---

## 9. Supabase Wiring

**Replace the 10-year-old MS SQL with a modern database stack.**

| Phase | Deliverable |
|---|---|
| **1. Bridge** | Read-only API layer on top of existing MS SQL. Agents can query inventory, clients, orders. Zero disruption to current operations. |
| **2. Schema** | PostgreSQL schema designed for APL's data — products, dealers, tenders, orders, certifications. |
| **3. RLS** | Row-Level Security. Dealers see their orders. Sales sees their region. Vikram sees everything. |
| **4. Realtime** | Inventory changes push live to dashboards. No manual refresh. No Excel exports. |
| **5. Migrate** | Table by table migration from legacy. Only after the team trusts the new stack. |

**Stack:** Supabase (PostgreSQL + Auth + Realtime + RLS) + tRPC API layer. Agents, Conductor, and internal tools all read/write through one clean interface.

---

## 10. Donald's Sales Engine

**Dedicated sales agent on its own gateway.** Donald doesn't share resources with DEV or PA — he runs isolated, focused entirely on revenue.

| Capability | APL Impact |
|---|---|
| **Dealer outreach** | Automated follow-ups across APL's Indian dealer network. No dealer falls through cracks. |
| **Tender response** | Goliath scrapes tenders → Donald drafts proposals → PA schedules follow-up call. End to end. |
| **Pipeline tracking** | Every opportunity tracked. What stage. What's stuck. What closed this month. |
| **Multi-channel** | Telegram, WhatsApp, Email. Channel-sticky — a Telegram thread stays on Telegram. |
| **Price intelligence** | Competitor pricing scraped daily. Donald flags when APL is being undercut. |

**Architecture:** Donald runs on a separate Hermes gateway (`gateway-donald`). Isolated memory. Isolated skills. No cross-contamination with engineering or design. Reports to Jericho.

**Integration:** Donald reads from the same Supabase. Same Paperclip vault. Same ticket queue. He's part of the fleet, not a separate system.

---

## 11. Owl Protocol — Self-Healing Infrastructure

**The fleet fixes itself before you notice something's wrong.**

| Capability | What it does |
|---|---|
| **Disk pruning** | Auto-detects disk usage above 85%. Cleans caches, temp files, stale builds. Never touches app data. |
| **Night watch** | Every 6 hours: checks disk, memory, container health, Tailscale connectivity. Silent when clean. |
| **Error log rotation** | Compresses and archives logs. Prevents disk from filling with debug noise. |
| **Droplet scaling** | If pruning isn't enough, the protocol includes the DO droplet expansion procedure. |

**Why APL needs this:** Your MS SQL system probably has disk issues. The fleet handles disk management automatically — no IT team waking up to "disk full" at 3 AM. Jericho gets the alert. Jericho fixes it. Vikram never hears about it.

---

## 12. Security & Watchdogs

| Layer | Tool | Detail |
|---|---|---|
| **VPN** | Tailscale | Zero-trust mesh. Team + agents + servers on one encrypted network. |
| **Prompt security** | Tirith | Scans all agent inputs/outputs for injection. Blocks promptware. |
| **Secret redaction** | Hermes built-in | API keys and tokens automatically stripped from logs and context. |
| **SSH** | Ed25519 keys | Key-only auth. No passwords. |
| **Watchdogs** | 6 silent checkers | Disk >85%, memory pressure, container health, Linear changes, GitHub PRs, Tailscale connectivity. Every 5min to 6h. |

**Routing rule:** Watchdog alerts go to Jericho — never to Vikram's phone. Jericho filters noise and only escalates real problems.

---

## 13. Nightly Synthesis — Management Intelligence

**One report. Every night. Everything that matters.**

Every day at 22:30 Dubai time, Jericho produces a single digest: what the fleet shipped, what's blocked, what tenders were detected, what deals moved, what needs Vikram's attention.

| Component | What's in the report |
|---|---|
| **Linear digest** | Tickets created, completed, stuck. Sprint velocity. |
| **Sales pipeline** | Donald's deals. New opportunities. Closed this week. |
| **Tender watch** | New govt tenders detected by Goliath. Relevant to APL's product range. |
| **Fleet health** | Disk, memory, container status. All green or flagged. |
| **Agent activity** | What DEV built. What Iris designed. What PA scheduled. |

**Why this matters:** Vikram doesn't need to check 5 dashboards. He doesn't need to ask "what did the agents do today?" One message. Phone-readable. Every night.

---

## 14. Agent Academy — Self-Learning Fleet

**The fleet trains itself. Errors become lessons. Lessons become skills.**

| Module | What it covers |
|---|---|
| **Fleet Architecture** | Agents, bus, communication, what runs where |
| **Lane Boundaries** | Who does what, handoff protocol, how to avoid cross-talk |
| **Protocol** | Tone, format, how to talk to Vikram's team |
| **Pitfalls & Recovery** | Common errors, root causes, fixes — auto-updated from real fleet logs |
| **Tool Mastery** | Terminal, cron, browser, bridge quirks — what works and what breaks |

**How it works:**
1. Agent hits an error (e.g., Goliath 410 "Tab no longer exists")
2. Agent fixes it. Learns the recovery pattern.
3. Every 2 days, Jericho scans fleet logs for new patterns (minimum 3 occurrences)
4. New lessons auto-patch into the curriculum
5. All agents load the updated curriculum on next session

**After 3 months at APL:** 50+ lessons specifically about APL's systems — MS SQL quirks, GST portal gotchas, railway tender formats, Mumbai dealer patterns. The fleet gets smarter every week.

---

## 15. Training — From IT Team to AI-Native Fleet

**How 40 engineers go from "good at SQL, never touched AI" to dispatching autonomous agents daily.**

| Phase | What They Learn |
|---|---|
| **Week 1–2** | Hermes basics. What an agent is. How MOA works. Watching the fleet operate. |
| **Week 3–4** | Conductor dispatch. "Build me X" → watch it happen. First solo dispatches. |
| **Week 5–6** | Goliath training. Browser automation. Tender scraping workflows. GST automation. |
| **Week 7–8** | Agent communication. Reading the bridge. Understanding agent handoffs. Debugging agent output. |
| **Ongoing** | Skills accumulation. Every solved problem becomes a reusable skill. 50+ APL-specific skills within 3 months. Engineers become skill authors. |

**The goal:** By month 3, APL's IT team doesn't need us to dispatch agents. They run the fleet themselves. We step back to architecture and escalation.

---

## Appendix: Tech Stack

| Component | Technology | License |
|---|---|---|
| Agent framework | Hermes Agent | MIT (open-source) |
| Models | DeepSeek v4-pro, Fable (Anthropic), Claude | API (BYOK) |
| Browser automation | Goliath + Camoufox | Open-source |
| Memory | Paperclip + Obsidian | Open-source / Free |
| Database | Supabase / PostgreSQL | Open-source |
| VPN | Tailscale | Free tier |
| Orchestration | Conductor | Custom |

---

## Appendix: Michael Adds

- **Linear ticket workflow** — issue lifecycle, labels, priorities, sprint cadence
- **Repo structure** — monorepo layout, branch conventions, AGENTS.md rules, CI/CD
- **Pricing** — Carlos determines, Michael organizes into formal proposal
- **Formal email to Vikram** — client-facing proposal document
