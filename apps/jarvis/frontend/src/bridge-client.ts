import { MicCapture, SpeakerPlayback } from './audio';
import {
  parseGroundedResultMessage,
  type GroundedResultPayload,
} from './grounded-result';

export type { GroundedResultPayload } from './grounded-result';

export interface BridgeWebSocketPort {
  readyState: number;
  onopen: ((event: Event) => void | Promise<void>) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface BridgeMicPort {
  readonly live: boolean;
  start(): Promise<void>;
  stop(): void;
  setMuted(muted: boolean): void;
  getRms(): number;
}

export interface BridgeSpeakerPort {
  resume(): Promise<void>;
  enqueue(data: string): void;
  interrupt(): void;
  isPlaying(): boolean;
  dispose(): void | Promise<void>;
}

export interface BridgeClientDependencies {
  createMic?: (
    onChunk: (data: string) => void,
    onClap: () => void,
  ) => BridgeMicPort;
  createSpeaker?: () => BridgeSpeakerPort;
  createWebSocket?: (url: string) => BridgeWebSocketPort;
  activeTurnMs?: number;
}

export type PersonaMode = 'jarvis' | 'megatron';

export interface BridgeEvents {
  onReady?: () => void;
  onVoices?: (voices: string[], active: string, meta?: { confirmed?: string; auditionSentence?: string }) => void;
  onVoiceSwitching?: (voice: string) => void;
  onVoiceFailed?: (voice: string) => void;
  onVoicePreview?: (state: { previewId: string; voice: string; status: string }) => void;
  onVoiceConfirmed?: (voice: string, confirmedAt: string) => void;
  onModeChange?: (mode: PersonaMode, name: string) => void;
  onModePending?: (mode: PersonaMode, name: string) => void;
  onArmed?: (armed: boolean) => void;
  onText?: (text: string) => void;
  onToolStart?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: Record<string, unknown>) => void;
  onGuidedTestStart?: (test: 'isabella', phase?: string) => void;
  onGuidedTestResume?: (test: 'isabella', phase?: string) => void;
  onGuidedTestEnd?: (test: 'isabella') => void;
  onGuidedTestPhase?: (detail: { test: 'isabella'; phase: string; evidence?: Record<string, unknown> }) => void;
  onGroundedResult?: (result: GroundedResultPayload) => void;
  onSpeechPlaying?: (playing: boolean) => void;
  onStatus?: (status: string) => void;
  onError?: (msg: string) => void;
  onWake?: (source: 'clap' | 'manual') => void;
}

const DEFAULT_ACTIVE_TURN_MS = 30_000;
const REMOTE_WAKE_GRACE_MS = 1_500;

type VoiceTurnState = 'standby' | 'greeting' | 'waiting' | 'active';

/** Privacy gate around the transient local mic and remote live-audio session. */
export class BridgeClient {
  private ws: BridgeWebSocketPort | null = null;
  private mic: BridgeMicPort;
  private spk: BridgeSpeakerPort;
  private started = false;
  private disposed = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private turnState: VoiceTurnState = 'standby';
  private previewPlaying = false;
  private speechPlaying = false;
  // client-side barge-in VAD
  private noiseFloor = 0.012;
  private vadTimer: ReturnType<typeof setInterval> | null = null;
  private bargeCooldown = 0;

  private readonly createWebSocket: (url: string) => BridgeWebSocketPort;
  private readonly activeTurnMs: number;

  constructor(private events: BridgeEvents = {}, dependencies: BridgeClientDependencies = {}) {
    this.spk = dependencies.createSpeaker?.() ?? new SpeakerPlayback();
    this.createWebSocket = dependencies.createWebSocket ?? ((url) => new WebSocket(url));
    this.activeTurnMs = dependencies.activeTurnMs ?? DEFAULT_ACTIVE_TURN_MS;
    if (!Number.isFinite(this.activeTurnMs) || this.activeTurnMs <= 0) {
      throw new Error('Active voice turn duration must be positive');
    }
    const onChunk = (b64: string) => {
      if (this.turnState === 'active' && this.ws?.readyState === 1) {
        this.ws.send(JSON.stringify({ type: 'audio', data: b64 }));
      }
    };
    const onClap = () => this.wake('clap');
    this.mic = dependencies.createMic?.(onChunk, onClap) ?? new MicCapture(onChunk, onClap);
  }

  async start() {
    if (this.started) return;
    if (this.disposed) throw new Error('Voice bridge is disposed');
    this.started = true;
    this.enterStandby();
    this.connect();
    try {
      // Standby capture is local-only. Start it independently of the remote
      // voice socket so clap wake remains useful during reconnects/outages.
      await this.mic.start();
      if (!this.started || this.disposed) {
        this.mic.stop();
        return;
      }
      this.startVAD();
      void this.spk.resume();
      this.events.onStatus?.('standby');
    } catch (err) {
      this.events.onError?.(`mic: ${(err as Error).message}`);
    }
  }

  stop() {
    this.started = false;
    if (this.retry) {
      clearTimeout(this.retry);
      this.retry = null;
    }
    if (this.vadTimer) {
      clearInterval(this.vadTimer);
      this.vadTimer = null;
    }
    this.enterStandby({ interrupt: true });
    this.publishSpeechPlaying(false);
    const socket = this.ws;
    this.ws = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      if (socket.readyState === 0 || socket.readyState === 1) {
        try {
          socket.close(1000, 'client stop');
        } catch {
          /* already closed */
        }
      }
    }
    this.mic.stop();
    this.spk.interrupt();
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    await this.spk.dispose();
  }

  setVoice(voice: string) {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'set_voice', voice }));
    }
  }

  previewVoice(voice: string, previewId = crypto.randomUUID()) {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'preview_voice', voice, previewId }));
    }
    return previewId;
  }

  cancelVoicePreview() {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'cancel_preview' }));
    }
  }

  confirmVoice(voice: string) {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'confirm_voice', voice }));
    }
  }

  completeGuidedPhase(phase: string) {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'guided_phase_complete', phase }));
    }
  }

  setMode(mode: PersonaMode) {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'set_mode', mode }));
    }
  }

  /** True while Jarvis speech chunks are scheduled or actively playing. */
  isSpeechPlaying(): boolean {
    return this.spk.isPlaying();
  }

  /** Manual wake fallback. Clap detection enters through this same local gate. */
  wake(source: 'clap' | 'manual' = 'manual') {
    const socket = this.ws;
    if (
      !this.started ||
      this.disposed ||
      this.turnState !== 'standby'
    ) return;

    this.mic.setMuted(true);
    this.events.onWake?.(source);
    if (!socket || this.ws !== socket || socket.readyState !== 1) {
      this.turnState = 'waiting';
      this.events.onStatus?.('voice-connecting');
      this.turnTimer = setTimeout(() => {
        if (this.turnState !== 'waiting') return;
        this.enterStandby();
        this.events.onStatus?.('voice-unavailable');
      }, REMOTE_WAKE_GRACE_MS);
      return;
    }
    this.requestRemoteGreeting(socket);
  }

  private requestRemoteGreeting(socket: BridgeWebSocketPort): void {
    if (this.ws !== socket || socket.readyState !== 1 || !this.started || this.disposed) return;
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    socket.send(JSON.stringify({ type: 'wake' }));
    this.turnState = 'greeting';
    this.events.onStatus?.('greeting');
  }

  private beginListening(): void {
    if (this.turnState !== 'greeting') return;
    this.turnState = 'active';
    this.mic.setMuted(false);
    this.events.onArmed?.(true);
    this.events.onStatus?.('listening');
    this.turnTimer = setTimeout(() => {
      if (this.turnState !== 'active') return;
      if (this.ws?.readyState === 1) {
        this.ws.send(JSON.stringify({ type: 'standby', reason: 'timeout' }));
      }
      this.enterStandby({ interrupt: true });
    }, this.activeTurnMs);
  }

  /**
   * Client-side barge-in. Learns the room's noise floor while the speaker is
   * silent, then — while JARVIS is talking — if mic energy rises well above
   * that floor, hard-stops the speaker immediately.
   */
  private startVAD() {
    if (this.vadTimer) return;
    this.vadTimer = setInterval(() => {
      const rms = this.mic.getRms();
      this.publishSpeechPlaying(this.spk.isPlaying());
      if (this.turnState === 'active' && this.spk.isPlaying()) {
        if (rms > this.noiseFloor * 3 + 0.012 && Date.now() - this.bargeCooldown > 700) {
          this.bargeCooldown = Date.now();
          this.spk.interrupt();
          this.publishSpeechPlaying(false);
        }
      } else if (this.mic.live) {
        // learn background noise while nobody is speaking (mic must be live)
        this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05;
      }
    }, 90);
  }

  private connect() {
    if (!this.started || this.disposed) return;
    if (this.retry) {
      clearTimeout(this.retry);
      this.retry = null;
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = this.createWebSocket(`${proto}://${location.host}/ws`);
    this.ws = socket;
    socket.onopen = () => {
      if (this.ws !== socket || !this.started || this.disposed) return;
      void this.spk.resume();
      if (this.turnState === 'waiting') {
        this.requestRemoteGreeting(socket);
        return;
      }
      if (this.turnState === 'standby') this.events.onStatus?.('standby');
    };
    socket.onmessage = (event) => {
      if (this.ws === socket) this.onMessage(String(event.data));
    };
    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.ws = null;
      this.events.onStatus?.('reconnecting');
      this.enterStandby({ interrupt: true });
      if (this.started && !this.disposed) this.retry = setTimeout(() => this.connect(), 1500);
    };
    socket.onerror = () => {
      if (this.ws === socket) this.events.onError?.('websocket error');
    };
  }

  private onMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'ready':
        this.events.onReady?.();
        break;
      case 'voices':
        this.events.onVoices?.(msg.voices, msg.active, {
          confirmed: msg.confirmed,
          auditionSentence: msg.auditionSentence,
        });
        break;
      case 'voice_switching':
        this.enterStandby({ interrupt: true });
        this.spk.interrupt();
        this.publishSpeechPlaying(false);
        this.events.onVoiceSwitching?.(msg.voice);
        break;
      case 'voice_failed':
        this.events.onVoiceFailed?.(msg.voice);
        break;
      case 'voice_preview':
        this.previewPlaying = msg.status === 'playing';
        if (msg.status !== 'playing') {
          this.spk.interrupt();
          this.publishSpeechPlaying(false);
        }
        this.events.onVoicePreview?.({
          previewId: msg.previewId,
          voice: msg.voice,
          status: msg.status,
        });
        break;
      case 'voice_confirmed':
        this.previewPlaying = false;
        this.events.onVoiceConfirmed?.(msg.voice, msg.confirmedAt);
        break;
      case 'mode_change':
        this.events.onModeChange?.(msg.mode, msg.name);
        break;
      case 'mode_pending':
        this.events.onModePending?.(msg.mode, msg.name);
        break;
      case 'armed':
        if (!msg.armed && this.turnState === 'active') this.enterStandby();
        this.events.onArmed?.(!!msg.armed);
        break;
      case 'audio':
        if (this.turnState === 'greeting' || this.turnState === 'active' || this.previewPlaying) {
          this.spk.enqueue(msg.data);
          this.publishSpeechPlaying(true);
        }
        break;
      case 'greeting_started':
        if (this.turnState === 'greeting') this.events.onStatus?.('greeting');
        break;
      case 'greeting_complete':
        // hasGreeted fast-path can deliver this before wake() finishes moving
        // standby/waiting → greeting. Promote so beginListening is not a no-op.
        if (this.turnState === 'active') break;
        if (this.turnState === 'standby' || this.turnState === 'waiting') {
          this.turnState = 'greeting';
        }
        this.beginListening();
        break;
      case 'interrupt':
        this.spk.interrupt();
        this.publishSpeechPlaying(false);
        break;
      case 'turn_complete':
        this.enterStandby();
        break;
      case 'grounded_result': {
        const { type: _, ...payload } = msg;
        const result = parseGroundedResultMessage(payload);
        if (result) this.events.onGroundedResult?.(result);
        break;
      }
      case 'text':
        this.events.onText?.(msg.text);
        break;
      case 'tool_start':
        this.events.onToolStart?.(msg.name, msg.args);
        break;
      case 'tool_result':
        this.events.onToolResult?.(msg.name, msg.result);
        break;
      case 'guided_test_start':
        if (msg.test === 'isabella') this.events.onGuidedTestStart?.('isabella', msg.phase);
        break;
      case 'guided_test_resume':
        if (msg.test === 'isabella') {
          this.events.onGuidedTestResume?.('isabella', msg.phase);
          if (this.turnState === 'greeting') this.events.onStatus?.('guided-test-listening');
        }
        break;
      case 'guided_test_end':
        if (msg.test === 'isabella') this.events.onGuidedTestEnd?.('isabella');
        break;
      case 'guided_test_phase':
        if (msg.test === 'isabella') {
          this.events.onGuidedTestPhase?.({
            test: 'isabella',
            phase: msg.phase,
            evidence: msg.evidence,
          });
        }
        break;
      case 'error':
        if (this.turnState === 'greeting' || this.turnState === 'waiting') {
          this.enterStandby({ interrupt: true });
          this.events.onStatus?.('voice-unavailable');
        }
        this.events.onError?.(msg.message);
        break;
      case 'closed':
        this.enterStandby({ interrupt: true });
        this.events.onStatus?.('session-closed');
        break;
    }
  }

  private enterStandby(options: { interrupt?: boolean } = {}): void {
    const changed = this.turnState !== 'standby';
    this.turnState = 'standby';
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    this.mic.setMuted(true);
    if (options.interrupt) this.spk.interrupt();
    if (options.interrupt || !this.spk.isPlaying()) this.publishSpeechPlaying(false);
    if (changed) {
      this.events.onArmed?.(false);
      this.events.onStatus?.('standby');
    }
  }

  private publishSpeechPlaying(playing: boolean): void {
    if (this.speechPlaying === playing) return;
    this.speechPlaying = playing;
    this.events.onSpeechPlaying?.(playing);
  }
}
