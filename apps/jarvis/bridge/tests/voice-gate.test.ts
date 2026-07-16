import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { MemoryIndex } from '../src/retrieval/memory-index.js';
import { IntakeProcessor } from '../src/orchestration/intake.js';
import {
  createJerichoServer,
  type VoiceConnect,
  type VoiceConnectionCallbacks,
  type VoiceConnectionRequest,
} from '../src/server.js';

const TOKEN = 'voice-gate-test-token';
const openServers: Array<{ close(): Promise<void> }> = [];
const openStores: JerichoStore[] = [];
const openSockets: WebSocket[] = [];
const openDirs: string[] = [];

afterEach(async () => {
  for (const socket of openSockets.splice(0)) socket.close();
  for (const server of openServers.splice(0)) await server.close();
  for (const store of openStores.splice(0)) store.close();
  for (const directory of openDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function memoryFixture(): { index: MemoryIndex; root: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'jericho-voice-mem-')));
  openDirs.push(root);
  writeFileSync(join(root, 'People Isabella Handel.md'), '# Isabella Handel\nIsabella Handel works at MasterBlox.\n');
  const index = new MemoryIndex({ roots: [{ id: 'obsidian', path: root, authority: 'canonical' }] });
  index.refresh();
  return { index, root };
}

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

  it('finalizes Gemini transcription without a finished field as an encrypted spoken capture', async () => {
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
      serverContent: { inputTranscription: { text: 'standby private speech' } },
    });
    expect(runtime.store.listEvents({ limit: 10 })).toEqual([]);

    socket.send(JSON.stringify({ type: 'wake' }));
    await vi.waitFor(() => expect(messages()).toContainEqual({ type: 'armed', armed: true }));
    callbacks?.onmessage({
      serverContent: { inputTranscription: { text: 'Build a multi-step project ' } },
    });
    // Transcription ordering is independent of model turn completion.
    callbacks?.onmessage({ serverContent: { turnComplete: true } });
    callbacks?.onmessage({
      serverContent: { inputTranscription: { text: 'for Jericho' } },
    });

    await vi.waitFor(() => expect(runtime.store.listEvents({ limit: 10 }).filter((event) => event.type === 'local.capture.spoken')).toHaveLength(1));
    expect(runtime.store.listEvents({ limit: 10 }).find((event) => event.type === 'local.capture.spoken')).toMatchObject({
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

    await vi.waitFor(() => expect(messages()).toContainEqual(expect.objectContaining({
      type: 'guided_test_start', test: 'isabella', phase: 'ready',
    })));
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
    await vi.waitFor(() => expect(messages()).toContainEqual(expect.objectContaining({
      type: 'guided_test_start', test: 'isabella', phase: 'ready',
    })));
    callbacks?.onmessage({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(messages()).toContainEqual({ type: 'turn_complete' }));

    const beforeResume = session.sendClientContent.mock.calls.length;
    socket.send(JSON.stringify({ type: 'wake' }));
    await vi.waitFor(() => expect(messages()).toContainEqual(expect.objectContaining({
      type: 'guided_test_resume', test: 'isabella', phase: 'ready',
    })));
    expect(messages()).toContainEqual({ type: 'greeting_complete' });
    expect(messages()).toContainEqual({ type: 'armed', armed: true });
    expect(session.sendClientContent).toHaveBeenCalledTimes(beforeResume);
  });

  it('retrieves private identity evidence before allowing a natural voice answer', async () => {
    let callbacks: VoiceConnectionCallbacks | undefined;
    const session = {
      sendClientContent: vi.fn(), sendRealtimeInput: vi.fn(), sendToolResponse: vi.fn(), close: vi.fn(),
    };
    const voiceConnect = vi.fn<VoiceConnect>(async (request) => {
      callbacks = request.callbacks;
      request.callbacks.onopen();
      return session;
    });
    const { index } = memoryFixture();
    const runtime = await startVoiceServer(voiceConnect, 5_000, { memoryIndex: index });
    const socket = await connectSocket(runtime.port);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({ type: 'wake' }));
    await vi.waitFor(() => expect(session.sendClientContent).toHaveBeenCalledTimes(1));
    callbacks?.onmessage({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(messages()).toContainEqual({ type: 'greeting_complete' }));

    callbacks?.onmessage({
      serverContent: { inputTranscription: { text: "Who's Isabella?" } },
    });
    callbacks?.onmessage({
      serverContent: { modelTurn: { parts: [{ inlineData: { data: 'speculative', mimeType: 'audio/pcm;rate=24000' } }] } },
    });
    expect(messages()).not.toContainEqual(expect.objectContaining({ data: 'speculative' }));
    await vi.waitFor(() => expect(messages()).toContainEqual(expect.objectContaining({
      type: 'grounded_result', phase: 'resolved',
    })));
    await vi.waitFor(() => expect(runtime.store.listEvents({ limit: 10 }).filter((event) => event.type === 'local.capture.spoken')).toHaveLength(1));
  });

  it('greets at most once across two WebSocket connections with one browser credential', async () => {
    const sessions: Array<{
      sendClientContent: ReturnType<typeof vi.fn>;
      sendRealtimeInput: ReturnType<typeof vi.fn>;
      sendToolResponse: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    }> = [];
    const callbacksList: VoiceConnectionCallbacks[] = [];
    const voiceConnect = vi.fn<VoiceConnect>(async (request) => {
      callbacksList.push(request.callbacks);
      const session = {
        sendClientContent: vi.fn(), sendRealtimeInput: vi.fn(), sendToolResponse: vi.fn(), close: vi.fn(),
      };
      sessions.push(session);
      request.callbacks.onopen();
      return session;
    });
    const runtime = await startVoiceServer(voiceConnect);
    const first = await connectSocket(runtime.port);
    const firstMessages = collectMessages(first);
    await vi.waitFor(() => expect(voiceConnect).toHaveBeenCalledTimes(1));
    first.send(JSON.stringify({ type: 'wake' }));
    await vi.waitFor(() => expect(sessions[0]!.sendClientContent).toHaveBeenCalledTimes(1));
    callbacksList[0]?.onmessage({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(firstMessages()).toContainEqual({ type: 'greeting_complete' }));
    first.close();

    const second = await connectSocket(runtime.port);
    const secondMessages = collectMessages(second);
    await vi.waitFor(() => expect(voiceConnect).toHaveBeenCalledTimes(2));
    second.send(JSON.stringify({ type: 'wake' }));
    await flushIo();
    expect(sessions[1]!.sendClientContent).not.toHaveBeenCalled();
    expect(secondMessages()).toContainEqual({ type: 'greeting_complete' });
    expect(secondMessages().filter((message) => message.type === 'greeting_started')).toHaveLength(0);
  });

  it('runs one identity-aware Isabella retrieval and does not replay the query', async () => {
    let callbacks: VoiceConnectionCallbacks | undefined;
    const session = {
      sendClientContent: vi.fn(), sendRealtimeInput: vi.fn(), sendToolResponse: vi.fn(), close: vi.fn(),
    };
    const voiceConnect = vi.fn<VoiceConnect>(async (request) => {
      callbacks = request.callbacks;
      request.callbacks.onopen();
      return session;
    });
    const { index } = memoryFixture();
    const runtime = await startVoiceServer(voiceConnect, 5_000, { memoryIndex: index });
    const socket = await connectSocket(runtime.port);
    const messages = collectMessages(socket);
    await vi.waitFor(() => expect(voiceConnect).toHaveBeenCalledTimes(1));

    socket.send(JSON.stringify({ type: 'wake' }));
    await vi.waitFor(() => expect(messages()).toContainEqual({ type: 'armed', armed: true }));
    callbacks?.onmessage({ serverContent: { turnComplete: true } });
    await vi.waitFor(() => expect(messages()).toContainEqual({ type: 'greeting_complete' }));
    callbacks?.onmessage({
      serverContent: { inputTranscription: { text: 'Test Isabella', finished: true } },
    });
    await vi.waitFor(() => expect(messages()).toContainEqual(expect.objectContaining({
      type: 'guided_test_phase', phase: 'ready',
    })));
    callbacks?.onmessage({
      serverContent: { inputTranscription: { text: 'Who is Isabella?', finished: true } },
    });
    await vi.waitFor(() => expect(messages()).toContainEqual(expect.objectContaining({
      type: 'guided_test_phase', phase: 'presenting',
    })));
    const grounded = messages().filter((message) => message.type === 'grounded_result' && message.phase !== 'retrieving');
    expect(grounded).toHaveLength(1);
    callbacks?.onmessage({
      serverContent: { inputTranscription: { text: 'Who is Isabella?', finished: true } },
    });
    await flushIo();
    const groundedAfter = messages().filter((message) => message.type === 'grounded_result' && message.phase !== 'retrieving');
    expect(groundedAfter).toHaveLength(1);
    const presenting = session.sendClientContent.mock.calls
      .map((call) => JSON.stringify(call[0]))
      .find((text) => /Narrate only the resolved evidence/i.test(text));
    expect(presenting).toBeTruthy();
    expect(presenting).not.toMatch(/Ask me: Who is Isabella/i);
  });

  it('auditions a voice with a bounded cancellable preview and persists confirmation', async () => {
    const sessions: Array<{
      sendClientContent: ReturnType<typeof vi.fn>;
      sendRealtimeInput: ReturnType<typeof vi.fn>;
      sendToolResponse: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    }> = [];
    let callbacks: VoiceConnectionCallbacks | undefined;
    const voiceConnect = vi.fn<VoiceConnect>(async (request) => {
      const session = {
        sendClientContent: vi.fn(), sendRealtimeInput: vi.fn(), sendToolResponse: vi.fn(), close: vi.fn(),
      };
      sessions.push(session);
      callbacks = request.callbacks;
      request.callbacks.onopen();
      return session;
    });
    const preferencePath = join(tmpdir(), `jericho-voice-${Date.now()}.json`);
    const runtime = await startVoiceServer(voiceConnect, 1_000, { voicePreferencePath: preferencePath });
    const socket = await connectSocket(runtime.port);
    const messages = collectMessages(socket);
    await vi.waitFor(() => expect(voiceConnect).toHaveBeenCalledTimes(1));

    socket.send(JSON.stringify({ type: 'preview_voice', voice: 'Orus', previewId: 'p1' }));
    await vi.waitFor(() => expect(voiceConnect).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(messages()).toContainEqual(expect.objectContaining({
      type: 'voice_preview', previewId: 'p1', status: 'playing',
    })));
    expect(sessions.at(-1)?.sendClientContent).toHaveBeenCalledWith(expect.objectContaining({
      turns: [expect.objectContaining({
        parts: [expect.objectContaining({
          text: expect.stringContaining('Jericho systems are online and at your disposal'),
        })],
      })],
    }));
    socket.send(JSON.stringify({ type: 'cancel_preview' }));
    await vi.waitFor(() => expect(messages()).toContainEqual(expect.objectContaining({
      type: 'voice_preview', previewId: 'p1', status: 'cancelled',
    })));

    socket.send(JSON.stringify({ type: 'confirm_voice', voice: 'Orus' }));
    await vi.waitFor(() => expect(messages()).toContainEqual(expect.objectContaining({
      type: 'voice_confirmed', voice: 'Orus',
    })));
    expect(JSON.parse(readFileSync(preferencePath, 'utf8')).voice).toBe('Orus');

    await runtime.server.close();
    for (const socket of openSockets.splice(0)) socket.close();
    const voiceConnect2 = vi.fn<VoiceConnect>(async (request) => {
      request.callbacks.onopen();
      return {
        sendClientContent: vi.fn(), sendRealtimeInput: vi.fn(), sendToolResponse: vi.fn(), close: vi.fn(),
      };
    });
    const runtime2 = await startVoiceServer(voiceConnect2, 1_000, { voicePreferencePath: preferencePath });
    const socket2 = await connectSocket(runtime2.port);
    await vi.waitFor(() => expect(voiceConnect2).toHaveBeenCalledTimes(1));
    expect(
      (voiceConnect2.mock.calls[0]![0] as VoiceConnectionRequest).config,
    ).toEqual(expect.objectContaining({
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Orus' } },
      },
    }));
    socket2.close();
    await runtime2.server.close();
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

describe('calibration phrase WebSocket transport', () => {
  it('speaks a known calibration phrase and emits started/audio/complete', async () => {
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

    socket.send(JSON.stringify({ type: 'calibration_phrase', phraseId: 'voice_range_1' }));
    await vi.waitFor(() => expect(session.sendClientContent).toHaveBeenCalled());

    callbacks!.onmessage({
      serverContent: {
        modelTurn: {
          parts: [{ inlineData: { data: 'fake-audio', mimeType: 'audio/pcm;rate=24000' } }],
        },
      },
    });
    callbacks!.onmessage({ serverContent: { turnComplete: true } });
    await flushIo();

    const calibrationMessages = messages().filter(
      (m: Record<string, unknown>) => String(m.type ?? '').startsWith('calibration_phrase'),
    );
    expect(calibrationMessages.some((m) => m.type === 'calibration_phrase' && m.status === 'started'))
      .toBe(true);
    expect(calibrationMessages.some((m) => m.type === 'calibration_phrase_audio'))
      .toBe(true);
    expect(calibrationMessages.some((m) => m.type === 'calibration_phrase' && m.status === 'complete'))
      .toBe(true);
    expect(session.sendRealtimeInput).not.toHaveBeenCalled();
  });

  it('rejects an unknown phrase ID with unavailable', async () => {
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

    socket.send(JSON.stringify({ type: 'calibration_phrase', phraseId: 'unknown_id' }));
    await vi.waitFor(() => {
      const phraseMsgs = messages().filter(
        (m) => m.type === 'calibration_phrase' && (m as Record<string, unknown>).status === 'unavailable',
      );
      return phraseMsgs.length > 0;
    });
    expect(session.sendClientContent).not.toHaveBeenCalled();
  });

  it('rejects calibration phrase during an active turn', async () => {
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

    // Activate a wake, simulate greeting
    socket.send(JSON.stringify({ type: 'wake' }));
    await vi.waitFor(() => expect(session.sendClientContent).toHaveBeenCalled());
    // Simulate greeting complete
    callbacks!.onmessage({ serverContent: { turnComplete: true } });
    await flushIo();

    socket.send(JSON.stringify({ type: 'calibration_phrase', phraseId: 'voice_range_1' }));
    await vi.waitFor(() => {
      const msgs = messages();
      const err = msgs.find(
        (m) => m.type === 'calibration_phrase' && (m as Record<string, unknown>).status === 'unavailable',
      );
      expect(err).toBeTruthy();
    });
  });

  it('rejects concurrent calibration phrase', async () => {
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

    socket.send(JSON.stringify({ type: 'calibration_phrase', phraseId: 'voice_range_1' }));
    await vi.waitFor(() => expect(session.sendClientContent).toHaveBeenCalled());
    socket.send(JSON.stringify({ type: 'calibration_phrase', phraseId: 'voice_range_2' }));
    await flushIo();

    const unavailable = messages().filter(
      (m) => m.type === 'calibration_phrase' && (m as Record<string, unknown>).status === 'unavailable',
    );
    expect(unavailable.length).toBe(1);
  });

  it('sends the exact allowlisted text to Gemini once', async () => {
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
    await vi.waitFor(() => expect(voiceConnect).toHaveBeenCalledTimes(1));

    socket.send(JSON.stringify({ type: 'calibration_phrase', phraseId: 'voice_range_3' }));
    await vi.waitFor(() => expect(session.sendClientContent).toHaveBeenCalled());
    const call = session.sendClientContent.mock.calls[0]?.[0];
    expect(call?.turns?.[0]?.parts?.[0]?.text).toBe('Who is Isabella Handel?');
    expect(call?.turns?.[0]?.parts?.[0]?.text).not.toContain('spouse');
    expect(call?.turns?.[0]?.parts?.[0]?.text).not.toContain('married');
    expect(call?.turns?.[0]?.parts?.[0]?.text).not.toContain('wife');
    expect(call?.turns?.[0]?.parts?.[0]?.text).not.toContain('husband');
  });
});

async function startVoiceServer(
  voiceConnect: VoiceConnect,
  voiceActiveTurnMs = 1_000,
  persona: {
    defaultPersonaMode?: 'jarvis' | 'megatron';
    megatronVoice?: string;
    personaAutoRevertMs?: number;
    voicePreferencePath?: string;
    vaultSearch?: { search(query: string, limit: number, signal: AbortSignal): Promise<any> };
    obsidianSearch?: { search(query: string, limit: number): Promise<any> };
    memoryIndex?: MemoryIndex;
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
