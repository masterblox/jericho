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

  it('rejects a spoken phrase block that fills most samples above the noise floor', () => {
    const detector = new ClapWakeDetector();
    for (let index = 0; index < 40; index += 1) {
      detector.process(steadySignal(0.012), index * 20);
    }

    expect(detector.process(speechPhraseBlock(), 1_000)).toBe(false);
  });

  it('rejects sustained tonal noise even with high crest-factor onset', () => {
    const detector = new ClapWakeDetector();
    for (let index = 0; index < 20; index += 1) {
      detector.process(steadySignal(0.012), index * 20);
    }

    // A block with a sharp onset transient but sustained trailing energy (like a door slam
    // or TTS fricative that fills the rest of the block) should be rejected.
    expect(detector.process(mixedTransientSustained(), 1_000)).toBe(false);
  });

  it('still detects a real clap in a production-sized block', () => {
    const detector = new ClapWakeDetector();
    for (let index = 0; index < 40; index += 1) {
      detector.process(productionSilence(4096), index * 20);
    }

    // 4096-sample production block: 8ms clap transient, then silence.
    expect(detector.process(productionClap(4096), 1_000)).toBe(true);
  });

  it('accepts consecutive claps separated by the refractory window', () => {
    const detector = new ClapWakeDetector({ refractoryMs: 800 });
    const silence = productionSilence(4096);

    for (let index = 0; index < 30; index += 1) {
      detector.process(silence, index * 85);
    }

    expect(detector.process(productionClap(4096), 3_000)).toBe(true);
    // Same block within refractory is suppressed.
    expect(detector.process(productionClap(4096), 3_100)).toBe(false);
    // After refractory.
    expect(detector.process(productionClap(4096), 3_900)).toBe(true);
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

/** A block that looks like a spoken phrase: moderate peak, sustained energy filling > 50% of samples. */
function speechPhraseBlock(length = 256): Float32Array {
  const arr = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    // Speech-like: alternating amplitude with a spectral shape.
    const envelope = i < 20 ? i / 20 : 1 - (i - 20) / (length - 20) * 0.3;
    arr[i] = Math.sin((i * 0.37) + Math.sin(i * 0.013) * 2) * 0.45 * envelope;
  }
  return arr;
}

/** A block with a sharp onset (like a clap) but sustained trailing energy (like a door slam or TTS fricative).
 *  The sustained tail fills enough samples to fail the sustained-fraction gate. */
function mixedTransientSustained(length = 256): Float32Array {
  const arr = new Float32Array(length);
  // Sharp onset
  for (let i = 0; i < 12; i += 1) {
    arr[i] = i % 2 === 0 ? 0.75 : -0.75;
  }
  // Sustained tail across the remaining samples
  for (let i = 12; i < length; i += 1) {
    arr[i] = Math.sin(i * 0.23) * 0.22;
  }
  return arr;
}

/** Production-length silence block (4096 samples at 48kHz). */
function productionSilence(length = 4096): Float32Array {
  const arr = new Float32Array(length);
  for (let i = 0; i < length; i += 1) arr[i] = (i % 47 - 23) * 0.00035;
  return arr;
}

/** Production-length clap: ~384 samples of transient (~8ms at 48kHz) in a 4096-sample block. */
function productionClap(length = 4096, transientLen = 384): Float32Array {
  const arr = new Float32Array(length);
  for (let i = 0; i < transientLen; i += 1) {
    arr[i] = i % 2 === 0 ? 0.88 : -0.88;
  }
  return arr;
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
