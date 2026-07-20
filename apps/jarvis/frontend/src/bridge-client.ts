import {
  assertGroundedTurnProgressEvent,
  CALIBRATION_PHRASES,
  type CalibrationPhraseId,
  type GroundedTurnProgressEvent,
} from '@jericho/shared';
import {
  MicCapture,
  SpeakerPlayback,
  type ClapWakeCalibratedThresholds,
  type LocalCalibrationSession,
} from './audio';
import {
  parseGroundedResultMessage,
  type GroundedResultPayload,
} from './grounded-result';

export type { GroundedResultPayload } from './grounded-result';
export { CALIBRATION_PHRASES } from '@jericho/shared';
export type { CalibrationPhraseId, GroundedTurnProgressEvent } from '@jericho/shared';

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
  openLocalSession(): Promise<LocalCalibrationSession | null>;
  installTemporaryProfile(profile: Partial<ClapWakeCalibratedThresholds>): void;
  restoreProfile(profile?: Partial<ClapWakeCalibratedThresholds> | null): void;
}

export interface BridgeSpeakerPort {
  resume(): Promise<void>;
  enqueue(data: string): void;
  interrupt(): void;
  isPlaying(): boolean;
  whenDrained(): Promise<void>;
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

const VALID_PHRASE_IDS = new Set<string>(Object.keys(CALIBRATION_PHRASES));

export type CalibrationGreetingPhase = 'started' | 'complete';
export type CalibrationNarrationEvent = { resultId: string; phase: 'started' | 'complete' };

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
  onCalibrationTurnProgress?: (event: GroundedTurnProgressEvent) => void;
  onCalibrationNarration?: (event: { resultId: string; phase: 'started' | 'complete' }) => void;
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
  private wakePending = false;
  // client-side barge-in VAD
  private noiseFloor = 0.012;
  private vadTimer: ReturnType<typeof setInterval> | null = null;
  private bargeCooldown = 0;

  // calibration state
  private canaryActive = false;
  private pendingNarrationResultId: string | null = null;
  private narrationStartedResultId: string | null = null;
  private phraseRequest: {
    phraseId: CalibrationPhraseId;
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private readonly progressListeners = new Set<(event: GroundedTurnProgressEvent) => void>();
  private readonly narrationListeners = new Set<(event: CalibrationNarrationEvent) => void>();
  private readonly greetingListeners = new Set<(phase: CalibrationGreetingPhase) => void>();
  private readonly wakeListeners = new Set<(source: 'clap' | 'manual') => void>();
  private readonly groundedResultListeners = new Set<(result: GroundedResultPayload) => void>();

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
    this.cancelPhrase('Voice bridge stopped');
    this.cancelNarration();
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

  speakCalibrationPhrase(phraseId: CalibrationPhraseId): Promise<void> {
    if (!VALID_PHRASE_IDS.has(phraseId)) {
      return Promise.reject(new Error(`Invalid calibration phrase: ${phraseId}`));
    }
    if (this.phraseRequest) {
      return Promise.reject(new Error('Calibration phrase already in progress'));
    }
    if (!this.started || this.disposed || this.ws?.readyState !== 1) {
      return Promise.reject(new Error('Calibration phrase transport is unavailable'));
    }
    this.enterStandby({ interrupt: true });
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.phraseRequest?.phraseId !== phraseId) return;
        this.cancelPhrase('Calibration phrase timed out');
      }, 8_000);
      this.phraseRequest = { phraseId, resolve, reject, timer };
      try {
        this.ws!.send(JSON.stringify({ type: 'calibration_phrase', phraseId }));
      } catch {
        this.cancelPhrase('Calibration phrase transport failed');
      }
    });
  }

  cancelCalibrationPhrase(): void {
    this.cancelPhrase('Calibration phrase cancelled');
  }

  async openLocalSession(): Promise<LocalCalibrationSession | null> {
    if (!this.started || this.disposed) return null;
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'standby', reason: 'calibration' }));
    }
    this.enterStandby({ interrupt: true });
    return this.mic.openLocalSession();
  }

  installTemporaryProfile(profile: Partial<ClapWakeCalibratedThresholds>): void {
    this.mic.installTemporaryProfile(profile);
  }

  restoreProfile(profile: Partial<ClapWakeCalibratedThresholds> | null = null): void {
    this.mic.restoreProfile(profile);
  }

  beginLiveCanary(): void {
    this.canaryActive = true;
    this.cancelNarration();
  }

  endLiveCanary(): void {
    this.canaryActive = false;
    this.cancelNarration();
  }

  addCalibrationTurnProgressListener(listener: (event: GroundedTurnProgressEvent) => void): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  addCalibrationNarrationListener(listener: (event: CalibrationNarrationEvent) => void): () => void {
    this.narrationListeners.add(listener);
    return () => this.narrationListeners.delete(listener);
  }

  addCalibrationGreetingListener(listener: (phase: CalibrationGreetingPhase) => void): () => void {
    this.greetingListeners.add(listener);
    return () => this.greetingListeners.delete(listener);
  }

  addCalibrationWakeListener(listener: (source: 'clap' | 'manual') => void): () => void {
    this.wakeListeners.add(listener);
    return () => this.wakeListeners.delete(listener);
  }

  addCalibrationGroundedResultListener(listener: (result: GroundedResultPayload) => void): () => void {
    this.groundedResultListeners.add(listener);
    return () => this.groundedResultListeners.delete(listener);
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
    if (this.canaryActive) {
      for (const listener of this.wakeListeners) listener(source);
    }
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
    this.wakePending = true;
    this.events.onStatus?.('greeting');
  }

  private beginListening(): void {
    if (this.turnState !== 'greeting' || !this.wakePending) return;
    this.wakePending = false;
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
      this.cancelPhrase('Calibration phrase transport closed');
      this.cancelNarration();
      this.events.onStatus?.('reconnecting');
      this.enterStandby({ interrupt: true });
      if (this.started && !this.disposed) this.retry = setTimeout(() => this.connect(), 1500);
    };
    socket.onerror = () => {
      if (this.ws !== socket) return;
      // Transport failure must never leave the mic armed or wakePending set.
      this.enterStandby({ interrupt: true });
      this.cancelPhrase('Calibration phrase transport failed');
      this.cancelNarration();
      this.events.onError?.('websocket error');
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
        this.cancelPhrase('Calibration phrase transport changed');
        this.cancelNarration();
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
          this.startNarrationIfCorrelated();
          this.spk.enqueue(msg.data);
          this.publishSpeechPlaying(true);
        }
        break;
      case 'greeting_started':
        if (this.turnState === 'greeting') {
          this.events.onStatus?.('greeting');
          if (this.canaryActive) this.publishGreeting('started');
        }
        break;
      case 'greeting_complete':
        if (!this.wakePending || this.turnState !== 'greeting') break;
        if (this.canaryActive) this.publishGreeting('complete');
        this.beginListening();
        break;
      case 'interrupt':
        this.spk.interrupt();
        this.cancelNarration();
        this.publishSpeechPlaying(false);
        break;
      case 'turn_complete':
        void this.completeNarrationAfterDrain();
        this.enterStandby();
        break;
      case 'calibration_phrase_audio':
        if (
          this.phraseRequest
          && msg.phraseId === this.phraseRequest.phraseId
          && typeof msg.data === 'string'
        ) {
          this.spk.enqueue(msg.data);
        }
        break;
      case 'calibration_phrase':
        this.handleCalibrationPhraseStatus(msg);
        break;
      case 'grounded_result': {
        const { type: _, ...payload } = msg;
        const result = parseGroundedResultMessage(payload);
        if (result) {
          this.events.onGroundedResult?.(result);
          for (const listener of this.groundedResultListeners) listener(result);
        }
        break;
      }
      case 'grounded_turn_progress': {
        const { type: _, ...payload } = msg;
        try {
          assertGroundedTurnProgressEvent(payload);
          const event = payload;
          this.events.onCalibrationTurnProgress?.(event);
          for (const listener of this.progressListeners) listener(event);

          if (this.canaryActive && event.milestone === 'terminal_result_sent' && event.resultId) {
            this.pendingNarrationResultId = event.resultId;
          }
        } catch { /* malformed correlation frames are ignored */ }
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
        this.cancelPhrase('Calibration phrase transport failed');
        this.cancelNarration();
        if (
          this.turnState === 'greeting'
          || this.turnState === 'waiting'
          || this.turnState === 'active'
        ) {
          this.enterStandby({ interrupt: true });
          this.events.onStatus?.('voice-unavailable');
        }
        this.events.onError?.(msg.message);
        break;
      case 'closed':
        this.cancelPhrase('Calibration phrase transport closed');
        this.cancelNarration();
        this.enterStandby({ interrupt: true });
        this.events.onStatus?.('session-closed');
        break;
    }
  }

  private enterStandby(options: { interrupt?: boolean } = {}): void {
    const changed = this.turnState !== 'standby';
    this.turnState = 'standby';
    this.wakePending = false;
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    this.mic.setMuted(true);
    this.previewPlaying = false;
    if (options.interrupt) {
      this.spk.interrupt();
      this.cancelNarration();
    }
    if (!this.spk.isPlaying()) {
      this.publishSpeechPlaying(false);
    }
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

  private handleCalibrationPhraseStatus(message: Record<string, unknown>): void {
    const request = this.phraseRequest;
    if (!request) return;
    if (message.phraseId !== undefined && message.phraseId !== request.phraseId) return;
    if (message.status === 'complete') {
      void this.completePhraseAfterDrain(request);
      return;
    }
    if (message.status === 'unavailable') {
      const reason = typeof message.reason === 'string' ? message.reason : 'unavailable';
      this.cancelPhrase(`Calibration phrase unavailable: ${reason}`);
    }
  }

  private async completePhraseAfterDrain(request: NonNullable<BridgeClient['phraseRequest']>): Promise<void> {
    await this.spk.whenDrained();
    if (this.phraseRequest !== request) return;
    clearTimeout(request.timer);
    this.phraseRequest = null;
    request.resolve();
  }

  private cancelPhrase(message: string): void {
    const request = this.phraseRequest;
    if (!request) return;
    clearTimeout(request.timer);
    this.phraseRequest = null;
    request.reject(new Error(message));
  }

  private publishGreeting(phase: CalibrationGreetingPhase): void {
    for (const listener of this.greetingListeners) listener(phase);
  }

  private startNarrationIfCorrelated(): void {
    if (
      !this.canaryActive
      || this.turnState !== 'active'
      || this.previewPlaying
      || this.phraseRequest
      || !this.pendingNarrationResultId
      || this.narrationStartedResultId
    ) return;
    this.narrationStartedResultId = this.pendingNarrationResultId;
    this.publishNarration({ resultId: this.narrationStartedResultId, phase: 'started' });
  }

  private async completeNarrationAfterDrain(): Promise<void> {
    const resultId = this.narrationStartedResultId;
    if (!this.canaryActive || !resultId) return;
    await this.spk.whenDrained();
    if (!this.canaryActive || this.narrationStartedResultId !== resultId) return;
    this.publishNarration({ resultId, phase: 'complete' });
    this.pendingNarrationResultId = null;
    this.narrationStartedResultId = null;
  }

  private publishNarration(event: CalibrationNarrationEvent): void {
    this.events.onCalibrationNarration?.(event);
    for (const listener of this.narrationListeners) listener(event);
  }

  private cancelNarration(): void {
    this.pendingNarrationResultId = null;
    this.narrationStartedResultId = null;
  }
}
