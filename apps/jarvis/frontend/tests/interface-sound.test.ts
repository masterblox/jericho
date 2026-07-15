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
  it('accepts the v2 grounded_result contract and preserves identity metadata', () => {
    const parsed = parseGroundedResultMessage({
      schemaVersion: 2,
      resultId: 'res-1',
      phase: 'resolved',
      route: 'private_knowledge',
      summary: 'Isabella at MasterBlox',
      subject: 'Isabella',
      confidence: 'strong',
      canonicalIdentity: 'Isabella Handel',
      fullName: 'Isabella Handel',
      employment: ['MasterBlox Capital'],
      provenance: [{
        sourceId: 'src-1', rootId: 'People', authority: 'canonical',
        relativePath: 'People/Isabella Handel.md',
        title: 'Isabella Handel',
        excerpt: 'Family context.',
        score: 0.92,
      }],
      claims: [{ id: 'cl-1', text: 'Isabella at MasterBlox', supportSourceIds: ['src-1'] }],
      conflicts: [],
      actions: { openSourceIds: ['src-1'] },
      indexRevision: 'r5',
      retrievalCount: 1,
      guided: { test: 'isabella' },
    });
    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      schemaVersion: 2,
      resultId: 'res-1',
      phase: 'resolved',
      route: 'private_knowledge',
      subject: 'Isabella',
      confidence: 'strong',
      canonicalIdentity: 'Isabella Handel',
      fullName: 'Isabella Handel',
      employment: ['MasterBlox Capital'],
      provenance: [expect.objectContaining({ sourceId: 'src-1', rootId: 'People' })],
      claims: [expect.objectContaining({ id: 'cl-1' })],
      indexRevision: 'r5',
      retrievalCount: 1,
      guided: { test: 'isabella' },
    });
  });

  it('rejects legacy action keys', () => {
    const base = validGroundedResult();
    expect(parseGroundedResultMessage({ ...base, actions: { open_note: 'x.md' } })).toBeNull();
    expect(parseGroundedResultMessage({ ...base, actions: { reorganize_notes: true } })).toBeNull();
    expect(parseGroundedResultMessage({ ...base, actions: { correct_identity: true } })).toBeNull();
  });

  it('allowlists phase, confidence, subject kinds, and action IDs', () => {
    const base = validGroundedResult();
    expect(parseGroundedResultMessage({ ...base, phase: 'presenting' })).toBeNull();
    expect(parseGroundedResultMessage({ ...base, confidence: 'high' })).toBeNull();
    expect(parseGroundedResultMessage({ ...base, subjectKind: 'alien' })).toBeNull();
    expect(parseGroundedResultMessage({
      ...base,
      actions: { openSourceIds: ['x'], deleteSources: ['y'] },
    })).toBeNull();
  });

  it('rejects overlength result IDs and relative paths instead of truncating', () => {
    const base = validGroundedResult();
    const longId = `id-${'x'.repeat(1100)}`;
    expect(parseGroundedResultMessage({ ...base, resultId: longId })).toBeNull();

    const longPath = `People/${'n'.repeat(1_020)}.md`;
    expect(longPath.length).toBeGreaterThan(1_024);
    const badProv = [{ sourceId: 's', rootId: 'r', authority: 'canonical', relativePath: longPath, title: 'T', excerpt: 'E', score: 0.5 }];
    expect(parseGroundedResultMessage({ ...base, provenance: badProv })).toBeNull();
    expect(parseGroundedResultMessage({
      ...base,
      provenance: [{ sourceId: 's2', rootId: 'r2', authority: 'canonical', relativePath: 'x.md', title: 'T', excerpt: 'E', score: 0.5 }],
      actions: { openSourceIds: ['valid-id'] },
    })).not.toBeNull();
  });

  it('rejects messages missing required v2 fields', () => {
    expect(parseGroundedResultMessage({ phase: 'resolved' })).toBeNull();
    expect(parseGroundedResultMessage({ schemaVersion: 2, resultId: 'x' })).toBeNull();
    expect(parseGroundedResultMessage({ ...validGroundedResult(), route: 'mystery' })).toBeNull();
    expect(parseGroundedResultMessage(null)).toBeNull();
  });
});

describe('BridgeClient grounded_result + speech playing', () => {
  it('forwards bounded grounded_result v2 messages and ignores malformed ones', async () => {
    const onGroundedResult = vi.fn();
    const harness = createBridgeHarness({}, { onGroundedResult });
    await harness.client.start();
    await harness.socket.open();

    harness.socket.message({
      type: 'grounded_result',
      ...validGroundedResult({ resultId: 'gr-1', phase: 'retrieving', confidence: 'none' }),
    });
    harness.socket.message({ type: 'grounded_result', phase: 'resolved' });
    harness.socket.message({ type: 'grounded_result', resultId: 'bad' });

    expect(onGroundedResult).toHaveBeenCalledTimes(1);
    expect(onGroundedResult.mock.calls[0][0]).toMatchObject({
      schemaVersion: 2,
      resultId: 'gr-1',
      phase: 'retrieving',
      route: 'private_knowledge',
      subject: 'Isabella',
      confidence: 'none',
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
    const detail = validGroundedResult({ resultId: 'gr-42' });

    events.onGroundedResult?.(detail);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0]).toMatchObject({ detail });
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

  it('fails silently when AudioContext construction throws', () => {
    const engine = new InterfaceSoundEngine({
      eventTarget: document,
      storage: memoryStorage(),
      createAudioContext: () => {
        throw new Error('AudioContext blocked');
      },
    });
    expect(() => dispatchSound('silent-1', 'retrieve')).not.toThrow();
    expect(engine.hasPlayed('silent-1', 'retrieve')).toBe(false);
    expect(engine.hasUnlockListeners()).toBe(true);
    engine.dispose();
  });

  it('does not consume a cue while AudioContext stays suspended after rejected resume', async () => {
    const audio = installFakeAudio({
      state: 'suspended',
      resume: async () => {
        throw new Error('autoplay blocked');
      },
    });
    const engine = new InterfaceSoundEngine({
      eventTarget: document,
      storage: memoryStorage(),
      createAudioContext: () => audio.create(),
    });

    dispatchSound('suspended-1', 'summon');
    await flushMicrotasks();
    expect(engine.hasPlayed('suspended-1', 'summon')).toBe(false);
    expect(audio.oscillators).toHaveLength(0);
    expect(engine.hasUnlockListeners()).toBe(true);

    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await flushMicrotasks();
    expect(engine.hasUnlockListeners()).toBe(true);
    expect(engine.hasPlayed('suspended-1', 'summon')).toBe(false);
    engine.dispose();
  });

  it('unlocks on trusted gesture after a delayed resume, then plays without consuming early', async () => {
    let releaseResume: (() => void) | undefined;
    const audio = installFakeAudio({
      state: 'suspended',
      resume: () => new Promise<void>((resolve) => {
        releaseResume = () => {
          audio.setState('running');
          resolve();
        };
      }),
    });
    const engine = new InterfaceSoundEngine({
      eventTarget: document,
      storage: memoryStorage(),
      createAudioContext: () => audio.create(),
    });

    dispatchSound('delayed-1', 'lock');
    expect(engine.hasPlayed('delayed-1', 'lock')).toBe(false);
    expect(audio.oscillators).toHaveLength(0);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(engine.hasPlayed('delayed-1', 'lock')).toBe(false);
    releaseResume?.();
    await flushMicrotasks();
    expect(engine.hasUnlockListeners()).toBe(false);

    dispatchSound('delayed-1', 'lock');
    expect(engine.hasPlayed('delayed-1', 'lock')).toBe(true);
    expect(audio.oscillators.length).toBeGreaterThan(0);
    engine.dispose();
  });

  it('plays after a successful unlock resume on pointerdown', async () => {
    const audio = installFakeAudio({
      state: 'suspended',
      resume: async () => { audio.setState('running'); },
    });
    const engine = new InterfaceSoundEngine({
      eventTarget: document,
      storage: memoryStorage(),
      createAudioContext: () => audio.create(),
    });

    dispatchSound('unlock-1', 'retrieve');
    expect(engine.hasPlayed('unlock-1', 'retrieve')).toBe(false);

    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await flushMicrotasks();
    expect(engine.hasUnlockListeners()).toBe(false);

    dispatchSound('unlock-1', 'retrieve');
    expect(engine.hasPlayed('unlock-1', 'retrieve')).toBe(true);
    engine.dispose();
  });

  it('disconnects oscillator, gain, and panner for each cue graph', () => {
    const audio = installFakeAudio();
    const engine = new InterfaceSoundEngine({
      eventTarget: document,
      storage: memoryStorage(),
      createAudioContext: () => audio.create(),
    });
    dispatchSound('graph-1', 'satellite');
    expect(audio.oscillators).toHaveLength(1);
    expect(audio.gains.length).toBeGreaterThan(1); // master + cue gain
    expect(audio.panners).toHaveLength(1);

    audio.oscillators[0]?.stop();
    expect(audio.oscillators[0]?.disconnect).toHaveBeenCalled();
    expect(audio.gains.at(-1)?.disconnect).toHaveBeenCalled();
    expect(audio.panners[0]?.disconnect).toHaveBeenCalled();
    engine.dispose();
  });

  it('does not consume the dedupe key when playback fails to schedule', () => {
    let shouldFail = true;
    const audio = installFakeAudio();
    const engine = new InterfaceSoundEngine({
      eventTarget: document,
      storage: memoryStorage(),
      createAudioContext: () => {
        if (shouldFail) throw new Error('AudioContext blocked');
        return audio.create();
      },
    });

    dispatchSound('retry-1', 'lock');
    expect(engine.hasPlayed('retry-1', 'lock')).toBe(false);
    expect(audio.oscillators).toHaveLength(0);

    shouldFail = false;
    dispatchSound('retry-1', 'lock');
    expect(engine.hasPlayed('retry-1', 'lock')).toBe(true);
    expect(audio.oscillators.length).toBeGreaterThan(0);
    engine.dispose();
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
    expect(first.hasUnlockListeners()).toBe(false);

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

function validGroundedResult(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    resultId: 'res-1',
    phase: 'resolved',
    route: 'private_knowledge',
    subject: 'Isabella',
    confidence: 'strong',
    provenance: [{
      sourceId: 'src-1', rootId: 'People', authority: 'canonical',
      relativePath: 'People/Isabella Handel.md',
      title: 'Isabella Handel',
      excerpt: 'Family and MasterBlox context.',
      score: 0.92,
    }],
    claims: [{ id: 'cl-1', text: 'Isabella at MasterBlox', supportSourceIds: ['src-1'] }],
    conflicts: [],
    actions: { openSourceIds: ['src-1'] },
    retrievalCount: 1,
    ...overrides,
  };
}

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

function installFakeAudio(options: {
  state?: string;
  resume?: (ctx: { state: string }) => Promise<void>;
} = {}) {
  const oscillators: FakeOscillator[] = [];
  const gains: FakeGain[] = [];
  const panners: FakePanner[] = [];
  const masterGains: FakeGain[] = [];
  const contexts: Array<{ state: string }> = [];
  let closed = 0;

  class FakeAudioContext {
    currentTime = 0;
    state = options.state ?? 'running';
    destination = {};
    resume = vi.fn(async () => {
      if (options.resume) await options.resume(this);
      else this.state = 'running';
    });
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
      const pan = new FakePanner();
      panners.push(pan);
      return pan;
    }
  }

  vi.stubGlobal('AudioContext', FakeAudioContext);

  return {
    oscillators,
    gains,
    panners,
    masterGains,
    get resume() {
      return contexts[0] ? (contexts[0] as FakeAudioContext).resume : vi.fn();
    },
    setState(state: string) {
      for (const ctx of contexts) ctx.state = state;
    },
    get closed() { return closed; },
    create() {
      const ctx = new FakeAudioContext();
      contexts.push(ctx);
      let gainCount = 0;
      ctx.createGain = () => {
        const gain = new FakeGain();
        gains.push(gain);
        if (gainCount === 0) masterGains.push(gain);
        gainCount += 1;
        return gain;
      };
      return ctx as unknown as AudioContext;
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
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
