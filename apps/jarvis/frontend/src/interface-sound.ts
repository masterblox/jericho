import {
  INTERFACE_SOUND_CUES,
  INTERFACE_SOUND_EVENT,
  INTERFACE_SOUND_MUTE_KEY,
  INTERFACE_SOUND_TOGGLE_EVENT,
  SPEECH_PLAYING_EVENT,
  parseInterfaceSoundDetail,
  type InterfaceSoundCue,
} from './grounded-result';

/** Master gain ≈ -24 dB. */
export const INTERFACE_SOUND_MASTER_GAIN = 10 ** (-24 / 20);

/** Additional attenuation while Jarvis speech is playing (≈ -12 dB more). */
export const INTERFACE_SOUND_DUCK_GAIN = 10 ** (-12 / 20);

const DEDUPE_LIMIT = 256;
const MAX_OSCILLATORS_PER_CUE = 4;
const MAX_CUE_MS = 900;

export interface InterfaceSoundStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface InterfaceSoundEngineOptions {
  eventTarget?: EventTarget;
  storage?: InterfaceSoundStorage;
  createAudioContext?: () => AudioContext;
  isSpeechPlaying?: () => boolean;
  now?: () => number;
}

type OscillatorKind = OscillatorType;

interface ScheduledNode {
  stop(): void;
  disconnect(): void;
}

/**
 * Subtle cinematic interface cues. Separate from Jarvis speech playback —
 * generates short Web Audio oscillator pulses and fails silently when the
 * AudioContext is unavailable or not yet permitted.
 */
export class InterfaceSoundEngine {
  private readonly eventTarget: EventTarget;
  private readonly storage: InterfaceSoundStorage;
  private readonly createAudioContext: () => AudioContext;
  private readonly isSpeechPlaying: () => boolean;
  private readonly now: () => number;
  private readonly played = new Set<string>();
  private readonly playedOrder: string[] = [];
  private readonly activeNodes = new Set<ScheduledNode>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private speechPlaying = false;
  private disposed = false;
  private duckTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onSound: EventListener = (event) => this.handleSound(event);
  private readonly onToggle: EventListener = (event) => this.handleToggle(event);
  private readonly onSpeech: EventListener = (event) => this.handleSpeech(event);

  constructor(options: InterfaceSoundEngineOptions = {}) {
    this.eventTarget = options.eventTarget ?? defaultEventTarget();
    this.storage = options.storage ?? defaultStorage();
    this.createAudioContext = options.createAudioContext ?? (() => new AudioContext());
    this.isSpeechPlaying = options.isSpeechPlaying ?? (() => false);
    this.now = options.now ?? (() => performance.now());
    this.muted = this.storage.getItem(INTERFACE_SOUND_MUTE_KEY) === 'true';
    this.eventTarget.addEventListener(INTERFACE_SOUND_EVENT, this.onSound);
    this.eventTarget.addEventListener(INTERFACE_SOUND_TOGGLE_EVENT, this.onToggle);
    this.eventTarget.addEventListener(SPEECH_PLAYING_EVENT, this.onSpeech);
    this.duckTimer = setInterval(() => this.syncMasterGain(), 100);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    if (this.disposed) return;
    this.muted = muted;
    try {
      this.storage.setItem(INTERFACE_SOUND_MUTE_KEY, muted ? 'true' : 'false');
    } catch {
      /* storage may be unavailable */
    }
    this.syncMasterGain();
  }

  setSpeechPlaying(playing: boolean): void {
    if (this.disposed) return;
    this.speechPlaying = playing;
    this.syncMasterGain();
  }

  /** Test helper: whether a `{resultId, cue}` pair has already been consumed. */
  hasPlayed(resultId: string, cue: InterfaceSoundCue): boolean {
    return this.played.has(dedupeKey(resultId, cue));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.eventTarget.removeEventListener(INTERFACE_SOUND_EVENT, this.onSound);
    this.eventTarget.removeEventListener(INTERFACE_SOUND_TOGGLE_EVENT, this.onToggle);
    this.eventTarget.removeEventListener(SPEECH_PLAYING_EVENT, this.onSpeech);
    if (this.duckTimer) {
      clearInterval(this.duckTimer);
      this.duckTimer = null;
    }
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const node of this.activeNodes) {
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    this.activeNodes.clear();
    this.played.clear();
    this.playedOrder.length = 0;
    const context = this.ctx;
    this.master = null;
    this.ctx = null;
    if (context && context.state !== 'closed') {
      void context.close().catch(() => undefined);
    }
  }

  private handleSound(event: Event): void {
    if (this.disposed || this.muted) return;
    const detail = parseInterfaceSoundDetail((event as CustomEvent).detail);
    if (!detail) return;
    const key = dedupeKey(detail.resultId, detail.cue);
    if (this.played.has(key)) return;
    this.remember(key);
    this.playCue(detail.cue);
  }

  private handleToggle(event: Event): void {
    if (this.disposed) return;
    const detail = (event as CustomEvent<{ muted?: boolean }>).detail;
    if (detail && typeof detail.muted === 'boolean') this.setMuted(detail.muted);
    else this.setMuted(!this.muted);
  }

  private handleSpeech(event: Event): void {
    const playing = (event as CustomEvent<{ playing?: boolean }>).detail?.playing;
    if (typeof playing === 'boolean') this.setSpeechPlaying(playing);
  }

  private remember(key: string): void {
    this.played.add(key);
    this.playedOrder.push(key);
    while (this.playedOrder.length > DEDUPE_LIMIT) {
      const oldest = this.playedOrder.shift();
      if (oldest) this.played.delete(oldest);
    }
  }

  private playCue(cue: InterfaceSoundCue): void {
    try {
      const ctx = this.ensureContext();
      if (!ctx || !this.master) return;
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => undefined);
      }
      if (ctx.state === 'closed') return;
      this.syncMasterGain();
      const start = ctx.currentTime;
      switch (cue) {
        case 'retrieve':
          this.pulse(ctx, start, 96, 0.42, 'sine', 0.55);
          break;
        case 'summon':
          this.glassyScan(ctx, start);
          break;
        case 'satellite':
          this.positionalTick(ctx, start);
          break;
        case 'lock':
          this.confirmation(ctx, start);
          break;
        case 'dismiss':
          this.reverseScan(ctx, start);
          break;
        default: {
          const _exhaustive: never = cue;
          return _exhaustive;
        }
      }
    } catch {
      /* AudioContext unavailable or not yet permitted */
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.disposed) return null;
    if (this.ctx && this.ctx.state !== 'closed') return this.ctx;
    try {
      const ctx = this.createAudioContext();
      const master = ctx.createGain();
      master.gain.value = this.effectiveMasterGain();
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      return ctx;
    } catch {
      this.ctx = null;
      this.master = null;
      return null;
    }
  }

  private effectiveMasterGain(): number {
    if (this.muted) return 0;
    const speech = this.speechPlaying || this.isSpeechPlaying();
    return INTERFACE_SOUND_MASTER_GAIN * (speech ? INTERFACE_SOUND_DUCK_GAIN : 1);
  }

  private syncMasterGain(): void {
    if (!this.master || this.disposed) return;
    const speech = this.speechPlaying || this.isSpeechPlaying();
    this.speechPlaying = speech;
    try {
      const gain = this.effectiveMasterGain();
      const param = this.master.gain;
      if (this.ctx) {
        param.cancelScheduledValues(this.ctx.currentTime);
        param.setValueAtTime(gain, this.ctx.currentTime);
      } else {
        param.value = gain;
      }
    } catch {
      /* ignore gain updates on closed contexts */
    }
  }

  private pulse(
    ctx: AudioContext,
    start: number,
    frequency: number,
    duration: number,
    type: OscillatorKind,
    peak = 0.7,
  ): void {
    if (!this.master) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), start + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(this.master);
    this.trackAndStart(osc, start, duration);
  }

  private glassyScan(ctx: AudioContext, start: number): void {
    if (!this.master) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(620, start);
    osc.frequency.exponentialRampToValueAtTime(1_480, start + 0.28);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.45, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.36);
    osc.connect(gain);
    gain.connect(this.master);
    this.trackAndStart(osc, start, 0.4);

    const shimmer = ctx.createOscillator();
    const shimmerGain = ctx.createGain();
    shimmer.type = 'sine';
    shimmer.frequency.setValueAtTime(2_100, start + 0.05);
    shimmer.frequency.exponentialRampToValueAtTime(3_200, start + 0.22);
    shimmerGain.gain.setValueAtTime(0.0001, start + 0.05);
    shimmerGain.gain.exponentialRampToValueAtTime(0.18, start + 0.08);
    shimmerGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
    shimmer.connect(shimmerGain);
    shimmerGain.connect(this.master);
    this.trackAndStart(shimmer, start + 0.05, 0.28);
  }

  private positionalTick(ctx: AudioContext, start: number): void {
    if (!this.master) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const pan = 'createStereoPanner' in ctx ? ctx.createStereoPanner() : null;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1_760, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.28, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.07);
    osc.connect(gain);
    if (pan) {
      pan.pan.setValueAtTime(0.35, start);
      gain.connect(pan);
      pan.connect(this.master);
    } else {
      gain.connect(this.master);
    }
    this.trackAndStart(osc, start, 0.09);
  }

  private confirmation(ctx: AudioContext, start: number): void {
    this.pulse(ctx, start, 440, 0.22, 'sine', 0.4);
    this.pulse(ctx, start + 0.05, 660, 0.2, 'sine', 0.28);
  }

  private reverseScan(ctx: AudioContext, start: number): void {
    if (!this.master) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1_320, start);
    osc.frequency.exponentialRampToValueAtTime(280, start + 0.26);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.38, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
    osc.connect(gain);
    gain.connect(this.master);
    this.trackAndStart(osc, start, 0.34);
  }

  private trackAndStart(osc: OscillatorNode, start: number, duration: number): void {
    const bounded = Math.min(duration, MAX_CUE_MS / 1_000);
    if (this.activeNodes.size >= MAX_OSCILLATORS_PER_CUE * INTERFACE_SOUND_CUES.length) {
      try {
        osc.disconnect();
      } catch {
        /* ignore */
      }
      return;
    }
    this.activeNodes.add(osc);
    try {
      osc.start(start);
      osc.stop(start + bounded);
    } catch {
      this.activeNodes.delete(osc);
      return;
    }
    const finish = () => {
      this.activeNodes.delete(osc);
      try {
        osc.disconnect();
      } catch {
        /* ignore */
      }
    };
    osc.onended = finish;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      finish();
    }, Math.ceil(bounded * 1_000) + 50);
    this.timers.add(timer);
  }
}

export function startInterfaceSoundEngine(
  options: InterfaceSoundEngineOptions = {},
): InterfaceSoundEngine {
  return new InterfaceSoundEngine(options);
}

function dedupeKey(resultId: string, cue: InterfaceSoundCue): string {
  return `${resultId}\0${cue}`;
}

function defaultEventTarget(): EventTarget {
  if (typeof document !== 'undefined') return document;
  return new EventTarget();
}

function defaultStorage(): InterfaceSoundStorage {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* ignore */
  }
  const memory = new Map<string, string>();
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => { memory.set(key, value); },
  };
}
