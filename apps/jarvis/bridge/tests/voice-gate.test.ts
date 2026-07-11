import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    live = {
      connect: vi.fn().mockRejectedValue(new Error('unexpected production voice connector')),
    };
  },
  Modality: { AUDIO: 'AUDIO' },
}));

import { JerichoStore } from '../src/core/store.js';
import {
  createJerichoServer,
  type VoiceConnect,
  type VoiceConnectionCallbacks,
} from '../src/server.js';

const TOKEN = 'voice-gate-test-token';
const openServers: Array<{ close(): Promise<void> }> = [];
const openStores: JerichoStore[] = [];
const openSockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of openSockets.splice(0)) socket.close();
  for (const server of openServers.splice(0)) await server.close();
  for (const store of openStores.splice(0)) store.close();
  vi.restoreAllMocks();
});

describe('voice socket privacy gate', () => {
  it('rejects a forged same-origin header without a bearer or browser session credential', async () => {
    const voiceConnect = vi.fn<VoiceConnect>();
    const runtime = await startVoiceServer(voiceConnect);

    const status = await rejectedSocketStatus(
      runtime.port,
      `http://127.0.0.1:${runtime.port}`,
    );

    expect(status).toBe(401);
    expect(voiceConnect).not.toHaveBeenCalled();
  });

  it('drops standby audio and closes the active gate when Gemini completes a turn', async () => {
    let callbacks: VoiceConnectionCallbacks | undefined;
    const session = {
      sendRealtimeInput: vi.fn(),
      sendToolResponse: vi.fn(),
      close: vi.fn(),
    };
    const voiceConnect = vi.fn<VoiceConnect>(async (request) => {
      callbacks = request.callbacks;
      request.callbacks.onopen();
      return session;
    });
    const runtime = await startVoiceServer(voiceConnect);
    const socket = await connectSocket(runtime.port);
    const messages = collectMessages(socket);
    await vi.waitFor(() => expect(voiceConnect).toHaveBeenCalledTimes(1));

    socket.send(JSON.stringify({ type: 'audio', data: 'standby-private-audio' }));
    await flushIo();
    expect(session.sendRealtimeInput).not.toHaveBeenCalled();

    socket.send(JSON.stringify({ type: 'wake' }));
    await vi.waitFor(() => expect(messages()).toContainEqual({ type: 'armed', armed: true }));
    socket.send(JSON.stringify({ type: 'audio', data: 'active-audio' }));
    await vi.waitFor(() => expect(session.sendRealtimeInput).toHaveBeenCalledTimes(1));
    expect(session.sendRealtimeInput).toHaveBeenCalledWith({
      media: { data: 'active-audio', mimeType: 'audio/pcm;rate=16000' },
    });

    callbacks?.onmessage({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => {
      expect(messages()).toContainEqual({ type: 'turn_complete' });
      expect(messages()).toContainEqual({ type: 'armed', armed: false });
    });
    socket.send(JSON.stringify({ type: 'audio', data: 'post-turn-private-audio' }));
    await flushIo();
    expect(session.sendRealtimeInput).toHaveBeenCalledTimes(1);
  });

  it('honors client standby and independently expires an abandoned active turn', async () => {
    const session = {
      sendRealtimeInput: vi.fn(),
      sendToolResponse: vi.fn(),
      close: vi.fn(),
    };
    const voiceConnect = vi.fn<VoiceConnect>(async (request) => {
      request.callbacks.onopen();
      return session;
    });
    const runtime = await startVoiceServer(voiceConnect, 40);
    const socket = await connectSocket(runtime.port);
    const messages = collectMessages(socket);
    await vi.waitFor(() => expect(voiceConnect).toHaveBeenCalledTimes(1));

    socket.send(JSON.stringify({ type: 'wake' }));
    await vi.waitFor(() => expect(messages()).toContainEqual({ type: 'armed', armed: true }));
    socket.send(JSON.stringify({ type: 'standby', reason: 'client timeout' }));
    await vi.waitFor(() => expect(messages()).toContainEqual({ type: 'armed', armed: false }));
    socket.send(JSON.stringify({ type: 'audio', data: 'client-standby-audio' }));
    await flushIo();
    expect(session.sendRealtimeInput).not.toHaveBeenCalled();

    socket.send(JSON.stringify({ type: 'wake' }));
    await vi.waitFor(() => {
      expect(messages().filter((message) => message.type === 'armed' && message.armed === true))
        .toHaveLength(2);
    });
    await vi.waitFor(() => {
      expect(messages().filter((message) => message.type === 'armed' && message.armed === false))
        .toHaveLength(3);
    }, { timeout: 500 });
    socket.send(JSON.stringify({ type: 'audio', data: 'server-timeout-audio' }));
    await flushIo();
    expect(session.sendRealtimeInput).not.toHaveBeenCalled();
  });
});

async function startVoiceServer(voiceConnect: VoiceConnect, voiceActiveTurnMs = 1_000) {
  const store = new JerichoStore({ path: ':memory:', key: Buffer.alloc(32, 93) });
  openStores.push(store);
  const server = createJerichoServer({
    store,
    apiToken: TOKEN,
    host: '127.0.0.1',
    geminiApiKey: 'fake-key',
    voiceConnect,
    voiceActiveTurnMs,
  });
  openServers.push(server);
  return server.listen(0);
}

function connectSocket(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${TOKEN}`);
    openSockets.push(socket);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function rejectedSocketStatus(port: number, origin: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin });
    openSockets.push(socket);
    socket.once('open', () => reject(new Error('unauthenticated voice socket opened')));
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      resolve(response.statusCode);
    });
    socket.once('error', (error) => {
      if (!String(error).includes('Unexpected server response')) reject(error);
    });
  });
}

function collectMessages(socket: WebSocket): () => Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  socket.on('message', (raw) => {
    messages.push(JSON.parse(raw.toString()) as Record<string, unknown>);
  });
  return () => messages;
}

function flushIo(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}
