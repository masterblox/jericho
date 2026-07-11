# Jericho Interface v1.0.4

Jericho's browser control room combines a private local truth store, bounded
mission orchestration, optional Gemini Live voice, and webcam-driven hands-free
interaction. The local Core owns personal context and authority; direct APIs and
Git are truth sources, while approved external work is fenced by mission scope
and receipts.

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
cp .env.example .env # add JERICHO_API_TOKEN; Gemini is optional
corepack pnpm dev
```

Set `JERICHO_API_TOKEN` before starting. `GEMINI_API_KEY` is optional: without
it, capture, truth, tools, connector health, HTTP API, and SSE continue to run
and `/api/v1/health` reports voice as unavailable. The server binds to loopback
by default and rejects invalid Host/Origin and unauthenticated API requests.

Configured connectors are composed by the production runtime, not test
fixtures. Telegram is consumed only through the authenticated Hermes gateway;
Linear uses its read-only GraphQL API; Git/GitHub/Conductor/Obsidian read their
configured truth surfaces. Named repository/root settings use JSON arrays such
as `[{"id":"jericho","path":"/path/to/jericho"}]`.

Hermes execution is fail-closed. `JERICHO_HERMES_BUS_ROOT`,
`JERICHO_HERMES_REPO`, and `JERICHO_HERMES_BRANCH` select a workspace, but no
assignment is emitted unless the operator publishes a fresh v1 capability
handshake. The installed historical operator is intentionally reported as
unavailable. See [the Hermes v1 contract](../../docs/HERMES-EXECUTION-PROTOCOL-V1.md).

Repository authority is separate and explicit. Configure
`JERICHO_MISSION_REPOSITORY_GRANTS` as a JSON array of repository grants, then
select one in a direct capture with `jerichoScope.repository`. Configuration
without a capture selector grants nothing; an unknown selector enters Review.

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
| Gemini Live voice loop | Optional/preserved |
| Encrypted local truth + identity reconciliation | Implemented |
| Telegram/Linear/Git/GitHub/Conductor/Obsidian capture adapters | Implemented |
| Durable cursor/lease/retry-safe connector supervision | Implemented |
| Tool calls | Truth-backed; drafts remain approval-only |
| Bounded mission orchestration + verified receipts | Implemented |
| Hermes worker executor | Jericho v1 adapter implemented; installed legacy operator fails closed pending Hermes-side upgrade |

`JERICHO_API_TOKEN` is required for the local service. `GEMINI_API_KEY` is only
required for voice. Paperclip is a reconciled worker queue, not a truth source.
The current Hermes operator cannot produce a successful Jericho assignment
until it implements the documented v1 artifact, verification, stop, and
handshake contract.
