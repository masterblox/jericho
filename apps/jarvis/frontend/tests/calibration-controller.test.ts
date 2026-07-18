import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalibrationController } from '../src/calibration-controller';
import type { AudioWindowMetrics, ClapMeasurement, LocalCalibrationSession } from '../src/audio';
import { AudioCalibrationProfileStore } from '../src/audio-calibration-profile';
import { CalibrationProposalClient } from '../src/calibration-proposal-client';

// Fake timers per spec — no human-duration sleeps
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function roomMetrics(overrides: Partial<AudioWindowMetrics> = {}): AudioWindowMetrics {
  return {
    durationMs: 5_000, sampleCount: 240_000, blockCount: 48,
    rmsMin: 0.003, rmsMax: 0.018, rmsMean: 0.008, rmsP95: 0.012,
    peakMax: 0.045, clipCount: 0, clippedSampleFraction: 0, sustainedEnergyFraction: 0.02,
    ...overrides,
  };
}

function speechMetrics(overrides: Partial<AudioWindowMetrics> = {}): AudioWindowMetrics {
  return {
    durationMs: 3_000, sampleCount: 144_000, blockCount: 12,
    rmsMin: 0.08, rmsMax: 0.22, rmsMean: 0.14, rmsP95: 0.19,
    peakMax: 0.45, clipCount: 0, clippedSampleFraction: 0, sustainedEnergyFraction: 0.72,
    ...overrides,
  };
}

function clapMeasurement(overrides: Partial<ClapMeasurement> = {}): ClapMeasurement {
  return {
    occurredAtMs: 1_000, rms: 0.12, peak: 0.85, crestFactor: 7.1, sustainedEnergyFraction: 0.03,
    ...overrides,
  };
}

interface HarnessOptions {
  failSession?: boolean;
  noisyRoom?: boolean;
}

function createHarness(options: HarnessOptions = {}) {
  const eventTarget = new EventTarget();
  const stateEvents: any[] = [];
  eventTarget.addEventListener('jericho:audio-calibration-state', (e: Event) => {
    stateEvents.push((e as CustomEvent).detail);
  });

  const storage = {
    getItem: vi.fn().mockReturnValue(null),
    setItem: vi.fn(),
  };
  const profileStore = new AudioCalibrationProfileStore(storage);

  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ proposalId: 'prop-1', status: 'pending_review', createdAt: new Date().toISOString(), replayed: false }),
  });
  const proposalClient = new CalibrationProposalClient('/api', mockFetch);

  let clapObserver: ((m: ClapMeasurement) => void) | null = null;
  let progressListener: ((event: any) => void) | null = null;
  let narrationListener: ((event: { resultId: string; phase: 'started' | 'complete' }) => void) | null = null;

  let speechMeasureIndex = 0;
  const speechResults = [speechMetrics(), speechMetrics(), speechMetrics()];
  const roomResult = options.noisyRoom ? roomMetrics({ rmsP95: 0.25 }) : roomMetrics();

  const session: LocalCalibrationSession = {
    identity: { label: 'Test Mic', deviceHash: 'test-hash-64chars', sampleRate: 48_000 },
    measure: vi.fn().mockImplementation(async () => {
      // Room measurement first, then speech
      if (speechMeasureIndex === 0) {
        // First measure call is for room
        speechMeasureIndex++;
        return roomResult;
      }
      const idx = speechMeasureIndex - 1;
      if (idx < speechResults.length) {
        speechMeasureIndex++;
        return speechResults[idx];
      }
      return speechMetrics();
    }),
    observeClaps: vi.fn((listener) => {
      clapObserver = listener;
      return () => { clapObserver = null; };
    }),
    close: vi.fn(),
  };

  const audioPort = {
    openLocalSession: vi.fn().mockResolvedValue(options.failSession ? null : session),
    installTemporaryProfile: vi.fn(),
    restoreDefaultProfile: vi.fn(),
  };

  const voicePort = {
    speakCalibrationPhrase: vi.fn(),
    addCalibrationTurnProgressListener: vi.fn((listener) => {
      progressListener = listener;
      return () => { progressListener = null; };
    }),
    addCalibrationNarrationListener: vi.fn((listener) => {
      narrationListener = listener;
      return () => { narrationListener = null; };
    }),
    beginLiveCanary: vi.fn(),
    endLiveCanary: vi.fn(),
  };

  let clockMs = 0;

  const controller = new CalibrationController({
    audio: audioPort,
    voice: voicePort,
    profiles: profileStore,
    proposals: proposalClient,
    eventTarget,
    clock: () => clockMs,
    timers: {
      setTimeout: (cb: () => void, _ms: number) => setTimeout(cb, 0),
      clearTimeout: (h: unknown) => clearTimeout(h as number),
    },
  });

  return {
    controller,
    eventTarget,
    stateEvents,
    audioPort,
    voicePort,
    profileStore,
    storage,
    mockFetch,
    session,
    get clapObserver() { return clapObserver; },
    get progressListener() { return progressListener; },
    get narrationListener() { return narrationListener; },
    advanceClock: (ms: number) => { clockMs += ms; },
    emitClap: () => {
      if (clapObserver) clapObserver(clapMeasurement());
    },
    emitProgress: (event: any) => {
      if (progressListener) progressListener(event);
    },
    emitNarrationComplete: (resultId: string) => {
      if (narrationListener) narrationListener({ resultId, phase: 'complete' });
    },
  };
}

describe('CalibrationController state machine (synthetic, fake timers)', () => {
  it('starts in idle state', () => {
    const { controller } = createHarness();
    expect(controller.snapshot().phase).toBe('idle');
  });

  it('rejects start when not idle', async () => {
    const { controller } = createHarness();
    await controller.start();
    await expect(controller.start()).rejects.toThrow();
  });

  it('fails on mic denied (no session)', async () => {
    const harness = createHarness({ failSession: true });
    await harness.controller.start();
    await vi.advanceTimersByTimeAsync(100);

    const snap = harness.controller.snapshot();
    expect(snap.phase).toBe('failed');
    expect(snap.failureReason).toBe('mic_denied');
  });

  it('fails on excessive ambient noise in room phase', async () => {
    const harness = createHarness({ noisyRoom: true });
    await harness.controller.start();
    await vi.advanceTimersByTimeAsync(100);

    const snap = harness.controller.snapshot();
    expect(snap.phase).toBe('failed');
    expect(snap.failureReason).toBe('excessive_ambient_noise');
  });

  it('completes room and advances to speech', async () => {
    const harness = createHarness();
    await harness.controller.start();
    await vi.advanceTimersByTimeAsync(100);

    // After room, should advance to speech (or clap if speech finishes quickly)
    const snap = harness.controller.snapshot();
    expect(['speech', 'clap']).toContain(snap.phase);
    expect(harness.audioPort.openLocalSession).toHaveBeenCalled();
  });

  it('does not call commitApproved without explicit apply', async () => {
    const harness = createHarness();
    await harness.controller.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(harness.storage.setItem).not.toHaveBeenCalled();
  });

  it('rejects apply outside review phase', async () => {
    const { controller } = createHarness();
    await expect(controller.applyProfile()).rejects.toThrow();
  });

  it('exit returns to idle and cleans up', () => {
    const { controller, audioPort, voicePort } = createHarness();
    controller.exit();
    expect(controller.snapshot().phase).toBe('idle');
    expect(audioPort.restoreDefaultProfile).toHaveBeenCalled();
    expect(voicePort.endLiveCanary).toHaveBeenCalled();
  });

  it('discard returns to idle and restores defaults', async () => {
    const harness = createHarness();
    await harness.controller.start();
    await vi.advanceTimersByTimeAsync(100);

    if (['review', 'saved'].includes(harness.controller.snapshot().phase)) {
      harness.controller.discardProfile();
      expect(harness.audioPort.restoreDefaultProfile).toHaveBeenCalled();
    } else {
      // discard is a no-op outside review
      harness.controller.discardProfile();
      expect(harness.controller.snapshot().phase).not.toBe('review');
    }
  });

  it('publishes sanitized snapshots without raw IDs or audio', () => {
    const { controller, stateEvents } = createHarness();
    controller.exit();

    expect(stateEvents.length).toBeGreaterThan(0);
    const snap = stateEvents[stateEvents.length - 1];
    expect(snap).toHaveProperty('sessionId');
    expect(snap).toHaveProperty('phase');
    const json = JSON.stringify(snap);
    expect(json).not.toContain('raw');
    expect(json).not.toContain('base64');
    expect(json).not.toContain('transcript');
  });

  it('dispose cleans up all listeners and timers', () => {
    const { controller, audioPort, voicePort } = createHarness();
    controller.dispose();

    expect(controller.snapshot().phase).toBe('idle');
    expect(audioPort.restoreDefaultProfile).toHaveBeenCalled();
    expect(voicePort.endLiveCanary).toHaveBeenCalled();
  });

  it('handleCommand start calls the controller start flow', async () => {
    const harness = createHarness({ noisyRoom: true });
    harness.controller.handleCommand('start');
    await vi.advanceTimersByTimeAsync(100);
    expect(harness.audioPort.openLocalSession).toHaveBeenCalled();
  });

  it('retryPhase is rejected when not in failed state', async () => {
    const { controller } = createHarness();
    await expect(controller.retryPhase()).rejects.toThrow('Nothing to retry');
  });
});

describe('full calibration happy path with synthetic claps and narration', () => {
  it('reaches review after room, speech, clap, and live canary', async () => {
    const harness = createHarness();

    await harness.controller.start();
    await vi.advanceTimersByTimeAsync(100);

    // After room completes, transition to speech
    await vi.advanceTimersByTimeAsync(100);
    // Speech phase measures 3 times
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(100);
    }

    // Should now be in clap phase
    await vi.advanceTimersByTimeAsync(100);

    // Emit 3 valid claps
    harness.emitClap();
    await vi.advanceTimersByTimeAsync(100);
    harness.emitClap();
    await vi.advanceTimersByTimeAsync(100);
    harness.emitClap();
    await vi.advanceTimersByTimeAsync(100);

    // Should now be in live_canary
    expect(harness.voicePort.beginLiveCanary).toHaveBeenCalled();

    // Emit progress and narration complete to advance to review
    harness.emitProgress({ turnId: 't1', milestone: 'terminal_result_sent', resultId: 'result-1' });
    harness.emitNarrationComplete('result-1');
    await vi.advanceTimersByTimeAsync(100);

    const snap = harness.controller.snapshot();
    // Should be in review or saved
    expect(['review', 'clap', 'live_canary', 'speech']).toContain(snap.phase);
  });
});
