# Native Jarvis Calibration Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the shared and bridge contracts required for native audio calibration without granting calibration any executable, repository, connector, filesystem, Hermes, or vault capability.

**Architecture:** Extend the existing shared validator with calibration-only types, add generic per-turn milestones to `GroundedTurnController`, add a fixed-ID Gemini phrase transport, and persist sanitized failures through the existing Core proposal store. The browser observes serialized events only; all new server handlers fail closed and remain independent of tool execution.

**Tech Stack:** TypeScript, Node 22, `@jericho/shared`, Vitest, WebSocket, existing Core store and HTTP server.

---

**Required base:** `77d18fba24edc1bcf1a9b69e988a09c6c9f11417`

**Owned paths:**

- `apps/jarvis/shared/**`
- `apps/jarvis/bridge/**`
- backend/shared tests

**Prohibited paths and behavior:**

- Do not edit `apps/jarvis/frontend/**`, lockfiles, populated `.env` files, Conductor files, or live memory.
- Do not add an Isabella-specific retrieval branch or answer text. The fixed calibration phrase is presentation-only.
- Do not add ToolExecutor, Hermes, connector, Git/GitHub, Conductor, vault, or filesystem dependencies to calibration proposals.
- Do not run real microphone, camera, Gemini, or human-duration waits. All voice tests use fake sessions and fake timers.

## File structure

- Modify `apps/jarvis/shared/src/index.ts`: authoritative calibration types, closed enums/unions, and strict runtime validators.
- Create `apps/jarvis/bridge/src/calibration/fix-proposals.ts`: canonical request validation, hashing, deterministic proposal persistence, and scoped lookup.
- Modify `apps/jarvis/bridge/src/retrieval/grounded-turn.ts`: generic at-most-once progress port.
- Modify `apps/jarvis/bridge/src/server.ts`: authenticated HTTP routes, fixed phrase WebSocket messages, and progress serialization.
- Create `apps/jarvis/bridge/tests/calibration-contracts.test.ts`: shared validation and fixed phrase contract.
- Create `apps/jarvis/bridge/tests/calibration-fix-proposals.test.ts`: endpoint security, idempotency, persistence, and dependency boundary.
- Modify `apps/jarvis/bridge/tests/grounded-intelligence.test.ts`: progress ordering and deduplication.
- Modify `apps/jarvis/bridge/tests/voice-gate.test.ts`: fixed phrase transport and no arbitrary prompt/audio-input path.

### Task 1: Shared calibration contracts and validators

**Files:**

- Modify: `apps/jarvis/shared/src/index.ts`
- Create: `apps/jarvis/bridge/tests/calibration-contracts.test.ts`

- [ ] **Step 1: Write failing contract tests**

Cover exact accepted values and strict rejection:

```ts
import {
  assertCalibrationFixProposalRequest,
  assertGroundedTurnProgressEvent,
  CALIBRATION_PHRASES,
} from '@jericho/shared';

it('accepts the bounded mic-denied request without a device hash', () => {
  expect(() => assertCalibrationFixProposalRequest({
    schemaVersion: 1,
    sessionId: 'session-1',
    buildSha: '77d18fb',
    failedPhase: 'room',
    failureReason: 'mic_denied',
    aggregateMetrics: {},
  })).not.toThrow();
});

it.each(['rawAudio', 'transcript', 'path', 'command', 'repositoryGrant']) (
  'rejects forbidden or unknown field %s',
  (field) => {
    expect(() => assertCalibrationFixProposalRequest({
      schemaVersion: 1,
      sessionId: 'session-1',
      buildSha: '77d18fb',
      failedPhase: 'room',
      failureReason: 'mic_denied',
      aggregateMetrics: {},
      [field]: 'forbidden',
    })).toThrow();
  },
);

it('accepts only known phrase IDs', () => {
  expect(Object.keys(CALIBRATION_PHRASES)).toEqual([
    'voice_range_1', 'voice_range_2', 'voice_range_3',
  ]);
});
```

Also reject: numeric/string overflow, arrays, nested unknown metrics, non-finite numbers, invalid phase/reason combinations, missing required fields, padded/whitespace-only opaque IDs, invalid hashes, duplicate/unknown milestones, and unknown object keys.

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
cd apps/jarvis/bridge
npx vitest run tests/calibration-contracts.test.ts
```

Expected: failure because the exports do not exist.

- [ ] **Step 3: Add the exact shared types**

Implement the spec contracts, including:

```ts
export const CALIBRATION_PHRASES = {
  voice_range_1: 'Jericho, calibrate my voice.',
  voice_range_2: 'Show me the grounded result.',
  voice_range_3: 'Who is Isabella Handel?',
} as const;

export type CalibrationPhraseId = keyof typeof CALIBRATION_PHRASES;
export type ActiveCalibrationPhase = 'room' | 'speech' | 'clap' | 'live_canary';
export type CalibrationPhase =
  | 'idle' | ActiveCalibrationPhase | 'review' | 'saved' | 'failed';

export const CALIBRATION_FAILURE_REASONS = [
  'mic_denied', 'device_lost', 'speaker_unavailable',
  'excessive_ambient_noise', 'clipping', 'insufficient_speech_energy',
  'invalid_clap', 'gemini_connection_failed', 'memory_unavailable',
  'event_duplication', 'event_mismatch', 'phase_timeout',
  'decision_scope_conflict', 'profile_write_failed',
] as const;

export type CalibrationFailureReason =
  (typeof CALIBRATION_FAILURE_REASONS)[number];

export type GroundedTurnMilestone =
  | 'capture_committed'
  | 'retrieval_started'
  | 'terminal_result_sent';

export interface GroundedTurnProgressEvent {
  turnId: string;
  milestone: GroundedTurnMilestone;
  captureId?: string;
  resultId?: string;
}
```

Add `CalibrationFixProposalRequest`, `CalibrationFixProposalResponse`, and the bounded aggregate metric type exactly as specified. `micDeviceHash` is optional so `mic_denied` remains reportable. Preserve opaque IDs exactly after validation; do not trim accepted identifiers.

- [ ] **Step 4: Implement strict validators**

Use explicit `Set` allowlists, existing assertion helpers, finite/range checks, exact phase-to-reason subsets, and body-string bounds. Do not silently coerce, truncate, drop, or normalize unknown data.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
cd apps/jarvis/bridge
npx vitest run tests/calibration-contracts.test.ts
cd ../shared
pnpm typecheck
```

Expected: all new tests pass; shared typecheck passes.

- [ ] **Step 6: Commit**

```bash
git add apps/jarvis/shared/src/index.ts apps/jarvis/bridge/tests/calibration-contracts.test.ts
git commit -m "feat(shared): define native calibration contracts"
```

### Task 2: At-most-once grounded-turn progress

**Files:**

- Modify: `apps/jarvis/bridge/src/retrieval/grounded-turn.ts`
- Modify: `apps/jarvis/bridge/tests/grounded-intelligence.test.ts`

- [ ] **Step 1: Write failing progress tests**

Extend the test port factory with `onProgress`. Assert one generic private turn emits exactly:

```ts
expect(progress.map((event) => event.milestone)).toEqual([
  'capture_committed',
  'retrieval_started',
  'terminal_result_sent',
]);
expect(new Set(progress.map((event) => event.turnId)).size).toBe(1);
expect(progress[1].resultId).toBe(progress[2].resultId);
```

Add duplicate final transcript, duplicate `turnComplete`, retrieval failure, unavailable index, general conversation, and two consecutive private-turn cases. Progress must never expose transcript, subject, evidence, excerpt, path, or claim fields.

- [ ] **Step 2: Confirm the focused tests fail**

```bash
cd apps/jarvis/bridge
npx vitest run tests/grounded-intelligence.test.ts -t "progress"
```

- [ ] **Step 3: Add an additive progress port**

Add to `GroundedTurnPorts`:

```ts
onProgress?: (event: GroundedTurnProgressEvent) => void;
```

Track milestones inside each `ActiveTurn` with a `Set<GroundedTurnMilestone>`. Add one helper that fails closed on duplicates:

```ts
private publishProgress(
  turn: ActiveTurn,
  milestone: GroundedTurnMilestone,
  ids: { captureId?: string; resultId?: string } = {},
): void {
  if (turn.progressSeen.has(milestone)) return;
  turn.progressSeen.add(milestone);
  this.#ports.onProgress?.({ turnId: turn.id, milestone, ...ids });
}
```

Emit only after the operation actually succeeds:

- `capture_committed` after the immutable spoken capture is committed, carrying `captureId`.
- `retrieval_started` after `resultId` is assigned and before the existing retrieving event is sent.
- `terminal_result_sent` after shared validation and WebSocket send/persistence, carrying the same `resultId`.

Do not change the existing capture, retrieval, greeting, cache, guided, or narration behavior.

- [ ] **Step 4: Run focused and related voice tests**

```bash
cd apps/jarvis/bridge
npx vitest run tests/grounded-intelligence.test.ts tests/voice-isabella-rag.test.ts tests/voice-gate.test.ts
```

Expected: all pass; exact-one existing assertions remain green.

- [ ] **Step 5: Commit**

```bash
git add apps/jarvis/bridge/src/retrieval/grounded-turn.ts apps/jarvis/bridge/tests/grounded-intelligence.test.ts
git commit -m "feat(bridge): publish grounded turn milestones"
```

### Task 3: Fixed calibration phrase WebSocket transport

**Files:**

- Modify: `apps/jarvis/bridge/src/server.ts`
- Modify: `apps/jarvis/bridge/tests/voice-gate.test.ts`

- [ ] **Step 1: Write failing WebSocket tests**

Using the existing fake Gemini session, assert:

- `{type:'calibration_phrase', phraseId:'voice_range_1'}` sends the exact allowlisted text once.
- The bridge emits `calibration_phrase` `started`, zero or more `calibration_phrase_audio` chunks, then `complete`.
- Unknown IDs, extra text fields, active turns, previews, and a second concurrent phrase fail closed with `unavailable` or an error and never reach Gemini.
- Calibration phrase input never calls `sendRealtimeInput`; no microphone data is accepted through this route.
- A timeout produces one terminal `unavailable` and clears phrase state without reconnect/warmup loops.

- [ ] **Step 2: Confirm failure**

```bash
cd apps/jarvis/bridge
npx vitest run tests/voice-gate.test.ts -t "calibration phrase"
```

- [ ] **Step 3: Implement one bounded phrase state**

Add a session-local state separate from preview and active voice turns:

```ts
let calibrationPhrase:
  | { phraseId: CalibrationPhraseId; timer: ReturnType<typeof setTimeout> }
  | undefined;
```

Validate the incoming frame with an exact key allowlist (`type`, `phraseId`). Resolve the phrase only from `CALIBRATION_PHRASES`. Reject when `active`, `preview`, or another phrase exists. Send only the fixed server text through the existing Gemini session.

In Gemini callbacks, handle calibration phrase output before the ordinary `if (!active) return` branch. Emit distinct audio frames so frontend code never confuses phrase playback with greeting or grounded narration. Use one short hard timeout and no automatic retry, dummy wake, greeting reset, or reconnect solely for phrase playback.

- [ ] **Step 4: Run voice tests and typecheck**

```bash
cd apps/jarvis/bridge
npx vitest run tests/voice-gate.test.ts tests/voice-isabella-rag.test.ts
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/jarvis/bridge/src/server.ts apps/jarvis/bridge/tests/voice-gate.test.ts
git commit -m "feat(bridge): speak fixed calibration phrases"
```

### Task 4: Immutable calibration fix proposals

**Files:**

- Create: `apps/jarvis/bridge/src/calibration/fix-proposals.ts`
- Modify: `apps/jarvis/bridge/src/server.ts`
- Create: `apps/jarvis/bridge/tests/calibration-fix-proposals.test.ts`

- [ ] **Step 1: Write failing service tests**

Test a pure service with an in-memory Core store and fixed clock:

```ts
const request = {
  schemaVersion: 1 as const,
  sessionId: 'session-1',
  buildSha: '77d18fb',
  failedPhase: 'room' as const,
  failureReason: 'mic_denied' as const,
  aggregateMetrics: {},
};
const key = calibrationProposalDigest(request);
const created = service.create(request, key);
const replay = service.create(request, key);
expect(created.statusCode).toBe(201);
expect(replay.statusCode).toBe(200);
expect(replay.body).toMatchObject({ proposalId: created.body.proposalId, replayed: true });
```

Assert deterministic ID binding, immutable stored body, `DataChange`/`PendingApproval`/`HumanApproval`, no assignment/external action, canonical JSON key-order independence, hash mismatch rejection, different-content conflict, scoped lookup, and no mutation after caller changes its input object.

- [ ] **Step 2: Write failing HTTP tests**

Exercise the real server routes:

- `POST /api/v1/calibration/fix-proposals`
- `GET /api/v1/calibration/fix-proposals/:proposalId`

Assert auth, content type, 16 KiB limit, 201/200/400/401/409/413/503 behavior, unknown-field rejection, and that arbitrary generic proposal IDs return 404 through the scoped GET.

Inject sentinel ToolExecutor/connector/vault callbacks into the test server and assert zero calls.

- [ ] **Step 3: Confirm failure**

```bash
cd apps/jarvis/bridge
npx vitest run tests/calibration-fix-proposals.test.ts
```

- [ ] **Step 4: Implement the isolated service**

The module may import only:

- `node:crypto`;
- shared calibration/Core proposal types and enums;
- the narrow Core store interface needed for `getProposal`/`saveProposal`;
- an injected clock.

It must not import `tools.ts`, connectors, orchestration, retention, vault, filesystem, Git/GitHub, or Conductor adapters.

Canonicalize only the already validated request, hash the canonical JSON, compare with the header using constant-time-safe equality where practical, derive the opaque proposal ID, deep-copy/freeze the body, and persist through `saveProposal`.

- [ ] **Step 5: Wire routes behind the existing API authentication guard**

Read at most 16 KiB, require `application/json`, validate exact headers/body, map domain errors to the specified status codes, and return no snapshot or unrelated proposal data.

- [ ] **Step 6: Run focused tests and typecheck**

```bash
cd apps/jarvis/bridge
npx vitest run tests/calibration-contracts.test.ts tests/calibration-fix-proposals.test.ts tests/server.test.ts
pnpm typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/jarvis/bridge/src/calibration/fix-proposals.ts apps/jarvis/bridge/src/server.ts apps/jarvis/bridge/tests/calibration-fix-proposals.test.ts
git commit -m "feat(bridge): store inert calibration fix proposals"
```

### Task 5: Backend regression gate and delivery

**Files:** No new production files unless a failing regression requires an in-scope correction.

- [ ] **Step 1: Run all focused tests together**

```bash
cd apps/jarvis/bridge
npx vitest run \
  tests/calibration-contracts.test.ts \
  tests/calibration-fix-proposals.test.ts \
  tests/grounded-intelligence.test.ts \
  tests/voice-gate.test.ts \
  tests/voice-isabella-rag.test.ts \
  tests/server.test.ts
```

- [ ] **Step 2: Run complete backend/shared verification**

```bash
cd apps/jarvis/shared && pnpm typecheck
cd ../bridge && pnpm typecheck && pnpm test
git diff --check 77d18fba24edc1bcf1a9b69e988a09c6c9f11417...
```

Expected: every test passes, both typechecks pass, diff check is empty.

- [ ] **Step 3: Prove scope and authority boundaries**

```bash
git diff --name-only 77d18fba24edc1bcf1a9b69e988a09c6c9f11417...
git grep -n -E "ToolExecutor|Hermes|GitHub|Conductor|vault|filesystem" HEAD -- apps/jarvis/bridge/src/calibration
```

Expected: only shared/bridge/backend tests changed; the calibration module has no prohibited dependency matches except explanatory comments/tests.

- [ ] **Step 4: Deliver**

Push the branch and report:

- full base and tip SHAs plus ordered commit list;
- changed files;
- exact focused and full test counts;
- shared/bridge typecheck results;
- explicit proof that no live mic, Gemini, `.env`, repository, or vault mutation occurred;
- any known integration assumptions.
