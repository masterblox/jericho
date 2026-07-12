# Jericho live-safe smoke test

**Owner:** Carlos / Jericho Core

**Freshness:** 2026-07-11

This runbook separates deterministic evidence, a no-external-effects browser
smoke, physical camera/voice checks, and integration checks that require a
deployed Hermes operator or sandbox messaging gateway. Do not report the full
Jericho smoke as passed when only the automated section passed.

## Safety rules

- Use a temporary home and fresh Core key. Never point the default smoke at
  Carlos's production database, Obsidian vault, repos, Conductor roots, Hermes
  bus, Telegram gateway, WhatsApp gateway, or Linear account.
- Keep every connector credential and local truth path blank in the default
  smoke. Confirm the approval surface says there are no external actions before
  approving the synthetic project.
- Never use a real person as a test recipient. A live send requires Carlos's
  explicit approval of a sandbox recipient and an exact mission task with a
  visible `externalAction`; generic spoken or Telegram text is not send authority.
- Never test deployment, destructive mutation, production mutation, or rollback
  against a production system.
- Preserve the terminal output as private: the production log includes a secret
  one-use browser bootstrap URL.

## 1. Automated deterministic gate

From `apps/jarvis`:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
```

All three gates must pass. The suites use temporary stores and fake transports;
they do not authorize or perform a real message, deployment, or repository
mutation. Among the covered contracts are:

- authenticated encryption, tamper/wrong-key failure, lookup-token backfill,
  immutable capture identity, and canonical reconciliation;
- all six routes, Review gates, exact hash/version approval, checkpoint
  dispositions, cancellation, budget/retry/concurrency policy, lease recovery,
  idempotent receipts, and truthful mission replay;
- more than 10,000 durable capture changes recovered in bounded pages and
  rerun without duplicates, plus the bounded legacy compatibility path;
- Telegram and WhatsApp exact-plan binding, fake gateway acknowledgement,
  independent evidence verification, one completed receipt, and fail-closed
  uncertain sends;
- Obsidian verified-only retention and reflection-as-pending-proposal behavior;
- loopback/browser authentication, one-use bootstrap, SSE/voice authorization,
  local clap state, dual-hand tracking, held approval/cancel gestures, inert
  closed fists, action-ring disambiguation, and Nucleus camera/depth grammar.

An automated pass does **not** prove physical clap latency, a particular webcam
or GPU, microphone routing, a remote gateway, a real destination, or Hermes-side
execution.

## 2. Isolated production boot

Use a shell that has no production Jericho process. Explicit empty exports stop
the local `.env` file from filling connector values during this run.

```bash
cd apps/jarvis
export HOME="$(mktemp -d -t jericho-smoke.XXXXXX)"
export JERICHO_MASTER_KEY="$(openssl rand -base64 32)"
export JERICHO_API_TOKEN=jericho-smoke-local-only
export CONDUCTOR_PORT=18787
export JERICHO_HOST=127.0.0.1
export JERICHO_ALLOWED_ORIGINS=
export GEMINI_API_KEY=
export JERICHO_TELEGRAM_GATEWAY_URL=
export JERICHO_TELEGRAM_GATEWAY_TOKEN=
export JERICHO_WHATSAPP_GATEWAY_URL=
export JERICHO_WHATSAPP_GATEWAY_TOKEN=
export LINEAR_API_KEY=
export JERICHO_GIT_REPOSITORIES='[]'
export JERICHO_GITHUB_REPOSITORIES=
export JERICHO_CONDUCTOR_ROOTS='[]'
export JERICHO_OBSIDIAN_VAULT=
export JERICHO_MISSION_REPOSITORY_GRANTS='[]'
export JERICHO_HERMES_BUS_ROOT=
export JERICHO_HERMES_REPO=
export JERICHO_HERMES_BRANCH=
corepack pnpm start
```

Expected:

- Core binds only to `127.0.0.1:18787` and prints a one-use bootstrap URL.
- No gateway, repo, Conductor, Obsidian, or Hermes work is attempted.
- `GET /api/v1/health` without bearer/session returns `401`.
- A plain `GET /` may serve static UI but does not set a session cookie; the UI
  cannot read Core until authenticated.
- `GET` of the printed bootstrap URL sets `jericho_session` as HttpOnly and
  SameSite Strict, redirects to `/`, and consumes the URL. Replaying it returns
  `410`. A wrong bootstrap token returns `404`.
- An authenticated API client may establish the same browser-session authority
  only with `POST /api/v1/session` and `Authorization: Bearer
  jericho-smoke-local-only`.
- Starting with `JERICHO_HOST=0.0.0.0` or another non-loopback host fails before
  listening.

Open the complete bootstrap URL in the browser. Exercise these viewports:

| Viewport | Expected projection |
|---|---|
| 1920×1080 | Three TV bays remain readable without clipped approvals. |
| 1600×1000 | Left, center, and right evidence bays remain independently usable. |
| 390×844 | Today, Communications, Nucleus, and Approvals tabs expose every bay. |

Check the browser console and network log. There must be no CSP errors and no
model request to a third-party domain. After local runtime engagement, the
gesture model loads from `/mediapipe/models/gesture_recognizer.task` and WASM
loads from `/mediapipe/wasm/` on the Jericho origin.

## 3. Safe capture, Review, approval, and replay

In another shell, keep the same port/token:

```bash
export JERICHO_API_TOKEN=jericho-smoke-local-only
export JERICHO_URL=http://127.0.0.1:18787
curl -fsS \
  -H "Authorization: Bearer $JERICHO_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"kind":"manual","sourceEventId":"smoke-project-v1","occurredAt":"2026-07-11T00:00:00.000Z","payload":{"text":"Implement a multi-step project to prepare a bounded Jericho smoke artifact","requiredCapabilities":["code.repo"]}}' \
  "$JERICHO_URL/api/v1/captures"

curl -fsS \
  -H "Authorization: Bearer $JERICHO_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"kind":"manual","sourceEventId":"smoke-review-v1","occurredAt":"2026-07-11T00:00:01.000Z","payload":{"text":"Implement this project in an unknown repository","requiredCapabilities":["code.repo"],"jerichoScope":{"repository":"not-configured"}}}' \
  "$JERICHO_URL/api/v1/captures"
```

The first response must report `processing.status: "planned"`; the second must
report `processing.status: "review"`. Repeating either exact request returns the
same immutable event without a duplicate intent or mission.

In the UI verify:

1. The project appears across persisted Capture, Understand, Route, and Plan
   timeline entries and as an exact-plan approval. Its plan has Research then DEV
   dependencies, a cost/runtime/retry ceiling, no repository grant, and no
   external action.
2. Approving once with the button queues the registered Research and DEV
   assignments. With no compatible Hermes executor, they cannot produce a
   successful artifact; the runner must fail closed and expose retry/checkpoint
   truth rather than claim success.
3. The invalid repository selection appears in Review with confidence/evidence.
   Dismiss resolves only that review, while **Reclassify as project** creates a
   new pending exact-plan mission that still requires approval.
4. A resumable checkpoint may resume only the same plan hash/version. Scope,
   objective, repository, recipient, or budget expansion requires a new plan;
   rejecting a checkpoint cancels the mission rather than leaving hidden work.
5. Dragging a typed Nucleus relation port to another node creates a pending
   proposal in the right bay. The semantic relationship is not silently applied.
6. Timeline replay and Nucleus pulses link only records that exist. There is no
   Retain stage until a verified mission is explicitly retained.
7. `POST /api/v1/reflection/run` with the bearer may create pending proposals but
   cannot approve, merge, or execute them.

Restart Core with the same temporary `HOME`, master key, and token. The captures,
intents, mission, decisions, assignments, and proposals must reappear without
duplicates. This restart is a live idempotency check; the greater-than-10,000
paged recovery case remains an automated test because generating that volume in
an operator smoke adds no useful external evidence.

## 4. Keyboard and permission fallback

Reload in a fresh browser profile and deny camera/microphone permission. Choose
**Continue with keyboard**. Verify that all tabs, selections, approval/rejection,
Review dispositions, checkpoint actions, retention control, cancellation, and
relationship proposal controls remain reachable by keyboard and pointer. Press
Escape after hardware engagement and confirm tracking pauses and the normal
cursor returns.

This section may pass without any physical camera or Gemini account.

## 5. Physical webcam and clap checks

These checks are manual prerequisites, not CI evidence. Keep the isolated
no-connector profile and use only its synthetic mission.

| Check | Acceptance |
|---|---|
| Engage | Camera/mic permission starts only after the explicit button; dismissal/unmount releases both. |
| Clap wake | From standby, five isolated claps each start “Hello, sir. What are we doing today?” within 1.5 seconds without a spoken wake word. |
| Standby privacy | Before wake, browser WebSocket frames contain no client `audio` message; only local transient analysis runs. |
| Right palm / left palm | Right palm aims; left palm scrolls only the communications bay. Temporary loss freezes only the missing hand. |
| Pinch tap | A fresh on-target pinch focuses/opens. A pinch begun off-target remains inert until released. |
| Context ring / drag | A stationary target pinch opens its action ring after 620 ms; moving at least 7 px before that threshold drags instead. |
| Nucleus camera | A right pinch beginning on empty Nucleus space clutches and moves the camera; release ends it. |
| Nucleus depth | Two open palms held inside Nucleus for 700 ms change semantic depth with hand span and do not cancel the mission. |
| Approval | Held thumb up/down affects only the visibly active matching plan hash/version and fires once per hold. Use the isolated no-external mission. |
| Cancel | Both open palms held outside the Nucleus depth context cancel only the selected pending mission and record the decision. |
| Closed fist | Repeated closed fists perform no tap, drag, approval, cancellation, camera, depth, or scroll action. |
| Calibration | Independent center/four-corner calibration survives the session for that camera; Swap corrects reversed handedness; Reset removes profiles. |
| Diagnostics | The 30-second export contains sanitized state/timing/ratios only—no image, raw landmark, transcript, token, or private card content. |

GPU/WASM performance and gesture accuracy are machine, camera, lighting, and
distance dependent; record the hardware and any failed threshold instead of
generalizing a pass from deterministic tests.

## 6. Active voice privacy check

This section requires a configured `GEMINI_API_KEY` and therefore sends active
turn audio to Gemini. Obtain explicit approval before running it.

1. Start in standby and confirm no client audio frames leave the browser.
2. Clap, wait for the local greeting, then speak a unique non-secret phrase.
3. Confirm audio transport stops on turn completion or the configured active-turn
   timeout and returns to standby.
4. Confirm the completed Gemini input transcript appears as one encrypted local
   spoken capture and follows the normal route/approval path.
5. Search the temporary Core directory and process logs for the unique phrase.
   It must not appear as plaintext. The phrase may be decrypted only through the
   authenticated Core evidence record.
6. Force capture failure in a test profile and confirm only the generic “spoken
   capture unavailable” error is returned; transcript contents are not logged or
   echoed.

The server can verify gating and encrypted retention; it cannot prove Gemini's
provider-side data handling. Treat that as a separate vendor/privacy review.

## 7. Sandbox connector receipt check

Do not run this section against a real contact. It requires a test gateway and a
synthetic recipient controlled by Carlos.

- Construct the mission through a test/integration planner that emits an
  explicit Telegram or WhatsApp `send_message` task, or configure fleet
  recipients (`JERICHO_FLEET_TELEGRAM_RECIPIENTS`) so the default Project planner
  emits a Telegram wake for interactive lane work.
- Confirm the approval surface displays the exact connector, system, recipient,
  message, tool, credential reference, data scope, mutation class, idempotency
  key, and receipt requirement.
- Approve that exact plan once. Confirm the gateway receives one request and the
  reserved receipt moves through pending/started/succeeded only once.
- Confirm the immutable delivery event contains hashes and gateway identifiers,
  not raw message text, and the independent verifier binds mission, plan, task,
  assignment, destination, message hash, idempotency hash, and external ID.
- Replay the scheduler and restart Core. The gateway must not receive a second
  request. Force a timeout after transport start; the receipt must remain
  uncertain and require review rather than automatic resend.

The implemented receipt proves a destination-bound gateway acknowledgement. It
does not prove that a human read the message, and it must not be presented as a
read receipt.

## 8. Fleet command (sphere → Hermes lanes)

Optional. Requires sandbox Telegram gateway credentials and an explicit
recipient allowlist. Do not point at production bots until Carlos approves the
exact recipient map.

Prerequisites:

```bash
JERICHO_TELEGRAM_GATEWAY_URL=...
JERICHO_TELEGRAM_GATEWAY_TOKEN=...
JERICHO_FLEET_TELEGRAM_RECIPIENTS={"dev":"<sandbox-chat-id>"}
JERICHO_FLEET_BRIDGE_ROOT=/tmp/jericho-fleet-bridge-smoke
JERICHO_FLEET_DISPATCH_MODE=hybrid
```

Verify:

1. A capture that asks DEV for a quick status plans a mission whose lane task
   has `externalAction.connectorId: "telegram"` and wake text containing
   `[Jericho Core → DEV]`.
2. Approving that exact plan sends one gateway message; command-center
   `knowledge.fleetDispatches` shows `dispatchMode: telegram_wake` plus a receipt.
3. A durable ask with `JERICHO_FLEET_BRIDGE_ROOT` writes
   `outbox/jericho-handoffs/*.md` and, when Paperclip is configured, creates an
   issue titled with the `[DevOps]` (or lane) tag.
4. A file under `outbox/jericho-replies/` is ingested as `fleet.bridge_reply`.

This path is workspace-agnostic: skills remain on the Hermes VPS; Core only
routes and receipts.

## 9. Hermes v1 operator prerequisite

The installed Hermes operator on 2026-07-11 is legacy. It injects a prompt,
writes historical state, cannot enforce stop, and supplies neither metered cost
evidence nor independently verified structured artifacts. Jericho must report
`hermes-execution` unavailable and emit no assignment to it.

A real DEV/Research completion smoke may run only after a sandbox operator:

1. Publishes a fresh, expiring v1 manifest with every required capability.
2. Enforces exact assignment/idempotency identity, bounded cancellation,
   minimum evidence, tools, writable scope, and no recursive worker expansion.
3. Uses a sandbox repository/branch matched by both the configured repository
   grant and the immutable capture selector.
4. Returns the approved artifact type, independent verification evidence, and
   integer micro-USD cost evidence bound to the approved model/tool identities.
5. Demonstrates dependency order, ceilings, retry exhaustion, cancellation,
   restart idempotency, and no outbox task on scope mismatch.

Only then can the end-to-end mission criteria—real Research and DEV artifacts,
cost accounting, Retain to a temporary Obsidian vault, and complete Nucleus
replay—be marked passed. External sends and deployments remain separate protocol
work; Hermes filesystem v1 does not authorize them.

## Completion record

Record results in four independent lines:

| Gate | Allowed result |
|---|---|
| Deterministic tests/typecheck/build | Pass / fail with command output. |
| Isolated browser/API smoke | Pass / fail with browser, OS, viewport, and console/network evidence. |
| Physical webcam/clap/voice | Pass / fail / not run with hardware and Gemini prerequisite noted. |
| Hermes/gateway integration | Pass / fail / blocked, naming the exact deployed operator or sandbox gateway. |

“Jericho smoke passed” is valid only when every required line for the claimed
environment passed. A blocked Hermes line is an honest fail-closed result, not a
successful agent-orchestration run.
