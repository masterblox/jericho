# Jericho Party Trick — Voice + Worker + Gestures

**Source**: https://x.com/ai_for_success/status/2071238528978341913 (IRIS project)
**Branch**: historical planning branch (see `docs/JERICHO-RENAME-MIGRATION.md`)

---

## TLDR

A voice-first control room: you talk to it like a person, it delegates real work to
the Hermes fleet (via Paperclip) in the background, keeps talking to you while it
works, proactively announces results, and you navigate the results hands-free with
hand gestures on your webcam. Iron Man Jericho. For a client demo it's "your agent,
but you can see it think" — the single most convincing artifact that the fleet is
real and not a chatbot.

This is a **showpiece built on what we already run** (Hermes fleet + Paperclip),
not a new product to maintain. Three weekends to the wow.

---

## Why this is wild for clients (positioning)

Clients never see the fleet work. They get a Telegram bot and tap "Allow" once. The
magic is invisible to them. This changes that:

- **Voice, eyes-free** — no typing, no app to learn. Talk like it's a person.
- **Background worker, foreground conversation** — the conversation never stops
  while work happens. That manager/worker flow *feels* like an employee, not a
  chatbot. This is the core IRIS insight and it's the thing that sells.
- **Hands-free HUD** — point at a result card, open it, scroll, dismiss. Pure
  theater, but it's the theater that closes.
- **Routed through Paperclip** — the voice agent hands work off to Paperclip,
  which routes to the fleet. So the demo isn't fake: it's the real fleet doing
  real work, surfaced through voice + gestures. The same path client work takes.

Bottom line: it turns "we run agents for you" from a claim into an experience.

---

## The three layers (IRIS architecture, mapped to our stack)

```
+----------------------------------------------------------+
|  BROWSER (demo laptop, fullscreen)                       |
|                                                          |
|   MIC -----> PCM 16kHz -----+                            |
|                             |                            |
|   CAM ---> MediaPipe ------>| GESTURE EVENTS             |
|        Gesture Recognizer   |                            |
|                             v                            |
|                        +----------+                      |
|   SPEAKERS <--- PCM ---|  HUD UI  |--- task cards,       |
|        24kHz            +----------+    results, status  |
|                              |                           |
+------------------------------|---------------------------+
                               | audio up/down + tool calls
                               v
+----------------------------------------------------------+
|  LOCAL BRIDGE (tiny server on the laptop, holds secrets) |
|                                                          |
|   Gemini Live WebSocket <---> proxied (API key here)     |
|        |                                                 |
|        | function call (e.g. "draft_email",              |
|        |   "pull_issues", "run_research")                |
|        v                                                 |
|   TOOL DISPATCHER --------------------------------------+-+
|        |                                                 | |
|        +-- LOCAL EXECUTOR (party-trick mode):            | |
|        |     fast local mock for the demo wow            | |
|        |                                                 | |
|        +-- PAPERCLIP / FLEET (real mode):                | |
|              POST to :3100 / Telegram bridge outbox      | |
|              poll for result, feed back as tool response | |
+- - - - - - - - - - - - - - - - - - - - - - - - - - - - -+ |
                                                           |
+----------------------------------------------------------+
|  HERMES FLEET (existing VPS)                             |
|   Paperclip :3100 -> Jericho -> DEV/PA/Iris/Donald       |
+----------------------------------------------------------+
```

**The key mechanic** (this is what makes it feel alive): Gemini Live supports
**function calling mid-conversation**. When you say "draft a reply to Michael",
Gemini emits a tool call. Our bridge catches it, runs the work (locally for the
trick, via Paperclip for real), and sends the result **back into the same live
session** as a tool response. Gemini then synthesizes that result into the
conversation and announces it — *while you were still talking to it about
something else*. That proactive "your draft's ready, want to hear it?" is the
whole party trick.

---

## Tech stack (concrete, verified)

| Layer | Choice | Why |
|---|---|---|
| Voice | **Gemini Live API** (`gemini-2.5-flash-live`) | Real-time bidirectional audio over WebSocket. Supports barge-in (interrupt), function calling, system instructions, 70+ languages. |
| Voice SDK | `@google/genai` (JS) **or** `google-genai` (Python) | Official. Browser-capable. Old SDKs deprecated Dec 2025. |
| Gestures | **MediaPipe Tasks Gesture Recognizer** via `@mediapipe/tasks-vision` | Runs in-browser on webcam. 7 built-in gestures + 21 hand landmarks for custom/pointing. |
| Frontend | Single-page web app (React or vanilla TS) | Runs locally on demo laptop, fullscreen. Mic + cam + speakers. |
| Bridge | Small local server (FastAPI or Express) | Holds Gemini API key, proxies the Live WebSocket, runs tool dispatcher. Keeps secrets off the client. |
| Execution | Local executor **or** Paperclip API (:3100) + Telegram bridge | Two modes: party-trick (local/mock, instant) and real (fleet, async). |
| Docs/samples | https://github.com/google-gemini/gemini-live-api-examples | Official quickstarts (Python, Node, raw WS). |

**Built-in MediaPipe gestures** (7): `Thumb_Up`, `Thumb_Down`, `Victory`,
`Pointing_Up`, `Closed_Fist`, `Open_Palm`, `ILoveYou`. Plus 21 landmarks/hand
for custom pointing + handedness (left/right) + multi-hand.

**Gemini Live audio**: up = 16-bit PCM 16kHz, down = 16-bit PCM 24kHz.

---

## The build — phased to the wow

### Phase 0 — The voice loop (prove it talks) [~1 day]
Goal: a browser page that talks to you with barge-in.

- [ ] Local server (FastAPI/Express) holding `GEMINI_API_KEY`
- [ ] Proxy a Gemini Live WebSocket session end-to-end
- [ ] Browser: capture mic (16kHz PCM), stream up; play back 24kHz PCM down
- [ ] System instruction: "You are [name], a calm capable chief of staff..."
- [ ] Verify barge-in works (talk over it, it stops and listens)

**Done when**: you can hold a natural voice conversation with barge-in.

### Phase 1 — The handoff (prove it works) [~1 day]
Goal: say "draft X", it does work, announces the result without stopping the chat.

- [ ] Define 2-3 Gemini Live tool schemas: `draft_email`, `pull_my_tasks`, `summarize_doc`
- [ ] Tool dispatcher in the bridge: Phase-1 uses a **local executor** (mock/instant) so the demo is snappy and dependency-free
- [ ] Feed tool results back into the Live session as tool responses
- [ ] UI: a task card appears when a tool fires; fills in when result lands
- [ ] Gemini proactively announces ("Your draft's ready...")

**Done when**: voice-driven delegation round-trips, conversation never pauses.

### Phase 2 — The gestures + HUD (the theater) [~2 days]
Goal: Iron Man HUD, hands-free.

- [ ] Wire MediaPipe Gesture Recognizer in-browser (`@mediapipe/tasks-vision`)
- [ ] HUD UI: floating task cards, results panel, status indicators
- [ ] Gesture → action mapping (tuned, with anti-flicker/debounce):
  - `Open_Palm` + index point → hover/select a card
  - pinch / `Closed_Fist` → grab/drag
  - `Pointing_Up` → open detail
  - swipe (landmark velocity) → scroll
  - `Victory` or `Closed_Fist` hold → dismiss/close
- [ ] **Anti-flicker layer** (the tweet author built one for webcam flicker — we'll add gesture debounce + min-confidence + dwell time)
- [ ] Visual feedback for gesture state (cursor follows index tip, gesture icon badge)

**Done when**: you can point at a card, open it, scroll, close it — no mouse.

### Phase 3 — Real execution via Paperclip [~2 days]
Goal: the demo is no longer a trick — it routes to the real fleet.

- [ ] Add a "real mode" tool dispatcher path: tool call → Paperclip API (`:3100`)
- [ ] Needs **P1-2 unblocked**: outbound Paperclip API key (currently 401 — see PLAN.md)
- [ ] Create a Paperclip issue from a voice request; poll for assigned/completed
- [ ] On completion, feed result back to Gemini Live session → proactive announce
- [ ] Fallback to Telegram bridge outbox if Paperclip unavailable
- [ ] Status badges on cards: queued → assigned → working → done

**Done when**: "pull my open issues" reads the real Paperclip queue by voice.

### Phase 4 — Client demo packaging [~1 day]
Goal: one-command launch, branded per client.

- [ ] Per-client config (reuse `clients/_template/` + SOUL.md pattern): voice persona, HUD theme, agent name
- [ ] Branded HUD skin per client (logo, accent color, voice)
- [ ] Launch script: `./jericho --client <slug>` → fullscreen browser + bridge up
- [ ] Offline/local fallback so the demo works on a plane (local executor)
- [ ] A 90-second canned demo script + the 3 guaranteed-to-wow requests

**Done when**: Carlos can demo any client tenant in <2 min setup.

---

## How Paperclip fits (the real product angle)

Paperclip is currently invisible plumbing. This makes it a **product surface**:

- Voice requests become Paperclip issues → routed to the fleet the normal way
- Task cards in the HUD = live Paperclip queue (the client *sees* their work moving)
- "What's my agent working on?" → voice query → reads Paperclip state aloud
- Per-client: each client tenant gets their own Paperclip-scoped voice session

This is the differentiator vs a generic voice bot: the work is **real and routed
through the same system that runs their business**, not a sandbox. That's the line
between a toy and infrastructure.

> Note: Phase 3 is blocked on **P1-2** (provision outbound Paperclip API key from
> the admin panel — currently 401). Phase 0-2 don't need it (local executor).

---

## What I need from Carlos (decisions + keys)

1. **Gemini API key** — get one at https://a.google/gemini-api (or use an existing Google Cloud project). This is the only hard dependency for Phase 0.
2. **Paperclip outbound API key** — unblock P1-2 (PLAN.md) so Phase 3 can route real work. Agent `20cb56be...`, company `5e826a0c...`.
3. **Real or mock first?** — recommend mock (Phase 0-2 local executor) for the fastest wow, real (Phase 3) after. Confirm.
4. **Voice persona** — name + character for the demo agent (default: "Iris" since it's our design lane, or a neutral "Jericho"-style codename).
5. **Demo target** — which client (or our own fleet) for the first live demo? "Our fleet" is the honest default.
6. **Where it runs** — local on the demo laptop (recommended, webcam needs local) vs hosted with a remote browser. Recommend local.

---

## Risks / open questions

| Risk | Mitigation |
|---|---|
| Latency on real (fleet) round-trips kills the "live" feel | Phase 1 uses instant local executor for the wow; Phase 3 sets expectations ("on it" → async announce) |
| Gesture false-positives make it look janky | Mandatory debounce + min-confidence + dwell; the tweet author built a dedicated anti-flicker app — budget for tuning |
| Gemini Live audio quality / accent handling | Test with real voices early; fallback to text-in/voice-out if needed |
| API key exposure if browser calls Gemini directly | Bridge proxies the WebSocket; key never leaves the local server |
| Fleet down during a live client demo (restart cascade risk per PLAN.md) | Local-executor fallback mode guarantees the demo works offline regardless of fleet state |
| Scope creep into "build a product" | Keep it a showpiece. It sells the fleet; it doesn't replace it. |

---

## References (verified)

- Gemini Live docs: https://ai.google.dev/gemini-api/docs/live
- Gemini Live tools (function calling): https://ai.google.dev/gemini-api/docs/live-tools
- Gemini Live samples: https://github.com/google-gemini/gemini-live-api-examples
- JS SDK `@google/genai`: https://github.com/googleapis/js-genai
- MediaPipe Gesture Recognizer live demo: https://google-ai-edge.github.io/mediapipe-samples-web/#/vision/gesture_recognizer
- MediaPipe samples repo: https://github.com/google-ai-edge/mediapipe-samples/tree/main/examples/gesture_recognizer
- MediaPipe npm: https://www.npmjs.com/package/@mediapipe/tasks-vision
