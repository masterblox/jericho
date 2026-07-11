import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClapWakeDetector, MicCapture } from '../src/audio';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ClapWakeDetector', () => {
  it('ignores steady room noise and speech-like energy', () => {
    const detector = new ClapWakeDetector();

    for (let index = 0; index < 80; index += 1) {
      expect(detector.process(steadySignal(0.04), index * 20)).toBe(false);
    }
    expect(detector.process(steadySignal(0.3), 1_700)).toBe(false);
  });

  it('detects a sharp transient above the adapted noise floor', () => {
    const detector = new ClapWakeDetector();
    for (let index = 0; index < 40; index += 1) {
      detector.process(steadySignal(0.012), index * 20);
    }

    expect(detector.process(clapSignal(), 1_000)).toBe(true);
  });

  it('adapts so a modest transient in a noisy room is not a clap', () => {
    const quietDetector = new ClapWakeDetector();
    const noisyDetector = new ClapWakeDetector();
    const modestTransient = transientSignal(0.3, 8);

    expect(quietDetector.process(modestTransient, 1_000)).toBe(true);
    for (let index = 0; index < 160; index += 1) {
      noisyDetector.process(steadySignal(0.05), index * 20);
    }
    expect(noisyDetector.process(modestTransient, 4_000)).toBe(false);
  });

  it('enforces a refractory period before accepting another clap', () => {
    const detector = new ClapWakeDetector({ refractoryMs: 800 });

    expect(detector.process(clapSignal(), 1_000)).toBe(true);
    expect(detector.process(clapSignal(), 1_200)).toBe(false);
    expect(detector.process(clapSignal(), 1_800)).toBe(true);
  });

  it('does not classify empty or non-finite sample blocks as a clap', () => {
    const detector = new ClapWakeDetector();

    expect(detector.process(new Float32Array(), 1_000)).toBe(false);
    expect(detector.process(new Float32Array([0, Number.NaN, 1]), 1_100)).toBe(false);
  });
});

describe('MicCapture local wake analysis', () => {
  it('detects a clap while muted without emitting a transport chunk', async () => {
    const processor = new FakeProcessor();
    const stopTrack = vi.fn();
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: stopTrack }],
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
    const mic = new MicCapture(onChunk, onClap);
    await mic.start();

    processor.process(steadySignal(0.012));
    processor.process(clapSignal());

    expect(onClap).toHaveBeenCalledTimes(1);
    expect(onChunk).not.toHaveBeenCalled();

    mic.setMuted(false);
    processor.process(steadySignal(0.04));
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onClap).toHaveBeenCalledTimes(1);

    mic.stop();
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });
});

function steadySignal(amplitude: number, length = 256): Float32Array {
  return Float32Array.from({ length }, (_, index) => index % 2 === 0 ? amplitude : -amplitude);
}

function transientSignal(peak: number, width: number, length = 256): Float32Array {
  const signal = new Float32Array(length);
  for (let index = 0; index < width; index += 1) {
    signal[index] = index % 2 === 0 ? peak : -peak;
  }
  return signal;
}

function clapSignal(): Float32Array {
  return transientSignal(0.9, 8);
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
