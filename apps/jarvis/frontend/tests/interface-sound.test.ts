// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BridgeClient, type BridgeClientDependencies, type BridgeEvents } from '../src/bridge-client';
import {
  GROUNDED_RESULT_EVENT,
  INTERFACE_SOUND_CUES,
  INTERFACE_SOUND_EVENT,
  INTERFACE_SOUND_MUTE_KEY,
  INTERFACE_SOUND_TOGGLE_EVENT,
  SPEECH_PLAYING_EVENT,
  parseGroundedResultMessage,
  type InterfaceSoundCue,
} from '../src/grounded-result';
import {
  INTERFACE_SOUND_DUCK_GAIN,
  INTERFACE_SOUND_MASTER_GAIN,
  InterfaceSoundEngine,
} from '../src/interface-sound';
import { GestureTargetRegistry } from '../src/gesture-target-registry';
import {
  JarvisRuntime,
  type BridgeRuntimePort,
  type GestureEngineRuntimePort,
  type GestureSurfacePort,
  type RuntimeVideoPort,
} from '../src/jarvis-runtime';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parseGroundedResultMessage', () => {
  it('accepts a bounded grounded_result envelope and drops oversized fields', () => {
    const parsed = parseGroundedResultMessage({
      type: 'grounded_result',
      resultId: ' res-1 ',
      phase: 'resolved',
      confidence: 'high',
      subject: { kind: 'person', label: 'Isabella Handel', id: 'isabella' },
      evidence: [{ label: 'Spouse', excerpt: 'wife', source: 'PA' }],
      provenance: [{ label: 'Obsidian', path: '/notes/isabella.md' }],
      actions: [{ id: 'open', label: 'Open Note' }],
      rogue: { huge: true },
    });
    expect(parsed).toEqual({
      resultId: 'res-1',
      phase: 'resolved',
      confidence: 'high',
      subject: { kind: 'person', label: 'Isabella Handel', id: 'isabella' },
      evidence: [{ label: 'Spouse', excerpt: 'wife', source: 'PA' }],
      provenance: [{ label: 'Obsidian', path: '/notes/isabella.md' }],
      actions: [{ id: 'open', label: 'Open Note' }],
    });
  });

  it('rejects messages missing resultId or phase', () => {
    expect(parseGroundedResultMessage({ type: 'grounded_result', phase: 'resolved' })).toBeNull();
    expect(parseGroundedResultMessage({ type: 'grounded_result', resultId: 'x' })).toBeNull();
    expect(parseGroundedResultMessage(null)).toBeNull();
  });
});

describe('BridgeClient grounded_result + speech playing', () => {
  it('forwards bounded grounded_result messages and ignores malformed ones', async () => {
    const onGroundedResult = vi.fn();
    const harness = createBridgeHarness({}, { onGroundedResult });
    await harness.client.start();
    await harness.socket.open();

    harness.socket.message({
      type: 'grounded_result',
      resultId: 'gr-1',
      phase: 'retrieving',
      subject: { kind: 'person', label: 'Isabella' },
    });
    harness.socket.message({ type: 'grounded_result', phase: 'resolved' });
    harness.socket.message({ type: 'grounded_result', resultId: 'bad' });

    expect(onGroundedResult).toHaveBeenCalledTimes(1);
    expect(onGroundedResult).toHaveBeenCalledWith({
      resultId: 'gr-1',
      phase: 'retrieving',
      subject: { kind: 'person', label: 'Isabella' },
    });
  });

  it('publishes speech playing while greeting audio is enqueued and clears on interrupt', async () => {
    const onSpeechPlaying = vi.fn();
    const harness = createBridgeHarness({}, { onSpeechPlaying });
    await harness.client.start();
    await harness.socket.open();
    harness.client.wake();
    harness.speaker.isPlaying.mockReturnValue(true);
    harness.socket.message({ type: 'audio', data: 'pcm' });
    expect(onSpeechPlaying).toHaveBeenCalledWith(true);

    harness.speaker.isPlaying.mockReturnValue(false);
    harness.socket.message({ type: 'interrupt' });
    expect(onSpeechPlaying).toHaveBeenCalledWith(false);
  });
});

describe('JarvisRuntime grounded-result projection', () => {
  it('turns BridgeEvents.onGroundedResult into jericho:grounded-result', async () => {
    const harness = createRuntimeHarness();
    const listener = vi.fn();
    document.addEventListener(GROUNDED_RESULT_EVENT, listener);
    await harness.runtime.engage();
    const events = harness.createBridge.mock.calls[0][0] as BridgeEvents;

    events.onGroundedResult?.({
      resultId: 'gr-42',
      phase: 'resolved',
      subject: { kind: 'person', label: 'Isabella Handel' },
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0]).toMatchObject({
      detail: {
        resultId: 'gr-42',
        phase: 'resolved',
        subject: { kind: 'person', label: 'Isabella Handel' },
      },
    });
    await harness.runtime.dispose();
  });

  it('mirrors speech playing onto the document for interface-sound ducking', async () => {
    const harness = createRuntimeHarness();
    const listener = vi.fn();
    document.addEventListener(SPEECH_PLAYING_EVENT, listener);
    await harness.runtime.engage();
    const events = harness.createBridge.mock.calls[0][0] as BridgeEvents;
    events.onSpeechPlaying?.(true);
    expect(listener.mock.calls[0][0]).toMatchObject({ detail: { playing: true } });
    await harness.runtime.dispose();
  });
});

describe('InterfaceSoundEngine', () => {
  it('plays each cue once with bounded oscillators and respects mute persistence', () => {
    const audio = installFakeAudio();
    const storage = memoryStorage();
    const engine = new InterfaceSoundEngine({
      eventTarget: document,
      storage,
      createAudioContext: () => audio.create(),
    });

    for (const cue of INTERFACE_SOUND_CUES) {
      dispatchSound('result-a', cue);
      dispatchSound('result-a', cue);
    }
    expect(audio.oscillators).toHaveLength(countExpectedOscillators());
    for (const cue of INTERFACE_SOUND_CUES) {
      expect(engine.hasPlayed('result-a', cue)).toBe(true);
    }
    expect(audio.masterGains[0]?.gain.value).toBeCloseTo(INTERFACE_SOUND_MASTER_GAIN, 5);

    document.dispatchEvent(new CustomEvent(INTERFACE_SOUND_TOGGLE_EVENT));
    expect(engine.isMuted).toBe(true);
    expect(storage.getItem(INTERFACE_SOUND_MUTE_KEY)).toBe('true');
    const before = audio.oscillators.length;
    dispatchSound('result-b', 'summon');
    expect(audio.oscillators).toHaveLength(before);
    expect(engine.hasPlayed('result-b', 'summon')).toBe(false);

    engine.dispose();
    expect(audio.closed).toBe(1);
  });

  it('ducks master gain while Jarvis speech is playing', () => {
    const audio = installFakeAudio();
    const engine = new InterfaceSoundEngine({
      eventTarget: document,
      storage: memoryStorage(),
      createAudioContext: () => audio.create(),
    });
    dispatchSound('duck-1', 'lock');
    expect(audio.masterGains[0]?.gain.value).toBeCloseTo(INTERFACE_SOUND_MASTER_GAIN, 5);

    document.dispatchEvent(new CustomEvent(SPEECH_PLAYING_EVENT, { detail: { playing: true } }));
    expect(audio.masterGains[0]?.gain.value)
      .toBeCloseTo(INTERFACE_SOUND_MASTER_GAIN * INTERFACE_SOUND_DUCK_GAIN, 5);

    document.dispatchEvent(new CustomEvent(SPEECH_PLAYING_EVENT, { detail: { playing: false } }));
    expect(audio.masterGains[0]?.gain.value).toBeCloseTo(INTERFACE_SOUND_MASTER_GAIN, 5);
    engine.dispose();
  });

  it('fails silently when AudioContext construction throws or stays suspended', () => {
    const engine = new InterfaceSoundEngine({
      eventTarget: document,
      storage: memoryStorage(),
      createAudioContext: () => {
        throw new Error('AudioContext blocked');
      },
    });
    expect(() => dispatchSound('silent-1', 'retrieve')).not.toThrow();
    engine.dispose();

    const suspended = installFakeAudio({ state: 'suspended' });
    const suspendedEngine = new InterfaceSoundEngine({
      eventTarget: document,
      storage: memoryStorage(),
      createAudioContext: () => suspended.create(),
    });
    expect(() => dispatchSound('silent-2', 'summon')).not.toThrow();
    expect(suspended.resume).toHaveBeenCalled();
    suspendedEngine.dispose();
  });

  it('cleans listeners, timers, and nodes so remount can play again', () => {
    const audio = installFakeAudio();
    const storage = memoryStorage();
    const first = new InterfaceSoundEngine({
      eventTarget: document,
      storage,
      createAudioContext: () => audio.create(),
    });
    dispatchSound('remount', 'satellite');
    expect(first.hasPlayed('remount', 'satellite')).toBe(true);
    first.dispose();
    expect(vi.getTimerCount()).toBe(0);

    const second = new InterfaceSoundEngine({
      eventTarget: document,
      storage,
      createAudioContext: () => audio.create(),
    });
    const before = audio.oscillators.length;
    dispatchSound('remount', 'satellite');
    expect(audio.oscillators.length).toBeGreaterThan(before);
    second.dispose();
  });

  it('restores mute preference from storage on construction', () => {
    const storage = memoryStorage();
    storage.setItem(INTERFACE_SOUND_MUTE_KEY, 'true');
    const audio = installFakeAudio();
    const engine = new InterfaceSoundEngine({
      eventTarget: document,
      storage,
      createAudioContext: () => audio.create(),
    });
    expect(engine.isMuted).toBe(true);
    dispatchSound('muted-boot', 'dismiss');
    expect(audio.oscillators).toHaveLength(0);
    engine.dispose();
  });
});

function countExpectedOscillators(): number {
  // retrieve 1, summon 2, satellite 1, lock 2, dismiss 1
  return 1 + 2 + 1 + 2 + 1;
}

function dispatchSound(resultId: string, cue: InterfaceSoundCue): void {
  document.dispatchEvent(new CustomEvent(INTERFACE_SOUND_EVENT, {
    detail: { resultId, cue },
  }));
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

function installFakeAudio(options: { state?: string } = {}) {
  const oscillators: FakeOscillator[] = [];
  const masterGains: FakeGain[] = [];
  const resume = vi.fn().mockResolvedValue(undefined);
  let closed = 0;

  class FakeAudioContext {
    currentTime = 0;
    state = options.state ?? 'running';
    destination = {};
    resume = resume;
    close = vi.fn(async () => { closed += 1; this.state = 'closed'; });
    createGain() {
      return new FakeGain();
    }
    createOscillator() {
      const osc = new FakeOscillator();
      oscillators.push(osc);
      return osc;
    }
    createStereoPanner() {
      return new FakePanner();
    }
  }

  vi.stubGlobal('AudioContext', FakeAudioContext);

  return {
    oscillators,
    masterGains,
    resume,
    get closed() { return closed; },
    create() {
      const ctx = new FakeAudioContext();
      let gains = 0;
      ctx.createGain = () => {
        const gain = new FakeGain();
        if (gains === 0) masterGains.push(gain);
        gains += 1;
        return gain;
      };
      return ctx as unknown as AudioContext;
    },
  };
}

class FakeGain {
  gain = {
    value: 1,
    setValueAtTime(value: number) { this.value = value; return this; },
    exponentialRampToValueAtTime(value: number) { this.value = value; return this; },
    cancelScheduledValues() { return this; },
  };
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeOscillator {
  type = 'sine';
  frequency = {
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn(function stop(this: FakeOscillator) {
    this.onended?.();
  });
}

class FakePanner {
  pan = { setValueAtTime: vi.fn() };
  connect = vi.fn();
  disconnect = vi.fn();
}

function createBridgeHarness(_options = {}, events: BridgeEvents = {}) {
  let onChunk: ((data: string) => void) | undefined;
  let onClap: (() => void) | undefined;
  const mic = {
    live: false,
    start: vi.fn(async () => { mic.live = true; }),
    stop: vi.fn(() => { mic.live = false; }),
    setMuted: vi.fn(),
    getRms: vi.fn().mockReturnValue(0),
  };
  const speaker = {
    resume: vi.fn().mockResolvedValue(undefined),
    enqueue: vi.fn(),
    interrupt: vi.fn(),
    isPlaying: vi.fn().mockReturnValue(false),
    dispose: vi.fn(),
  };
  const sockets: FakeSocket[] = [];
  const dependencies: BridgeClientDependencies = {
    createMic: (chunk, clap) => {
      onChunk = chunk;
      onClap = clap;
      return mic;
    },
    createSpeaker: () => speaker,
    createWebSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
  };
  const client = new BridgeClient(events, dependencies);
  return {
    client,
    mic,
    speaker,
    get socket() {
      const socket = sockets.at(-1);
      if (!socket) throw new Error('missing socket');
      return socket;
    },
    emitChunk: (data: string) => onChunk?.(data),
    emitClap: () => onClap?.(),
  };
}

class FakeSocket {
  static readonly OPEN = 1;
  readonly close = vi.fn(() => { this.readyState = 3; });
  readyState = 0;
  onopen: ((event: Event) => void | Promise<void>) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  send = vi.fn();
  constructor(readonly url: string) {}
  async open() {
    this.readyState = FakeSocket.OPEN;
    await this.onopen?.(new Event('open'));
  }
  message(value: Record<string, unknown>) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(value) }));
  }
}

function createRuntimeHarness() {
  const root = document.createElement('div');
  document.body.append(root);
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track], getVideoTracks: () => [{ getSettings: () => ({ deviceId: 'cam' }) }] };
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  const video: RuntimeVideoPort = {
    srcObject: null,
    muted: false,
    playsInline: false,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    videoWidth: 1280,
    videoHeight: 720,
  };
  const engine: GestureEngineRuntimePort = {
    start: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
    setSwapHands: vi.fn(),
    setPinchThresholds: vi.fn(),
  };
  const bridge: BridgeRuntimePort = {
    start: vi.fn(),
    wake: vi.fn(),
    dispose: vi.fn(),
  };
  const renderer: GestureSurfacePort = {
    configureControls: vi.fn(),
    updateControlState: vi.fn(),
    render: vi.fn(),
    setSystemStatus: vi.fn(),
    showCalibration: vi.fn(),
    showDiagnostics: vi.fn(),
    showActionRing: vi.fn(),
    hideActionRing: vi.fn(),
    dispose: vi.fn(),
  };
  const createBridge = vi.fn(() => bridge);
  const createGestureEngine = vi.fn(async () => engine);
  const runtime = new JarvisRuntime({
    root,
    registry: new GestureTargetRegistry(document),
    renderer,
    mediaDevices: { getUserMedia },
    createVideo: () => video,
    createGestureEngine,
    createBridge,
    eventTarget: document,
    storage: localStorage,
  });
  return { runtime, createBridge, bridge, engine, video, track, renderer, root, getUserMedia };
}
