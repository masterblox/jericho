# Jericho Interface v1.0.4

Jericho's browser control room combines Gemini Live voice with webcam-driven,
hands-free interaction. Jericho owns this interface; the bridge currently keeps
the existing local mock tools. Real Paperclip/Hermes fleet execution is the next
adapter and is intentionally outside the v1.0.4 gesture pass.

## Gesture contract

- Physical left hand: open palm arms anchored command-rail scrolling; pinch
  selects the pink-highlighted command.
- Physical right hand: open palm aims. A fresh pinch acquires a card when the
  orange cursor center is inside or within 18 px of its boundary (nearest card
  wins). The card—not the cursor—shifts by the minimum amount so the circle sits
  at least 14 px inside. Attachment is immediate at that bounded grab point.
- A pinch started outside a card cannot acquire one by entering while still held.
- On grab, the previous selection outline clears and the grabbed card gets an
  orange grab-preview outline. Quick release restores position then selects the
  grabbed card; a 120 ms hold or 6 px move commits the drop and selects it;
  tracking cancellation restores both position and the previous selection.
- Both hands run simultaneously through independent controllers. Temporary loss
  under 350 ms freezes only the missing hand and does not cancel the other.
- Coordinates always come from the palm centroid, so pinching does not switch
  anatomical anchors. Fist, pointing, victory, and dwell cause no actions.

Use **CAL LEFT** and **CAL RIGHT** for separate center + four-corner setup.
Calibration is saved per camera and stabilized physical role. **SWAP** corrects
cameras that report handedness backwards. **RESET** removes both profiles.
**DIAGNOSTIC** reveals all 21 landmarks, coordinates, thresholds, FPS, and the
calibration residual. **EXPORT 30S** downloads the local diagnostic replay.

## Run

Jericho requires Node.js 22.13 or newer. The bridge uses Node's built-in SQLite
module and will not start on older runtimes.

```bash
cd apps/jarvis
corepack pnpm install
cp .env.example .env # add GEMINI_API_KEY
corepack pnpm dev
```

Open <http://localhost:5173>, click the start overlay, and allow camera/mic.
Press Escape at any time to pause gesture tracking and restore the mouse cursor.

## Local truth store

The bridge truth store defaults to `~/.jericho/jericho.db`. Sensitive record
bodies and provenance are encrypted with a master key from
`JERICHO_MASTER_KEY` or the current user's macOS Keychain. A database is bound
to the key that initialized it and fails closed when opened with another key.
Entity and relation reconciliation compares normalized UTC instants; stale or
equal-time observations can add provenance and new fields, but existing values
win attribute collisions deterministically.

Automatic master-key rotation is intentionally deferred. Rotating a production
key will require an explicit authenticated re-encryption migration; replacing
the key in place will make the existing database unavailable rather than risk
mixed-key writes.

## Verify

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
```

The deterministic suite covers palm-to-pinch coordinate invariance, two-hand
identity/role stabilization, independent scrolling and dragging, dropout,
calibration, edge-footprint acquisition, bounded grab inset, grab-preview
selection, and click/drag/release behavior. Final camera accuracy still requires
live dogfooding because CI has no webcam.

## Runtime status

| Capability | Status |
|---|---|
| Dual-hand palm + pinch interface | v1.0.4 |
| Sticky card acquisition + fresh-pinch grab preview | v1.0.4 |
| Immediate pinch attachment | v1.0.2 |
| Per-hand five-point calibration | v1.0.1 |
| Gemini Live voice loop | Preserved |
| Tool calls | Local mock |
| Real Hermes fleet dispatch | Follow-up adapter |

Only `GEMINI_API_KEY` is required for voice. Paperclip variables remain reserved
for the future real-fleet adapter.
