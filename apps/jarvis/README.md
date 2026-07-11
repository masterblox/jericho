# Jericho Private Intelligence OS

**Owner:** Carlos

**Freshness:** 2026-07-11

Jericho is a private, local-first chief of staff and command center. The local
Core owns evidence, identity, authority, decisions, mission state, and receipts:

`Capture → Understand → Route → Plan → Approve → Execute → Retain → Present`

One approval authorizes only the exact immutable mission version shown to
Carlos. Agents may complete internal assignments inside that plan, but cost,
time, retry, tool, repository, recipient, credential, data, destructive, or
production expansion returns to a visible checkpoint.

## Requirements and first boot

Jericho requires Node.js 22.13 or newer because Core uses Node's built-in
SQLite module.

```bash
cd apps/jarvis
corepack pnpm install --frozen-lockfile
cp .env.example .env
corepack pnpm start
```

On macOS, production first boot creates and reuses the Core encryption key and
API token in Keychain when their environment overrides are blank. Do not commit
`.env`, gateway credentials, repository grants, or the bootstrap URL.

Production binds to loopback and prints two lines: the listening address and a
one-time browser bootstrap URL. Open that complete bootstrap URL, not just `/`.
It sets a per-process `HttpOnly; SameSite=Strict` session cookie and redirects to
the command center. The URL works once; restarting Jericho creates a new one.
An authenticated API client may instead `POST /api/v1/session` with the Core
bearer token. An unauthenticated page or API request never mints a session.
Jericho refuses a non-loopback bind and rejects invalid Host and Origin values.

For `pnpm dev`, set `JERICHO_API_TOKEN` explicitly so the Vite HTTP and WebSocket
proxies can attach it. Production `pnpm start` is the canonical private runtime.

## Local truth and keys

The Core store defaults to `~/.jericho/jericho.db`. Sensitive bodies and
provenance use authenticated encryption. External identity IDs and receipt
destination/external-ID lookup columns use keyed HMAC tokens; plaintext values
remain inside their encrypted records. Existing compatible stores are backfilled
and physically scrubbed only after the configured key verifies. A database is
bound to its initialization key and fails closed on a wrong key or tampered
record.

Automatic master-key rotation is intentionally deferred. Replacing a production
key in place makes the existing store unavailable; rotation requires a separate
authenticated re-encryption migration.

## Command center

The default surface is the interface-v2 intelligence sphere backed by the same
authenticated Core snapshot and live change stream. `/?view=command` retains
the detailed three-bay operator view, and `/?lab=gestures` retains the isolated
hardware test surface. The sphere never imports the design fixture missions or
signals; its projections are derived from persisted Core missions and history.

The desktop/TV layout has three evidence-backed bays:

- Left: Today, ranked communications, people, tasks, and commitments.
- Center: selected mission context, the eight-stage pipeline, Nucleus, verified
  retention control, and mission timeline replay.
- Right: Review, checkpoint and relationship proposals, exact-plan approvals,
  active assignments, outcomes, and destination receipts.

On narrow screens, Today, Communications, Nucleus, and Approvals become explicit
tabs. Nucleus combines semantic entities and relationships with activity and
mission lifecycle projections. Nodes and pulses come from persisted Core truth;
missing stages remain missing rather than being animated as fictional work.
Dragging typed relation ports creates a pending proposal. It does not silently
rewrite the truth graph.

## Voice and gesture boundary

Click **Engage local runtime** before granting camera and microphone access.
Denial or hardware failure leaves the entire command center usable by keyboard
and pointer. Escape pauses or resumes tracking and restores the normal cursor.

Standby microphone samples stay in the browser and are used only by the local
clap detector. A clap or manual wake asks the existing Gemini Live session to
speak exactly “Hello, sir. What are we doing today?” through the configured
Algieba Jericho voice. The microphone remains muted and server-side input is
rejected until `greeting_complete`; that event opens one active turn without
closing it. There is no browser speech-synthesis fallback. Without Gemini, Core
and the command center still work and wake returns safely to standby.

The focused production-runtime test surface is available at
`/?lab=gestures`. Frontend redesign work must preserve the wiring contracts in
[`frontend/FRONTEND_HANDOFF.md`](frontend/FRONTEND_HANDOFF.md).

Gemini input transcription for a completed active turn becomes an encrypted
local spoken-capture event and enters normal intake. Audio frames are never
written to Core. Transcript contents are not logged or echoed on capture
failure. Camera frames and raw landmarks stay inside the disposable browser
runtime; the optional 30-second diagnostic export contains only sanitized
states, ratios, timing, and target-presence flags.

MediaPipe is production-local: the gesture model and SIMD/non-SIMD WASM bundles
are served from `frontend/public/mediapipe/` on the Jericho origin. Runtime
gesture recognition does not depend on a model CDN.

## Gesture grammar

All semantic gestures are context-gated and require fresh tracked hands:

- Open right palm aims. Open left palm scrolls the left communications bay.
- A fresh right pinch on a target focuses it. A pinch that begins off-target
  cannot acquire a target by entering while still held.
- A stationary target pinch held for 620 ms opens its contextual action ring.
  Movement of at least 7 px before that threshold starts a drag; release
  completes or cancels the corresponding tap, hold, or drag path.
- A right pinch that starts on empty Nucleus space clutches the graph camera.
  Releasing ends the clutch; tracking loss cancels it.
- Two open palms held inside Nucleus for 700 ms control semantic graph depth as
  their span changes. This Nucleus gesture does not cancel work.
- A thumb up or thumb down held for 700 ms approves or rejects only the active
  approval whose mission ID, plan hash, and version match the UI.
- Both open palms held for 700 ms outside the Nucleus depth context cancel the
  selected pending mission through its exact plan binding.
- `Closed_Fist` is explicitly suppressed. Pointing, victory, fist, and dwell
  have no command semantics.

Left and right hands have independent tracking/controllers. Loss under 350 ms
freezes only the missing hand. Use **CAL LEFT** and **CAL RIGHT** for independent
center plus four-corner calibration; **SWAP** corrects reversed handedness and
**RESET** removes the active camera's profiles. **DIAGNOSTIC** shows local
sanitized telemetry; **EXPORT 30S** downloads that sanitized rolling window.
The low-level sticky-target invariants remain canonical in
[`../../docs/JERICHO-V1-GESTURES.md`](../../docs/JERICHO-V1-GESTURES.md).

## Connectors and execution

Operational rollout is Telegram first. Linear, Git/GitHub, Hermes/Conductor,
and Obsidian follow as evidence surfaces; WhatsApp should be enabled only after
the Telegram gateway is dependable. Remote adapters with blank credentials
remain unavailable; local path adapters are registered only when configured.
Telegram and WhatsApp client sessions and credentials stay behind their
authenticated Hermes gateways; Jericho receives normalized events and approved
delivery results.

Connector capture uses durable leases, cursors, pagination, bounded pages,
retry/backoff, and source-event idempotency. Startup intake recovery takes a
durable high-water mark and pages the captured-event change log, so current
events are not lost behind a fixed 10,000-record scan. Only pre-change-log
legacy/direct-import records use a bounded compatibility scan.

Telegram and WhatsApp sending exists only for a mission task that already
contains an approved `externalAction`. Before transport, the adapter rechecks
the assignment, exact plan hash, task, recipient, message, tool, credential
reference, mutation class, scope, and reserved idempotency receipt. A successful
gateway acknowledgement becomes an immutable delivery event without raw message
text; an independent verifier binds that event back to the destination before
the runner completes the receipt. A send that started but lacks a certain result
is not retried automatically. General spoken or Telegram intake does not infer
permission to send.

Hermes agent execution is separately fail-closed. A configured bus receives no
assignment unless its operator publishes the fresh v1 capability handshake and
implements bounded stop, idempotent dispatch, metered cost evidence, structured
artifacts, and independent verification. The Hermes operator installed on
2026-07-11 is legacy and cannot complete a Jericho DEV/Research assignment. See
[`../../docs/HERMES-EXECUTION-PROTOCOL-V1.md`](../../docs/HERMES-EXECUTION-PROTOCOL-V1.md).

Repository authority also requires two bindings: configure an allowlisted
`JERICHO_MISSION_REPOSITORY_GRANTS` entry, then select its repository in an
immutable direct capture at `payload.jerichoScope.repository`. Configuration
alone grants nothing. An absent selector grants no repository; an unknown or
invalid selector enters Review.

## Retention and reflection

Obsidian is selected human-readable memory, not the job queue. **Retain verified
mission** is available only after every task succeeded with verification
evidence and every external action has a verified destination-bound gateway
receipt. The writer stores a narrow summary and then appends a retention event for replay;
absolute vault paths do not leave Core.

Vault search uses the narrow authenticated gateway documented in
[`../../docs/VAULT-RAG-GATEWAY.md`](../../docs/VAULT-RAG-GATEWAY.md). The bridge
never falls back to scanning note bodies for search. Gateway health derives
freshness from the vault Git commit, marks syncs older than one hour degraded,
and drives one post-sync index rebuild during the 01:00–05:00 UTC window.

The deterministic reflection pass runs on the configured cadence (six hours by
default) and may also be requested through the authenticated API. Conflicts,
incompatible assumptions, and abandoned commitments become pending proposals.
Reflection cannot approve, merge, or resolve them.

## Verification and known live boundary

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
```

These commands are the deterministic gate for Core, orchestration, connectors,
privacy, projections, and gesture state machines. Physical clap timing, webcam
tracking accuracy, GPU/WASM behavior, microphone routing, a deployed Hermes v1
operator, and real gateway delivery need explicit live checks. Use the
[`../../docs/JERICHO-LIVE-SMOKE-TEST.md`](../../docs/JERICHO-LIVE-SMOKE-TEST.md)
runbook; its default path disables external systems and never sends, deploys,
or mutates production.
