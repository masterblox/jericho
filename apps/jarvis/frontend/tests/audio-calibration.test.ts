import { afterEach, describe, expect, it, vi } from 'vitest';

import { MicCapture, type ClapMeasurement } from '../src/audio';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MicCapture local calibration session', () => {
  it('reports only the display label and hashed device identity', async () => {
    const digest = vi.fn().mockResolvedValue('a'.repeat(64));
    const harness = createMicHarness({ digest, deviceId: 'raw-usb-mic-9', label: 'USB Mic' });
    await harness.mic.start();

    const session = await harness.mic.openLocalSession();

    expect(digest).toHaveBeenCalledTimes(1);
    expect(digest).toHaveBeenCalledWith('raw-usb-mic-9');
    expect(session.identity).toEqual({
      label: 'USB Mic',
      deviceHash: 'a'.repeat(64),
      sampleRate: 48_000,
    });
    expect(JSON.stringify(session.identity)).not.toContain('raw-usb-mic-9');
    session.close();
  });

  it('requires a live stream and permits only one open local session', async () => {
    const harness = createMicHarness();
    await expect(harness.mic.openLocalSession()).rejects.toThrow(/unavailable/);

    await harness.mic.start();
    const session = await harness.mic.openLocalSession();
    await expect(harness.mic.openLocalSession()).rejects.toThrow(/session/);
    session.close();

    const next = await harness.mic.openLocalSession();
    next.close();
  });

  it('aggregates room blocks without producing transport chunks', async () => {
    const harness = createMicHarness();
    await harness.mic.start();
    const session = await harness.mic.openLocalSession();
    const controller = new AbortController();

    const pending = session.measure({ mode: 'room', durationMs: 1_000, signal: controller.signal });
    // 48 samples per ms at 48kHz: 100 blocks of 480 samples complete the window.
    for (let index = 0; index < 100; index += 1) {
      harness.processor.process(quietBlock(0.008 + (index % 3) * 0.002, 480));
    }

    const metrics = await pending;
    expect(metrics).toMatchObject({
      durationMs: 1_000,
      sampleCount: 48_000,
      blockCount: 100,
      clipCount: 0,
      clippedSampleFraction: 0,
    });
    expect(metrics.rmsMin).toBeGreaterThan(0);
    expect(metrics.rmsMax).toBeLessThan(0.05);
    expect(metrics.rmsMean).toBeGreaterThan(0);
    expect(metrics.rmsP95).toBeGreaterThanOrEqual(metrics.rmsMean);
    expect(metrics.peakMax).toBeGreaterThan(0);
    expect(metrics.sustainedEnergyFraction).toBeLessThan(0.2);
    expect(harness.onChunk).not.toHaveBeenCalled();
    session.close();
  });

  it('returns only flat finite numbers, never sample arrays', async () => {
    const harness = createMicHarness();
    await harness.mic.start();
    const session = await harness.mic.openLocalSession();
    const pending = session.measure({ mode: 'speech', durationMs: 200, signal: new AbortController().signal });
    for (let index = 0; index < 20; index += 1) {
      harness.processor.process(speechBlock(480));
    }
    const metrics = await pending;

    const leaves: unknown[] = [];
    const walk = (value: unknown): void => {
      if (value !== null && typeof value === 'object') {
        expect(ArrayBuffer.isView(value)).toBe(false);
        expect(Array.isArray(value)).toBe(false);
        for (const nested of Object.values(value)) walk(nested);
        return;
      }
      leaves.push(value);
    };
    walk(metrics);
    expect(leaves.length).toBeGreaterThan(0);
    for (const leaf of leaves) {
      expect(typeof leaf).toBe('number');
      expect(Number.isFinite(leaf as number)).toBe(true);
    }
    session.close();
  });

  it('distinguishes sustained speech energy from a quiet room', async () => {
    const harness = createMicHarness();
    await harness.mic.start();
    const session = await harness.mic.openLocalSession();

    const speechPending = session.measure({ mode: 'speech', durationMs: 100, signal: new AbortController().signal });
    for (let index = 0; index < 10; index += 1) harness.processor.process(speechBlock(480));
    const speech = await speechPending;
    expect(speech.sustainedEnergyFraction).toBeGreaterThan(0.5);
    expect(speech.rmsMean).toBeGreaterThan(0.05);

    const roomPending = session.measure({ mode: 'room', durationMs: 100, signal: new AbortController().signal });
    for (let index = 0; index < 10; index += 1) harness.processor.process(quietBlock(0.006, 480));
    const room = await roomPending;
    expect(room.sustainedEnergyFraction).toBeLessThan(0.1);
    session.close();
  });

  it('counts clipped samples and reports their fraction', async () => {
    const harness = createMicHarness();
    await harness.mic.start();
    const session = await harness.mic.openLocalSession();
    const pending = session.measure({ mode: 'speech', durationMs: 100, signal: new AbortController().signal });
    for (let index = 0; index < 10; index += 1) harness.processor.process(clippedBlock(480, 48));

    const metrics = await pending;
    expect(metrics.clipCount).toBe(10 * 48);
    expect(metrics.clippedSampleFraction).toBeCloseTo(0.1, 5);
    expect(metrics.peakMax).toBe(1);
    session.close();
  });

  it('computes rms p95 over the bounded histogram', async () => {
    const harness = createMicHarness();
    await harness.mic.start();
    const session = await harness.mic.openLocalSession();
    const pending = session.measure({ mode: 'room', durationMs: 1_000, signal: new AbortController().signal });
    for (let index = 0; index < 90; index += 1) harness.processor.process(quietBlock(0.01, 480));
    for (let index = 0; index < 10; index += 1) harness.processor.process(speechBlock(480));

    const metrics = await pending;
    expect(metrics.blockCount).toBe(100);
    expect(metrics.rmsP95).toBeGreaterThan(0.05);
    expect(metrics.rmsP95).toBeGreaterThan(metrics.rmsMean);
    expect(metrics.rmsMax).toBeGreaterThanOrEqual(metrics.rmsP95);
    session.close();
  });

  it('ignores empty and non-finite blocks so aggregates stay finite', async () => {
    const harness = createMicHarness();
    await harness.mic.start();
    const session = await harness.mic.openLocalSession();
    const pending = session.measure({ mode: 'room', durationMs: 100, signal: new AbortController().signal });
    harness.processor.process(new Float32Array(0));
    harness.processor.process(Float32Array.from({ length: 480 }, (_, index) => (index % 7 === 0 ? Number.NaN : 0.01)));
    harness.processor.process(Float32Array.from({ length: 480 }, (_, index) => (index % 5 === 0 ? Number.POSITIVE_INFINITY : 0.01)));
    for (let index = 0; index < 10; index += 1) harness.processor.process(quietBlock(0.01, 480));

    const metrics = await pending;
    expect(metrics.sampleCount).toBe(4_800);
    expect(metrics.blockCount).toBe(10);
    for (const value of Object.values(metrics)) expect(Number.isFinite(value)).toBe(true);
    session.close();
  });

  it('rejects an overlapping window and an invalid request', async () => {
    const harness = createMicHarness();
    await harness.mic.start();
    const session = await harness.mic.openLocalSession();
    const controller = new AbortController();
    const pending = session.measure({ mode: 'room', durationMs: 5_000, signal: controller.signal });

    await expect(session.measure({ mode: 'room', durationMs: 1_000, signal: new AbortController().signal }))
      .rejects.toThrow(/overlap|active/);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    await expect(session.measure({ mode: 'room', durationMs: 0, signal: new AbortController().signal }))
      .rejects.toThrow(/duration/);
    await expect(session.measure({ mode: 'room', durationMs: 1_000, signal: AbortSignal.abort() }))
      .rejects.toMatchObject({ name: 'AbortError' });
    session.close();
  });

  it('rejects the pending window when the session closes and removes observers', async () => {
    const harness = createMicHarness();
    await harness.mic.start();
    const session = await harness.mic.openLocalSession();
    const listener = vi.fn();
    session.observeClaps(listener);
    const pending = session.measure({ mode: 'room', durationMs: 5_000, signal: new AbortController().signal });

    session.close();
    await expect(pending).rejects.toThrow(/closed|abort/i);
    expect(() => session.observeClaps(listener)).toThrow(/closed/i);

    const now = { value: 5_000 };
    vi.spyOn(performance, 'now').mockImplementation(() => now.value);
    harness.processor.process(clapBlock());
    expect(listener).not.toHaveBeenCalled();
  });

  it('rejects the pending window and closes the session when the stream stops', async () => {
    const harness = createMicHarness();
    await harness.mic.start();
    const session = await harness.mic.openLocalSession();
    const pending = session.measure({ mode: 'room', durationMs: 5_000, signal: new AbortController().signal });

    harness.mic.stop();
    await expect(pending).rejects.toThrow(/stopped|unavailable/i);
    expect(() => session.measure({ mode: 'room', durationMs: 100, signal: new AbortController().signal }))
      .rejects.toThrow(/closed/i);
  });

  it('notifies local observers with aggregate clap metrics and suppresses ordinary wake only while exclusive', async () => {
    const now = { value: 1_000 };
    vi.spyOn(performance, 'now').mockImplementation(() => now.value);
    const harness = createMicHarness();
    await harness.mic.start();
    for (let index = 0; index < 40; index += 1) harness.processor.process(steadySignal(0.012));

    const session = await harness.mic.openLocalSession();
    const seen: ClapMeasurement[] = [];
    session.observeClaps((measurement) => seen.push(measurement));

    harness.processor.process(clapBlock());
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      occurredAtMs: 1_000,
      peak: 0.9,
    });
    expect(seen[0].rms).toBeGreaterThan(0);
    expect(seen[0].crestFactor).toBeGreaterThan(2.5);
    expect(seen[0].sustainedEnergyFraction).toBeLessThan(0.18);
    expect(harness.onClap).not.toHaveBeenCalled();
    expect(harness.onChunk).not.toHaveBeenCalled();

    session.close();
    now.value = 5_000;
    harness.processor.process(clapBlock());
    expect(harness.onClap).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);
  });

  it('swaps calibrated detector thresholds and restores production defaults', async () => {
    const now = { value: 10_000 };
    vi.spyOn(performance, 'now').mockImplementation(() => now.value);
    const harness = createMicHarness();
    await harness.mic.start();
    for (let index = 0; index < 40; index += 1) harness.processor.process(steadySignal(0.012));

    // A weak transient that passes default thresholds...
    harness.processor.process(weakTransient());
    expect(harness.onClap).toHaveBeenCalledTimes(1);

    // ...is rejected under a calibrated profile with a higher peak gate.
    now.value = 20_000;
    harness.mic.setDetectorOptions({ minPeak: 0.6, initialNoiseFloor: 0.012 });
    harness.processor.process(weakTransient());
    expect(harness.onClap).toHaveBeenCalledTimes(1);

    now.value = 30_000;
    harness.processor.process(clapBlock());
    expect(harness.onClap).toHaveBeenCalledTimes(2);

    // Restoring defaults accepts the weak transient again.
    now.value = 40_000;
    harness.mic.setDetectorOptions();
    for (let index = 0; index < 40; index += 1) harness.processor.process(steadySignal(0.012));
    now.value = 41_000;
    harness.processor.process(weakTransient());
    expect(harness.onClap).toHaveBeenCalledTimes(3);
  });
});

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

interface MicHarnessOptions {
  deviceId?: string;
  label?: string;
  digest?: (raw: string) => Promise<string>;
}

function createMicHarness(options: MicHarnessOptions = {}) {
  const processor = new FakeProcessor();
  const stopTrack = vi.fn();
  const track = {
    stop: stopTrack,
    label: options.label ?? 'Test Microphone',
    getSettings: () => ({ deviceId: options.deviceId ?? 'raw-device-42' }),
  };
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [track],
        getAudioTracks: () => [track],
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
  const onChunk = vi.fn();
  const onClap = vi.fn();
  const mic = new MicCapture(
    onChunk,
    onClap,
    options.digest ? { digestDeviceId: options.digest } : undefined,
  );
  return { mic, processor, onChunk, onClap, stopTrack };
}

function quietBlock(amplitude: number, length: number): Float32Array {
  return Float32Array.from({ length }, (_, index) => (index % 2 === 0 ? amplitude : -amplitude));
}

function steadySignal(amplitude: number, length = 256): Float32Array {
  return quietBlock(amplitude, length);
}

/** ~8 ms clap transient inside a 480-sample (10 ms) block. */
function clapBlock(length = 480): Float32Array {
  const block = new Float32Array(length);
  for (let index = 0; index < 24; index += 1) block[index] = index % 2 === 0 ? 0.9 : -0.9;
  return block;
}

/** Weak transient that clears default gates but not a calibrated 0.6 peak gate. */
function weakTransient(length = 480): Float32Array {
  const block = new Float32Array(length);
  for (let index = 0; index < 16; index += 1) block[index] = index % 2 === 0 ? 0.3 : -0.3;
  return block;
}

/** Speech-like block: sustained sinusoidal energy across most samples. */
function speechBlock(length: number): Float32Array {
  const block = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    block[index] = Math.sin(index * 0.35 + Math.sin(index * 0.01) * 2) * 0.4;
  }
  return block;
}

function clippedBlock(length: number, clipped: number): Float32Array {
  const block = quietBlock(0.02, length);
  for (let index = 0; index < clipped; index += 1) block[index] = index % 2 === 0 ? 1 : -1;
  return block;
}
