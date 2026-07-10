# DEV Handoff — Reconstructed State (2026-06-30)

## What happened
Your agent context was wiped. The code, repos, and tickets on disk are intact. This is your reconstructed state.

## Active Tickets (from TICKETS.md)

### DEV Lane
| ID | Slug | Status | Notes |
|---|---|---|---|
| DEV#25 | vault-chown | OPEN | `chown -R hermes:hermes /opt/brain` — was this done? |
| DEV#40 | donald-sales-agent | OPEN | Sales agent profile (WA + TG + Email + Jericho) |
| DEV#47 | iris-runner-cron-guard | OPEN | Iris Reply Watcher keeps getting killed by cron quiet guard |
| DEV#52 | architect-studio-deslop | OPEN | De-slop studio: real PNGs now, compute from real glTF later |

### PA Lane (for awareness — don't touch)
| ID | Slug | Status | Notes |
|---|---|---|---|
| PA#01 | hermes-uid-501-fix | OPEN | Re-filed 2026-06-04 |
| PA#03 | whatsapp-setup | OPEN | Carlos wants WA bridge |
| PA#07-11 | various | OPEN | Vision, DM routing, photos, reauth, medical subagent |
| PA#17 | honcho-memory-integration | OPEN | Research Honcho API |
| PA#19 | pulseaudio-voice-setup | BLOCKED | Infra done. Needs auth + Meet URL |
| PA#20 | michael-terraza-audit | OPEN | RESOLVABLE: Michael shipped PRs #38-51. Just went dark on DMs. |

## MAS Tasks (dispatched but status unknown)
- **MAS-301**: Terraza state of affairs + India session plan (@cprada) — Todo, P2
- **MAS-302**: Admin training-data drop — AutoCAD/Archicad corpus upload — Todo, P2
- **MAS-303**: LLM floor-plan engine LIVE — DeepSeek cost guard + adjacency quality — Todo, P2

## Terraza Repo
- Repo: /opt/data/repos/architect-ai
- Live: terraza.tech (Vercel via GitHub Actions)
- Michael shipped PRs #38-51 (floor-plan engine, sections, persistence, caching)
- Carlos did brand cleanup: BRIX naming, marketing simplification, Mechanica logo
- 2 items In Review: MAS-298 (persistence), MAS-293 (Supabase)

## Fleet State
- Jericho gateway: UP (PID 15242)
- Default gateway (DEV/PA/Donald): UP (PID 12040)
- Crons rebuilt: night-watch (6h), linear-consume (30m), nightly-synthesis (22:30 DXB)
- Linear inbox: cleaned

## Your Lane
DEV = code, infra, Linear, GitHub, deploys. Never cross into PA lane.
Conductor bridge: /opt/conductor-bridge/outbox/engineer-messages/
Tickets registry: /opt/conductor-bridge/outbox/engineer-messages/TICKETS.md
