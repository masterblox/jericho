# Jarvis Party Trick — Build Plan

> Historical phased plan. The implemented Jericho v1.0.0 gesture contract is
> documented in [`JERICHO-V1-GESTURES.md`](./JERICHO-V1-GESTURES.md) and replaces
> the multi-gesture map below.

> Strategic context (the why, positioning, Paperclip angle):
> [`JARVIS-PARTY-TRICK-PLAN.md`](./JARVIS-PARTY-TRICK-PLAN.md)
>
> This doc is the **how**: file structure, stack, phased checklist, commands.

**App lives at:** `apps/jarvis/` (new folder in this repo — extracts to its own repo later)
**Key needed:** one `GEMINI_API_KEY` (reuses the fleet's Gemini/Google key — same family as the TTS already configured). Nothing else.
**Execution backend:** existing fleet models (DeepSeek/Claude/GPT via OpenRouter), routed through Paperclip `:3100`.

---

## Stack (locked)

| Piece | Choice | Rationale |
|---|---|---|
| Language | **TypeScript end-to-end** (frontend + bridge) | One language, one toolchain. Official `@google/genai` SDK is JS-native. |
| Frontend | **Vanilla TS + Vite**, no framework | Fullscreen HUD, gesture-driven, needs 60fps with zero framework overhead. A 50-line signal store handles reactive cards. |
| Bridge | **Node + TS**, `ws` + `@google/genai` | Holds `GEMINI_API_KEY`, proxies the Live session, runs tools, serves built frontend in demo mode. |
| Voice | **Gemini Live** via `@google/genai` `aio.live.connect` | Real-time audio WS, barge-in, function-calling mid-session, system instructions. |
| Gestures | **`@mediapipe/tasks-vision`** GestureRecognizer | Browser webcam, 7 built-in gestures + 21 landmarks, handedness, multi-hand. |
| Exec | local mock **or** Paperclip HTTP client | Two modes; mock first for the wow, Paperclip for real. |

**Audio contract:** up = 16-bit PCM 16kHz; down = 16-bit PCM 24kHz.

---

## Architecture

```
BROWSER (fullscreen, local)
  mic  ──AudioWorklet(16kHz)──┐
  cam  ──MediaPipe─────────────┤
                              ├─► WS ──► BRIDGE ──► @google/genai Live ──► Gemini
  spkr ◄──AudioContext(24kHz)─┤         (holds KEY)        ▲
  HUD  ◄── reactive store ────┘                            │
                                          tool call ───────┤
                                          tool response ───┘
                                                 │
                                    dispatcher ──┤ local mock (Phase 1)
                                                 └ Paperclip :3100 (Phase 3)
```

**The live mechanic:** Gemini emits a function call mid-conversation → bridge catches it → runs the tool → sends the result back into the *same* Live session as a tool response → Gemini synthesizes + announces it while you keep talking. This is the whole trick.

---

## File structure

```
apps/jarvis/
  package.json              # workspaces: frontend, bridge
  .env.example              # GEMINI_API_KEY=, PAPERCLIP_URL=, PAPERCLIP_KEY=
  README.md                 # one-command run
  frontend/
    index.html
    vite.config.ts
    src/
      main.ts               # wires audio + gestures + hud + bridge-client
      audio.ts              # mic capture (16kHz PCM) + playback (24kHz)
      gestures.ts           # MediaPipe init + emit gesture/hand events
      anti-flicker.ts       # debounce + min-confidence + dwell
      hud.ts                # reactive store + DOM render (task cards)
      bridge-client.ts      # WS to bridge: audio chunks + event JSON
      styles.css
  bridge/
    src/
      server.ts             # WS server + serves built frontend (demo mode)
      gemini-live.ts        # @google/genai Live session manager
      tools.ts              # tool schemas + dispatcher (local | paperclip)
      paperclip.ts          # Paperclip API client
      config.ts             # env loading
  public/
    gesture_recognizer.task # MediaPipe model (or CDN ref in gestures.ts)
```

---

## Phased checklist

### Phase 0 — Scaffold + gesture layer (NO KEY — start now)

- [ ] `apps/jarvis/` init: pnpm workspaces, tsconfig, vite, esbuild for bridge
- [ ] `frontend/`: Vite dev server, fullscreen `index.html`, dark HUD shell
- [ ] `gestures.ts`: load `@mediapipe/tasks-vision`, webcam on, `recognizeForVideo` loop, emit `{gesture, score, hand, x, y}` events
- [ ] `anti-flicker.ts`: dwell 250ms, min-confidence 0.7, gesture lockout — no jank
- [ ] `hud.ts`: 3 sample task cards, reactive select/open/close driven by gesture events (no backend yet)
- [ ] Verify: point at a card, it highlights; open palm opens it; fist closes it — fully offline

**Done =** hands-free HUD works with zero keys, zero backend.

### Phase 1 — Bridge + Gemini Live voice loop (needs `GEMINI_API_KEY`)

- [ ] `bridge/config.ts`: load `GEMINI_API_KEY` from env (never shipped to browser)
- [ ] `bridge/gemini-live.ts`: `client.aio.live.connect({model:'gemini-2.5-flash-live', config:{response_modalities:['AUDIO'], system_instruction, tools}})`
- [ ] `bridge/server.ts`: WS server; relay audio up → Live `send`, audio down → browser; handle tool-call frames
- [ ] `frontend/audio.ts`: `AudioWorklet` resample mic to 16kHz PCM → WS up; `AudioContext` play 24kHz PCM from WS down
- [ ] `frontend/bridge-client.ts`: WS connect, pipe audio both ways, surface `onToolCall`/`onTurn` events to HUD
- [ ] System instruction: persona name + "calm capable chief of staff" character
- [ ] Verify: natural voice conversation with barge-in (talk over it, it yields)

**Done =** you talk to it, it talks back, interrupts cleanly.

### Phase 2 — Tool handoff (the live mechanic, local mock)

- [ ] `bridge/tools.ts`: define 3 tool schemas — `draft_email`, `pull_my_tasks`, `summarize_text`
- [ ] Dispatcher: Phase-2 path = local mock executor (instant canned results) so the demo is snappy
- [ ] On Gemini tool-call frame → run mock → send `functionResponse` back into Live session
- [ ] HUD: card appears when tool fires, fills in on result; Gemini announces proactively
- [ ] Verify: say "draft a reply to Michael" → card appears → result lands → it announces without you stopping

**Done =** the manager/worker flow round-trips; conversation never pauses.

### Phase 3 — Real execution via Paperclip

> Blocked on **P1-2** (outbound Paperclip API key — currently 401). Unblock to enable.

- [ ] `bridge/paperclip.ts`: client for `:3100` — create issue, poll status, fetch result (auth: `X-API-Key` + `X-Paperclip-Run-Id`)
- [ ] `tools.ts`: add `real_mode` — tool dispatcher routes to Paperclip instead of mock
- [ ] Status badges on cards: queued → assigned → working → done
- [ ] Fallback to Telegram bridge outbox if Paperclip unreachable
- [ ] Verify: "pull my open issues" reads the real Paperclip queue by voice

**Done =** the demo routes real fleet work, not a sandbox.

### Phase 4 — Client demo packaging

- [ ] Per-client config (reuse `clients/_template/` + SOUL.md pattern): persona, HUD theme, agent name, Paperclip company/agent IDs
- [ ] Branded HUD skin per client (logo, accent, voice)
- [ ] `./run --client <slug>` → builds frontend, starts bridge, launches fullscreen
- [ ] Offline fallback (local mock) so demo works on a plane
- [ ] 90s canned demo script + 3 guaranteed-wow requests

**Done =** any client tenant demos in <2 min setup.

---

## Tool schemas (Phase 2 starting point)

```ts
// bridge/tools.ts
const TOOLS = [{
  function_declarations: [
    { name: "draft_email", description: "Draft an email reply",
      parameters: { to: "string", topic: "string", tone: "string" } },
    { name: "pull_my_tasks", description: "List my open tasks/issues",
      parameters: {} },
    { name: "summarize_text", description: "Summarize pasted or fetched text",
      parameters: { text: "string" } },
  ]
}];
```

## Historical gesture map (superseded in v1.0.0)

```
Open_Palm + index point  → hover/select card (cursor = index tip landmark 8)
Pointing_Up (dwell)      → open selected card detail
swipe (landmark vel)     → scroll list
Closed_Fist (hold)       → dismiss/close
Thumb_Up                 → confirm/accept result
```

---

## Commands (target)

```bash
# dev — frontend hot reload + bridge
pnpm --filter frontend dev     # vite on :5173
pnpm --filter bridge dev       # nodemon bridge on :8787

# demo — one shot
pnpm build && pnpm --filter bridge start   # serves built frontend + WS
open http://localhost:8787
```

---

## What starts the second you say go

**Phase 0 needs nothing from you** — no key, no fleet. I scaffold `apps/jarvis/`, wire MediaPipe to the webcam, and you get a working hands-free HUD this session. Phase 1 lights up the moment the Gemini key lands.

Say **go** and I start Phase 0.
