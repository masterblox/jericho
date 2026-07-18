export interface AudioWindowMetrics {
  durationMs: number;
  sampleCount: number;
  blockCount: number;
  rmsMin: number;
  rmsMax: number;
  rmsMean: number;
  rmsP95: number;
  peakMax: number;
  clipCount: number;
  clippedSampleFraction: number;
  sustainedEnergyFraction: number;
}

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
    this.thresholds = {
      clapPeakMin: profile.clapPeakMin ?? DEFAULT_CLAP_THRESHOLDS.clapPeakMin,
      clapRmsMin: profile.clapRmsMin ?? DEFAULT_CLAP_THRESHOLDS.clapRmsMin,
      clapCrestMin: profile.clapCrestMin ?? DEFAULT_CLAP_THRESHOLDS.clapCrestMin,
      clapSustainedEnergyLimit: profile.clapSustainedEnergyLimit ?? DEFAULT_CLAP_THRESHOLDS.clapSustainedEnergyLimit,
    };
  }

  restoreProfile(_profile: Partial<ClapWakeCalibratedThresholds> | null): void {
    this.thresholds = { ...DEFAULT_CLAP_THRESHOLDS };
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
  close(): void;
}

interface MeasurementBlock {
  rms: number;
  peak: number;
  clipCount: number;
  sustainedCount: number;
  totalSamples: number;
}

interface CalibrationSessionState {
  listeners: Set<(m: ClapMeasurement) => void>;
}

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

  // Aggregate measurement state (never retains sample arrays)
  private measurementBlocks: MeasurementBlock[] = [];
  private measurementPending: {
    promise: Promise<AudioWindowMetrics>;
    resolve: (m: AudioWindowMetrics) => void;
    reject: (e: Error) => void;
    durationMs: number;
  } | null = null;
  private measurementBlockCount = 0;

  // Local calibration session
  private localSession: CalibrationSessionState | null = null;

  constructor(
    private onChunk: (b64: string) => void,
    private onClap: () => void = () => undefined,
  ) {}

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
          const now = performance.now();
          const result = this.wakeDetector.evaluate(input, now);
          if (result.detected) {
            for (const listener of this.localSession.listeners) {
              listener(result.measurement);
            }
          }
          return;
        }
        // Ordinary clap wake
        if (this.wakeDetector.process(input, performance.now())) this.onClap();
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
    this.measurementBlocks = [];
    this.measurementPending = null;
    this.localSession = null;
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
    if (this.measurementPending) {
      return Promise.reject(new Error('Measurement already in progress'));
    }

    let resolveFn!: (m: AudioWindowMetrics) => void;
    let rejectFn!: (e: Error) => void;

    const promise = new Promise<AudioWindowMetrics>((resolve, reject) => {
      if (request.signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const onAbort = () => {
        this.measurementPending = null;
        this.measurementBlocks = [];
        reject(new DOMException('Aborted', 'AbortError'));
      };
      request.signal.addEventListener('abort', onAbort, { once: true });
      resolveFn = (m) => {
        this.measurementPending = null;
        resolve(m);
      };
      rejectFn = reject;
    });

    this.measurementBlocks = [];
    this.measurementBlockCount = 0;
    this.measurementPending = {
      promise,
      resolve: resolveFn,
      reject: rejectFn,
      durationMs: request.durationMs,
    };

    return promise;
  }

  /** Resolve the active measurement window with current aggregates. */
  completeMeasurement(): void {
    if (!this.measurementPending) return;
    const metrics = this.computeMetrics(this.measurementPending.durationMs);
    this.measurementPending.resolve(metrics);
    this.measurementPending = null;
  }

  /** Read-only summary for inspection (test/debug only). */
  getMeasurementSummary(): { blockCount: number; rmsMean: number } {
    const rmsValues = this.measurementBlocks.map((b) => b.rms).filter((v) => Number.isFinite(v));
    const rmsMean = rmsValues.length > 0
      ? rmsValues.reduce((sum, v) => sum + v, 0) / rmsValues.length
      : 0;
    return { blockCount: this.measurementBlockCount, rmsMean };
  }

  /**
   * Open a local calibration session. Only one session can be active.
   * Returns null if a session is already open.
   */
  openLocalSession(): LocalCalibrationSession | null {
    if (this.localSession) return null;
    this.localSession = { listeners: new Set() };
    const self = this;
    return {
      get identity() {
        return {
          label: 'Microphone',
          deviceHash: 'local-device-hash',
          sampleRate: self.ctx?.sampleRate ?? 48_000,
        };
      },
      measure(request: AudioMeasurementRequest): Promise<AudioWindowMetrics> {
        return self.measure(request);
      },
      observeClaps(listener: (measurement: ClapMeasurement) => void): () => void {
        self.localSession?.listeners.add(listener);
        return () => {
          self.localSession?.listeners.delete(listener);
        };
      },
      close(): void {
        self.localSession = null;
        // Reject pending measurement on session close
        if (self.measurementPending) {
          self.measurementPending.reject(new Error('Session closed'));
          self.measurementPending = null;
          self.measurementBlocks = [];
        }
      },
    };
  }

  /** Install temporary detector thresholds (for LIVE_CANARY). */
  installTemporaryProfile(profile: Partial<ClapWakeCalibratedThresholds>): void {
    this.wakeDetector.installTemporaryProfile(profile);
  }

  /** Restore default detector thresholds. */
  restoreDefaultProfile(): void {
    this.wakeDetector.restoreProfile(null);
  }

  // --- private helpers ---

  private feedMeasurementBlock(input: Float32Array): void {
    if (!this.measurementPending) return;
    this.measurementBlockCount++;

    let sumSquares = 0;
    let peak = 0;
    let clipCount = 0;
    let sustainedCount = 0;
    let validSamples = 0;

    for (let i = 0; i < input.length; i++) {
      const s = input[i];
      if (!Number.isFinite(s)) continue;
      validSamples++;
      const abs = Math.abs(s);
      peak = Math.max(peak, abs);
      sumSquares += s * s;
      if (abs >= 0.99) clipCount++;
      if (abs > 0.02) sustainedCount++;
    }

    const rms = validSamples > 0 ? Math.sqrt(sumSquares / validSamples) : 0;
    this.measurementBlocks.push({ rms, peak, clipCount, sustainedCount, totalSamples: input.length });
  }

  private computeMetrics(durationMs: number): AudioWindowMetrics {
    const rmsValues = this.measurementBlocks.map((b) => b.rms).filter((v) => Number.isFinite(v));
    const peaks = this.measurementBlocks.map((b) => b.peak).filter((v) => Number.isFinite(v));
    const totalSamples = this.measurementBlocks.reduce((sum, b) => sum + b.totalSamples, 0);
    const totalClips = this.measurementBlocks.reduce((sum, b) => sum + b.clipCount, 0);
    const totalSustained = this.measurementBlocks.reduce((sum, b) => sum + b.sustainedCount, 0);

    let rmsP95 = 0;
    if (rmsValues.length > 0) {
      const sorted = [...rmsValues].sort((a, b) => a - b);
      const idx = Math.ceil(sorted.length * 0.95) - 1;
      rmsP95 = sorted[Math.max(0, idx)];
    }

    return {
      durationMs,
      sampleCount: totalSamples,
      blockCount: this.measurementBlocks.length,
      rmsMin: rmsValues.length > 0 ? Math.min(...rmsValues) : 0,
      rmsMax: rmsValues.length > 0 ? Math.max(...rmsValues) : 0,
      rmsMean: rmsValues.length > 0 ? rmsValues.reduce((s, v) => s + v, 0) / rmsValues.length : 0,
      rmsP95,
      peakMax: peaks.length > 0 ? Math.max(...peaks) : 0,
      clipCount: totalClips,
      clippedSampleFraction: totalSamples > 0 ? totalClips / totalSamples : 0,
      sustainedEnergyFraction: totalSamples > 0 ? totalSustained / totalSamples : 0,
    };
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

/** Speaker playback: plays 24kHz 16-bit PCM base64 chunks, gapless, with interrupt. */
export class SpeakerPlayback {
  private ctx: AudioContext | null;
  private nextStart = 0;
  private sources: AudioBufferSourceNode[] = [];
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
  }

  /** True while any playback is scheduled/active (used by the barge-in VAD). */
  isPlaying() {
    return this.sources.length > 0;
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
