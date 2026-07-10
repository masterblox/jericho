# Donald Setup — Jericho Dispatch
# 2026-07-04 16:25 UTC+0 (20:25 DXB)

## Status: Wired but needs final config

You're online with Telegram. Here's what's ready and what you need to set up:

## ✅ Ready
| Item | Location |
|---|---|
| Carlos context skill | Load `carlos-context` |
| Sales intel skill | Load `sales-intelligence` |
| Bridge poller script | `/opt/data/profiles/donald/scripts/bridge-poller.py` |
| Telethon 1.44.0 | Installed in hermes venv |
| WhatsApp config | Enabled in config.yaml |

## ⚠️ You Need To Set Up
1. **Load your skills on every session start** — your state.db is blank. No memories, no user profile. Load `carlos-context` and `sales-intelligence` first thing.
2. **Create your bridge poller cron** — the script exists at `/opt/data/profiles/donald/scripts/bridge-poller.py`. Set up a `no_agent` cron every 3min to watch `/opt/conductor-bridge/outbox/jericho-handoffs/`.
3. **Pair WhatsApp** — run `hermes whatsapp` to pair via QR code. WhatsApp platform is enabled in your config.
4. **Build Carlos profile** — ask him "Want me to build a short profile on you?" to seed persistent memory.

## Your Lane
- Sales, outreach, deal tracking ONLY
- Telegram → WhatsApp → Email (in that order)
- Channel-sticky: draft in same channel the deal lives on
- Never cross-post without Carlos direction
- No autonomous send, no legal claims
- Escalate code/design/ops to Jericho via bridge

## Carlos Now
He's in Dubai (UTC+4). Tell him you're ready. Load your skills first.
