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

External effects require destination-scoped idempotency and a verified receipt. Retries must not duplicate a send, deployment, or other mutation.

### Retain

Verified outcomes, evidence, decisions, artifacts, edits, costs, and receipts return to the truth graph. Claims keep their assumptions and contradictory observations remain separate. Preference and memory changes are source-backed proposals, never silent merges. Selected summaries may be written to Obsidian after verification.

### Present

The command center projects Today, ranked communications and people, active context, approvals, assignments, outcomes, connector health, and replayable history. Nucleus combines semantic, activity, and mission graphs. A visible node or animation must trace to persisted evidence; storage integrity is not a substitute for destination verification.

## Interaction boundary

Voice expresses intent, edits, filters, and explanations. Gestures operate only when their visual context makes the action valid. Clap wake is detected locally in standby; standby audio is not sent upstream. Open palm aims, left palm scrolls communications, fresh pinch focuses, stationary pinch-hold opens contextual actions, and early movement drags. Nucleus owns camera clutch and semantic-depth gestures. Held thumb up/down acts only on an active approval. Both open palms cancel pending work. Closed-fist actions are deliberately absent.

The React tree owns application state and `#app`. The gesture renderer owns only a disposable body overlay. Hardware starts from an explicit user engagement and tears down completely on dismissal, failure, or unmount. Keyboard and pointer operation remain complete fallbacks.

## Privacy invariants

- Bind to loopback by default; reject untrusted Host and Origin values.
- Require an authenticated bearer or per-process same-origin session for Core APIs and voice upgrade.
- Never persist or log audio frames, transcripts, raw hand landmarks, secrets, or private source payloads outside their encrypted evidence record.
- Route only semantic gesture events into application state.
- Keep remote workers on minimum evidence and permissions.
- Record estimated and actual mission cost without recording secret prompts or credentials.
- Fail closed on wrong keys, tampered ciphertext, stale plan versions, expired leases, scope expansion, and unverifiable external results.

## Change discipline

Any change to shared contracts, authority boundaries, approval semantics, connector source identity, receipt verification, credential handling, or gesture grammar requires executable tests and an update to this document plus the nearest `INDEX.md`. Historical plans in `docs/` never override this architecture or the shared contracts.
