import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroundedTurnProgressEvent } from '@jericho/shared';
import type { AudioWindowMetrics, ClapMeasurement, LocalCalibrationSession } from '../src/audio';
import {
  AUDIO_CALIBRATION_KEY_PREFIX,
  AudioCalibrationProfileStore,
  type AudioCalibrationProfile,
} from '../src/audio-calibration-profile';
import {
  CalibrationController,
  type CalibrationControllerOptions,
} from '../src/calibration-controller';
import type {
  CalibrationGreetingPhase,
  CalibrationNarrationEvent,
  GroundedResultPayload,
} from '../src/bridge-client';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const DEVICE_HASH = 'a'.repeat(64);

function roomMetrics(overrides: Partial<AudioWindowMetrics> = {}): AudioWindowMetrics {
  return {
    durationMs: 5_000,
    sampleCount: 240_000,
    blockCount: 48,
    rmsMin: 0.003,
    rmsMax: 0.018,
    rmsMean: 0.008,
    rmsP95: 0.012,
    peakMax: 0.045,
    clipCount: 0,
    clippedSampleFraction: 0,
    sustainedEnergyFraction: 0.02,
    ...overrides,
  };
}

function speechMetrics(overrides: Partial<AudioWindowMetrics> = {}): AudioWindowMetrics {
  return {
    durationMs: 3_000,
    sampleCount: 144_000,
    blockCount: 36,
    rmsMin: 0.08,
    rmsMax: 0.22,
    rmsMean: 0.14,
    rmsP95: 0.19,
    peakMax: 0.45,
    clipCount: 0,
    clippedSampleFraction: 0,
    sustainedEnergyFraction: 0.72,
    ...overrides,
  };
}

function clapMeasurement(index = 0, overrides: Partial<ClapMeasurement> = {}): ClapMeasurement {
  return {
    occurredAtMs: 1_000 + index * 900,
    rms: 0.12,
    peak: 0.85,
    crestFactor: 7.1,
    sustainedEnergyFraction: 0.03,
    ...overrides,
  };
}

function previousProfile(): AudioCalibrationProfile {
  return {
    schemaVersion: 1,
    micDeviceHash: DEVICE_HASH,
    createdAt: '2026-07-18T00:00:00.000Z',
    ambientNoiseFloor: 0.01,
    speechActivationFloor: 0.04,
    clapPeak: 0.55,
    clapRms: 0.08,
    clapCrest: 4,
    clapSustainedEnergyLimit: 0.10,
    inputSampleRate: 48_000,
    phaseSampleCounts: { room: 1, speech: 3, clap: 3 },
    liveResultId: 'previous-result',
  };
}

function grounded(
  phase: GroundedResultPayload['phase'],
  overrides: Partial<GroundedResultPayload> = {},
): GroundedResultPayload {
  return {
    schemaVersion: 2,
    resultId: 'result-1',
    phase,
    route: 'private_knowledge',
    subject: phase === 'retrieving' ? 'Isabella' : 'Isabella Handel',
    confidence: phase === 'resolved' ? 'strong' : phase === 'retrieving' ? 'partial' : 'none',
    canonicalIdentity: phase === 'resolved' ? 'Isabella Handel' : undefined,
    fullName: phase === 'resolved' ? 'Isabella Handel' : undefined,
    employment: phase === 'resolved' ? ['MasterBlox'] : undefined,
    summary: phase === 'resolved' ? 'Isabella Handel works at MasterBlox.' : undefined,
    claims: phase === 'resolved'
      ? [{ id: 'claim-1', text: 'Works at MasterBlox', supportSourceIds: ['source-1'] }]
      : undefined,
    provenance: [],
    actions: {},
    retrievalCount: phase === 'retrieving' ? 0 : 1,
    ...overrides,
  };
}

interface HarnessOptions {
  openSession?: boolean;
  roomResults?: AudioWindowMetrics[];
  speechResults?: AudioWindowMetrics[];
  measurementNeverResolves?: boolean;
  phraseFailureAt?: number;
  storedPreviousProfile?: boolean;
}

function createHarness(options: HarnessOptions = {}) {
  const eventTarget = new EventTarget();
  const stateEvents: unknown[] = [];
  eventTarget.addEventListener('jericho:audio-calibration-state', (event) => {
    stateEvents.push((event as CustomEvent).detail);
  });

  const stored = options.storedPreviousProfile ? JSON.stringify(previousProfile()) : null;
  const storage = {
    getItem: vi.fn((key: string) => key === `${AUDIO_CALIBRATION_KEY_PREFIX}${DEVICE_HASH}` ? stored : null),
    setItem: vi.fn(),
  };
  const profiles = new AudioCalibrationProfileStore(storage);
  const proposals = {
    submitCalibrationFixProposal: vi.fn().mockResolvedValue({
      proposalId: 'proposal-1',
      status: 'pending_review' as const,
      createdAt: '2026-07-18T00:00:00.000Z',
      replayed: false,
    }),
  };

  let clapListener: ((measurement: ClapMeasurement) => void) | null = null;
  let wakeListener: ((source: 'clap' | 'manual') => void) | null = null;
  let greetingListener: ((phase: CalibrationGreetingPhase) => void) | null = null;
  let progressListener: ((event: GroundedTurnProgressEvent) => void) | null = null;
  let resultListener: ((event: GroundedResultPayload) => void) | null = null;
  let narrationListener: ((event: CalibrationNarrationEvent) => void) | null = null;
  let measureIndex = 0;
  let phraseIndex = 0;
  const roomResults = options.roomResults ?? [roomMetrics()];
  const speechResults = options.speechResults ?? [speechMetrics(), speechMetrics(), speechMetrics()];

  const session: LocalCalibrationSession = {
    identity: { label: 'Studio Microphone', deviceHash: DEVICE_HASH, sampleRate: 48_000 },
    measure: vi.fn(({ mode, signal }) => {
      if (options.measurementNeverResolves) {
        return new Promise<AudioWindowMetrics>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        });
      }
      const result = mode === 'room'
        ? (roomResults.shift() ?? roomMetrics())
        : (speechResults[measureIndex++] ?? speechMetrics());
      return Promise.resolve(result);
    }),
    observeClaps: vi.fn((listener) => {
      clapListener = listener;
      return () => { clapListener = null; };
    }),
    observeLevel: vi.fn(() => () => undefined),
    close: vi.fn(),
  };

  const audio = {
    openLocalSession: vi.fn().mockImplementation(async () => options.openSession === false ? null : session),
    installTemporaryProfile: vi.fn(),
    restoreProfile: vi.fn(),
  };
  const voice = {
    speakCalibrationPhrase: vi.fn(async () => {
      phraseIndex += 1;
      if (options.phraseFailureAt === phraseIndex) throw new Error('speaker unavailable');
    }),
    cancelCalibrationPhrase: vi.fn(),
    addCalibrationWakeListener: vi.fn((listener) => {
      wakeListener = listener;
      return () => { wakeListener = null; };
    }),
    addCalibrationGreetingListener: vi.fn((listener) => {
      greetingListener = listener;
      return () => { greetingListener = null; };
    }),
    addCalibrationTurnProgressListener: vi.fn((listener) => {
      progressListener = listener;
      return () => { progressListener = null; };
    }),
    addCalibrationGroundedResultListener: vi.fn((listener) => {
      resultListener = listener;
      return () => { resultListener = null; };
    }),
    addCalibrationNarrationListener: vi.fn((listener) => {
      narrationListener = listener;
      return () => { narrationListener = null; };
    }),
    beginLiveCanary: vi.fn(),
    endLiveCanary: vi.fn(),
  };

  const controllerOptions: CalibrationControllerOptions = {
    audio,
    voice,
    profiles,
    proposals,
    eventTarget,
    clock: () => performance.now(),
    wallClock: () => new Date('2026-07-18T12:00:00.000Z'),
    buildSha: 'abcdef0',
    timers: {
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
  };
  const controller = new CalibrationController(controllerOptions);

  return {
    controller,
    eventTarget,
    stateEvents,
    storage,
    profiles,
    proposals,
    session,
    audio,
    voice,
    emitClap(measurement = clapMeasurement()) { clapListener?.(measurement); },
    emitWake(source: 'clap' | 'manual') { wakeListener?.(source); },
    emitGreeting(phase: CalibrationGreetingPhase) { greetingListener?.(phase); },
    emitProgress(event: GroundedTurnProgressEvent) { progressListener?.(event); },
    emitResult(event: GroundedResultPayload) { resultListener?.(event); },
    emitNarration(event: CalibrationNarrationEvent) { narrationListener?.(event); },
  };
}

type Harness = ReturnType<typeof createHarness>;

async function advanceToClap(harness: Harness): Promise<void> {
  await harness.controller.start();
  await vi.advanceTimersByTimeAsync(1_000);
  for (let i = 0; i < 3; i += 1) await vi.advanceTimersByTimeAsync(250);
  expect(harness.controller.snapshot().phase).toBe('clap');
}

async function advanceToLiveCanary(harness: Harness): Promise<void> {
  await advanceToClap(harness);
  harness.emitClap(clapMeasurement(0));
  harness.emitClap(clapMeasurement(1));
  harness.emitClap(clapMeasurement(2));
  expect(harness.controller.snapshot().phase).toBe('live_canary');
  expect(harness.voice.beginLiveCanary).toHaveBeenCalledTimes(1);
}

function emitSuccessfulCanary(harness: Harness, includeGreetingStarted = true): void {
  harness.emitWake('clap');
  if (includeGreetingStarted) harness.emitGreeting('started');
  harness.emitGreeting('complete');
  harness.emitProgress({ turnId: 'turn-1', milestone: 'capture_committed', captureId: 'capture-1' });
  harness.emitProgress({ turnId: 'turn-1', milestone: 'retrieval_started', resultId: 'result-1' });
  harness.emitResult(grounded('retrieving'));
  harness.emitProgress({ turnId: 'turn-1', milestone: 'terminal_result_sent', resultId: 'result-1' });
  harness.emitResult(grounded('resolved'));
  harness.emitNarration({ resultId: 'result-1', phase: 'started' });
  harness.emitNarration({ resultId: 'result-1', phase: 'complete' });
}

describe('CalibrationController bounded phase flow', () => {
  it('starts idle and rejects concurrent starts', async () => {
    const harness = createHarness();
    expect(harness.controller.snapshot().phase).toBe('idle');
    await harness.controller.start();
    await expect(harness.controller.start()).rejects.toThrow('already in progress');
  });

  it('uses the real 1s settle and exactly three sequential phrase checks', async () => {
    const harness = createHarness();
    const started = harness.controller.start();
    await started;
    expect(harness.session.measure).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(999);
    expect(harness.session.measure).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.session.measure).toHaveBeenCalledWith(expect.objectContaining({ mode: 'room', durationMs: 5_000 }));
    for (let i = 0; i < 3; i += 1) await vi.advanceTimersByTimeAsync(250);
    expect(harness.voice.speakCalibrationPhrase.mock.calls.map(([id]) => id)).toEqual([
      'voice_range_1', 'voice_range_2', 'voice_range_3',
    ]);
    expect(harness.controller.snapshot()).toMatchObject({
      phase: 'clap',
      completedPhases: ['room', 'speech'],
      speechChecks: [
        { phraseId: 'voice_range_1', passed: true },
        { phraseId: 'voice_range_2', passed: true },
        { phraseId: 'voice_range_3', passed: true },
      ],
    });
  });

  it('fails visibly on denied microphone, noisy room, speaker failure, and clipping', async () => {
    const denied = createHarness({ openSession: false });
    await denied.controller.start();
    await vi.runAllTicks();
    expect(denied.controller.snapshot()).toMatchObject({ phase: 'failed', failedPhase: 'room', failureReason: 'mic_denied' });

    const noisy = createHarness({ roomResults: [roomMetrics({ rmsP95: 0.21, rmsMax: 0.22, peakMax: 0.25 })] });
    await noisy.controller.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(noisy.controller.snapshot()).toMatchObject({ phase: 'failed', failureReason: 'excessive_ambient_noise' });

    const speaker = createHarness({ phraseFailureAt: 1 });
    await speaker.controller.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(speaker.controller.snapshot()).toMatchObject({ phase: 'failed', failedPhase: 'speech', failureReason: 'speaker_unavailable' });

    const clipped = createHarness({ speechResults: [speechMetrics({ clippedSampleFraction: 0.02, clipCount: 100 })] });
    await clipped.controller.start();
    await vi.advanceTimersByTimeAsync(1_250);
    expect(clipped.controller.snapshot()).toMatchObject({ phase: 'failed', failureReason: 'clipping' });
  });

  it('uses one hard room deadline and never retries automatically', async () => {
    const harness = createHarness({ measurementNeverResolves: true });
    const retrySpy = vi.spyOn(harness.controller, 'retryPhase');
    await harness.controller.start();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(harness.controller.snapshot()).toMatchObject({
      phase: 'failed', failedPhase: 'room', failureReason: 'phase_timeout',
    });
    expect(retrySpy).not.toHaveBeenCalled();
    expect(harness.audio.openLocalSession).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries only after an explicit command', async () => {
    const harness = createHarness({
      roomResults: [roomMetrics({ rmsP95: 0.21, rmsMax: 0.22, peakMax: 0.25 }), roomMetrics()],
    });
    await harness.controller.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.controller.snapshot().phase).toBe('failed');
    expect(harness.audio.openLocalSession).toHaveBeenCalledTimes(1);
    await harness.controller.retryPhase();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.controller.snapshot().phase).toBe('speech');
    expect(harness.audio.openLocalSession).toHaveBeenCalledTimes(2);
  });

  it('rejects a speech-like clap and restores the previous detector profile', async () => {
    const harness = createHarness({ storedPreviousProfile: true });
    await advanceToClap(harness);
    harness.emitClap(clapMeasurement(0, { sustainedEnergyFraction: 0.40 }));
    expect(harness.controller.snapshot()).toMatchObject({ phase: 'failed', failureReason: 'invalid_clap' });
    expect(harness.audio.restoreProfile).toHaveBeenLastCalledWith(expect.objectContaining({
      clapPeakMin: 0.55,
      clapSustainedEnergyLimit: 0.10,
    }));
  });
});

describe('CalibrationController genuine-path correlation contract', () => {
  it('reaches stable review only after the exact correlated chain', async () => {
    const harness = createHarness();
    await advanceToLiveCanary(harness);
    expect(harness.audio.installTemporaryProfile).toHaveBeenCalledWith(expect.objectContaining({
      clapPeakMin: expect.any(Number),
      clapSustainedEnergyLimit: expect.any(Number),
    }));
    expect(harness.storage.setItem).not.toHaveBeenCalled();

    emitSuccessfulCanary(harness);
    expect(harness.controller.snapshot()).toMatchObject({
      phase: 'review',
      completedPhases: ['room', 'speech', 'clap', 'live_canary'],
      liveResultId: 'result-1',
      candidateProfile: { schemaVersion: 1, liveResultId: 'result-1' },
      actionState: 'idle',
    });
    expect(harness.storage.setItem).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves one-greeting compatibility when started is absent', async () => {
    const harness = createHarness();
    await advanceToLiveCanary(harness);
    emitSuccessfulCanary(harness, false);
    expect(harness.controller.snapshot().phase).toBe('review');
  });

  it('fails closed on manual wake, duplicates, order mismatches, and ID mismatches', async () => {
    const manual = createHarness();
    await advanceToLiveCanary(manual);
    manual.emitWake('manual');
    expect(manual.controller.snapshot()).toMatchObject({ phase: 'failed', failureReason: 'event_mismatch' });

    const duplicate = createHarness();
    await advanceToLiveCanary(duplicate);
    duplicate.emitWake('clap');
    duplicate.emitWake('clap');
    expect(duplicate.controller.snapshot()).toMatchObject({ phase: 'failed', failureReason: 'event_duplication' });

    const order = createHarness();
    await advanceToLiveCanary(order);
    order.emitWake('clap');
    order.emitGreeting('complete');
    order.emitProgress({ turnId: 'turn-1', milestone: 'retrieval_started', resultId: 'result-1' });
    expect(order.controller.snapshot()).toMatchObject({ phase: 'failed', failureReason: 'event_mismatch' });

    const mismatch = createHarness();
    await advanceToLiveCanary(mismatch);
    mismatch.emitWake('clap');
    mismatch.emitGreeting('complete');
    mismatch.emitProgress({ turnId: 'turn-1', milestone: 'capture_committed', captureId: 'capture-1' });
    mismatch.emitProgress({ turnId: 'turn-2', milestone: 'retrieval_started', resultId: 'result-1' });
    expect(mismatch.controller.snapshot()).toMatchObject({ phase: 'failed', failureReason: 'event_mismatch' });
  });

  it('rejects unavailable memory and unsupported spouse assertions', async () => {
    const unavailable = createHarness();
    await advanceToLiveCanary(unavailable);
    unavailable.emitWake('clap');
    unavailable.emitGreeting('complete');
    unavailable.emitProgress({ turnId: 'turn-1', milestone: 'capture_committed', captureId: 'capture-1' });
    unavailable.emitProgress({ turnId: 'turn-1', milestone: 'retrieval_started', resultId: 'result-1' });
    unavailable.emitResult(grounded('unavailable'));
    expect(unavailable.controller.snapshot()).toMatchObject({ phase: 'failed', failureReason: 'memory_unavailable' });

    const spouse = createHarness();
    await advanceToLiveCanary(spouse);
    spouse.emitWake('clap');
    spouse.emitGreeting('complete');
    spouse.emitProgress({ turnId: 'turn-1', milestone: 'capture_committed', captureId: 'capture-1' });
    spouse.emitProgress({ turnId: 'turn-1', milestone: 'retrieval_started', resultId: 'result-1' });
    spouse.emitResult(grounded('retrieving'));
    spouse.emitProgress({ turnId: 'turn-1', milestone: 'terminal_result_sent', resultId: 'result-1' });
    spouse.emitResult(grounded('resolved', { relationship: "Isabella is Carlos Prada's wife." }));
    expect(spouse.controller.snapshot()).toMatchObject({ phase: 'failed', failureReason: 'memory_unavailable' });
  });
});

describe('CalibrationController review authority and cleanup', () => {
  it('restores the device-bound approved detector profile on reload without starting calibration', async () => {
    const harness = createHarness({ storedPreviousProfile: true });
    await harness.controller.loadApprovedProfile();
    expect(harness.controller.snapshot().phase).toBe('idle');
    expect(harness.audio.restoreProfile).toHaveBeenCalledWith(expect.objectContaining({
      clapPeakMin: 0.55,
      clapRmsMin: 0.08,
      clapCrestMin: 4,
    }));
    expect(harness.session.close).toHaveBeenCalledTimes(1);
    expect(harness.storage.setItem).not.toHaveBeenCalled();
  });

  it('persists only after explicit apply', async () => {
    const harness = createHarness();
    await advanceToLiveCanary(harness);
    emitSuccessfulCanary(harness);
    expect(harness.storage.setItem).not.toHaveBeenCalled();
    await harness.controller.applyProfile();
    expect(harness.controller.snapshot()).toMatchObject({ phase: 'saved', actionState: 'succeeded' });
    expect(harness.storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('discard, exit, and dispose restore the prior profile without persistence', async () => {
    const discarded = createHarness({ storedPreviousProfile: true });
    await advanceToLiveCanary(discarded);
    emitSuccessfulCanary(discarded);
    discarded.controller.discardProfile();
    expect(discarded.controller.snapshot().phase).toBe('idle');
    expect(discarded.storage.setItem).not.toHaveBeenCalled();
    expect(discarded.audio.restoreProfile).toHaveBeenLastCalledWith(expect.objectContaining({ clapPeakMin: 0.55 }));

    const exited = createHarness();
    await advanceToLiveCanary(exited);
    exited.controller.exit();
    expect(exited.controller.snapshot().phase).toBe('idle');
    expect(exited.voice.endLiveCanary).toHaveBeenCalled();

    const disposed = createHarness();
    await advanceToClap(disposed);
    disposed.controller.dispose();
    expect(disposed.controller.snapshot().phase).toBe('idle');
    expect(disposed.session.close).toHaveBeenCalled();
  });

  it('surfaces profile-write and decision-scope failures without calling Core', async () => {
    const harness = createHarness();
    await advanceToLiveCanary(harness);
    emitSuccessfulCanary(harness);
    harness.storage.setItem.mockImplementationOnce(() => { throw new Error('quota'); });
    await harness.controller.applyProfile();
    expect(harness.controller.snapshot()).toMatchObject({
      phase: 'review', actionState: 'failed', failureReason: 'profile_write_failed',
    });
    harness.controller.reportDecisionScopeConflict();
    expect(harness.controller.snapshot()).toMatchObject({
      phase: 'review', actionState: 'failed', failureReason: 'decision_scope_conflict',
    });
    expect(harness.proposals.submitCalibrationFixProposal).not.toHaveBeenCalled();
  });

  it('creates an inert idempotent diagnostic only from failed state', async () => {
    const harness = createHarness({
      roomResults: [roomMetrics({ rmsP95: 0.21, rmsMax: 0.22, peakMax: 0.25 })],
    });
    await harness.controller.start();
    await vi.advanceTimersByTimeAsync(1_000);
    await harness.controller.createFixProposal();
    expect(harness.proposals.submitCalibrationFixProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: 1,
        failedPhase: 'room',
        failureReason: 'excessive_ambient_noise',
        micDeviceHash: DEVICE_HASH,
        aggregateMetrics: expect.objectContaining({ rmsP95: 0.21 }),
      }),
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(harness.controller.snapshot()).toMatchObject({ proposalId: 'proposal-1', actionState: 'succeeded' });
    expect(harness.storage.setItem).not.toHaveBeenCalled();
  });

  it('publishes only sanitized aggregate state', async () => {
    const harness = createHarness();
    await advanceToClap(harness);
    const serialized = JSON.stringify(harness.stateEvents);
    expect(serialized).toContain('Studio Microphone');
    expect(serialized).not.toContain(DEVICE_HASH);
    expect(serialized).not.toMatch(/deviceId|raw|base64|transcript|excerpt|credential|sourcePath/);
  });
});
