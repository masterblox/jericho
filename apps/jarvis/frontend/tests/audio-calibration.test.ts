import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ClapWakeDetector,
  MicCapture,
  type AudioWindowMetrics,
  type AudioMeasurementRequest,
} from '../src/audio';

// Deterministic helpers

function steadyBlock(amplitude: number, length = 256): Float32Array {
  return Float32Array.from({ length }, (_, i) => (i % 2 === 0 ? amplitude : -amplitude));
}

function clapBlock(): Float32Array {
  const block = new Float32Array(256);
  for (let i = 0; i < 8; i++) block[i] = (i % 2 === 0 ? 0.95 : -0.95);
  return block;
}

function speechBlock(amplitude = 0.15, length = 512): Float32Array {
  const block = new Float32Array(length);
  for (let i = 0; i < length; i++) block[i] = Math.sin(i * 0.05) * amplitude;
  return block;
}

function feedBlocks(mic: MicCapture, blocks: Float32Array[]): void {
  for (const block of blocks) {
    (mic as any)._feedAudioBlock(block);
  }
}

class FakeProcessor {
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();

  process(samples: Float32Array): void {
    this.onaudioprocess?.({
      inputBuffer: { getChannelData: () => samples },
    } as unknown as AudioProcessingEvent);
  }
}

function setupFakeMic(onChunk = () => {}, onClap = () => {}): { mic: MicCapture; processor: FakeProcessor; stopTrack: ReturnType<typeof vi.fn> } {
  const processor = new FakeProcessor();
  const stopTrack = vi.fn();
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: stopTrack }, { stop: vi.fn() }],
      }),
    },
  });
  vi.stubGlobal('AudioContext', class {
    sampleRate = 48_000;
    state = 'running';
    destination = {};
    createMediaStreamSource() { return { connect: vi.fn() }; }
    createScriptProcessor() { return processor; }
    createGain() { return { gain: { value: 1 }, connect: vi.fn() }; }
    resume = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
  });

  const mic = new MicCapture(onChunk, onClap);
  // Bind the processor feed method
  (mic as any)._feedAudioBlock = (block: Float32Array) => {
    processor.process(block);
  };

  return { mic, processor, stopTrack };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('aggregate room measurement (synthetic audio)', () => {
  it('aggregates room blocks without producing transport chunks', async () => {
    const onChunk = vi.fn();
    const { mic, processor } = setupFakeMic(onChunk);
    await mic.start();

    const controller = new AbortController();
    const pending = mic.measure({ mode: 'room', durationMs: 5_000, signal: controller.signal });

    processor.process(steadyBlock(0.008));
    processor.process(steadyBlock(0.012));
    processor.process(steadyBlock(0.010));

    mic.completeMeasurement();
    const metrics = await pending;

    expect(metrics.rmsMin).toBeGreaterThanOrEqual(0);
    expect(metrics.rmsMax).toBeGreaterThan(0);
    expect(metrics.rmsMean).toBeGreaterThan(0);
    expect(metrics.peakMax).toBeGreaterThan(0);
    expect(metrics.clipCount).toBe(0);
    expect(metrics.clippedSampleFraction).toBe(0);
    expect(metrics.durationMs).toBe(5_000);
    expect(metrics.blockCount).toBe(3);

    // Verify all values are finite numbers
    for (const [key, value] of Object.entries(metrics)) {
      expect(Number.isFinite(value), `${key} is not finite`).toBe(true);
    }

    // No transport chunks during measurement (muted room phase)
    expect(onChunk).not.toHaveBeenCalled();

    mic.stop();
  });

  it('rejects aborted measurement', async () => {
    const { mic } = setupFakeMic();
    await mic.start();
    const controller = new AbortController();
    controller.abort();

    const pending = mic.measure({ mode: 'room', durationMs: 5_000, signal: controller.signal });
    await expect(pending).rejects.toThrow();

    mic.stop();
  });

  it('detects clipped samples', async () => {
    const { mic, processor } = setupFakeMic();
    await mic.start();

    const controller = new AbortController();
    const pending = mic.measure({ mode: 'speech', durationMs: 3_000, signal: controller.signal });

    // Block at clipping level
    const clipped = new Float32Array(256);
    for (let i = 0; i < 256; i++) clipped[i] = (i % 2 === 0 ? 1.0 : -1.0);
    processor.process(clipped);

    mic.completeMeasurement();
    const metrics = await pending;
    expect(metrics.clipCount).toBeGreaterThan(0);

    mic.stop();
  });

  it('never retains raw sample arrays after aggregation', async () => {
    const { mic, processor } = setupFakeMic();
    await mic.start();

    const controller = new AbortController();
    void mic.measure({ mode: 'room', durationMs: 5_000, signal: controller.signal });

    // Feed blocks through the processor
    const block = new Float32Array([0.1, -0.1, 0.05]);
    processor.process(block);
    // mutate after processing — internal state must have been copied
    block[0] = 999;
    processor.process(new Float32Array([0.02, -0.02]));

    // The internal aggregate should not reference the original block
    const summary = mic.getMeasurementSummary();
    expect(summary.blockCount).toBe(2);
    expect(Number.isFinite(summary.rmsMean)).toBe(true);

    mic.completeMeasurement();
    mic.stop();
  });

  it('handles empty blocks without NaN propagation', async () => {
    const { mic, processor } = setupFakeMic();
    await mic.start();

    const controller = new AbortController();
    const pending = mic.measure({ mode: 'room', durationMs: 5_000, signal: controller.signal });

    processor.process(new Float32Array());
    processor.process(new Float32Array([0.1, 0.2]));
    processor.process(new Float32Array([0, Number.NaN, 1]));

    mic.completeMeasurement();
    const metrics = await pending;
    expect(Number.isFinite(metrics.rmsMean)).toBe(true);
    expect(Number.isFinite(metrics.peakMax)).toBe(true);

    mic.stop();
  });

  it('rejects overlapping measurement windows', async () => {
    const { mic } = setupFakeMic();
    await mic.start();

    const ctrl1 = new AbortController();
    const ctrl2 = new AbortController();

    void mic.measure({ mode: 'room', durationMs: 5_000, signal: ctrl1.signal });
    const second = mic.measure({ mode: 'room', durationMs: 3_000, signal: ctrl2.signal });

    await expect(second).rejects.toThrow('Measurement already in progress');

    mic.completeMeasurement();
    mic.stop();
  });

  it('reports RMS P95 metric', async () => {
    const { mic, processor } = setupFakeMic();
    await mic.start();

    const controller = new AbortController();
    const pending = mic.measure({ mode: 'room', durationMs: 5_000, signal: controller.signal });

    // Feed varied amplitude blocks
    for (let amp = 0.005; amp <= 0.04; amp += 0.005) {
      processor.process(steadyBlock(amp));
    }

    mic.completeMeasurement();
    const metrics = await pending;
    expect(metrics.rmsP95).toBeGreaterThan(0);
    expect(metrics.rmsP95).toBeGreaterThanOrEqual(metrics.rmsMin);
    expect(metrics.rmsP95).toBeLessThanOrEqual(metrics.rmsMax);

    mic.stop();
  });
});

describe('ClapWakeDetector evaluate (synthetic audio)', () => {
  it('evaluates clap metrics without mutating detector state', () => {
    const detector = new ClapWakeDetector();

    // Adapt noise floor first
    for (let i = 0; i < 40; i++) {
      detector.process(steadyBlock(0.012), i * 20);
    }

    const result = detector.evaluate(clapBlock(), 1_000);
    expect(result).toMatchObject({
      detected: expect.any(Boolean),
      measurement: {
        peak: expect.any(Number),
        rms: expect.any(Number),
        crestFactor: expect.any(Number),
        sustainedEnergyFraction: expect.any(Number),
      },
    });

    // All measurement values should be finite
    expect(Number.isFinite(result.measurement.peak)).toBe(true);
    expect(Number.isFinite(result.measurement.rms)).toBe(true);
    expect(Number.isFinite(result.measurement.crestFactor)).toBe(true);
    expect(Number.isFinite(result.measurement.sustainedEnergyFraction)).toBe(true);

    // process() must still work (compatibility wrapper)
    expect(detector.process(clapBlock(), 1_800)).toBe(true);
  });

  it('respects calibrated thresholds via temporary profile', () => {
    const detector = new ClapWakeDetector();
    detector.installTemporaryProfile({
      clapPeakMin: 0.4,
      clapRmsMin: 0.15,
      clapCrestMin: 4.0,
      clapSustainedEnergyLimit: 0.05,
    });

    const modestTransient = new Float32Array(256);
    for (let i = 0; i < 16; i++) modestTransient[i] = (i % 2 === 0 ? 0.3 : -0.3);

    const result = detector.evaluate(modestTransient, 500);
    expect(result.detected).toBe(false);

    // Restore defaults
    detector.restoreProfile(null);
    const resultAfter = detector.evaluate(clapBlock(), 1_000);
    expect(resultAfter.detected).toBe(true);
  });

  it('enforces refractory period for evaluate', () => {
    const detector = new ClapWakeDetector({ refractoryMs: 800 });

    expect(detector.evaluate(clapBlock(), 1_000).detected).toBe(true);
    expect(detector.evaluate(clapBlock(), 1_200).detected).toBe(false);
    expect(detector.evaluate(clapBlock(), 1_900).detected).toBe(true);
  });

  it('rejects speech-like sustained energy', () => {
    const detector = new ClapWakeDetector();
    const block = speechBlock(0.5);

    const result = detector.evaluate(block, 1_000);
    expect(result.detected).toBe(false);
  });

  it('does not classify empty or non-finite blocks', () => {
    const detector = new ClapWakeDetector();

    const empty = detector.evaluate(new Float32Array(), 1_000);
    expect(empty.detected).toBe(false);

    const nan = detector.evaluate(new Float32Array([0, Number.NaN, 1]), 1_100);
    expect(nan.detected).toBe(false);
  });

  it('process is backward compatible with old API', () => {
    const detector = new ClapWakeDetector({ refractoryMs: 800 });

    for (let i = 0; i < 40; i++) {
      detector.process(steadyBlock(0.012), i * 20);
    }

    expect(detector.process(clapBlock(), 1_000)).toBe(true);
    expect(detector.process(clapBlock(), 1_200)).toBe(false);
    expect(detector.process(clapBlock(), 1_800)).toBe(true);

    // Speech should be rejected through process too
    expect(detector.process(speechBlock(0.3), 2_000)).toBe(false);
  });
});

describe('local session ownership', () => {
  it('rejects overlapping local calibration sessions', () => {
    const { mic } = setupFakeMic();
    const session1 = mic.openLocalSession();
    expect(session1).not.toBeNull();

    const session2 = mic.openLocalSession();
    expect(session2).toBeNull();

    session1!.close();
    mic.stop();
  });

  it('closing a session allows a new one', () => {
    const { mic } = setupFakeMic();
    const session1 = mic.openLocalSession();
    expect(session1).not.toBeNull();
    session1!.close();

    const session2 = mic.openLocalSession();
    expect(session2).not.toBeNull();
    session2!.close();
    mic.stop();
  });

  it('closing session resets observers', () => {
    const { mic } = setupFakeMic();
    const session = mic.openLocalSession();
    expect(session).not.toBeNull();

    let clapObserved = false;
    const unsubscribe = session!.observeClaps(() => { clapObserved = true; });
    expect(typeof unsubscribe).toBe('function');

    session!.close();
    expect(mic.openLocalSession()).not.toBeNull();
    expect(clapObserved).toBe(false);
    mic.stop();
  });
});
