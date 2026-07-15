# Native Jarvis Calibration Design

## Goal

Jericho calibrates itself inside the native Sphere using Carlos's actual microphone, room, voice, clap, camera, and hands. Automated audio fixtures remain useful for deterministic regression tests, but they never count as live acceptance.

The calibration flow is manually started, device-local, bounded, and reversible. It does not grant Jarvis repository credentials, dispatch Hermes, modify source files, or write to the unified memory vault.

## Product flow

Voice mode first shows the existing administrative voice controls plus a `CALIBRATE ROOM + MIC` action. Starting calibration closes CommandOverlay and replaces the administrative card with one evolving native calibration card:

1. `ROOM` — settle for one second, then measure exactly five seconds of ambient noise.
2. `SPEECH` — display and speak three fixed short phrases. After each prompt finishes playing and a 250 ms settle period passes, Carlos repeats it while Jericho measures signal-to-noise ratio, clipping, continuity, and usable speech range. It reports only whether usable speech energy was heard; it does not claim that local transcription verified the words.
3. `CLAP` — collect three real claps, reject sustained speech-like energy, enforce an inter-clap refractory period, and derive candidate wake thresholds.
4. `LIVE_CANARY` — apply the candidate detector profile in memory, require a real clap wake, and ask Carlos to say “Who's Isabella?” through the production microphone → WebSocket → Gemini Live → `GroundedTurnController` → Sphere path.
5. `REVIEW` — show the selected microphone label from the current permissioned browser session, previous and candidate profile summaries, passed phases, bounded failure codes, and the correlated grounded-result ID.

The fixed speech prompts are identified by opaque IDs and server-side allowlisted text; the browser cannot submit arbitrary Gemini instructions. Each prompt is requested once. Microphone transport remains muted during prompt playback and local measurement.

```ts
const CALIBRATION_PHRASES = {
  voice_range_1: 'Jericho, calibrate my voice.',
  voice_range_2: 'Show me the grounded result.',
  voice_range_3: 'Who is Isabella Handel?',
} as const;

type CalibrationPhraseId = keyof typeof CALIBRATION_PHRASES;
```

The browser sends only a `CalibrationPhraseId`. The bridge resolves and speaks the matching fixed text once, reports playback completion, and rejects every other value.

The Sphere remains visible. The card reuses the measured Sphere exclusion geometry and stacks beneath the Sphere when side placement cannot fit. Calibration never opens CommandOverlay and never renders a modal or dashboard replacement.

At REVIEW, Jarvis says, “Calibration is ready. Confirm to apply.” A held thumb-up for 700 ms applies the profile; held thumb-down discards it. Pointer and keyboard controls invoke the same controller methods. Voice confirmation alone never applies. Escape or both-open-palms cancellation restores the previous profile.

## Runtime ownership and controller contract

`JarvisRuntime` owns and disposes one frontend `CalibrationController` after the existing camera/microphone consent gate succeeds. The controller is not created by the React render tree. The Sphere card communicates with it through typed DOM commands and sanitized state events.

`BridgeClient` continues to own the one production `MicCapture`; calibration must not open a second microphone stream. It exposes a narrow calibration session over that same capture. While the local session is open, the bridge remains in standby, remote audio transport stays muted, and ordinary clap wake is suppressed. LIVE_CANARY closes local-only measurement, installs the candidate detector profile in memory, and resumes the ordinary clap-wake path.

The controller accepts these injected ports:

```ts
interface CalibrationControllerOptions {
  audio: CalibrationAudioPort;
  voice: CalibrationVoicePort;
  profiles: AudioCalibrationProfileStore;
  proposals: CalibrationProposalPort;
  eventTarget: RuntimeEventTarget;
  clock: () => number;
  timers: CalibrationTimerPort;
}
```

The port contracts are:

```ts
interface CalibrationAudioPort {
  openLocalSession(): Promise<CalibrationAudioSession>;
  installTemporaryProfile(profile: AudioCalibrationProfile): void;
  restoreProfile(profile: AudioCalibrationProfile | null): void;
}

interface CalibrationAudioSession {
  readonly identity: {
    label: string;       // display-only for the current permissioned session
    deviceHash: string;  // SHA-256; raw deviceId never leaves the adapter
    sampleRate: number;
  };
  measure(request: AudioMeasurementRequest): Promise<AudioWindowMetrics>;
  observeClaps(listener: (measurement: ClapMeasurement) => void): () => void;
  close(): void;
}

interface CalibrationVoiceObserver {
  onWake(source: 'clap' | 'manual'): void;
  onGreeting(phase: 'started' | 'complete'): void;
  onTurnProgress(event: GroundedTurnProgressEvent): void;
  onGroundedResult(event: GroundedResultEvent): void;
  onGroundedNarration(event: {
    resultId: string;
    phase: 'started' | 'complete';
  }): void;
  onUnavailable(reason: 'transport' | 'gemini'): void;
}

interface CalibrationVoicePort {
  speakCalibrationPhrase(phraseId: CalibrationPhraseId): Promise<void>;
  subscribe(observer: CalibrationVoiceObserver): () => void;
  beginLiveCanary(): void;
  endLiveCanary(): void;
}

interface AudioCalibrationProfileStore {
  loadApproved(deviceHash: string): AudioCalibrationProfile | null;
  commitApproved(profile: AudioCalibrationProfile): void;
}

interface CalibrationProposalPort {
  submitCalibrationFixProposal(
    request: CalibrationFixProposalRequest,
    idempotencyKey: string,
  ): Promise<CalibrationFixProposalResponse>;
}

interface CalibrationTimerPort {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}
```

- `CalibrationAudioPort` opens one exclusive local measurement session, reports the selected microphone identity, produces aggregate measurement windows, reports clap metrics, temporarily installs/restores detector thresholds, and never returns raw samples.
- `CalibrationVoicePort` requests only the three fixed phrase IDs, exposes additive subscriptions to greeting/turn/result/narration milestones, and starts or ends the ordinary live-canary voice path. It does not expose arbitrary Gemini instructions.
- `AudioCalibrationProfileStore` loads the previously approved device-bound profile and exposes one `commitApproved(profile)` write operation. The controller may call that operation only during `REVIEW → SAVED`.
- `CalibrationProposalPort` exposes only `submitCalibrationFixProposal(request, idempotencyKey)`. It is not `CoreClient` and has no mission, connector, filesystem, vault, Hermes, Git, or workspace methods.
- The clock and timer ports permit deterministic fake-clock tests. Production uses `performance.now()` for deadlines and wall-clock time only for persisted timestamps.

The public controller surface is:

```ts
interface CalibrationController {
  snapshot(): CalibrationSnapshot;
  start(): Promise<void>;
  retryPhase(): Promise<void>;
  exit(): void;
  applyProfile(): Promise<void>;
  discardProfile(): void;
  createFixProposal(): Promise<CalibrationFixProposalResponse>;
  dispose(): void;
}
```

`start()` is accepted only while the runtime is engaged, the Voice view was manually opened, and no mission approval or other calibration is active. Methods that do not apply to the current state fail closed and do not mutate state.

The state machine is:

`IDLE → ROOM → SPEECH → CLAP → LIVE_CANARY → REVIEW → SAVED`

```ts
type ActiveCalibrationPhase = 'room' | 'speech' | 'clap' | 'live_canary';
type CalibrationPhase =
  | 'idle'
  | ActiveCalibrationPhase
  | 'review'
  | 'saved'
  | 'failed';
```

Any active phase may enter terminal `FAILED`. `retryPhase()` repeats only the recorded failed phase when its prerequisites remain valid. `exit()`, `discardProfile()`, `dispose()`, device loss, and page teardown cancel every outstanding timer/subscription and restore the previous detector profile.

### DOM command and state contracts

The React card dispatches one command event:

```ts
type CalibrationCommand =
  | 'start'
  | 'retry_phase'
  | 'exit'
  | 'apply'
  | 'discard'
  | 'create_fix_proposal';

const JERICHO_AUDIO_CALIBRATION_COMMAND_EVENT =
  'jericho:audio-calibration-command';
```

`JarvisRuntime` is the only command consumer and maps these commands to the controller methods. Pointer and keyboard controls dispatch the same command event. No voice transcript or Gemini tool call is mapped to this event.

The controller publishes a complete sanitized snapshot after every transition:

```ts
const JERICHO_AUDIO_CALIBRATION_STATE_EVENT =
  'jericho:audio-calibration-state';

interface CalibrationSnapshot {
  sessionId: string;
  phase: CalibrationPhase;
  failedPhase?: ActiveCalibrationPhase;
  failureReason?: CalibrationFailureReason;
  microphoneLabel?: string;
  previousProfile?: AudioCalibrationProfileSummary;
  candidateProfile?: AudioCalibrationProfileSummary;
  completedPhases: ActiveCalibrationPhase[];
  speechChecks: Array<{ phraseId: CalibrationPhraseId; passed: boolean }>;
  clapCount: 0 | 1 | 2 | 3;
  liveResultId?: string;
  proposalId?: string;
  actionState?: 'idle' | 'working' | 'succeeded' | 'failed';
  deadlineRemainingMs?: number;
}

interface AudioCalibrationProfileSummary {
  schemaVersion: 1;
  createdAt: string;
  ambientNoiseFloor: number;
  speechActivationFloor: number;
  clapPeak: number;
  clapRms: number;
  clapCrest: number;
  liveResultId: string;
}
```

The snapshot contains no raw microphone ID, audio, transcript, private excerpt, source path, repository instruction, or credential. Unknown DOM commands and malformed snapshots are rejected.

## Failure codes, deadlines, and retry policy

The closed failure contract is:

```ts
type CalibrationFailureReason =
  | 'mic_denied'
  | 'device_lost'
  | 'speaker_unavailable'
  | 'excessive_ambient_noise'
  | 'clipping'
  | 'insufficient_speech_energy'
  | 'invalid_clap'
  | 'gemini_connection_failed'
  | 'memory_unavailable'
  | 'event_duplication'
  | 'event_mismatch'
  | 'phase_timeout'
  | 'decision_scope_conflict'
  | 'profile_write_failed';
```

Phase subsets are enforced:

- ROOM: `mic_denied`, `device_lost`, `excessive_ambient_noise`, `phase_timeout`.
- SPEECH: `mic_denied`, `device_lost`, `speaker_unavailable`, `clipping`, `insufficient_speech_energy`, `phase_timeout`.
- CLAP: `mic_denied`, `device_lost`, `invalid_clap`, `phase_timeout`.
- LIVE_CANARY: `mic_denied`, `device_lost`, `gemini_connection_failed`, `memory_unavailable`, `event_duplication`, `event_mismatch`, `phase_timeout`.
- REVIEW/APPLY: `decision_scope_conflict`, `profile_write_failed`.

Each user-started attempt has one monotonic hard deadline:

- ROOM: 8 seconds total, containing the one-second settle and exact five-second sample.
- SPEECH: 45 seconds total for three prompt/playback/response measurements.
- CLAP: 30 seconds total for three valid claps.
- LIVE_CANARY: 75 seconds total from the instruction screen to correlated narration completion.
- Applying or discarding: 2 seconds. Fix-proposal submission: 10 seconds.

REVIEW itself is a stable decision state, not `WORKING`, and therefore has no automatic approval timeout. Page teardown still discards the candidate.

The calibration layer performs zero automatic phase retries, never extends a deadline, never sends a dummy wake, never resets the greeting flag, and never loops Gemini warmups. A deadline or transport failure becomes visible terminal `FAILED` with `RETRY PHASE` and `EXIT`. Only an explicit Carlos action starts another attempt.

## Local audio measurement and privacy

`MicCapture` gains an aggregate window API over its existing callback without changing the production active-turn encoding gate:

```ts
interface AudioMeasurementRequest {
  mode: 'room' | 'speech';
  durationMs: number;
  signal: AbortSignal;
}

interface AudioWindowMetrics {
  durationMs: number;
  sampleCount: number;
  blockCount: number;
  rmsMin: number;
  rmsMax: number;
  rmsMean: number;
  rmsP95: number;
  peakMax: number;
  clipCount: number;
  clippedSampleFraction: number;
  sustainedEnergyFraction: number;
}

interface ClapMeasurement {
  occurredAtMs: number;
  rms: number;
  peak: number;
  crestFactor: number;
  sustainedEnergyFraction: number;
}
```

Metrics are finite, bounded numeric aggregates. Raw samples remain scoped to the audio callback, are never returned by a port, never placed in React/controller state, never serialized or logged, and are discarded after that callback.

ROOM, SPEECH, and CLAP keep `MicCapture` muted. Their audio is never base64-encoded, sent through WebSocket, or given to Gemini. Tests must prove the outbound chunk callback remains at zero throughout all three phases.

CLAP reuses the production `ClapWakeDetector`, including `maxSustainedFraction`, but observes detections locally rather than waking Gemini. Three accepted detections must satisfy the detector's refractory period. Sustained speech/tones and detections outside the phase window do not increment the count.

## Audio profile and device identity

Audio and camera calibration remain separate. Audio uses:

```ts
const AUDIO_CALIBRATION_VERSION = 1;
const AUDIO_CALIBRATION_KEY_PREFIX = 'jericho.audio-calibration.v1.';

interface AudioCalibrationProfile {
  schemaVersion: 1;
  micDeviceHash: string; // lowercase 64-character SHA-256 hex
  createdAt: string;
  ambientNoiseFloor: number;
  speechActivationFloor: number;
  clapPeak: number;
  clapRms: number;
  clapCrest: number;
  clapSustainedEnergyLimit: number;
  inputSampleRate: number;
  phaseSampleCounts: {
    room: number;
    speech: number;
    clap: number;
  };
  liveResultId: string;
}
```

The storage key is `jericho.audio-calibration.v1.${micDeviceHash}`. It never overlaps the camera `jericho.calibration.v2.*` namespace and does not change or migrate camera profiles.

After microphone permission, the audio track's selected `deviceId` is hashed through Web Crypto before it leaves the narrow identity adapter. The raw value is never stored, emitted to the DOM, logged, or sent to Core. The current permissioned `MediaDeviceInfo.label` may be displayed during the session but is not persisted in the profile or proposal.

The runtime listens for `devicechange` and compares the active audio track's hash with the approved profile. A mismatch or incompatible schema returns audio wake to uncalibrated defaults and requires a new manual calibration.

The controller holds the candidate and previous profiles in private memory. Only `applyProfile()` in REVIEW may call `commitApproved`. A failed phase, discard, exit, reload before approval, device loss, or cancellation cannot overwrite the previous known-good profile. LIVE_CANARY temporarily activates the candidate; every unsuccessful exit path restores the previous detector thresholds.

## Gesture approval

The existing mission contract remains byte-for-byte compatible. `ActiveApprovalScope`, `approval-decision`, `JERICHO_APPROVAL_GESTURE_EVENT`, and its mission payload do not change.

The held-gesture contract gains a separate semantic target and action:

```ts
type HeldGestureAction =
  | ExistingApprovalDecision
  | { type: 'calibration-decision'; outcome: 'apply' | 'discard' }
  | { type: 'cancel-pending' };

interface HeldGestureInput {
  // existing fields remain
  activeCalibrationDecision?: true;
}

interface HeldGestureProgress {
  target: 'mission' | 'calibration';
  outcome: 'approved' | 'rejected' | 'apply' | 'discard';
  ratio: number; // 0...1
}
```

`HeldGestureInterpreter.update()` retains its existing return type, 700 ms hold, 900 ms debounce, stale-hand rejection, conflicting-hand rejection, and single-fire latch. A new read-only `getProgress(now)` returns progress for rendering without firing an action.

The REVIEW card alone sets `data-jericho-active-calibration-decision="true"`. The runtime uses two separate DOM events:

```ts
const JERICHO_CALIBRATION_DECISION_EVENT =
  'jericho:calibration-decision';
const JERICHO_CALIBRATION_HOLD_PROGRESS_EVENT =
  'jericho:calibration-hold-progress';

interface CalibrationDecisionDetail {
  outcome: 'apply' | 'discard';
}

interface CalibrationHoldProgressDetail {
  outcome: 'apply' | 'discard';
  ratio: number;
}
```

`JarvisRuntime.onFrame` reads the calibration target, dispatches progress while the fresh hold is active, and emits one calibration decision after the hold. The runtime's calibration adapter maps that event to the same `applyProfile()` or `discardProfile()` methods used by DOM commands. It never fabricates mission IDs, plan hashes, versions, approvals, or Core decisions. `sphere-shell.tsx` continues listening only to `JERICHO_APPROVAL_GESTURE_EVENT` and therefore cannot route calibration to `CoreClient.decideMission()`.

Mission approval and calibration REVIEW may not coexist. Starting calibration closes CommandOverlay; if both semantic target attributes nevertheless appear, the interpreter fails closed, fires neither decision, and calibration enters `decision_scope_conflict`.

Held-thumb, pointer, and keyboard paths converge on `applyProfile()` or `discardProfile()`. Voice output and transcription have no path to either method. During calibration, Escape is consumed as `exit()` before the existing runtime-pause or Sphere-navigation handlers run; both-open-palms also calls `exit()` instead of mission cancellation. Hold progress appears on the Sphere/card; reduced motion removes interpolation but preserves an immediate numeric/progress indication.

## Native Sphere projection

The calibration card reuses exported `computeSphereExclusion()` geometry and constants from `KnowledgeProjection`; it does not duplicate fixed viewport offsets.

- Expand the measured Sphere rectangle by 28 px.
- Keep the card at least 24 px inside the stage and 20 px from the Sphere.
- Use a bounded 300–380 px width on wide/medium screens.
- Prefer the side with sufficient measured space; otherwise place one scrollable column below the still-visible Sphere.
- At 390×844 use `min(calc(100vw - 32px), 420px)` beneath the Sphere.
- Re-measure through `ResizeObserver`.
- Respect `prefers-reduced-motion`; no calibration transition or hold-progress animation may be required to understand state.

The card has visible terminal states for phase failure, profile-apply failure, and proposal-submission failure. No action remains indefinitely labelled `WORKING`. Starting guided/natural knowledge projection during calibration does not hide the calibration card. During LIVE_CANARY the calibration card compacts to a status card and participates in the same measured slot allocation as `KnowledgeProjection`; the two components may not independently choose overlapping absolute positions. If all measured cards do not fit around the Sphere, they share one scrollable column below it. The card expands back into REVIEW after correlated narration completes.

## Live-canary correlation contract

`GroundedTurnController` remains the sole backend owner of transcript accumulation, exactly-one spoken capture, private-route classification, retrieval, result persistence, and narration start. The frontend does not read backend getters or duplicate its state machine across the WebSocket boundary.

The bridge adds sanitized correlation milestones derived from the existing `GroundedTurnController` methods/state:

```ts
type GroundedTurnMilestone =
  | 'capture_committed'
  | 'retrieval_started'
  | 'terminal_result_sent';

interface GroundedTurnProgressEvent {
  turnId: string;
  milestone: GroundedTurnMilestone;
  captureId?: string;
  resultId?: string;
}
```

`GroundedTurnController` emits each milestone at most once per turn through an additive progress port. It exposes no transcript or evidence excerpt. Existing public methods and getters (`beginTurn`, `ingestTranscription`, `runPrivateRetrieval`, `noteGroundedOutput`, `groundingState`, `activeResultId`, `groundedOutputSeen`, `hasGreeted`) remain the authoritative server implementation; the calibration frontend observes only the serialized milestones.

`BridgeClient` adds these typed subscriptions without removing existing callbacks:

- greeting phase: `started | complete`;
- grounded-turn progress;
- existing grounded result events;
- grounded narration `started | complete`, correlated to `resultId` after local speaker playback actually starts and drains.

Within one LIVE_CANARY attempt, the controller accepts exactly this ordered chain:

1. One real local `onWake('clap')`.
2. Zero or one greeting-started event and exactly one greeting-complete event. If the browser session already greeted, the existing one-greeting rule is preserved; calibration never forces a second greeting.
3. One `capture_committed` milestone.
4. One `retrieval_started` milestone.
5. One `grounded_result` retrieving phase.
6. One `terminal_result_sent` milestone carrying the same progress `turnId` and `resultId`.
7. One terminal resolved grounded-result event carrying that `resultId`.
8. One correlated narration started/complete cycle after the terminal result.

Duplicate, missing, out-of-order, mismatched, ambiguous, unavailable, or timed-out events fail the phase. The result must resolve Isabella Handel and supported MasterBlox employment evidence. Its summary, relationship field, and supported claims must not assert that Isabella is Carlos's spouse; excluded/conflicting relationship evidence may remain visibly present. The controller records only the opaque result ID, never private excerpts.

This is an acceptance canary around the generic grounded pipeline, not Isabella-specific retrieval or answer logic.

## Fix-proposal API contract

`CREATE FIX PROPOSAL` is available only from terminal FAILED. The controller uses its narrow proposal port to submit a strictly typed diagnostic object:

```http
POST /api/v1/calibration/fix-proposals
Content-Type: application/json
X-Idempotency-Key: <64-character lowercase SHA-256 hex>
Cookie: existing HttpOnly jericho_session
```

The normal `/api/v1/*` authentication guard applies: the existing same-origin browser session cookie or existing bearer token is accepted. No new credential is exposed to JavaScript.

```ts
interface CalibrationFixProposalRequest {
  schemaVersion: 1;
  sessionId: string;          // opaque, 1..128 chars
  buildSha: string;           // 7..40 lowercase hex
  micDeviceHash?: string;     // 64 lowercase hex; absent when permission failed
  failedPhase: ActiveCalibrationPhase | 'review';
  failureReason: CalibrationFailureReason;
  aggregateMetrics: Partial<AudioWindowMetrics>;
  correlatedResultId?: string; // opaque, 1..1024 chars
}

interface CalibrationFixProposalResponse {
  proposalId: string;
  status: 'pending_review';
  createdAt: string;
  replayed: boolean;
}
```

The body is limited to 16 KiB. Every object uses an exact allowlist; unknown keys, non-finite/out-of-range metrics, whitespace-only/oversized strings, arrays, nested arbitrary records, raw audio, transcript, excerpt, path, command, claim, entity ID, repository grant, writable scope, Git instruction, or credential are rejected.

The idempotency key is SHA-256 over canonical JSON of the validated request. The server recomputes it and rejects a mismatched header. It stores the diagnostic through the existing Core proposal store under a deterministic opaque ID as `ProposalKind.DataChange`, `LifecycleStatus.PendingApproval`, `RouteType.HumanApproval`, with no assignment, connector, executable effect, filesystem path, or external action.

Responses are:

- `201` for a newly persisted proposal;
- `200` with the same response and `replayed: true` for an identical replay;
- `400` for schema/forbidden-field/idempotency-hash validation failure;
- `401` for missing authentication;
- `409` if an existing deterministic ID is bound to different validated content;
- `413` above 16 KiB;
- `503` when Core persistence is unavailable.

Authenticated `GET /api/v1/calibration/fix-proposals/:proposalId` returns only the same sanitized proposal response/status, or `404`. It cannot retrieve arbitrary generic proposals.

The endpoint handler depends only on the Core store and clock. It has no `ToolExecutor`, Hermes dispatcher, connector registry, Git/GitHub client, Conductor client, writable vault root, or filesystem callback. Creating or reviewing this proposal does not dispatch Hermes, create a workspace, commit, push, open a PR, modify configuration, or touch the memory vault.

## Authority boundary

The calibration module cannot import `CoreClient`; a dependency-boundary test enforces that it receives only `CalibrationProposalPort`. The proposal endpoint's dependency boundary prevents accidental execution coupling. Repository connectors remain read-only/unset and Jarvis receives no repository credentials.

This is an accidental-capability boundary, not a claim that arbitrary compromised same-origin JavaScript is sandboxed from every authenticated Core endpoint. A future browser capability-token architecture may strengthen that broader threat model; it is not required for proposal-only v1.

Applying calibration writes only the versioned local audio profile. It makes no Core request.

## Verification

### Automated

- Pure calibration math: quiet/noisy rooms, normal/clipped speech, valid claps, speech-like transients, outliers, and deterministic candidate profiles.
- Privacy: raw audio is never retained, serialized, logged, placed in React/controller state, or transmitted during ROOM/SPEECH/CLAP; outbound chunk count remains zero.
- State machine: every transition, deadline, explicit retry, cancellation, reload, device change, profile compatibility check, apply, discard, and previous-profile restoration.
- No-loop contract: fake monotonic timers advance every phase; unit/integration tests perform no real human-duration sleeps, no dummy wake, no Gemini warmup loop, and no automatic retry. Network/Gemini are mocked in automation.
- Gesture grammar: 700 ms thumb-up/down, progress, 900 ms debounce, inactive/conflicting/stale gestures, single-fire behavior, mission backward compatibility, and pointer/keyboard parity.
- Core proposal contract: authentication, canonical idempotency, bounded accepted data, strict forbidden-field rejection, immutable pending status, scoped GET, and proof that no executor/repository/vault capability is invoked.
- Correlation: exact ordered milestone chain, one-greeting compatibility, duplicates, mismatches, missing phases, narration drain, and terminal timeout.
- Browser layout at 1440×900, 1024×768, and 390×844 with normal and reduced motion: Sphere visible, card inside stage, no overlap, no CommandOverlay, and terminal failures visible.
- Synthetic audio may drive deterministic browser tests only when the report labels it synthetic and makes no live-acceptance claim.
- Full shared, bridge, and frontend suites; all typechecks; frontend production build; `git diff --check`.

Automated workers may not run genuine microphone/camera acceptance unattended or wait for human-like input. Any harness that stalls must terminate with an explicit failure instead of polling/restarting phases.

### Genuine local acceptance

After every automated gate passes, run the integrated build from its allocated Conductor port with Carlos present, using the real microphone and camera. Do not inject DOM/controller events and do not use prerecorded or fake audio. The calibration controller performs one attempt per explicit Carlos action and never pre-warms Gemini with a synthetic/dummy wake.

1. Complete ROOM, SPEECH, and CLAP using the actual room, voice, and three claps.
2. Prove normal speech does not produce clap wake.
3. Complete the live canary with exactly one real clap wake, greeting-complete, spoken capture, retrieval, terminal grounded result, and correlated narration.
4. Verify Isabella Handel and MasterBlox are supported by local memory and no unsupported spouse claim is asserted.
5. Apply through a real held thumb-up, reload Jarvis, and prove the device-bound profile persists.
6. Repeat REVIEW with thumb-down and prove the previous profile remains.
7. Exercise one terminal failure, create one Core fix proposal, and prove Hermes remains undispatched.
8. Hash the repository and unified vault before and after; both remain unchanged except for the expected gitignored browser-local profile outside those trees.
9. Capture wide and phone screenshots plus a sanitized calibration report containing phase status, profile version, build SHA, event/result IDs, and no private excerpts.

PR #20 is not product-merge-ready until this genuine local acceptance passes.

## Explicit exclusions

- No direct repository access or credentials for Jarvis.
- No commit, push, pull request, Conductor workspace creation, or Hermes dispatch.
- No automatic calibration on startup; calibration is user-initiated.
- No automatic phase retries, dummy wakes, greeting resets, or human-like unattended loops.
- No raw-audio recording or retention.
- No migration or rewrite of existing camera calibration profiles.
- No special Isabella answer logic; Isabella is only the grounded acceptance canary.
- No fake-WAV, DOM injection, or controller synthesis presented as live acceptance.
