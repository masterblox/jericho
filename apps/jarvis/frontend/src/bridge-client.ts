import { MicCapture, SpeakerPlayback } from './audio';

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
  createMic?: (onChunk: (data: string) => void) => BridgeMicPort;
  createSpeaker?: () => BridgeSpeakerPort;
  createWebSocket?: (url: string) => BridgeWebSocketPort;
}

export interface BridgeEvents {
  onReady?: () => void;
  onVoices?: (voices: string[], active: string) => void;
  onVoiceSwitching?: (voice: string) => void;
  onVoiceFailed?: (voice: string) => void;
  onArmed?: (armed: boolean) => void;
  onText?: (text: string) => void;
  onToolStart?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: Record<string, unknown>) => void;
  onStatus?: (status: string) => void;
  onError?: (msg: string) => void;
}

/**
 * Always-on voice bridge.
 *
 * The mic streams continuously from the moment the WebSocket connects. Gemini
 * Live hears everything and itself decides when to respond (it only speaks
 * after hearing the wake word "JARVIS" — enforced by the system instruction).
 *
 * This replaces the previous Chrome SpeechRecognition wake-word approach,
 * which was unreliable (mic contention, background throttling, silent death).
 *
 * Barge-in is handled two ways:
 *  1. Gemini's native server-side interruption (sc.interrupted).
 *  2. Client-side VAD backup (mic energy above noise floor → hard speaker cut).
 */
export class BridgeClient {
  private ws: BridgeWebSocketPort | null = null;
  private mic: BridgeMicPort;
  private spk: BridgeSpeakerPort;
  private started = false;
  private disposed = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  // client-side barge-in VAD
  private noiseFloor = 0.012;
  private vadTimer: ReturnType<typeof setInterval> | null = null;
  private bargeCooldown = 0;

  private readonly createWebSocket: (url: string) => BridgeWebSocketPort;

  constructor(private events: BridgeEvents = {}, dependencies: BridgeClientDependencies = {}) {
    this.spk = dependencies.createSpeaker?.() ?? new SpeakerPlayback();
    this.createWebSocket = dependencies.createWebSocket ?? ((url) => new WebSocket(url));
    // mic ALWAYS forwards audio while the socket is open — no armed gate.
    // Gemini's system instruction handles the wake word, not the client.
    const onChunk = (b64: string) => {
      if (this.ws?.readyState === 1) {
        this.ws.send(JSON.stringify({ type: 'audio', data: b64 }));
      }
    };
    this.mic = dependencies.createMic?.(onChunk) ?? new MicCapture(onChunk);
  }

  async start() {
    if (this.started) return;
    if (this.disposed) throw new Error('Voice bridge is disposed');
    this.started = true;
    this.connect();
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

  /** Manual nudge — sends a wake signal to the bridge (click-to-talk fallback). */
  wake() {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'wake' }));
    }
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
      if (this.spk.isPlaying()) {
        if (rms > this.noiseFloor * 3 + 0.012 && Date.now() - this.bargeCooldown > 700) {
          this.bargeCooldown = Date.now();
          this.spk.interrupt();
          console.log(`[vad] barge-in rms=${rms.toFixed(4)} floor=${this.noiseFloor.toFixed(4)}`);
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
    socket.onopen = async () => {
      if (this.ws !== socket || !this.started || this.disposed) return;
      // Always-on: acquire the mic immediately and start streaming.
      try {
        await this.mic.start();
        if (this.ws !== socket || !this.started || this.disposed) {
          this.mic.stop();
          return;
        }
        this.mic.setMuted(false);
      } catch (err) {
        this.events.onError?.(`mic: ${(err as Error).message}`);
      }
      this.startVAD();
      void this.spk.resume();
      this.events.onStatus?.('listening');
    };
    socket.onmessage = (event) => {
      if (this.ws === socket) this.onMessage(String(event.data));
    };
    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.ws = null;
      this.events.onStatus?.('reconnecting');
      this.mic.stop();
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
        this.events.onVoices?.(msg.voices, msg.active);
        break;
      case 'voice_switching':
        this.spk.interrupt();
        this.events.onVoiceSwitching?.(msg.voice);
        break;
      case 'voice_failed':
        this.events.onVoiceFailed?.(msg.voice);
        break;
      case 'armed':
        this.events.onArmed?.(!!msg.armed);
        break;
      case 'audio':
        this.spk.enqueue(msg.data);
        break;
      case 'interrupt':
        this.spk.interrupt();
        break;
      case 'text':
        this.events.onText?.(msg.text);
        break;
      case 'tool_start':
        this.events.onToolStart?.(msg.name, msg.args);
        break;
      case 'tool_result':
        this.events.onToolResult?.(msg.name, msg.result);
        break;
      case 'error':
        this.events.onError?.(msg.message);
        break;
      case 'closed':
        this.events.onStatus?.('session-closed');
        break;
    }
  }
}
