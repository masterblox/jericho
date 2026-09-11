# Frontend pass handoff: gesture and voice wiring

**Owner:** Jericho frontend

**Freshness:** 2026-07-12. Review after every sphere visual pass.

The visual pass may freely change layout, typography, animation, and component
composition. Keep the contracts below intact so the finished UI can be wired to
the already-tested production gesture and voice runtime without reimplementing
recognition. Chat at `/` is the primary product surface; the Sphere is a
secondary operator view toggled from chat. `?lab=gestures` remains the hardware
lab. The UI projects persisted Core truth only — no fixture roster, tasks,
signals, or gauges. Conversation turns are in-memory only.

## Test before and after the visual pass

- Product (chat): `http://localhost:5173/`
- Secondary sphere view: toggle **Sphere** from the chat masthead
- Hardware lab: `http://localhost:5173/?lab=gestures`
- Click **Wake Jericho** before testing camera, clap, or hand input.
- Press **V** (or clap) for manual voice wake, or use the composer mic.

The lab is intentionally independent of the sphere design. Do not copy
gesture thresholds or recognition logic into React components. It must continue
to construct `JerichoRuntime` and use `GestureTargetRegistry`.

## DOM contracts the frontend must preserve

| Interaction | Required UI contract |
|---|---|
| Aim, tap, hold | `data-gesture-target="<stable-id>"` on the interactive element |
| Drag | Target contract plus `data-gesture-draggable="true"` |
| Communications scroll | Scroll container retains `.jericho-bay--left` |
| Nucleus clutch/depth | Empty graph surface retains `data-jericho-nucleus-space="true"` |
| Approval gesture | Visible active approval exposes `data-jericho-active-approval="true"`, mission ID, exact plan hash, and version datasets |
| Context ring | Put enabled `<button>` actions inside the selected gesture target; the registry derives the valid action ring from them |

Stable IDs must represent semantic entities, not array positions or visual
coordinates. A redesign must not create hidden gesture targets over visible
controls.

## Events to wire after the visual pass

Continue consuming the typed constants from `src/gesture-events.ts`:

- `JERICHO_APPROVAL_GESTURE_EVENT`
- `JERICHO_CANCEL_PENDING_EVENT`
- `JERICHO_NUCLEUS_CAMERA_EVENT`
- `JERICHO_NUCLEUS_DEPTH_EVENT`

Approval and cancellation handlers must retain their existing exact mission,
plan-hash, and version checks. Nucleus handlers may update presentation state,
but must not create fictional Core events.

## Voice contract

Clap and manual wake both enter `BridgeClient.wake()`. The browser must not use
`speechSynthesis`. Gemini Live speaks exactly “Hello, sir. What are we doing
today?” through the configured `Algieba` session while client and server reject
microphone audio. Only `greeting_complete` opens the active listening turn.

## Final wiring checklist

1. Apply the DOM contracts to the final components.
2. Confirm every visual control still works with keyboard and pointer.
3. Run all guided checks in `?lab=gestures` with the physical camera and mic.
4. Smoke-test the same gestures on the final command center.
5. Run `pnpm test && pnpm typecheck && pnpm build` from `apps/jericho`.

Raw camera frames, audio, landmarks, transcripts, secrets, and private payloads
must never be added to snapshots, UI logs, analytics, or retained diagnostics.
