/**
 * Kaldi-style 80-dim log-mel filterbank used by WeSpeaker ResNet34-LM.
 * Frame: 25 ms Hamming window, 10 ms shift, 16 kHz mono PCM.
 */
import { SPEAKER_SAMPLE_RATE } from './speaker-model.js';

const FRAME_LENGTH = Math.round(SPEAKER_SAMPLE_RATE * 0.025);
const FRAME_SHIFT = Math.round(SPEAKER_SAMPLE_RATE * 0.01);
const FFT_SIZE = 512;
const NUM_MEL = 80;
const PRE_EMPHASIS = 0.97;

let melFilters: Float64Array[] | undefined;
let hamming: Float64Array | undefined;

export function computeLogMelFbank(samples: Float32Array): Float32Array {
  if (samples.length < FRAME_LENGTH) {
    throw new Error('speaker_audio_too_short');
  }
  const filters = getMelFilters();
  const window = getHamming();
  const frameCount = 1 + Math.floor((samples.length - FRAME_LENGTH) / FRAME_SHIFT);
  const feats = new Float32Array(frameCount * NUM_MEL);
  const frame = new Float64Array(FFT_SIZE);
  const power = new Float64Array(FFT_SIZE / 2 + 1);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const offset = frameIndex * FRAME_SHIFT;
    let previous = 0;
    for (let i = 0; i < FRAME_LENGTH; i += 1) {
      const sample = samples[offset + i]!;
      const emphasized = i === 0 ? sample : sample - PRE_EMPHASIS * previous;
      previous = sample;
      frame[i] = emphasized * window[i]!;
    }
    for (let i = FRAME_LENGTH; i < FFT_SIZE; i += 1) frame[i] = 0;
    const spectrum = ditFft(frame);
    for (let bin = 0; bin <= FFT_SIZE / 2; bin += 1) {
      const re = spectrum[bin * 2]!;
      const im = spectrum[bin * 2 + 1]!;
      power[bin] = re * re + im * im;
    }
    const base = frameIndex * NUM_MEL;
    for (let mel = 0; mel < NUM_MEL; mel += 1) {
      let energy = 0;
      const filter = filters[mel]!;
      for (let bin = 0; bin < filter.length; bin += 1) {
        energy += filter[bin]! * power[bin]!;
      }
      feats[base + mel] = Math.log(Math.max(energy, 1e-10));
    }
  }
  frame.fill(0);
  power.fill(0);
  return feats;
}

export function fbankFrameCount(sampleCount: number): number {
  if (sampleCount < FRAME_LENGTH) return 0;
  return 1 + Math.floor((sampleCount - FRAME_LENGTH) / FRAME_SHIFT);
}

function getHamming(): Float64Array {
  if (!hamming) {
    hamming = new Float64Array(FRAME_LENGTH);
    for (let i = 0; i < FRAME_LENGTH; i += 1) {
      hamming[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME_LENGTH - 1));
    }
  }
  return hamming;
}

function getMelFilters(): Float64Array[] {
  if (melFilters) return melFilters;
  const fftBins = FFT_SIZE / 2 + 1;
  const lowMel = hzToMel(20);
  const highMel = hzToMel(SPEAKER_SAMPLE_RATE / 2);
  const points = new Float64Array(NUM_MEL + 2);
  for (let i = 0; i < points.length; i += 1) {
    points[i] = melToHz(lowMel + ((highMel - lowMel) * i) / (NUM_MEL + 1));
  }
  const bins = new Int32Array(points.length);
  for (let i = 0; i < points.length; i += 1) {
    bins[i] = Math.floor(((FFT_SIZE + 1) * points[i]!) / SPEAKER_SAMPLE_RATE);
  }
  melFilters = Array.from({ length: NUM_MEL }, () => new Float64Array(fftBins));
  for (let mel = 0; mel < NUM_MEL; mel += 1) {
    const left = bins[mel]!;
    const center = bins[mel + 1]!;
    const right = bins[mel + 2]!;
    const filter = melFilters[mel]!;
    for (let bin = left; bin < center; bin += 1) {
      if (center !== left) filter[bin] = (bin - left) / (center - left);
    }
    for (let bin = center; bin < right; bin += 1) {
      if (right !== center) filter[bin] = (right - bin) / (right - center);
    }
  }
  return melFilters;
}

function hzToMel(hz: number): number {
  return 1127 * Math.log(1 + hz / 700);
}

function melToHz(mel: number): number {
  return 700 * (Math.exp(mel / 1127) - 1);
}

/** In-place radix-2 DIT FFT; `frame` is real input zero-padded to FFT_SIZE. */
function ditFft(frame: Float64Array): Float64Array {
  const n = FFT_SIZE;
  const out = new Float64Array(n * 2);
  for (let i = 0; i < n; i += 1) {
    const rev = reverseBits(i, 9);
    out[rev * 2] = frame[i]!;
    out[rev * 2 + 1] = 0;
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const tableStep = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0; j < half; j += 1) {
        const angle = (-2 * Math.PI * j * tableStep) / n;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        const evenRe = out[(i + j) * 2]!;
        const evenIm = out[(i + j) * 2 + 1]!;
        const oddRe = out[(i + j + half) * 2]!;
        const oddIm = out[(i + j + half) * 2 + 1]!;
        const tr = wr * oddRe - wi * oddIm;
        const ti = wr * oddIm + wi * oddRe;
        out[(i + j) * 2] = evenRe + tr;
        out[(i + j) * 2 + 1] = evenIm + ti;
        out[(i + j + half) * 2] = evenRe - tr;
        out[(i + j + half) * 2 + 1] = evenIm - ti;
      }
    }
  }
  return out;
}

function reverseBits(value: number, bits: number): number {
  let reversed = 0;
  for (let i = 0; i < bits; i += 1) {
    reversed = (reversed << 1) | (value & 1);
    value >>= 1;
  }
  return reversed;
}
