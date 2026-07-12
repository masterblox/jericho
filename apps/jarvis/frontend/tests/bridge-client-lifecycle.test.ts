// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SpeakerPlayback } from '../src/audio';
import { BridgeClient, type BridgeClientDependencies, type BridgeEvents } from '../src/bridge-client';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BridgeClient lifecycle', () => {
  it('starts once, uses same-origin /ws, and disposes reconnect, VAD, socket, mic, and speaker', async () => {
    const mic = {
      live: false,
      start: vi.fn().mockResolvedValue(undefined), stop: vi.fn(), setMuted: vi.fn(), getRms: vi.fn().mockReturnValue(0),
    };
    const speaker = {
      resume: vi.fn().mockResolvedValue(undefined), enqueue: vi.fn(), interrupt: vi.fn(),
      isPlaying: vi.fn().mockReturnValue(false), dispose: vi.fn(),
    };
    const sockets: FakeSocket[] = [];
    const dependencies: BridgeClientDependencies = {
      createMic: () => mic,
      createSpeaker: () => speaker,
      createWebSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    };
    const client = new BridgeClient({}, dependencies);

    await Promise.all([client.start(), client.start()]);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    expect(mic.start).toHaveBeenCalledTimes(1);
    await sockets[0].open();
    expect(mic.start).toHaveBeenCalledTimes(1);

    const staleClose = sockets[0].onclose;
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    client.dispose();
    staleClose?.(new CloseEvent('close'));
    await vi.runAllTimersAsync();

    expect(sockets).toHaveLength(1);
    expect(sockets[0].close).toHaveBeenCalledTimes(1);
    expect(mic.stop).toHaveBeenCalled();
    expect(speaker.interrupt).toHaveBeenCalled();
    expect(speaker.dispose).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('queues clap wake while the voice socket is connecting without leaking audio', async () => {
    const harness = createBridgeHarness();
    await harness.client.start();

    expect(harness.mic.start).toHaveBeenCalledTimes(1);
    harness.emitClap();
    await flushPromises();

    expect(sentMessages(harness.socket)).not.toContainEqual({ type: 'wake' });
    expect(harness.mic.stop).not.toHaveBeenCalled();
    expect(harness.mic.setMuted).toHaveBeenLastCalledWith(true);
  });

  it('keeps every microphone chunk local while standby', async () => {
    const harness = createBridgeHarness();

    await harness.client.start();
    await harness.socket.open();
    harness.emitChunk('private-standby-audio');

    expect(harness.mic.setMuted).toHaveBeenLastCalledWith(true);
    expect(sentMessages(harness.socket)).not.toContainEqual({
      type: 'audio',
      data: 'private-standby-audio',
    });
  });

  it('keeps the mic muted while Gemini greets, plays greeting audio, then listens', async () => {
    const harness = createBridgeHarness();
    await harness.client.start();
    await harness.socket.open();

    harness.client.wake();

    expect(sentMessages(harness.socket)).toContainEqual({ type: 'wake' });
    expect(harness.mic.setMuted).toHaveBeenLastCalledWith(true);
    harness.emitChunk('blocked-during-greeting');
    expect(sentMessages(harness.socket)).not.toContainEqual({
      type: 'audio', data: 'blocked-during-greeting',
    });

    harness.socket.message({ type: 'audio', data: 'gemini-greeting-audio' });
    expect(harness.speaker.enqueue).toHaveBeenCalledWith('gemini-greeting-audio');
    expect(harness.mic.setMuted).toHaveBeenLastCalledWith(true);

    harness.socket.message({ type: 'greeting_complete' });
    expect(harness.mic.setMuted).toHaveBeenLastCalledWith(false);

    harness.emitChunk('active-audio');
    expect(sentMessages(harness.socket)).toContainEqual({
      type: 'audio',
      data: 'active-audio',
    });
  });

  it('uses the same Gemini greeting and active gate for a detected clap', async () => {
    const harness = createBridgeHarness();
    await harness.client.start();
    await harness.socket.open();

    harness.emitClap();
    await flushPromises();

    expect(sentMessages(harness.socket)).toContainEqual({ type: 'wake' });
    expect(harness.mic.setMuted).toHaveBeenLastCalledWith(true);
    harness.socket.message({ type: 'greeting_complete' });
    expect(harness.mic.setMuted).toHaveBeenLastCalledWith(false);
  });

  it('does not let a delayed initial standby frame cancel an in-progress greeting', async () => {
    const harness = createBridgeHarness();
    await harness.client.start();
    await harness.socket.open();
    harness.client.wake();

    harness.socket.message({ type: 'armed', armed: false });
    expect(sentMessages(harness.socket)).toContainEqual({ type: 'wake' });
    expect(harness.mic.setMuted).toHaveBeenLastCalledWith(true);
    harness.socket.message({ type: 'greeting_complete' });
    expect(harness.mic.setMuted).toHaveBeenLastCalledWith(false);
  });

  it('keeps a clap detected during microphone startup instead of resetting it', async () => {
    const harness = createBridgeHarness({ clapDuringStart: true });

    await harness.client.start();
    await harness.socket.open();
    await flushPromises();

    expect(sentMessages(harness.socket)).toContainEqual({ type: 'wake' });
    expect(harness.mic.setMuted).toHaveBeenLastCalledWith(true);
    harness.socket.message({ type: 'greeting_complete' });
    expect(harness.mic.setMuted).toHaveBeenLastCalledWith(false);
  });

  it('never uses the local browser synthesizer for wake', async () => {
    class FakeUtterance {
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly text: string) {}
    }
    const speak = vi.fn((utterance: FakeUtterance) => utterance.onend?.());
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() });
    const harness = createBridgeHarness({ useDefaultGreeting: true });
    await harness.client.start();
    await harness.socket.open();

    harness.client.wake();
    await flushPromises();

    expect(speak).not.toHaveBeenCalled();
    expect(sentMessages(harness.socket)).toContainEqual({ type: 'wake' });
    expect(harness.mic.setMuted).toHaveBeenLastCalledWith(true);
  });

  it('mutes upstream audio and returns to standby on turn completion', async () => {
    const harness = createBridgeHarness();
    await harness.client.start();
    await harness.socket.open();
    harness.client.wake();
    await flushPromises();
    harness.socket.message({ type: 'greeting_complete' });
    harness.socket.send.mockClear();

    harness.socket.message({ type: 'turn_complete' });
    harness.emitChunk('post-turn-private-audio');

    expect(harness.mic.setMuted).toHaveBeenLastCalledWith(true);
    expect(sentMessages(harness.socket)).toEqual([]);
  });

  it('forwards only recognized guided test start signals', async () => {
    const onGuidedTestStart = vi.fn();
    const harness = createBridgeHarness({}, { onGuidedTestStart });
    await harness.client.start();
    await harness.socket.open();

    harness.socket.message({ type: 'guided_test_start', test: 'unknown' });
    harness.socket.message({ type: 'guided_test_start', test: 'isabella' });

    expect(onGuidedTestStart).toHaveBeenCalledOnce();
    expect(onGuidedTestStart).toHaveBeenCalledWith('isabella', undefined);
  });

  it('enters listening directly when the server resumes a guided test', async () => {
    const onStatus = vi.fn();
    const onGuidedTestResume = vi.fn();
    const harness = createBridgeHarness({}, { onStatus, onGuidedTestResume });
    await harness.client.start();
    await harness.socket.open();
    harness.client.wake();

    harness.socket.message({ type: 'guided_test_resume', test: 'isabella' });
    harness.socket.message({ type: 'greeting_complete' });

    expect(onStatus).toHaveBeenCalledWith('guided-test-listening');
    expect(onStatus).toHaveBeenCalledWith('listening');
    expect(onGuidedTestResume).toHaveBeenCalledWith('isabella', undefined);
    expect(harness.mic.setMuted).toHaveBeenLastCalledWith(false);
  });

  it('forwards only recognized guided test end signals', async () => {
    const onGuidedTestEnd = vi.fn();
    const harness = createBridgeHarness({}, { onGuidedTestEnd });
    await harness.client.start();
    await harness.socket.open();

    harness.socket.message({ type: 'guided_test_end', test: 'unknown' });
    harness.socket.message({ type: 'guided_test_end', test: 'isabella' });

    expect(onGuidedTestEnd).toHaveBeenCalledOnce();
    expect(onGuidedTestEnd).toHaveBeenCalledWith('isabella');
  });

  it('bounds an active turn and tells the server when the client times out', async () => {
    const harness = createBridgeHarness({ activeTurnMs: 1_000 });
    await harness.client.start();
    await harness.socket.open();
    harness.client.wake();
    await flushPromises();
    harness.socket.message({ type: 'greeting_complete' });
    harness.socket.send.mockClear();

    await vi.advanceTimersByTimeAsync(1_000);
    harness.emitChunk('post-timeout-private-audio');

    expect(harness.mic.setMuted).toHaveBeenLastCalledWith(true);
    expect(sentMessages(harness.socket)).toEqual([
      { type: 'standby', reason: 'timeout' },
    ]);
  });

  it('cannot activate from a stale greeting after disconnect and reconnect', async () => {
    const harness = createBridgeHarness();
    await harness.client.start();
    await harness.socket.open();
    harness.client.wake();

    harness.socket.disconnect();
    await flushPromises();

    expect(sentMessages(harness.socket)).toContainEqual({ type: 'wake' });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(harness.sockets).toHaveLength(2);
    await harness.sockets[1].open();
    expect(harness.mic.setMuted).toHaveBeenLastCalledWith(true);
  });

  it('preserves client-side barge-in during an active turn without logging audio levels', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const harness = createBridgeHarness();
    harness.speaker.isPlaying.mockReturnValue(true);
    harness.mic.getRms.mockReturnValue(0.2);
    await harness.client.start();
    await harness.socket.open();
    harness.client.wake();
    await flushPromises();
    harness.socket.message({ type: 'greeting_complete' });

    await vi.advanceTimersByTimeAsync(100);

    expect(harness.speaker.interrupt).toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
  });
});

describe('SpeakerPlayback lifecycle', () => {
  it('interrupts and closes its AudioContext exactly once', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    class FakeAudioContext {
      state = 'running';
      currentTime = 0;
      destination = {};
      close = close;
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const playback = new SpeakerPlayback();
    vi.spyOn(playback, 'interrupt');

    await playback.dispose();
    await playback.dispose();
    expect(playback.interrupt).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

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

  disconnect() {
    this.readyState = 3;
    this.onclose?.(new CloseEvent('close'));
  }
}

interface BridgeHarnessOptions {
  activeTurnMs?: number;
  useDefaultGreeting?: boolean;
  clapDuringStart?: boolean;
}

function createBridgeHarness(options: BridgeHarnessOptions = {}, events: BridgeEvents = {}) {
  let onChunk: ((data: string) => void) | undefined;
  let onClap: (() => void) | undefined;
  const mic = {
    live: false,
    start: vi.fn(async () => {
      mic.live = true;
      if (options.clapDuringStart) onClap?.();
    }),
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
    activeTurnMs: options.activeTurnMs,
  };
  const client = new BridgeClient(events, dependencies);

  return {
    client,
    mic,
    speaker,
    sockets,
    get socket() {
      const socket = sockets.at(-1);
      if (!socket) throw new Error('Bridge test socket is not connected');
      return socket;
    },
    emitChunk: (data: string) => onChunk?.(data),
    emitClap: () => onClap?.(),
  };
}

function sentMessages(socket: FakeSocket): Array<Record<string, unknown>> {
  return socket.send.mock.calls.map(([raw]) => JSON.parse(String(raw)) as Record<string, unknown>);
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
