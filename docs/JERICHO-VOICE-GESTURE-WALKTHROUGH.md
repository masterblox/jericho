# Jericho — Voice + Gesture Walkthrough (v1.0.4, local)

**What this is (plain English):** a hands-on test script for your final product —
the **intelligence sphere**. You open ONE URL (`http://localhost:5173/`), click one
button to turn on the camera + mic, and test every voice command and hand gesture
directly on the sphere. There's an optional second page (`?lab=gestures`) that grades
each gesture `LIVE → PASS` if you want objective per-gesture confirmation, but the
sphere at `/` is the product you're testing.

**Status right now:** the app is already running on this machine.

```
STACK          STATE          URL / PORT
frontend       up             http://localhost:5173
bridge (Core)  up             127.0.0.1:55160   (auth ok: 200 w/ token, 401 without)
vault gateway  up             127.0.0.1:8790    (hermes Obsidian vault, 9,923 docs indexed)
store          isolated       .context/jericho-home/.jericho/jericho.db  (fresh, seeded)
voice key      set + verified GEMINI_API_KEY in apps/jericho/.env (Google AI Studio, prepaid)
fleet board    live           Paperclip via bridge /api/v1/fleet (9 agents · 50 issues)
seeded data    1 mission · 1 approval · Nucleus 13 nodes/7 edges
```

**The sphere's projections (keys 1–4, or pinch the tabs):**

| Key | Tab | What it shows (all live, nothing faked) |
|---|---|---|
| 1 | CORE | The resting reactor sphere |
| 2 | AGENTS | The Hermes fleet from the Paperclip board — name, role, status, heartbeat age |
| 3 | TASKS | Kanban (QUEUED / ACTIVE / REVIEW / DONE): Paperclip MAS-tickets + Jericho Core missions; the Core mission card carries the approval binding for thumb gestures |
| 4 | BRAIN | Obsidian vault search (BM25 RAG over the hermes vault) + Nucleus entity/relation counts |

If Paperclip or the vault gateway is down, AGENTS/TASKS/BRAIN show explicit
OFFLINE states — never a stale or fake roster.

---

## 0. Open the surface

| URL | What it is |
|---|---|
| **http://localhost:5173/** | **THE PRODUCT — the intelligence sphere.** Reactor sphere + live Core: missions, Nucleus (memory), approvals, voice, gestures. **Start here.** |
| http://localhost:5173/?lab=gestures | Optional self-grading gesture check — a bare harness that flips each gesture `LIVE → PASS`. Use only if you want per-gesture proof. |

(The old `?view=command` flat operator view and the root `interface/` prototype
were deleted in the HADAL cleanse — the sphere is the only product surface.)

Use **Chrome**. `localhost` is a secure origin, so camera + mic are allowed. Verified
live this pass: the sphere loads, shows **CONNECTED · CORE STABLE**, and has **0 console
errors**.

## 1. Engage the runtime (once)

On the sphere, click **Wake Jericho** and allow **camera** + **microphone**
(or **Continue with keyboard** to test without hardware).
- Camera frames and hand landmarks never leave the browser; the mic feeds only the
  local clap detector until you wake it.
- **Escape** pauses/resumes tracking and restores the normal cursor at any time.
- Denying camera/mic is a valid test too: everything stays usable by keyboard + pointer.

---

## 2. Voice commands

Voice = **wake, then talk**. There is no fixed phrase grammar — you wake it, it greets
you, then whatever you say in the open turn becomes a captured signal in Core.

Do this **on the sphere** (`/`), after Wake Jericho:

| # | Do this | Expect |
|---|---|---|
| V1 | Press **V** (or **clap once**) | The reactor sphere jumps to its `listening` state (shell pulses); Gemini/Algieba speaks exactly *"Hello, sir. What are we doing today?"* |
| V2 | After the greeting, **say a sentence** ("Note that the walkthrough is running") | Mic opens for one turn; the sphere shows `thinking` then `speaking`; your words transcribe into an encrypted local capture and the turn closes — once routed, it shows up as a Jericho card in TASKS |

**V** is the keyboard wake — same path as the clap, no mic gymnastics needed. It is
ignored while you're typing in a field. The Gemini path was verified end-to-end this
pass: an authenticated wake over the bridge WebSocket returned `ready` (Algieba) and
`greeting_started` with your key.

Persona swap (jericho ↔ megatron) changes the voice (Algieba → Fenrir) and sphere hue
(cyan → amber) — presentation only, no new authority.

**No spoken greeting?** Check the bridge terminal — connect failures now log as
`[jericho] voice connect failed: <reason>`. The key lives in `apps/jericho/.env` as
`GEMINI_API_KEY=` (a prepaid Google AI Studio key; the machine's canonical copy is in
the main repo checkout `conductor/repos/jericho/apps/jericho/.env`). After changing
`.env`, **restart the bridge** — tsx watches source files, not `.env`.

The mic stays muted and the server rejects audio until the greeting finishes; that's
the privacy gate, not a bug.

---

## 3. Gestures — on the sphere

All gestures work directly on the sphere at `/`. They need **fresh, tracked hands**
and are context-gated. Do each move in front of the camera:

| # | Gesture | How | Expect on the sphere |
|---|---|---|---|
| G1 | **Right palm aim** | Open right palm, move it | Cyan cursor follows your hand |
| G2 | **Pinch tap** | Right thumb+index pinch once over a mission card / control | That element activates (focuses / selects) |
| G3 | **Pinch drag** | Pinch a draggable card, move, release | Card follows with an orange grab outline |
| G4 | **Pinch hold** | Pinch a target and hold ~620 ms without moving | Its contextual **action ring** opens |
| G5 | **Left palm scroll** | Open **left** palm, move vertically over the communications list | The list scrolls |
| G6 | **Nucleus clutch** | Right pinch on **empty** Nucleus (memory graph) space, move | Graph camera pans |
| G7 | **Semantic depth** | **Two** open palms inside Nucleus (~700 ms), change the gap | Graph depth steps in/out (expand/collapse the 13-node graph) |
| G8 | **Approval decision** | Right **thumb up / down** (~700 ms) at the active approval | Approves / rejects the exact mission + plan-hash + version (1 approval is seeded) |
| G9 | **Cancel** | **Two** open palms held ~700 ms **outside** Nucleus | Cancels the selected pending mission |
| G10 | **Closed fist inert** | Make a fist | **Nothing** dispatches (by design) |
| G11 | **Clap wake** | Clap (same as V1) | Sphere wakes + greeting |

Pointing, victory, and dwell have **no** command meaning by design — only the moves above.

### Want objective per-gesture proof?
Open **`http://localhost:5173/?lab=gestures`** — same recognition runtime, but a bare
harness with a checklist that flips each step `LIVE → PASS` as you perform it, plus a
live telemetry panel (FPS, hands, pinch phase). This is the *self-grading* surface; the
sphere is the product. The lab is also where calibration lives.

### Calibration + diagnostics (in the lab)
- **CAL LEFT / CAL RIGHT** — per-hand: hold an open palm at center, then the four
  corners. Improves cursor accuracy. Profiles reject if center residual > 5%.
- **SWAP** — fixes reversed handedness (if left/right feel mirrored).
- **RESET** — clears this camera's calibration profiles.
- **DIAGNOSTIC** — shows sanitized telemetry (track IDs, handedness, pinch phase, FPS).
- **EXPORT 30S** — downloads a sanitized 30-second window (no frames, no landmarks).

---

## 4. What the live data shows on the sphere

The sphere reads live truth only (nothing faked). Right now you should see:

- **CORE (1):** the reactor sphere, `CONNECTED · CORE STABLE`, live clock. The particle
  halo orbits one cluster per live Hermes agent (error/stale agents tint red).
- **AGENTS (2):** the real Hermes fleet from Paperclip — Angela, Analyst, Researcher,
  Intelligence, Insights, Iris, Donald, DEV, Jericho — with role, status, and true
  heartbeat age.
- **TASKS (3):** the kanban — ~50 live MAS tickets across QUEUED/ACTIVE/REVIEW/DONE plus
  the seeded Jericho mission in REVIEW. That mission card carries the exact approval
  binding: hold **thumb up / down** on it to approve/reject the exact
  mission + plan-hash + version.
- **BRAIN (4):** type a query (e.g. "fleet architecture") → BM25 results from the hermes
  Obsidian vault (9,923 docs). Nucleus truth shows 13 entities / 7 relations.

### Want more to look at?
Seed another capture (safe, local, no external effect):
```bash
cd apps/jericho
tok=$(grep '^JERICHO_API_TOKEN=' .env | cut -d= -f2)
curl -s -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' \
  -d '{"kind":"manual","sourceEventId":"note-'$(date +%s)'","occurredAt":"'$(date -u +%FT%TZ)'","payload":{"text":"Another synthetic signal for the demo"}}' \
  http://127.0.0.1:55160/api/v1/captures
```

---

## 5. Start / stop / restart

Three processes run in the background from `apps/jericho`.

```bash
# stop
lsof -ti tcp:5173 -sTCP:LISTEN | xargs kill        # frontend
lsof -ti tcp:55160 -sTCP:LISTEN | xargs kill       # bridge
lsof -ti tcp:8790 -sTCP:LISTEN | xargs kill        # vault gateway (BRAIN search)

# start again
cd apps/jericho
ISO="$PWD/../../.context"
pnpm --filter frontend dev &
# bridge: isolated store (paperclip creds come from .env as JERICHO_PAPERCLIP_*)
env HOME="$ISO/jericho-home" pnpm --filter bridge dev &
# vault gateway: hermes Obsidian vault + uv-python wrapper in .context/bin
env PATH="$ISO/bin:$PATH" \
    JERICHO_VAULT_GATEWAY_TOKEN="$(cat "$ISO/vault-rag/gateway-token")" \
    JERICHO_VAULT_GATEWAY_PORT=8790 \
    JERICHO_VAULT_PATH=/Users/carlosprada/conductor/repos/hermes \
    JERICHO_VAULT_RAG_SCRIPT="$PWD/../../ops/vault/vault-rag.py" \
    JERICHO_VAULT_RAG_CACHE="$ISO/vault-rag/rag-cache.json" \
    JERICHO_VAULT_RAG_INDEX="$ISO/vault-rag/bm25_index.json" \
  pnpm --filter bridge vault-gateway &
```

The isolated `HOME` keeps the demo store separate from your real `~/.jericho`. Keys and
tokens live in `apps/jericho/.env` (gitignored), so restarts reopen the same seeded store.
BRAIN works without the gateway too — it just shows the honest OFFLINE state.

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Bridge crash: *"master key … 32 bytes"* | Corrupt `jericho-core` Keychain item on this machine | Already handled: `JERICHO_MASTER_KEY` is set in `.env`, bypassing Keychain |
| No spoken greeting | Gemini connect failed — check bridge terminal for `[jericho] voice connect failed` | Fix `GEMINI_API_KEY=` in `apps/jericho/.env` (canonical copy: `conductor/repos/jericho/apps/jericho/.env`), then **restart the bridge** |
| Left/right hands mirrored | Handedness reversed for this camera | **SWAP** in the lab |
| Cursor drifts / offset | Uncalibrated camera | **CAL LEFT** / **CAL RIGHT** |
| Camera never appears | Permission denied, or another app holds the camera | Re-allow in Chrome site settings; close other camera apps |
| API returns 401 | Missing/mismatched token | Vite proxy attaches `JERICHO_API_TOKEN` from `.env`; keep bridge + frontend on the same value |
| `python3 …` errors in tests | Machine policy forces `uv run python3` | Unrelated to voice/gestures; the one red vault-RAG CLI test is this, not a product bug. The running vault gateway avoids it via the `.context/bin/python3` wrapper |
| AGENTS / TASKS say OFFLINE | Paperclip board unreachable or bad key | Check `JERICHO_PAPERCLIP_URL/API_KEY/COMPANY_ID` in `apps/jericho/.env` and `[jericho] fleet snapshot failed` in the bridge terminal (the stale shell export `PAPERCLIP_API_KEY` is unused now) |
| BRAIN says VAULT SEARCH OFFLINE | Vault gateway not running | Start it per section 5; search works once `127.0.0.1:8790` is up |

---

## Appendix — how this was verified before handing off

- `pnpm test` → 349/350 (the single failure is the `uv run python3` machine policy on
  the vault-RAG CLI test, not voice/gesture logic).
- `pnpm --filter frontend test` → 134/134 (gesture state machines, clap/wake authZ,
  runtime, projections, command-center rendering).
- `pnpm typecheck` → clean (shared + frontend + bridge).
- Live: frontend 200, `/api/v1/health` 200 via proxy / 401 without token, bridge on
  55160, command-center snapshot populated with the seeded mission + approval + Nucleus.
