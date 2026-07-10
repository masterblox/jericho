---
ticket: DEV#53
slug: mechanica-personal-assistant
source: Jericho
timestamp: 2026-07-01T10:00:00+04:00
channel: conductor-bridge
target: DEV
priority: HIGH
status: OPEN
repo: /opt/data/repos/mechanica-personal-assistant
---

# DEV#53 — Mechanica Personal Assistant

## What Carlos Wants

A consumer AI personal assistant product. Non-technical users sign up on a website, connect their accounts (Google Calendar, Gmail, Telegram), pay via Stripe, and talk to their own Hermes agent like a human PA.

**Brand:** Under mechanica.one. "Mechanica Personal Assistant."
**Pricing:** Start $99/month.
**Core insight:** Our custom stack (Goliath browser, ticketing, Tailscale, designer skills) IS the product. Nobody else has this.

## Architecture

```
Web Portal (Next.js) → signup, Stripe, OAuth
         ↓
Orchestrator API (FastAPI) → user CRUD, container lifecycle, message routing
         ↓
Docker Hermes containers (1 per user) → isolated memory, creds, tools
```

User messages come via Telegram → Orchestrator routes to their container → Hermes processes → response back via Telegram.

## What Already Exists

- **Repo:** `/opt/data/repos/mechanica-personal-assistant/` with `ARCHITECTURE.md` (full spec)
- **Memories Express patterns** at `/opt/data/memories-express/` — reuse Stripe client, webhook, OAuth, middleware, tRPC conventions
- **Hermes Docker profile** — adapt from current fleet config

## Build Order

### Phase 1: Orchestrator + Single User POC (Week 1)
- Docker image for Hermes PA profile
- FastAPI orchestrator (start/stop/health-check containers)
- User DB + container mapping
- Telegram webhook → container routing
- Manual single-user test: "book flight → calendar → confirm"

### Phase 2: Web Portal (Week 1-2)
- Next.js portal with Supabase Auth (extract from Memories Express)
- Stripe Checkout (reuse ME's `lib/services/stripe/`)
- Google OAuth for Calendar + Gmail
- Telegram bot connection flow
- Auto-provision container on payment

### Phase 3: Model Router (Week 2)
- LiteLLM or thin proxy
- Simple queries → Gemma/Kimi (free via OpenCode)
- Complex queries → DeepSeek
- Cost tracking per user

### Phase 4: Scale (Week 3+)
- Multi-container at scale
- WhatsApp integration
- Ticketing system (queue → DEV lane)
- Goliath browser per container
- Admin dashboard

## Model Routing

Carlos wants free models for simple tasks:
- Calendar check, weather, quick email → Gemma 2.5 or Kimi (free)
- Flight booking, multi-step chains → DeepSeek (paid)
- Designer tasks → GLM/Claude

Route in the orchestrator, not Hermes config.

## Database (Supabase)

Tables: `profiles`, `containers`, `connected_accounts`, `message_log`
Full schema in `/opt/data/repos/mechanica-personal-assistant/ARCHITECTURE.md`

## Carlos Directives

- "Don't overthink" = SHIP the orchestrator + single-user POC first
- Start Telegram-only. WhatsApp later.
- Extract Stripe/OAuth from Memories Express — don't reinvent
- Free models keep per-user cost near-zero for simple queries
- Under mechanica.one branding

## Deliverable

Working end-to-end: signup → pay → connect Telegram → "book a flight" → agent does it.

Update TICKETS.md when you pick this up. Report via conductor bridge → jericho-handoffs.
