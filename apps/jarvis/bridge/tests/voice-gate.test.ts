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
import { IntakeProcessor } from '../src/orchestration/intake.js';
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
  it('speaks wake through Gemini, drops greeting-time input, then keeps listening', async () => {
    let callbacks: VoiceConnectionCallbacks | undefined;
    const session = {
      sendClientContent: vi.fn(),
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

    socket.send(JSON.stringify({ type: 'wake' }));
    await vi.waitFor(() => expect(session.sendClientContent).toHaveBeenCalledWith({
      turns: [{ role: 'user', parts: [{ text: 'Say exactly: “Hello, sir. What are we doing today?”' }] }],
      turnComplete: true,
    }));
    socket.send(JSON.stringify({ type: 'audio', data: 'must-not-pass-during-greeting' }));
    await flushIo();
    expect(session.sendRealtimeInput).not.toHaveBeenCalled();

    callbacks?.onmessage({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(messages()).toContainEqual({ type: 'greeting_complete' }));
    expect(messages()).not.toContainEqual({ type: 'turn_complete' });
    socket.send(JSON.stringify({ type: 'audio', data: 'listen-now' }));
    await vi.waitFor(() => expect(session.sendRealtimeInput).toHaveBeenCalledWith({
      media: { data: 'listen-now', mimeType: 'audio/pcm;rate=16000' },
    }));
  });

  it('binds Gemini search_vault calls to the configured bounded gateway port', async () => {
    let callbacks: VoiceConnectionCallbacks | undefined;
    const session = {
      sendClientContent: vi.fn(), sendRealtimeInput: vi.fn(), sendToolResponse: vi.fn(), close: vi.fn(),
    };
    const voiceConnect = vi.fn<VoiceConnect>(async (request) => {
      callbacks = request.callbacks;
      request.callbacks.onopen();
      return session;
    });
    const search = vi.fn(async () => ({
      cached: false,
      results: [{ path: 'Evidence.md', title: 'Evidence', excerpt: 'Verified.', score: 1 }],
    }));
    const runtime = await startVoiceServer(voiceConnect, 1_000, { vaultSearch: { search } });
    const socket = await connectSocket(runtime.port);
    socket.send(JSON.stringify({ type: 'wake' }));
    await flushIo();

    callbacks?.onmessage({
      toolCall: { functionCalls: [{ id: 'call-1', name: 'search_vault', args: { query: ' evidence ' } }] },
    });

    await vi.waitFor(() => expect(search).toHaveBeenCalledWith('evidence', 5, expect.any(AbortSignal)));
    await vi.waitFor(() => expect(session.sendToolResponse).toHaveBeenCalledWith({
      functionResponses: [expect.objectContaining({
        id: 'call-1', name: 'search_vault',
        response: expect.objectContaining({ available: true, count: 1 }),
      })],
    }));
  });

  it('lets Gemini search the bounded local Obsidian adapter when no RAG gateway is configured', async () => {
    let callbacks: VoiceConnectionCallbacks | undefined;
    const session = {
      sendClientContent: vi.fn(), sendRealtimeInput: vi.fn(), sendToolResponse: vi.fn(), close: vi.fn(),
    };
    const voiceConnect = vi.fn<VoiceConnect>(async (request) => {
      callbacks = request.callbacks;
      request.callbacks.onopen();
      return session;
    });
    const search = vi.fn(async () => [{
      path: 'People/Isabella.md', title: 'Isabella', excerpt: 'Verified local note.',
    }]);
    const runtime = await startVoiceServer(voiceConnect, 1_000, { obsidianSearch: { search } });
    const socket = await connectSocket(runtime.port);
    socket.send(JSON.stringify({ type: 'wake' }));
    await flushIo();

    callbacks?.onmessage({
      toolCall: { functionCalls: [{ id: 'local-1', name: 'search_vault', args: { query: 'Isabella' } }] },
    });

    await vi.waitFor(() => expect(search).toHaveBeenCalledWith('Isabella', 5));
    await vi.waitFor(() => expect(session.sendToolResponse).toHaveBeenCalledWith({
      functionResponses: [expect.objectContaining({
        id: 'local-1', name: 'search_vault',
        response: expect.objectContaining({ available: true, count: 1, cached: false }),
      })],
    }));
  });

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

  it('accepts a bearer header supplied by the local development reverse proxy', async () => {
    const voiceConnect = vi.fn<VoiceConnect>(async (request) => {
      request.callbacks.onopen();
      return {
        sendClientContent: vi.fn(), sendRealtimeInput: vi.fn(), sendToolResponse: vi.fn(), close: vi.fn(),
      };
    });
    const runtime = await startVoiceServer(voiceConnect);
    const socket = await connectSocketWithBearer(runtime.port);

    await vi.waitFor(() => expect(voiceConnect).toHaveBeenCalledTimes(1));
    socket.close();
  });

  it('drops standby audio and closes the active gate when Gemini completes a turn', async () => {
    let callbacks: VoiceConnectionCallbacks | undefined;
    const session = {
      sendClientContent: vi.fn(),
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
    callbacks?.onmessage({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(messages()).toContainEqual({ type: 'greeting_complete' }));
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

  it('retains only finished active-turn input transcription as an encrypted spoken capture', async () => {
    let callbacks: VoiceConnectionCallbacks | undefined;
    const voiceConnect = vi.fn<VoiceConnect>(async (request) => {
      callbacks = request.callbacks;
      request.callbacks.onopen();
      return {
        sendClientContent: vi.fn(),
        sendRealtimeInput: vi.fn(),
        sendToolResponse: vi.fn(),
        close: vi.fn(),
      };
    });
    const runtime = await startVoiceServer(voiceConnect);
    const socket = await connectSocket(runtime.address.port);
    const messages = collectMessages(socket);
    await vi.waitFor(() => expect(voiceConnect).toHaveBeenCalledTimes(1));
    expect(voiceConnect.mock.calls[0][0].config).toMatchObject({
      inputAudioTranscription: {},
    });

    callbacks?.onmessage({
      serverContent: { inputTranscription: { text: 'standby private speech', finished: true } },
    });
    expect(runtime.store.listEvents({ limit: 10 })).toEqual([]);

    socket.send(JSON.stringify({ type: 'wake' }));
    await vi.waitFor(() => expect(messages()).toContainEqual({ type: 'armed', armed: true }));
    callbacks?.onmessage({
      serverContent: { inputTranscription: { text: 'Build a multi-step project ', finished: false } },
    });
    // Transcription ordering is independent of model turn completion.
    callbacks?.onmessage({ serverContent: { turnComplete: true } });
    callbacks?.onmessage({
      serverContent: { inputTranscription: { text: 'for Jericho', finished: true } },
    });

    await vi.waitFor(() => expect(runtime.store.listEvents({ limit: 10 })).toHaveLength(1));
    expect(runtime.store.listEvents({ limit: 10 })[0]).toMatchObject({
      source: 'local:spoken',
      type: 'local.capture.spoken',
      payload: { transcript: 'Build a multi-step project for Jericho' },
    });
    expect(runtime.store.listMissions()).toHaveLength(1);
    expect(messages()).not.toContainEqual(expect.objectContaining({
      transcript: expect.anything(),
    }));
  });

  it('emits a bounded Isabella walkthrough signal without exposing the transcript', async () => {
    let callbacks: VoiceConnectionCallbacks | undefined;
    const voiceConnect = vi.fn<VoiceConnect>(async (request) => {
      callbacks = request.callbacks;
      request.callbacks.onopen();
      return {
        sendClientContent: vi.fn(), sendRealtimeInput: vi.fn(), sendToolResponse: vi.fn(), close: vi.fn(),
      };
    });
    const runtime = await startVoiceServer(voiceConnect);
    const socket = await connectSocket(runtime.port);
    const messages = collectMessages(socket);
    await vi.waitFor(() => expect(voiceConnect).toHaveBeenCalledTimes(1));

    socket.send(JSON.stringify({ type: 'wake' }));
    await vi.waitFor(() => expect(messages()).toContainEqual({ type: 'armed', armed: true }));
    callbacks?.onmessage({
      serverContent: { inputTranscription: { text: 'Test Isabella', finished: true } },
    });

    await vi.waitFor(() => expect(messages()).toContainEqual({
      type: 'guided_test_start', test: 'isabella',
    }));
    expect(messages()).not.toContainEqual(expect.objectContaining({ transcript: expect.anything() }));
  });

  it('resumes an active Isabella test without replaying the generic greeting', async () => {
    let callbacks: VoiceConnectionCallbacks | undefined;
    const session = {
      sendClientContent: vi.fn(), sendRealtimeInput: vi.fn(), sendToolResponse: vi.fn(), close: vi.fn(),
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

    socket.send(JSON.stringify({ type: 'wake' }));
    await vi.waitFor(() => expect(session.sendClientContent).toHaveBeenCalledTimes(1));
    callbacks?.onmessage({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(messages()).toContainEqual({ type: 'greeting_complete' }));
    callbacks?.onmessage({
      serverContent: { inputTranscription: { text: 'Test Isabella', finished: true } },
    });
    callbacks?.onmessage({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(messages()).toContainEqual({ type: 'turn_complete' }));

    const beforeResume = session.sendClientContent.mock.calls.length;
    socket.send(JSON.stringify({ type: 'wake' }));
    await vi.waitFor(() => expect(messages()).toContainEqual({
      type: 'guided_test_resume', test: 'isabella',
    }));
    expect(messages()).toContainEqual({ type: 'greeting_complete' });
    expect(messages()).toContainEqual({ type: 'armed', armed: true });
    expect(session.sendClientContent).toHaveBeenCalledTimes(beforeResume);
  });

  it('honors client standby and independently expires an abandoned active turn', async () => {
    const session = {
      sendClientContent: vi.fn(),
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

  it('disposes presentation-mode revert timers and sessions when the server closes', async () => {
    const sessions: Array<{ close: ReturnType<typeof vi.fn> }> = [];
    const voiceConnect = vi.fn<VoiceConnect>(async (request) => {
      const session = {
        sendClientContent: vi.fn(),
        sendRealtimeInput: vi.fn(),
        sendToolResponse: vi.fn(),
        close: vi.fn(),
      };
      sessions.push(session);
      request.callbacks.onopen();
      return session;
    });
    const runtime = await startVoiceServer(voiceConnect, 1_000, {
      defaultPersonaMode: 'jarvis',
      megatronVoice: 'Fenrir',
      personaAutoRevertMs: 200,
    });
    const socket = await connectSocket(runtime.port);
    await vi.waitFor(() => expect(voiceConnect).toHaveBeenCalledTimes(1));

    socket.send(JSON.stringify({ type: 'set_mode', mode: 'megatron' }));
    await vi.waitFor(() => expect(voiceConnect).toHaveBeenCalledTimes(2));
    await runtime.server.close();
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(voiceConnect).toHaveBeenCalledTimes(2);
    expect(sessions.every((session) => session.close.mock.calls.length > 0)).toBe(true);
  });
});

async function startVoiceServer(
  voiceConnect: VoiceConnect,
  voiceActiveTurnMs = 1_000,
  persona: {
    defaultPersonaMode?: 'jarvis' | 'megatron';
    megatronVoice?: string;
    personaAutoRevertMs?: number;
    vaultSearch?: { search(query: string, limit: number, signal: AbortSignal): Promise<any> };
    obsidianSearch?: { search(query: string, limit: number): Promise<any> };
  } | undefined = undefined,
) {
  const store = new JerichoStore({ path: ':memory:', key: Buffer.alloc(32, 93) });
  openStores.push(store);
  const intake = new IntakeProcessor({ store });
  const server = createJerichoServer({
    store,
    apiToken: TOKEN,
    host: '127.0.0.1',
    geminiApiKey: 'fake-key',
    voiceConnect,
    voiceActiveTurnMs,
    intake,
    ...persona,
  });
  openServers.push(server);
  const address = await server.listen(0);
  return { ...address, address, store, server };
}

function connectSocket(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${TOKEN}`);
    openSockets.push(socket);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function connectSocketWithBearer(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
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
