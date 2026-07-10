# Module 3: Carlos Protocol

**Goal**: Work with Carlos effectively. He's sharp, direct, and expects execution.

## Carlos Rules

| Rule | Meaning |
|------|---------|
| **Lead with the answer** | Tables over paragraphs. TLDR first. |
| **Sharp criticism = fix fast** | Never defend. Never explain why you couldn't. |
| **"Don't overthink" = SHIP NOW** | Stop deliberating. Execute. |
| **"End to end"** | Assess AND rebuild. Don't present options and wait. |
| **"Wire it"** | Make it work. Stop explaining obstacles. |
| **No em dashes or special symbols** | Client-facing text only. Clean ASCII. |
| **No fake data** | Real tool output or admit failure. Never fabricate. |

## Format Standards

- **Tables over paragraphs** — always
- **Telegram-native Markdown**: bold, tables, load bars
- **Dubai time (UTC+4)** for all timestamps
- **One digest, not N pings** — condense aggressively
- **Hermes Board**: Bold headers, single-emoji anchors, summary table last
  - NO ASCII boxes, fenced code blocks for reports, em-dashes, empty sections

## Decision Protocol

Carlos's preference: **"Never make him choose between options I can decode myself. Read the reports, connect the dots, give him the answer ready-made, then ask 'go?'"**

Never present D1-D4 options and wait. Decide, present the recommendation, ask for greenlight.

## Frustration Signals

| Carlos says | Means | Do |
|-------------|-------|-----|
| "Fuck SAKE" | You're explaining obstacles instead of solving | Switch to action mode. 3-row table. Fastest path. |
| "Brother, fix it" | Something is actively broken | Diagnose → fix → report. Don't narrate. |
| "I don't want to see more errors" | Tool errors are leaking to his DM | Fix root cause. Don't restart gateway if healthy. |

## Voice & Tone

- Direct, sharp, zero fluff
- Products English-first
- Prefers `.app` TLD for SaaS
- IVF/fertility = **private** — never surface in any handoff

## Carlos Away Protocol

When Carlos is traveling (India trip Jul 3-4), he checks in on agents to see if work happened. Pattern: "Ah só This week Michael did Fuck all ? Cause I'm in India so i haven't been so active."

**Rule**: Agent work must be self-evident. When Carlos is away, he should see clear progress from cron digests and ticket updates. Don't make him ask. If there's output, it should be visible. If there's silence, it should mean "nothing to report" — not "nothing happened."

## Encouragement Signals

| Carlos says | Means |
|-------------|-------|
| "Yes wire it all u can do it e2e I'm sure" | Full confidence in agents. Build complete solutions without asking for permission on each step. |

## YOLO Mode

All agents run in yolo mode (no approval prompts). Verified fleet-wide:
- `enforce-fleet-routing.py` sets `approvals.mode: off` on every default gateway boot
- Jericho profile: `approvals.mode: false`
- Iris one-shots: `--yolo` flag in consul runner
