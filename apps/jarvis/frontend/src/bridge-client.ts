import { MicCapture, SpeakerPlayback } from './audio';

export type PersonaMode = 'jarvis' | 'megatron';

export interface BridgeEvents {
  onReady?: () => void;
  onVoices?: (voices: string[], active: string) => void;
  onVoiceSwitching?: (voice: string) => void;
  onVoiceFailed?: (voice: string) => void;
  onModeChange?: (mode: PersonaMode, name: string) => void;
  onModePending?: (mode: PersonaMode, name: string) => void;
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
  private ws: WebSocket | null = null;
  private mic: MicCapture;
  private spk: SpeakerPlayback;
  private started = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  // client-side barge-in VAD
  private noiseFloor = 0.012;
  private vadTimer: ReturnType<typeof setInterval> | null = null;
  private bargeCooldown = 0;

  constructor(private events: BridgeEvents = {}) {
    this.spk = new SpeakerPlayback();
    // mic ALWAYS forwards audio while the socket is open — no armed gate.
    // Gemini's system instruction handles the wake word, not the client.
    this.mic = new MicCapture((b64) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'audio', data: b64 }));
      }
    });
  }

  async start() {
    this.started = true;
    this.connect();
  }

  setVoice(voice: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'set_voice', voice }));
    }
  }

  setMode(mode: PersonaMode) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'set_mode', mode }));
    }
  }

  /** Manual nudge — sends a wake signal to the bridge (click-to-talk fallback). */
  wake() {
    if (this.ws?.readyState === WebSocket.OPEN) {
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
    if (this.retry) {
      clearTimeout(this.retry);
      this.retry = null;
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = async () => {
      // Always-on: acquire the mic immediately and start streaming.
      try {
        await this.mic.start();
        this.mic.setMuted(false);
      } catch (err) {
        this.events.onError?.(`mic: ${(err as Error).message}`);
      }
      this.startVAD();
      void this.spk.resume();
      this.events.onStatus?.('listening');
    };
    this.ws.onmessage = (e) => this.onMessage(e.data);
    this.ws.onclose = () => {
      this.events.onStatus?.('reconnecting');
      this.mic.stop();
      if (this.started) this.retry = setTimeout(() => this.connect(), 1500);
    };
    this.ws.onerror = () => this.events.onError?.('websocket error');
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
      case 'mode_change':
        this.events.onModeChange?.(msg.mode, msg.name);
        break;
      case 'mode_pending':
        this.events.onModePending?.(msg.mode, msg.name);
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
