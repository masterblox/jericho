import type { AudioWindowMetrics } from '@jericho/shared';

export type { AudioWindowMetrics } from '@jericho/shared';

export interface AudioMeasurementRequest {
  mode: 'room' | 'speech';
  durationMs: number;
  signal: AbortSignal;
}

export interface ClapMeasurement {
  occurredAtMs: number;
  rms: number;
  peak: number;
  crestFactor: number;
  sustainedEnergyFraction: number;
}

export interface ClapWakeCalibratedThresholds {
  clapPeakMin: number;
  clapRmsMin: number;
  clapCrestMin: number;
  clapSustainedEnergyLimit: number;
}

const DEFAULT_CLAP_THRESHOLDS: ClapWakeCalibratedThresholds = {
  clapPeakMin: 0.18,
  clapRmsMin: 0.02,
  clapCrestMin: 2.5,
  clapSustainedEnergyLimit: 0.18,
};

export interface ClapWakeDetectorOptions {
  refractoryMs?: number;
  noiseAdaptation?: number;
  initialNoiseFloor?: number;
  /** Rejects blocks where sustained signal covers this fraction of samples. */
  maxSustainedFraction?: number;
}

/**
 * Pure, block-based clap detector. Callers supply samples and a monotonic
 * timestamp, so detection is deterministic and does not retain raw audio.
 *
 * A clap is a sharp transient (high crest factor) followed quickly by silence.
 * Sustained speech or tonal noise fills most of the block with energy and is
 * rejected by the sustained-fraction gate.
 */
export class ClapWakeDetector {
  private readonly refractoryMs: number;
  private readonly noiseAdaptation: number;
  private noiseFloor: number;
  private lastClapAt = Number.NEGATIVE_INFINITY;
  private thresholds: ClapWakeCalibratedThresholds = { ...DEFAULT_CLAP_THRESHOLDS };

  constructor(options: ClapWakeDetectorOptions = {}) {
    this.refractoryMs = options.refractoryMs ?? 800;
    this.noiseAdaptation = options.noiseAdaptation ?? 0.05;
    this.noiseFloor = options.initialNoiseFloor ?? 0.008;
    this.thresholds.clapSustainedEnergyLimit =
      options.maxSustainedFraction ?? DEFAULT_CLAP_THRESHOLDS.clapSustainedEnergyLimit;
  }

  process(samples: Float32Array, timestampMs: number): boolean {
    return this.evaluate(samples, timestampMs).detected;
  }

  evaluate(samples: Float32Array, timestampMs: number): { detected: boolean; measurement: ClapMeasurement } {
    if (samples.length === 0 || !Number.isFinite(timestampMs)) {
      return { detected: false, measurement: zeroMeasurement() };
    }
    let sumSquares = 0;
    let peak = 0;
    let sustainedCount = 0;
    let validSamples = 0;
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      if (!Number.isFinite(sample)) return { detected: false, measurement: zeroMeasurement() };
      validSamples++;
      const magnitude = Math.abs(sample);
      peak = Math.max(peak, magnitude);
      sumSquares += sample * sample;
      if (magnitude > 0.02) sustainedCount++;
    }
    if (validSamples === 0) return { detected: false, measurement: zeroMeasurement() };

    const rms = Math.sqrt(sumSquares / validSamples);
    const crestFactor = rms > 0 ? peak / rms : 0;
    const sustainedFraction = sustainedCount / validSamples;

    const measurement: ClapMeasurement = {
      occurredAtMs: timestampMs,
      rms,
      peak,
      crestFactor,
      sustainedEnergyFraction: sustainedFraction,
    };

    const transient =
      sustainedFraction <= this.thresholds.clapSustainedEnergyLimit &&
      peak >= Math.max(this.thresholds.clapPeakMin, this.noiseFloor * 5) &&
      rms >= Math.max(this.thresholds.clapRmsMin, this.noiseFloor * 1.8) &&
      crestFactor >= this.thresholds.clapCrestMin;

    if (transient) {
      if (timestampMs - this.lastClapAt < this.refractoryMs) return { detected: false, measurement };
      this.lastClapAt = timestampMs;
      return { detected: true, measurement };
    }

    this.noiseFloor += (rms - this.noiseFloor) * this.noiseAdaptation;
    return { detected: false, measurement };
  }

  installTemporaryProfile(profile: Partial<ClapWakeCalibratedThresholds>): void {
    const next = { ...this.thresholds, ...profile };
    if (
      !Number.isFinite(next.clapPeakMin)
      || !Number.isFinite(next.clapRmsMin)
      || !Number.isFinite(next.clapCrestMin)
      || !Number.isFinite(next.clapSustainedEnergyLimit)
    ) throw new TypeError('Clap detector thresholds must be finite');
    this.thresholds = next;
  }

  restoreProfile(profile: Partial<ClapWakeCalibratedThresholds> | null): void {
    this.thresholds = {
      ...DEFAULT_CLAP_THRESHOLDS,
      ...(profile ?? {}),
    };
  }

  profile(): ClapWakeCalibratedThresholds {
    return { ...this.thresholds };
  }
}

function zeroMeasurement(): ClapMeasurement {
  return { occurredAtMs: 0, rms: 0, peak: 0, crestFactor: 0, sustainedEnergyFraction: 0 };
}

export interface LocalCalibrationSession {
  readonly identity: {
    label: string;
    deviceHash: string;
    sampleRate: number;
  };
  measure(request: AudioMeasurementRequest): Promise<AudioWindowMetrics>;
  observeClaps(listener: (measurement: ClapMeasurement) => void): () => void;
  observeLevel(listener: (rms: number) => void): () => void;
  close(): void;
}

interface CalibrationSessionState {
  token: symbol;
  listeners: Set<(m: ClapMeasurement) => void>;
  levelListeners: Set<(rms: number) => void>;
  closed: boolean;
}

interface MeasurementAccumulator {
  sessionToken: symbol;
  mode: AudioMeasurementRequest['mode'];
  durationMs: number;
  targetSamples: number;
  processedSamples: number;
  sampleCount: number;
  blockCount: number;
  rmsMin: number;
  rmsMax: number;
  rmsSum: number;
  peakMax: number;
  clipCount: number;
  sustainedCount: number;
  rmsHistogram: Uint32Array;
  signal: AbortSignal;
  abortListener: () => void;
  resolve: (metrics: AudioWindowMetrics) => void;
  reject: (error: Error) => void;
}

export interface MicCaptureOptions {
  subtle?: Pick<SubtleCrypto, 'digest'>;
  now?: () => number;
}

const RMS_HISTOGRAM_BINS = 256;
const CLIP_THRESHOLD = 0.99;
const SUSTAINED_THRESHOLD = 0.02;

/**
 * Mic capture keeps standby samples local for transient analysis and only
 * encodes transport chunks when the active-turn gate unmutes it.
 *
 * Calibration measurement is a separate local-only path. While a local
 * session is open, ordinary clap wake is suppressed (calibration observes
 * claps locally). Raw samples are never retained beyond `onaudioprocess`.
 */
export class MicCapture {
  private ctx: AudioContext | null = null;
  private proc: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private muted = true;
  private rms = 0; // smoothed input energy (0..~0.5) for voice-activity detection
  private wakeDetector = new ClapWakeDetector();
  private measurement: MeasurementAccumulator | null = null;
  private localSession: CalibrationSessionState | null = null;
  private trackEndedListener: (() => void) | null = null;
  private readonly subtle: Pick<SubtleCrypto, 'digest'>;
  private readonly now: () => number;

  constructor(
    private onChunk: (b64: string) => void,
    private onClap: () => void = () => undefined,
    options: MicCaptureOptions = {},
  ) {
    const subtle = options.subtle ?? globalThis.crypto?.subtle;
    if (!subtle) throw new Error('Web Crypto is required for microphone identity protection');
    this.subtle = subtle;
    this.now = options.now ?? (() => performance.now());
  }

  /** True while the mic stream is live (armed). */
  get live(): boolean {
    return this.stream !== null;
  }

  async start() {
    if (this.stream) return; // already live
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    this.ctx = new AudioContext();
    const track = this.audioTrack();
    if (track?.addEventListener) {
      this.trackEndedListener = () => this.handleDeviceLost();
      track.addEventListener('ended', this.trackEndedListener, { once: true });
    }
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(4096, 1, 1);

    // Keep the processor alive WITHOUT playing mic into speakers.
    // Unmuted destination output causes AEC to cancel the user's voice → Gemini hears silence.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;

    const inRate = this.ctx.sampleRate;
    const outRate = 16000;

    this.proc.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const r = Math.sqrt(sum / input.length);
      this.rms = this.rms * 0.6 + r * 0.4;

      // Feed aggregate measurement window if active (local-only, never encodes)
      this.feedMeasurementBlock(input);

      if (this.muted) {
        // Local calibration session: evaluate clap metrics and notify observers
        if (this.localSession) {
          const boundedRms = Math.max(0, Math.min(1, r));
          for (const listener of this.localSession.levelListeners) listener(boundedRms);
          const now = this.now();
          const result = this.wakeDetector.evaluate(input, now);
          if (result.detected) {
            for (const listener of this.localSession.listeners) {
              listener(result.measurement);
            }
          }
          return;
        }
        // Ordinary clap wake
        if (this.wakeDetector.process(input, this.now())) this.onClap();
        return;
      }
      const b64 = this.downsampleAndEncode(input, inRate, outRate);
      if (b64) this.onChunk(b64);
    };
    src.connect(this.proc);
    this.proc.connect(mute);
    mute.connect(this.ctx.destination);
  }

  /** Tear down the stream + context and release the mic hardware. */
  stop() {
    this.rejectMeasurement(new Error('Microphone stopped'));
    this.closeLocalSession();
    const track = this.audioTrack();
    if (track && this.trackEndedListener) {
      track.removeEventListener?.('ended', this.trackEndedListener);
    }
    this.trackEndedListener = null;
    try {
      this.stream?.getTracks().forEach((t) => t.stop());
    } catch {
      /* noop */
    }
    this.stream = null;
    try {
      this.proc?.disconnect();
    } catch {
      /* noop */
    }
    this.proc = null;
    try {
      this.ctx?.close();
    } catch {
      /* noop */
    }
    this.ctx = null;
    this.rms = 0;
    this.muted = true;
    this.wakeDetector = new ClapWakeDetector();
  }

  /** Pause transport while retaining local transient analysis. */
  setMuted(m: boolean) {
    this.muted = m;
  }

  /** Smoothed mic energy (0..~0.5). Used by the barge-in VAD. */
  getRms() {
    return this.rms;
  }

  resume() {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  /**
   * Start an aggregate measurement window. Only one window may be active.
   * Raw samples are never stored — only running count/sum/min/max aggregates.
   */
  measure(request: AudioMeasurementRequest): Promise<AudioWindowMetrics> {
    const session = this.localSession;
    if (!session || session.closed || !this.stream || !this.ctx) {
      return Promise.reject(new Error('Local calibration session is unavailable'));
    }
    if (this.measurement) {
      return Promise.reject(new Error('Measurement already in progress'));
    }
    if (!Number.isFinite(request.durationMs) || request.durationMs <= 0) {
      return Promise.reject(new TypeError('Measurement duration must be positive'));
    }
    if (request.signal.aborted) {
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }

    return new Promise<AudioWindowMetrics>((resolve, reject) => {
      const abortListener = () => this.rejectMeasurement(new DOMException('Aborted', 'AbortError'));
      request.signal.addEventListener('abort', abortListener, { once: true });
      this.measurement = {
        sessionToken: session.token,
        mode: request.mode,
        durationMs: request.durationMs,
        targetSamples: Math.ceil(this.ctx!.sampleRate * request.durationMs / 1_000),
        processedSamples: 0,
        sampleCount: 0,
        blockCount: 0,
        rmsMin: Number.POSITIVE_INFINITY,
        rmsMax: 0,
        rmsSum: 0,
        peakMax: 0,
        clipCount: 0,
        sustainedCount: 0,
        rmsHistogram: new Uint32Array(RMS_HISTOGRAM_BINS),
        signal: request.signal,
        abortListener,
        resolve,
        reject,
      };
    });
  }

  /** Test-only compatibility hook; production windows complete by sample count. */
  completeMeasurement(): void {
    this.resolveMeasurement();
  }

  /** Read-only summary for inspection (test/debug only). */
  getMeasurementSummary(): { blockCount: number; rmsMean: number } {
    const measurement = this.measurement;
    return {
      blockCount: measurement?.blockCount ?? 0,
      rmsMean: measurement?.blockCount ? measurement.rmsSum / measurement.blockCount : 0,
    };
  }

  /**
   * Open a local calibration session. Only one session can be active.
   * Returns null if a session is already open.
   */
  async openLocalSession(): Promise<LocalCalibrationSession | null> {
    if (this.localSession || !this.stream || !this.ctx) return null;
    const stream = this.stream;
    const context = this.ctx;
    const track = this.audioTrack();
    if (!track || track.readyState === 'ended') return null;
    const rawDeviceId = track.getSettings?.().deviceId ?? '';
    const deviceHash = await hashDeviceId(rawDeviceId || `default:${track.label || 'microphone'}`, this.subtle);
    if (this.stream !== stream || this.ctx !== context || String(track.readyState) === 'ended') return null;
    const state: CalibrationSessionState = {
      token: Symbol('local-calibration-session'),
      listeners: new Set(),
      levelListeners: new Set(),
      closed: false,
    };
    this.localSession = state;
    const self = this;
    return {
      identity: {
        label: track.label?.trim() || 'Default microphone',
        deviceHash,
        sampleRate: context.sampleRate,
      },
      measure(request: AudioMeasurementRequest): Promise<AudioWindowMetrics> {
        if (state.closed || self.localSession?.token !== state.token) {
          return Promise.reject(new Error('Session closed'));
        }
        return self.measure(request);
      },
      observeClaps(listener: (measurement: ClapMeasurement) => void): () => void {
        if (state.closed || self.localSession?.token !== state.token) {
          throw new Error('Session closed');
        }
        state.listeners.add(listener);
        return () => {
          state.listeners.delete(listener);
        };
      },
      observeLevel(listener: (rms: number) => void): () => void {
        if (state.closed || self.localSession?.token !== state.token) {
          throw new Error('Session closed');
        }
        state.levelListeners.add(listener);
        return () => state.levelListeners.delete(listener);
      },
      close(): void {
        if (state.closed) return;
        state.closed = true;
        state.listeners.clear();
        state.levelListeners.clear();
        if (self.localSession?.token === state.token) self.closeLocalSession();
      },
    };
  }

  /** Install temporary detector thresholds (for LIVE_CANARY). */
  installTemporaryProfile(profile: Partial<ClapWakeCalibratedThresholds>): void {
    this.wakeDetector.installTemporaryProfile(profile);
  }

  /** Restore default detector thresholds. */
  restoreProfile(profile: Partial<ClapWakeCalibratedThresholds> | null = null): void {
    this.wakeDetector.restoreProfile(profile);
  }

  /** @deprecated Use restoreProfile so callers may restore an approved profile. */
  restoreDefaultProfile(): void {
    this.restoreProfile(null);
  }

  // --- private helpers ---

  private feedMeasurementBlock(input: Float32Array): void {
    const measurement = this.measurement;
    if (!measurement || measurement.sessionToken !== this.localSession?.token) return;
    const remaining = measurement.targetSamples - measurement.processedSamples;
    if (remaining <= 0) {
      this.resolveMeasurement();
      return;
    }
    const limit = Math.min(input.length, remaining);
    if (limit <= 0) return;

    let sumSquares = 0;
    let peak = 0;
    let clipCount = 0;
    let sustainedCount = 0;
    let validSamples = 0;

    for (let i = 0; i < limit; i++) {
      const s = input[i];
      if (!Number.isFinite(s)) continue;
      validSamples++;
      const abs = Math.abs(s);
      peak = Math.max(peak, abs);
      sumSquares += s * s;
      if (abs >= CLIP_THRESHOLD) clipCount++;
      if (abs > SUSTAINED_THRESHOLD) sustainedCount++;
    }

    measurement.processedSamples += limit;
    if (validSamples === 0) {
      if (measurement.processedSamples >= measurement.targetSamples) this.resolveMeasurement();
      return;
    }
    const rms = validSamples > 0 ? Math.sqrt(sumSquares / validSamples) : 0;
    measurement.sampleCount += validSamples;
    measurement.blockCount += 1;
    measurement.rmsMin = Math.min(measurement.rmsMin, rms);
    measurement.rmsMax = Math.max(measurement.rmsMax, rms);
    measurement.rmsSum += rms;
    measurement.peakMax = Math.max(measurement.peakMax, peak);
    measurement.clipCount += clipCount;
    measurement.sustainedCount += sustainedCount;
    const bin = Math.min(RMS_HISTOGRAM_BINS - 1, Math.floor(Math.max(0, Math.min(1, rms)) * RMS_HISTOGRAM_BINS));
    measurement.rmsHistogram[bin] += 1;
    if (measurement.processedSamples >= measurement.targetSamples) this.resolveMeasurement();
  }

  private resolveMeasurement(): void {
    const measurement = this.measurement;
    if (!measurement) return;
    this.measurement = null;
    measurement.signal.removeEventListener('abort', measurement.abortListener);
    measurement.resolve(measurementMetrics(measurement));
  }

  private rejectMeasurement(error: Error): void {
    const measurement = this.measurement;
    if (!measurement) return;
    this.measurement = null;
    measurement.signal.removeEventListener('abort', measurement.abortListener);
    measurement.reject(error);
  }

  private closeLocalSession(): void {
    const session = this.localSession;
    if (!session) return;
    session.closed = true;
    session.listeners.clear();
    session.levelListeners.clear();
    this.localSession = null;
    this.rejectMeasurement(new Error('Session closed'));
  }

  private handleDeviceLost(): void {
    this.rejectMeasurement(new Error('Microphone device lost'));
    this.closeLocalSession();
  }

  private audioTrack(): MediaStreamTrack | undefined {
    const stream = this.stream;
    if (!stream) return undefined;
    return stream.getAudioTracks?.()[0] ?? stream.getTracks()[0];
  }

  private downsampleAndEncode(input: Float32Array, inRate: number, outRate: number): string {
    if (inRate === outRate) {
      return int16ToBase64(float32ToInt16(input));
    }
    const ratio = inRate / outRate;
    const outLen = Math.floor(input.length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const idx = i * ratio;
      const lo = Math.floor(idx);
      const hi = Math.min(lo + 1, input.length - 1);
      const frac = idx - lo;
      out[i] = input[lo] * (1 - frac) + input[hi] * frac;
    }
    return int16ToBase64(float32ToInt16(out));
  }
}

async function hashDeviceId(
  deviceId: string,
  subtle: Pick<SubtleCrypto, 'digest'>,
): Promise<string> {
  const bytes = new TextEncoder().encode(`jericho-mic-device:${deviceId}`);
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function measurementMetrics(measurement: MeasurementAccumulator): AudioWindowMetrics {
  const blockCount = measurement.blockCount;
  const sampleCount = measurement.sampleCount;
  return {
    durationMs: measurement.durationMs,
    sampleCount,
    blockCount,
    rmsMin: blockCount > 0 ? measurement.rmsMin : 0,
    rmsMax: blockCount > 0 ? measurement.rmsMax : 0,
    rmsMean: blockCount > 0 ? measurement.rmsSum / blockCount : 0,
    rmsP95: blockCount > 0 ? histogramPercentile(
      measurement.rmsHistogram,
      0.95,
      measurement.rmsMin,
      measurement.rmsMax,
    ) : 0,
    peakMax: measurement.peakMax,
    clipCount: measurement.clipCount,
    clippedSampleFraction: sampleCount > 0 ? measurement.clipCount / sampleCount : 0,
    sustainedEnergyFraction: sampleCount > 0 ? measurement.sustainedCount / sampleCount : 0,
  };
}

function histogramPercentile(
  histogram: Uint32Array,
  percentile: number,
  minimum: number,
  maximum: number,
): number {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  if (total === 0) return 0;
  const target = Math.max(1, Math.ceil(total * percentile));
  let cumulative = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index];
    if (cumulative >= target) {
      const estimate = (index + 0.5) / histogram.length;
      return Math.max(minimum, Math.min(maximum, estimate));
    }
  }
  return maximum;
}

/** Speaker playback: plays 24kHz 16-bit PCM base64 chunks, gapless, with interrupt. */
export class SpeakerPlayback {
  private ctx: AudioContext | null;
  private nextStart = 0;
  private sources: AudioBufferSourceNode[] = [];
  private drainWaiters = new Set<() => void>();
  private disposed = false;

  constructor() {
    this.ctx = new AudioContext({ sampleRate: 24000 });
  }

  enqueue(b64: string) {
    if (!this.ctx || this.disposed) return;
    void this.resume();
    const pcm = base64ToInt16(b64);
    const float = int16ToFloat32(pcm);
    const buf = this.ctx.createBuffer(1, float.length, 24000);
    buf.copyToChannel(float as Float32Array<ArrayBuffer>, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    const now = this.ctx.currentTime;
    if (this.nextStart < now) this.nextStart = now;
    src.start(this.nextStart);
    this.nextStart += float.length / 24000;
    this.sources.push(src);
    src.onended = () => {
      this.sources = this.sources.filter((s) => s !== src);
      this.resolveDrainIfIdle();
    };
  }

  /** barge-in: stop scheduled audio immediately */
  interrupt() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
    this.nextStart = 0;
    this.resolveDrainIfIdle();
  }

  /** True while any playback is scheduled/active (used by the barge-in VAD). */
  isPlaying() {
    return this.sources.length > 0;
  }

  whenDrained(): Promise<void> {
    if (!this.isPlaying()) return Promise.resolve();
    return new Promise((resolve) => this.drainWaiters.add(resolve));
  }

  resume() {
    if (this.ctx?.state === 'suspended') return this.ctx.resume();
    return Promise.resolve();
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.interrupt();
    const context = this.ctx;
    this.ctx = null;
    if (context && context.state !== 'closed') await context.close();
  }

  private resolveDrainIfIdle(): void {
    if (this.isPlaying()) return;
    for (const resolve of this.drainWaiters) resolve();
    this.drainWaiters.clear();
  }
}

function float32ToInt16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function int16ToFloat32(i: Int16Array): Float32Array {
  const out = new Float32Array(i.length);
  for (let j = 0; j < i.length; j++) out[j] = i[j] / 0x8000;
  return out;
}

function int16ToBase64(buf: Int16Array): string {
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToInt16(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}
