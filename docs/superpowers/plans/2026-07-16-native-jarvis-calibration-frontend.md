# Native Jarvis Calibration Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the native, bounded ROOM → SPEECH → CLAP → LIVE_CANARY → REVIEW calibration flow around Jericho's existing single microphone, BridgeClient, gesture runtime, and measured Sphere projection.

**Architecture:** `JarvisRuntime` owns one port-driven `CalibrationController`; `BridgeClient` remains the sole owner of `MicCapture`; React observes sanitized DOM state and emits typed commands. Local phases never encode/transmit audio, candidate profiles remain in memory until explicit confirmation, and calibration decisions use a separate gesture action that cannot reach mission approval.

**Tech Stack:** TypeScript, React 19, Web Audio, MediaDevices, Vitest, Testing Library, Playwright, existing gesture runtime and Sphere projection.

---

**Required base:** the accepted backend tip containing the shared contracts from `2026-07-16-native-jarvis-calibration-backend.md`. Do not create local duplicate shared types.

**Owned paths:**

- `apps/jarvis/frontend/**`
- frontend tests and screenshots

**Prohibited paths and behavior:**

- Do not edit shared, bridge, backend tests, `.env`, lockfiles, live memory, or Conductor files.
- Do not open a second microphone stream.
- Do not import `CoreClient` from any calibration module.
- Do not run real mic/camera/Gemini acceptance, human-duration sleeps, dummy wakes, greeting resets, or automated phase retries.
- Synthetic audio and DOM events are test fixtures only and must be labelled synthetic.

## File structure

- Modify `apps/jarvis/frontend/src/audio.ts`: aggregate-only measurement, detector metrics/profile, and local session hooks while preserving active-turn privacy.
- Create `apps/jarvis/frontend/src/audio-calibration-profile.ts`: profile math, strict serialization, hashing adapter, and approved-profile store.
- Create `apps/jarvis/frontend/src/calibration-events.ts`: typed DOM event constants/parsers.
- Create `apps/jarvis/frontend/src/calibration-controller.ts`: deterministic port-driven state machine and deadlines.
- Create `apps/jarvis/frontend/src/calibration-proposal-client.ts`: single-endpoint proposal port with no CoreClient dependency.
- Modify `apps/jarvis/frontend/src/bridge-client.ts`: calibration audio/voice ports, fixed phrase playback, progress subscriptions, and narration correlation.
- Modify `apps/jarvis/frontend/src/gesture-grammar.ts`, `gesture-events.ts`, and `jarvis-runtime.ts`: separate held decision, progress, command ownership, and cancellation priority.
- Create `apps/jarvis/frontend/src/sphere/NativeCalibrationCard.jsx`: one evolving accessible card.
- Create `apps/jarvis/frontend/src/sphere/projection-geometry.js`: shared measured geometry extracted from KnowledgeProjection.
- Modify `KnowledgeProjection.jsx`, `VoiceCalibrationCard.jsx`, `App.jsx`, `Scene.jsx`, and `scene.css`: native entry, shared slots, no overlay, responsive/reduced-motion presentation.
- Add focused Vitest files and extend `tests/browser/layout.spec.ts`.

### Task 1: Aggregate audio measurement and calibrated clap options

**Files:**

- Modify: `apps/jarvis/frontend/src/audio.ts`
- Create: `apps/jarvis/frontend/tests/audio-calibration.test.ts`
- Modify: `apps/jarvis/frontend/tests/audio-clap.test.ts`

- [ ] **Step 1: Write failing pure-metric tests**

Feed deterministic `Float32Array` blocks and assert exact aggregate properties without retaining sample arrays:

```ts
it('aggregates room blocks without producing transport chunks', async () => {
  const chunks: string[] = [];
  const mic = testMicCapture({ onChunk: (chunk) => chunks.push(chunk) });
  const pending = mic.measure({ mode: 'room', durationMs: 5_000, signal });
  feedBlocks(mic, [quietBlock(0.008), quietBlock(0.012), quietBlock(0.010)]);
  advanceSamplesToDuration(mic, 5_000);
  await expect(pending).resolves.toMatchObject({
    rmsMin: expect.any(Number),
    rmsMax: expect.any(Number),
    peakMax: expect.any(Number),
    clipCount: 0,
  });
  expect(chunks).toEqual([]);
});
```

Cover abort, overlapping windows, stopped/device-lost stream, clipped samples, RMS p95, sustained fraction, empty/non-finite blocks, and raw-sample non-retention. Inspect the returned object recursively and prove it contains numbers only.

- [ ] **Step 2: Write failing detector-metric tests**

Add a non-breaking evaluator:

```ts
const result = detector.evaluate(validClap(), 1_000);
expect(result).toMatchObject({
  detected: true,
  measurement: {
    peak: expect.any(Number),
    rms: expect.any(Number),
    crestFactor: expect.any(Number),
    sustainedEnergyFraction: expect.any(Number),
  },
});
expect(detector.process(validClap(), 1_000)).toBe(true);
```

Keep `process()` as a compatibility wrapper. Test calibrated min peak/RMS/crest/sustained thresholds, refractory timing, speech/tones, and old defaults.

- [ ] **Step 3: Confirm focused failures**

```bash
cd apps/jarvis/frontend
npx vitest run tests/audio-calibration.test.ts tests/audio-clap.test.ts
```

- [ ] **Step 4: Implement constant-memory aggregation**

Store only running counts/sums/min/max, a bounded RMS histogram or fixed-size numeric quantile accumulator, and the active promise callbacks. Never store an input block or copied sample array beyond `onaudioprocess`.

Extend the private muted branch in this order:

1. update smoothed RMS;
2. feed an active aggregate window;
3. evaluate clap metrics and notify local observers;
4. if local calibration is exclusive, return;
5. otherwise invoke ordinary clap wake;
6. never encode while muted.

Add explicit session ownership so only one local measurement session can exist and closing it removes observers and aborts pending windows.

- [ ] **Step 5: Run tests and typecheck**

```bash
cd apps/jarvis/frontend
npx vitest run tests/audio-calibration.test.ts tests/audio-clap.test.ts tests/bridge-client-lifecycle.test.ts
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/jarvis/frontend/src/audio.ts apps/jarvis/frontend/tests/audio-calibration.test.ts apps/jarvis/frontend/tests/audio-clap.test.ts
git commit -m "feat(frontend): measure local calibration audio"
```

### Task 2: Audio profile math, hashing, and approval-only persistence

**Files:**

- Create: `apps/jarvis/frontend/src/audio-calibration-profile.ts`
- Create: `apps/jarvis/frontend/tests/audio-calibration-profile.test.ts`

- [ ] **Step 1: Write failing profile tests**

Test deterministic profile derivation from one room window, three passing speech windows, and three clap measurements. Test strict load rejection, version/key separation from camera calibration, full SHA-256 device hash, device mismatch, and no writes before explicit commit.

Use a spy storage:

```ts
expect(storage.setItem).not.toHaveBeenCalled();
const candidate = deriveAudioCalibrationProfile(input);
expect(storage.setItem).not.toHaveBeenCalled();
store.commitApproved(candidate);
expect(storage.setItem).toHaveBeenCalledTimes(1);
expect(storage.setItem.mock.calls[0][0]).toBe(
  `jericho.audio-calibration.v1.${candidate.micDeviceHash}`,
);
```

- [ ] **Step 2: Confirm failure**

```bash
cd apps/jarvis/frontend
npx vitest run tests/audio-calibration-profile.test.ts
```

- [ ] **Step 3: Implement bounded deterministic math**

Use medians to resist one outlier and clamp every threshold:

```ts
ambientNoiseFloor = clamp(room.rmsP95, 0.001, 0.25);
speechActivationFloor = clamp(
  Math.max(ambientNoiseFloor * 2.2, median(speech.map((m) => m.rmsMean)) * 0.35),
  0.01,
  0.30,
);
clapPeak = clamp(Math.max(ambientNoiseFloor * 5, medianPeak * 0.60), 0.18, 0.98);
clapRms = clamp(Math.max(ambientNoiseFloor * 1.8, medianRms * 0.60), 0.02, 0.50);
clapCrest = clamp(medianCrest * 0.75, 2.5, 10);
clapSustainedEnergyLimit = clamp(medianSustained + 0.03, 0.05, 0.18);
```

Speech passes only when RMS clears the ambient floor, clipping remains below the strict bound, and continuity/sustained energy indicates actual speech rather than silence or a single transient. Keep constants named/exported for tests.

Implement SHA-256 through an injected Web Crypto adapter. The raw `deviceId` must be local to the hashing function and never enter a profile, event, log, DOM detail, or storage key.

- [ ] **Step 4: Implement strict profile storage**

Validate exact keys, schema version, 64-hex hash, ISO timestamp, finite bounded numbers, positive integer sample counts, and non-empty opaque result ID. Reject/trap storage failures; never partially overwrite the prior profile.

- [ ] **Step 5: Run tests and commit**

```bash
cd apps/jarvis/frontend
npx vitest run tests/audio-calibration-profile.test.ts
pnpm typecheck
git add src/audio-calibration-profile.ts tests/audio-calibration-profile.test.ts
git commit -m "feat(frontend): add approved audio profiles"
```

### Task 3: BridgeClient calibration ports and event correlation

**Files:**

- Modify: `apps/jarvis/frontend/src/bridge-client.ts`
- Modify: `apps/jarvis/frontend/tests/bridge-client-lifecycle.test.ts`

- [ ] **Step 1: Write failing one-mic/session tests**

Assert `openLocalSession()` delegates to the existing private mic, never invokes `createMic` twice, forces standby/muted transport, suppresses ordinary clap wake, rejects overlap, and restores ordinary wake after close.

Assert fixed phrase behavior:

- only phrase ID is sent;
- distinct calibration audio plays while standby without arming the mic;
- started/complete/unavailable resolve or reject one promise;
- 8-second phrase timeout terminates once without retry.

- [ ] **Step 2: Write failing correlation subscription tests**

Feed raw WebSocket frames and assert additive subscribers receive validated greeting and `grounded_turn_progress` events. Unknown keys/values are ignored. After one terminal resolved result, the next grounded audio playback publishes exactly one `{resultId, phase:'started'}` and one `complete` only after speaker drain. Greeting/preview/general audio cannot be mislabeled as grounded narration.

- [ ] **Step 3: Confirm failure**

```bash
cd apps/jarvis/frontend
npx vitest run tests/bridge-client-lifecycle.test.ts -t "calibration|grounded narration|turn progress"
```

- [ ] **Step 4: Implement the narrow ports**

Extend `BridgeMicPort` only with aggregate/local-session methods needed by `CalibrationAudioPort`; do not expose raw samples. Let `BridgeClient` implement both `CalibrationAudioPort` and `CalibrationVoicePort`, so `JarvisRuntime` injects the same object twice and no second stream can be created.

Use a subscriber set independent of existing `BridgeEvents`. Parse progress via the shared validator. Maintain one bounded `pendingNarrationResultId`; clear it on completion, standby/error, new terminal result, stop, and dispose.

- [ ] **Step 5: Run related tests and commit**

```bash
cd apps/jarvis/frontend
npx vitest run tests/bridge-client-lifecycle.test.ts tests/interface-sound.test.ts tests/grounded-result-parser.test.ts
pnpm typecheck
git add src/bridge-client.ts tests/bridge-client-lifecycle.test.ts
git commit -m "feat(frontend): expose bounded calibration bridge ports"
```

### Task 4: Deterministic CalibrationController and proposal-only client

**Files:**

- Create: `apps/jarvis/frontend/src/calibration-controller.ts`
- Create: `apps/jarvis/frontend/src/calibration-events.ts`
- Create: `apps/jarvis/frontend/src/calibration-proposal-client.ts`
- Create: `apps/jarvis/frontend/tests/calibration-controller.test.ts`
- Create: `apps/jarvis/frontend/tests/calibration-events.test.ts`
- Create: `apps/jarvis/frontend/tests/calibration-proposal-client.test.ts`

- [ ] **Step 1: Write failing state-machine tests with fake timers**

Cover every legal transition and guard. A representative successful path must assert:

```ts
await controller.start();
await advanceRoom(fakeClock, audio, validRoomMetrics);
await advanceThreeSpeechChecks(fakeClock, voice, audio, validSpeechMetrics);
emitThreeValidClaps(audio);
emitCanaryChain(voice, { resultId: 'result-1' });
expect(controller.snapshot()).toMatchObject({
  phase: 'review',
  completedPhases: ['room', 'speech', 'clap', 'live_canary'],
  liveResultId: 'result-1',
});
expect(profileStore.commitApproved).not.toHaveBeenCalled();
```

Cover each failure code and phase subset, 8s/45s/30s/75s deadlines, explicit retry of only the failed phase, exit/discard/dispose restoration, device loss, malformed/duplicate/out-of-order canary events, one-greeting compatibility, unsupported spouse claim, unavailable/ambiguous result, and storage failure.

Use fake timers exclusively. Assert zero internal calls to `retryPhase`, zero dummy `wake`, zero greeting-reset API, and no scheduled timer beyond the current deadline.

- [ ] **Step 2: Write failing DOM contract tests**

Exact command allowlist, malformed detail rejection, complete sanitized snapshot, no raw device ID/audio/transcript/path/credential, and event listener cleanup after dispose.

- [ ] **Step 3: Write failing proposal-client boundary tests**

Assert only the calibration endpoint exists on the class, request body/header are exact, same-origin credentials are used, timeouts become visible failures, and `CoreClient` is neither imported nor constructible through this module.

- [ ] **Step 4: Confirm failures**

```bash
cd apps/jarvis/frontend
npx vitest run \
  tests/calibration-controller.test.ts \
  tests/calibration-events.test.ts \
  tests/calibration-proposal-client.test.ts
```

- [ ] **Step 5: Implement the minimal state machine**

Use one `AbortController` and one deadline handle per phase. Publish a fresh immutable snapshot after every transition. Do not use polling loops. Speech is exactly three sequential `speakCalibrationPhrase` → playback-complete → 250 ms settle → measurement operations. CLAP advances only from three local observer callbacks. LIVE_CANARY installs the candidate, closes local measurement, subscribes before enabling ordinary wake, and validates the exact eight-step chain.

`applyProfile()` is the sole call site for `commitApproved`. Every other terminal path invokes `restoreProfile(previous)` and unsubscribes/aborts.

- [ ] **Step 6: Run focused tests, boundary grep, and commit**

```bash
cd apps/jarvis/frontend
npx vitest run \
  tests/calibration-controller.test.ts \
  tests/calibration-events.test.ts \
  tests/calibration-proposal-client.test.ts
! rg "CoreClient|decideMission|Hermes|GitHub|Conductor|openVault|fetch\(" \
  src/calibration-controller.ts src/audio-calibration-profile.ts
pnpm typecheck
git add src/calibration-controller.ts src/calibration-events.ts src/calibration-proposal-client.ts tests/calibration-*.test.ts
git commit -m "feat(frontend): add bounded calibration controller"
```

### Task 5: Semantic held decisions and JarvisRuntime ownership

**Files:**

- Modify: `apps/jarvis/frontend/src/gesture-grammar.ts`
- Modify: `apps/jarvis/frontend/src/gesture-events.ts`
- Modify: `apps/jarvis/frontend/src/jarvis-runtime.ts`
- Modify: `apps/jarvis/frontend/tests/gesture-grammar.test.ts`
- Modify: `apps/jarvis/frontend/tests/jarvis-runtime.test.ts`

- [ ] **Step 1: Write failing gesture tests**

Test 699 ms inert / 700 ms single-fire, 900 ms debounce, progress 0..1, thumb up apply, thumb down discard, stale/conflicting hands, no active target, and both mission + calibration targets fail closed. Re-run every existing mission approval fixture unchanged.

- [ ] **Step 2: Write failing runtime integration tests**

Assert:

- runtime constructs/disposes one controller only after engagement;
- DOM start command is rejected before engagement;
- calibration held decisions call controller methods and never dispatch `JERICHO_APPROVAL_GESTURE_EVENT`;
- mission held decisions remain byte-for-byte unchanged;
- Escape and both-open-palms exit calibration before pause/navigation/mission cancellation;
- pause, dispose, devicechange, and page teardown restore the previous detector profile;
- progress event stops immediately when the gesture becomes stale.

- [ ] **Step 3: Implement discriminated action and progress**

Preserve the existing `approval-decision` type and payload. Add only the separate calibration candidate/action. `getProgress(now)` is read-only and cannot latch/fire. Runtime reads `data-jericho-active-calibration-decision="true"`; conflicting semantic targets produce `decision_scope_conflict` and no event.

- [ ] **Step 4: Wire controller ownership and command adapter**

After `BridgeClient.start()`, construct `CalibrationController` with the same bridge as audio/voice ports, approved profile store, narrow proposal client, document event target, monotonic clock, and timers. Add exact listener teardown. Do not route calibration through `sphere-shell.tsx` or `CoreClient`.

- [ ] **Step 5: Run tests and commit**

```bash
cd apps/jarvis/frontend
npx vitest run tests/gesture-grammar.test.ts tests/jarvis-runtime.test.ts tests/action-parity.test.tsx
pnpm typecheck
git add src/gesture-grammar.ts src/gesture-events.ts src/jarvis-runtime.ts tests/gesture-grammar.test.ts tests/jarvis-runtime.test.ts
git commit -m "feat(frontend): confirm calibration with held gestures"
```

### Task 6: Native Sphere calibration card and shared geometry

**Files:**

- Create: `apps/jarvis/frontend/src/sphere/NativeCalibrationCard.jsx`
- Create: `apps/jarvis/frontend/src/sphere/projection-geometry.js`
- Modify: `apps/jarvis/frontend/src/sphere/KnowledgeProjection.jsx`
- Modify: `apps/jarvis/frontend/src/sphere/VoiceCalibrationCard.jsx`
- Modify: `apps/jarvis/frontend/src/sphere/App.jsx`
- Modify: `apps/jarvis/frontend/src/sphere/Scene.jsx`
- Modify: `apps/jarvis/frontend/src/sphere/styles/scene.css`
- Create: `apps/jarvis/frontend/tests/native-calibration-card.test.tsx`
- Modify: `apps/jarvis/frontend/tests/knowledge-projection.test.tsx`
- Modify: `apps/jarvis/frontend/tests/knowledge-projection-scene.test.tsx`
- Modify: `apps/jarvis/frontend/tests/voice-calibration-card.test.tsx`

- [ ] **Step 1: Write failing lifecycle/UI tests**

Assert manual Voice entry shows `CALIBRATE ROOM + MIC`; starting closes CommandOverlay and emits one start command. Render every phase and terminal failure. Assert three phrase statuses, clap pulses/count, compact live-canary state, previous/candidate review, result/proposal IDs, visible deadlines, and terminal action failures.

Pointer click, Enter/Space, and gesture-event fixtures must call the same command actions. Voice/grounded-result events alone must never emit apply/discard.

- [ ] **Step 2: Extract and test shared geometry**

Move `computeSphereExclusion` and reusable constants/placement helpers without changing existing knowledge-card geometry. Add single-card and joint calibration+knowledge allocation tests. No independent absolute coordinates, random transforms, `vmin` offsets, or drag transforms.

- [ ] **Step 3: Implement the evolving card**

Use semantic headings, progress/status text, accessible buttons, live regions that do not repeatedly announce countdown frames, and `data-gesture-target` parity. REVIEW alone sets the calibration decision data attribute. Reduced motion removes interpolation but preserves progress numerically.

During LIVE_CANARY, compact the calibration status card and allocate it together with knowledge cards. On narrow screens, place all projection cards in one scrollable column below the visible Sphere.

- [ ] **Step 4: Add responsive/reduced-motion CSS**

Enforce 28 px expanded exclusion, 24 px stage padding, 20 px separation, 300–380 px wide card, and `min(calc(100vw - 32px), 420px)` narrow card. Ensure calibration is not hidden by existing knowledge-projection selectors.

- [ ] **Step 5: Run focused tests and commit**

```bash
cd apps/jarvis/frontend
npx vitest run \
  tests/native-calibration-card.test.tsx \
  tests/knowledge-projection.test.tsx \
  tests/knowledge-projection-scene.test.tsx \
  tests/voice-calibration-card.test.tsx \
  tests/action-parity.test.tsx
pnpm typecheck
git add src/sphere tests/native-calibration-card.test.tsx tests/knowledge-projection*.test.tsx tests/voice-calibration-card.test.tsx
git commit -m "feat(frontend): render native calibration in the Sphere"
```

### Task 7: Browser geometry and synthetic evidence gate

**Files:**

- Modify: `apps/jarvis/frontend/tests/browser/layout.spec.ts`
- Update: `apps/jarvis/frontend/tests/browser/screenshots/*.png`

- [ ] **Step 1: Add deterministic synthetic calibration fixture**

The browser fixture may dispatch sanitized calibration state events and synthetic audio metrics only. Name the test/report `synthetic calibration layout`; never call it live acceptance.

- [ ] **Step 2: Add hard geometry assertions**

At 1440×900, 1024×768, and 390×844, normal and reduced motion, assert:

- Sphere remains visible;
- calibration card is inside the stage;
- 28 px expanded Sphere exclusion is clear;
- calibration and knowledge cards do not intersect;
- all card pairs have at least 20 px separation in side mode;
- narrow mode uses the shared scroll column below the Sphere;
- CommandOverlay is absent;
- no terminal action remains `WORKING`;
- hold progress remains readable with reduced motion.

Use hard `expect`, never `expect.soft`, and do not scroll a bad layout into passing geometry.

- [ ] **Step 3: Capture six deterministic screenshots**

Update wide/medium/narrow normal and reduced-motion screenshots. Do not create extra stale variants.

- [ ] **Step 4: Run Playwright**

```bash
cd apps/jarvis/frontend
npx playwright test tests/browser/layout.spec.ts --reporter=line
```

Expected: every project/test passes with hard geometry assertions.

- [ ] **Step 5: Commit**

```bash
git add apps/jarvis/frontend/tests/browser/layout.spec.ts apps/jarvis/frontend/tests/browser/screenshots
git commit -m "test(frontend): gate calibration Sphere geometry"
```

### Task 8: Frontend regression gate and delivery

**Files:** No new production files unless a failing regression requires an in-scope correction.

- [ ] **Step 1: Run all focused calibration suites**

```bash
cd apps/jarvis/frontend
npx vitest run \
  tests/audio-calibration.test.ts \
  tests/audio-calibration-profile.test.ts \
  tests/calibration-controller.test.ts \
  tests/calibration-events.test.ts \
  tests/calibration-proposal-client.test.ts \
  tests/bridge-client-lifecycle.test.ts \
  tests/gesture-grammar.test.ts \
  tests/jarvis-runtime.test.ts \
  tests/native-calibration-card.test.tsx \
  tests/action-parity.test.tsx
```

- [ ] **Step 2: Run full frontend verification**

```bash
cd apps/jarvis/frontend
pnpm test
pnpm typecheck
pnpm build
npx playwright test tests/browser/layout.spec.ts --reporter=line
git diff --check <BACKEND_TIP>...
```

- [ ] **Step 3: Prove privacy, no-loop, and scope boundaries**

Use tests plus static inspection to show:

- one `getUserMedia({audio:...})` stream only;
- zero outbound chunk calls during ROOM/SPEECH/CLAP;
- no real sleeps, retry loops, dummy wakes, greeting mutation, or unattended hardware tests;
- only frontend paths differ from `BACKEND_TIP`;
- calibration modules do not import `CoreClient` or executable capabilities.

- [ ] **Step 4: Deliver**

Push the branch and report:

- full backend base and frontend tip SHAs plus ordered commit list;
- changed files;
- exact Vitest and Playwright counts;
- typecheck/build results;
- screenshot paths labelled synthetic;
- explicit statement that no genuine/live acceptance was attempted;
- any integration risks.
