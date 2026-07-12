# Jericho Private Intelligence OS

**Owner:** Carlos

**Architecture owner:** Jericho Core

**Freshness:** 2026-07-11

Jericho is Carlos's private, local-first chief of staff. It turns evidence into bounded missions and orchestrates registered agents after one explicit approval:

`Capture → Understand → Route → Plan → Approve → Execute → Retain → Present`

It is an authority and evidence system, not a decorative agent dashboard. The Nucleus may visualize only persisted, truth-backed activity.

## Trust topology

```text
Direct APIs / Git / Hermes collectors / local captures
                         │ immutable evidence
                         ▼
              ┌─────────────────────┐
              │ Jericho Core        │
              │ encrypted SQLite    │
              │ identity + policy   │
              │ mission authority   │
              └──────┬────────┬─────┘
                     │        │
       bounded work  │        │ verified projections
                     ▼        ▼
          Registered agents   Command Center / Nucleus
          + remote executors  + selected Obsidian notes
```

The laptop owns personal context and authority. Remote Hermes services may collect source events and execute approved assignments, but cannot approve work, expand mission scope, or rewrite local memory. Paperclip is a reconciled worker queue, never evidence truth.

## Runtime topology

`apps/jarvis` is the canonical implementation:

- `bridge/` is one loopback TypeScript service. It serves the built React UI, authenticated HTTP/SSE, the optional voice WebSocket, connector polling, and mission execution from one origin.
- `shared/` contains versioned contracts used by Core and the command center.
- `frontend/` is the cinematic command center and disposable local voice/gesture runtime.
- `frontend/public/mediapipe/` contains the same-origin gesture model and all
  SIMD/non-SIMD WASM variants; production gesture recognition has no model-CDN
  dependency.
- macOS Keychain holds the generated Core master key and local API token unless explicit environment overrides are supplied.
- SQLite record bodies and provenance are authenticated and encrypted. Immutable source-event identity and exact plan hashes prevent silent mutation.

Conductor supplies a workspace-specific port, but runtime mode is nonconcurrent because all workspaces would otherwise compete for Carlos's single private Core and connector leases.

## Authority hierarchy

1. Direct source APIs and Git are evidence truth for their own systems.
2. Immutable `EventEnvelope` records preserve captured source identity, time, evidence, provenance, and integrity.
3. Canonical entities and typed relationships reconcile observations without deleting contradictions.
4. A versioned, hash-bound `MissionPlan` is execution authority only after Carlos approves that exact version.
5. `ActionReceipt` and independently verified artifacts prove outcomes; queue state or successful tool return alone does not.
6. Obsidian is selected, human-readable durable memory. It is not an authority ledger or job queue.
7. Paperclip, filesystem buses, prototypes, and old reports are reconciled surfaces only.

## Lifecycle

### Capture

Core accepts spoken/local captures, Telegram via the authenticated Hermes gateway, Linear, Git, GitHub, Conductor, Obsidian, URLs/files/transcripts supplied by Carlos, and semantic selections from the command center. Connector cursors, leases, pagination, retries, and health are durable. Source event IDs make ingestion idempotent.

Operational rollout is Telegram first, followed by Linear, Git/GitHub,
Hermes/Conductor, and Obsidian. The WhatsApp adapter and approved-send boundary
exist, but WhatsApp should be enabled only after Telegram is dependable.
Unavailable configuration remains visible as connector health rather than
invented activity.

Startup recovery takes a durable change-log high-water mark and pages every
current `EventCaptured` change up to it. This avoids a fixed 10,000-event intake
ceiling and cannot chase a continuously moving tail forever. A bounded scan is
retained only for legacy/direct-import events written before captured-event
change records existed.

### Understand

The classifier is read-only. It extracts entities, intent, expected outcome, commitments, claims, assumptions, deadlines, affected parties, risk, evidence requirements, capability needs, confidence, and ambiguity. It cannot authorize an external action.

### Route

Every intent has exactly one primary route: `Reply`, `Action`, `Project`, `Knowledge`, `Signal`, or `Review`. Deterministic ownership and safety rules override model suggestions. Low confidence, contradictory evidence, and high-risk ambiguity enter Review.

### Plan

Project work becomes a dependency-aware `MissionPlan` with deliverables, acceptance tests, evidence snapshot, registered capabilities, cost/runtime/concurrency/retry ceilings, tool and writable scopes, recipients and systems, mutation boundaries, rollback, and escalation conditions.

Default lanes are DEV for code and delivery preparation, Angela for personal operations, Donald for sales and relationships, Iris for visual work, and Researcher/Analyst for evidence and synthesis.

### Approve once

Carlos approves an exact plan version and hash. That approval permits internal orchestration only inside the displayed boundary. The approved version is immutable.

A checkpoint is mandatory before any budget/runtime/concurrency/retry overrun, new recipient or system, broader repository/credential/data access, changed objective or acceptance test, unapproved destructive/production mutation, or recommendation-changing contradiction.

### Execute

Assignments use durable leases, idempotency keys, bounded retries, cancellation, dependency checks, and minimum evidence/tool/writable scope. Only versioned `AgentCapability` entries may run. Workers cannot recursively create unrestricted workers or widen their own authority. Completion requires a structured artifact and independent verification.

Hermes execution additionally requires a fresh, expiring v1 operator capability
handshake. A configured bus without that handshake is visible as unavailable
and receives no assignment. Historical Hermes results are retained only as
unverified review checkpoints. Repository grants require both an explicit
configured allowlist entry and an immutable direct-capture selector; neither
workspace configuration nor natural-language inference silently grants a repo.
The exact operator contract is `docs/HERMES-EXECUTION-PROTOCOL-V1.md`.

External effects require destination-scoped idempotency and a verified receipt.
The implemented Telegram and WhatsApp send adapters accept only a mission task
with an explicit, approved `externalAction`. They revalidate the exact plan,
assignment, task, recipient, message, tool, credential reference, data and
mutation scopes, and reserved receipt before transport. A successful gateway
acknowledgement becomes an immutable delivery event containing message and
idempotency hashes rather than raw message text. The independent verifier binds
that event and external ID back to the destination before the runner completes
the receipt. A started but uncertain send is not automatically resent. Ordinary
capture or classifier output cannot infer send authority.

### Retain

Verified outcomes, evidence, decisions, artifacts, edits, costs, and receipts return to the truth graph. Claims keep their assumptions and contradictory observations remain separate. Preference and memory changes are source-backed proposals, never silent merges.

The current Obsidian write is operator-triggered from a succeeded mission. It
fails unless every task has verification evidence and every external action has
a verified destination receipt. It writes a narrow human-readable summary, then
appends a retention event for replay. The scheduled deterministic reflection
pass produces pending review proposals only; it cannot resolve contradictions,
merge memory, or approve a preference.

Verified missions also produce immutable content-addressed knowledge packages.
Obsidian renders the private package; Notion may receive only an explicitly
approved redacted projection. Retrieval indexes may rebuild and promote a
benchmark-improving candidate automatically, but routing, source knowledge,
consolidation, redaction, and benchmark policy remain review-gated. Paperclip
is a reconciled execution projection and its completion state never substitutes
for Core verification.

### Present

The command center projects Today, ranked communications and people, active context, approvals, assignments, outcomes, connector health, and replayable history. The left bay owns Today, communications, people, tasks, and commitments; the center owns mission context, pipeline, Nucleus, retention, and replay; the right bay owns Review, proposals/checkpoints, approvals, runs, outcomes, and receipts. Narrow screens expose Today, Communications, Nucleus, and Approvals as explicit tabs.

Nucleus combines semantic, activity, and mission graphs. Typed-port drags create
pending relationship proposals, never direct graph mutation. Approval is bound
to the proposal's sealed hash and version and creates only the exact typed,
source-backed entity relation; rejection creates no edge. Relation deletion is
not exposed because Core has no verified tombstone contract yet. Message,
Action, and reflection proposal approvals are reviewed-status changes only and
cannot send, queue, execute, or silently rewrite memory. Timeline entries
link the persisted capture, intent/route, plan, decision, assignment, receipt,
and retention records that exist for a mission; absent stages stay absent. A
visible node or animation must trace to persisted evidence; storage integrity
is not a substitute for destination verification.

## Interaction boundary

Voice expresses intent, edits, filters, and explanations. Gestures operate only when their visual context makes the action valid. Clap wake is detected locally in standby; standby audio is not sent upstream. The greeting is synthesized locally, then active-turn audio may flow to the configured Gemini Live session for the bounded turn. A finished Gemini input transcript is retained only as an encrypted local spoken-capture event and is never logged on failure.

Open right palm aims, open left palm scrolls communications, fresh right pinch focuses, stationary target pinch-hold for 620 ms opens contextual actions, and movement of at least 7 px before the hold threshold drags. A right pinch that begins on empty Nucleus space clutches the camera. Two open palms held inside Nucleus control semantic depth and do not cancel work. Held thumb up/down for 700 ms acts only on the exact active approval. Both open palms held outside the Nucleus depth context cancel the selected pending mission through its plan binding. `Closed_Fist` is explicitly inert; pointing, victory, and dwell have no semantic actions.

The React tree owns application state and `#app`. The gesture renderer owns only a disposable body overlay. Hardware starts from an explicit user engagement and tears down completely on dismissal, failure, or unmount. Keyboard and pointer operation remain complete fallbacks.

## Privacy invariants

- Require loopback binding; reject non-loopback startup and untrusted Host and Origin values.
- Require an authenticated bearer or per-process same-origin session for Core APIs and voice upgrade. Production prints a secret, one-use bootstrap URL; opening `/` alone never grants authority. Bearer clients may explicitly `POST /api/v1/session`.
- Never persist or log audio frames, raw hand landmarks, or secrets. Private source payloads and a completed spoken transcript may exist only inside authenticated encrypted evidence records; sanitized gesture diagnostics contain no frames or landmarks.
- Route only semantic gesture events into application state.
- Keep remote workers on minimum evidence and permissions.
- Record estimated and actual mission cost without recording secret prompts or credentials.
- Fail closed on wrong keys, tampered ciphertext, stale plan versions, expired leases, scope expansion, and unverifiable external results.

## Change discipline

Any change to shared contracts, authority boundaries, approval semantics, connector source identity, receipt verification, credential handling, or gesture grammar requires executable tests and an update to this document plus the nearest `INDEX.md`. Historical plans in `docs/` never override this architecture or the shared contracts.
