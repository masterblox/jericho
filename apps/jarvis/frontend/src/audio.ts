/** Mic capture: resamples device input to 16kHz 16-bit PCM, emits base64 chunks.
 *  Supports start()/stop() so the mic hardware can be released in standby —
 *  that lets Chrome's SpeechRecognition (wake word) get exclusive mic access. */
export class MicCapture {
  private ctx: AudioContext | null = null;
  private proc: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private muted = false;
  private rms = 0; // smoothed input energy (0..~0.5) for voice-activity detection

  constructor(private onChunk: (b64: string) => void) {}

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
      if (this.muted) return;
      const input = e.inputBuffer.getChannelData(0);
      // track input energy for client-side barge-in (VAD)
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const r = Math.sqrt(sum / input.length);
      this.rms = this.rms * 0.6 + r * 0.4;
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
  }

  /** Pause sending (wake-word mode) without tearing down the stream. */
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
