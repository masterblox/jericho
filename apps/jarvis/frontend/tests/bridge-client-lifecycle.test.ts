// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SpeakerPlayback } from '../src/audio';
import { BridgeClient, type BridgeClientDependencies } from '../src/bridge-client';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
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
}
