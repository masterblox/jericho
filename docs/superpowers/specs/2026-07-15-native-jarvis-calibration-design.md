# Native Jarvis Calibration Design

## Goal

Jericho calibrates itself inside the native Sphere using Carlos's actual microphone, room, voice, clap, camera, and hands. Automated audio fixtures remain useful for deterministic regression tests, but they never count as live acceptance.

The calibration flow is device-local and reversible. It does not grant Jarvis repository credentials, dispatch Hermes, modify source files, or write to the unified memory vault.

## Product flow

Calibration is a manually opened native Sphere view with one evolving card and these phases:

1. `ROOM` — settle for one second, then measure five seconds of ambient noise.
2. `SPEECH` — present and speak three short phrases; qualify signal-to-noise ratio, clipping, continuity, and usable speech range without claiming local transcription.
3. `CLAP` — collect three real claps, reject sustained speech-like energy, and derive candidate wake thresholds.
4. `LIVE_CANARY` — temporarily apply the candidate profile in memory, require a real clap wake, then ask Carlos to say “Who's Isabella?” through the production microphone → WebSocket → Gemini Live → GroundedTurnController → Sphere path.
5. `REVIEW` — show the selected microphone, previous and candidate profile summaries, passed phases, failure codes, and correlated grounded-result ID.

The Sphere remains visible. The card uses the existing measured exclusion geometry and stacks beneath the Sphere when side placement cannot fit. Calibration never opens CommandOverlay and never renders a modal/dashboard replacement.

Jarvis says, “Calibration is ready. Confirm to apply.” A held thumb-up for 700 ms applies the profile; held thumb-down discards it. Pointer and keyboard controls call the same functions. Voice confirmation alone never applies. Escape or both-open-palms cancellation restores the previous profile.

## Architecture and local profile

A frontend `CalibrationController` owns the deterministic state machine:

`IDLE → ROOM → SPEECH → CLAP → LIVE_CANARY → REVIEW → SAVED`

Each phase may move to a terminal `FAILED` state carrying a bounded reason code and the phase eligible for retry. Retrying repeats only the failed phase when its prerequisites remain valid. Exiting always restores the previously active profile.

`MicCapture` exposes aggregate measurement windows to the controller while retaining raw samples only for the duration of the audio callback. ROOM, SPEECH, and CLAP never encode or transmit audio. The final live canary uses the existing active-turn transport gate.

The candidate profile is versioned and bound to a privacy-preserving hash of the selected `MediaDeviceInfo.deviceId`. Store it under a versioned local key; never persist the raw device ID. A microphone change or incompatible profile version returns Jarvis to the uncalibrated state.

The profile contains only bounded numeric thresholds and provenance metadata needed to explain it: ambient noise floor, speech activation floor, clap peak/RMS/crest/sustained-energy limits, input sample rate, creation time, phase sample counts, and the successful live result ID. It contains no audio, transcript, private excerpt, filesystem path, repository instruction, or credential.

Candidate thresholds are active only in memory until REVIEW approval. A failed phase, discard, reload before approval, or cancellation cannot overwrite the previous known-good profile.

## Gesture approval

Reuse the existing 700 ms held-thumb interpreter and 900 ms debounce, but generalize its active target from mission-only approval to a discriminated semantic decision target. Existing mission approval behavior and payloads remain backward compatible.

Calibration exposes a local decision target only while REVIEW is visible. Thumb-up maps to `apply`; thumb-down maps to `discard`. Without an active decision target, held thumbs remain inert. Conflicting hands, stale tracking, insufficient hold duration, and repeated held frames cannot fire a decision.

The Sphere renders visible hold progress and the selected outcome. Calibration must not fabricate mission IDs, plan hashes, approvals, or Core decisions.

## Live-canary correlation

The final canary observes the existing production events and succeeds only when one calibration session correlates all of the following in order:

- clap wake;
- one Gemini greeting and greeting completion;
- one final spoken capture containing the prompted question;
- one grounded retrieval;
- one terminal grounded result;
- narration for that result.

The grounded result must resolve Isabella Handel and supported MasterBlox employment evidence, must not assert an unsupported Carlos-spouse relationship, and must expose its real result ID. Missing, duplicate, mismatched, unavailable, or timed-out events fail the phase. Calibration metadata may observe the result; it may not create, modify, or synthesize it.

## Failure handling and fix proposals

Microphone permission denial, device loss, excessive ambient noise, clipping, insufficient speech energy, invalid claps, Gemini connection failure, memory unavailability, event duplication, and phase timeout become visible terminal states with `RETRY PHASE` and `EXIT`. No failure may remain indefinitely in `WORKING`.

`CREATE FIX PROPOSAL` is available only after a terminal failure. It submits a strictly bounded diagnostic report to an authenticated Core endpoint. The report may contain schema/profile versions, session ID, build SHA, hashed device ID, failed phase, enumerated reason codes, aggregate numeric metrics, and an optional correlated result ID.

Core rejects raw audio, transcripts, private excerpts, arbitrary prose, filesystem paths, commands, claims, entity IDs, repository grants, writable scopes, Git instructions, and unknown or oversized fields. It persists one immutable pending human-review proposal and returns its opaque ID. Replays are idempotent.

Creating the proposal does not dispatch Hermes, create a workspace, commit, push, open a PR, modify configuration, or touch the memory vault. Repository remediation remains a separate future approval flow.

## Verification

### Automated

- Pure calibration math: quiet/noisy rooms, normal/clipped speech, valid claps, speech-like transients, outliers, and deterministic candidate profiles.
- Privacy: raw audio is never retained, serialized, logged, placed in React state, or transmitted during local phases.
- State machine: every transition, retry, timeout, cancellation, reload, device change, profile compatibility check, apply, discard, and previous-profile restoration.
- Gesture grammar: 700 ms thumb-up/down, 900 ms debounce, inactive/conflicting/stale gestures, single-fire behavior, mission backward compatibility, and pointer/keyboard parity.
- Core proposal contract: authentication, idempotency, bounded accepted data, strict forbidden-field rejection, immutable pending status, and proof that no executor or repository capability is invoked.
- Browser layout at 1440×900, 1024×768, and 390×844 with normal and reduced motion: Sphere visible, card inside stage, no overlap, no CommandOverlay, and terminal failures visible.
- Synthetic audio may drive deterministic browser tests only when the report labels it synthetic and makes no live-acceptance claim.
- Full shared, bridge, and frontend suites; all typechecks; frontend production build; `git diff --check`.

### Genuine local acceptance

Run the integrated build from its allocated Conductor port with the real microphone and camera. Do not inject DOM/controller events and do not use prerecorded or fake audio.

1. Complete ROOM, SPEECH, and CLAP using the actual room, voice, and three claps.
2. Prove normal speech does not produce clap wake.
3. Complete the live canary with exactly one clap wake, greeting, spoken capture, retrieval, terminal grounded result, and narration.
4. Verify Isabella Handel and MasterBlox are supported by local memory and no unsupported spouse claim is asserted.
5. Apply through a real held thumb-up, reload Jarvis, and prove the device-bound profile persists.
6. Repeat REVIEW with thumb-down and prove the previous profile remains.
7. Exercise a terminal failure, create one Core fix proposal, and prove Hermes remains undispatched.
8. Hash the repository and unified vault before and after; both remain unchanged.
9. Capture wide and phone screenshots plus a sanitized calibration report containing phase status, profile version, build SHA, event/result IDs, and no private excerpts.

PR #20 is not product-merge-ready until this genuine local acceptance passes.

## Explicit exclusions

- No direct repository access or credentials for Jarvis.
- No commit, push, pull request, Conductor workspace creation, or Hermes dispatch.
- No automatic calibration on startup; calibration is user-initiated.
- No raw-audio recording or retention.
- No special Isabella answer logic; Isabella is only the grounded acceptance canary.
- No fake-WAV evidence presented as live acceptance.
