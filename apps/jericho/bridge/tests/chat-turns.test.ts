import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertChatHistoryPage,
  assertChatTurn,
  assertChatTurnAccepted,
  assertGroundedResultEvent,
} from '@jericho/shared';

import { JerichoStore } from '../src/core/store.js';
import { IntakeProcessor } from '../src/orchestration/intake.js';
import { createJerichoServer } from '../src/server.js';
import {
  ChatTurnRequestError,
  listChatTurns,
  processDesktopTextTurn,
} from '../src/hub/chat-turns.js';

const KEY = Buffer.alloc(32, 83);
const TOKEN = 'local-api-token';
const T0 = '2026-09-11T11:00:00.000Z';
const stores: JerichoStore[] = [];
const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const store of stores.splice(0)) store.close();
});

describe('desktop chat turn processor', () => {
  it('ingests desktop_text through hub classify/route and persists encrypted answer turns', async () => {
    const store = openStore();
    const live: string[] = [];
    const accepted = await processDesktopTextTurn(
      { text: 'What is the status of PR 16?', idempotencyKey: 'query-pr' },
      {
        store,
        now: () => T0,
        onLiveEvent: (event) => live.push(event.event === 'chat_turn' ? event.data.state : event.event),
      },
    );
    expect(() => assertChatTurnAccepted(accepted)).not.toThrow();
    expect(accepted.replayed).toBe(false);
    expect(accepted.userTurn).toMatchObject({
      schemaVersion: 1, role: 'user', state: 'answer', source: 'desktop_text', intent: 'QUERY',
    });
    expect(accepted.receipt.plan).toMatchObject({ intent: 'QUERY', targetAgent: 'JERICHO', status: 'planned' });
    expect(accepted.replyTurn.role).toBe('assistant');
    expect(accepted.replyTurn.state).toBe('answer');
    expect(accepted.replyTurn.text).toContain('JERICHO');
    expect(live).toEqual(['answer', 'thinking', 'speaking', 'answer']);
    expect(store.listChangeLog({ afterSequence: 0 }).every((change) => {
      const encoded = JSON.stringify(change.payload);
      return !encoded.includes('What is the status') && !encoded.includes(accepted.replyTurn.text);
    })).toBe(true);

    const replay = await processDesktopTextTurn(
      { text: 'What is the status of PR 16?', idempotencyKey: 'query-pr' },
      { store, now: () => T0 },
    );
    expect(replay.replayed).toBe(true);
    expect(replay.replyTurn.id).toBe(accepted.replyTurn.id);
    expect(store.listEvents({ source: 'local:chat', limit: 10 })).toHaveLength(2);
  });

  it('holds mutating hub TASK turns for confirmation in the reply', async () => {
    const store = openStore();
    const accepted = await processDesktopTextTurn(
      { text: 'fix the deploy regression', idempotencyKey: 'task-1' },
      { store, now: () => T0 },
    );
    expect(accepted.receipt.plan.status).toBe('pending_approval');
    expect(accepted.replyTurn.text).toMatch(/confirmation/i);
  });

  it('rejects unknown fields and empty text without writing Core records', async () => {
    const store = openStore();
    await expect(processDesktopTextTurn({ text: '   ' }, { store, now: () => T0 }))
      .rejects.toBeInstanceOf(ChatTurnRequestError);
    await expect(processDesktopTextTurn(
      { text: 'hello', extra: true } as { text: string; extra: boolean },
      { store, now: () => T0 },
    )).rejects.toMatchObject({ code: 'chat_field_not_allowed' });
    expect(store.listEvents({ source: 'local:chat', limit: 10 })).toEqual([]);
  });
});

describe('chat turn HTTP, SSE, and history', () => {
  it('requires bearer or session auth', async () => {
    const runtime = await startServer();
    expect((await fetch(`${runtime.url}/api/v1/chat/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'status please' }),
    })).status).toBe(401);
    expect((await fetch(`${runtime.url}/api/v1/chat/turns`)).status).toBe(401);
  });

  it('returns a reply turn, streams thinking/speaking/answer, and pages Core history', async () => {
    let now = T0;
    const runtime = await startServer({ clock: () => now });
    const live = await openSse(runtime.url, '0');

    const created = await api(runtime.url, '/api/v1/chat/turns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'What is the status of PR 16?', idempotencyKey: 'http-query' }),
    });
    expect(created.status).toBe(201);
    const body = await created.json() as { replyTurn: { text: string; state: string }; receipt: { plan: { intent: string } } };
    expect(() => assertChatTurnAccepted(body)).not.toThrow();
    expect(body.receipt.plan.intent).toBe('QUERY');
    expect(body.replyTurn.state).toBe('answer');

    const stream = await readUntil(live.reader, '"state":"speaking"');
    expect(stream).toContain('event: chat_turn');
    expect(stream).toContain('"state":"thinking"');
    expect(stream).toContain('"state":"speaking"');
    expect(stream).toContain('"state":"answer"');
    live.abort();

    now = '2026-09-11T11:01:00.000Z';
    const second = await api(runtime.url, '/api/v1/chat/turns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Give me a brief of the last 72 hours', idempotencyKey: 'http-brief' }),
    });
    expect(second.status).toBe(201);

    const history = await apiJson(runtime.url, '/api/v1/chat/turns?limit=50');
    expect(() => assertChatHistoryPage(history)).not.toThrow();
    expect(history.turns).toHaveLength(4);
    expect(history.turns.map((turn: { role: string }) => turn.role)).toEqual([
      'user', 'assistant', 'user', 'assistant',
    ]);
    expect(history.turns.every((turn: { state: string }) => turn.state === 'answer')).toBe(true);

    const page = await apiJson(runtime.url, '/api/v1/chat/turns?limit=2');
    expect(page.turns).toHaveLength(2);
    expect(page.nextBefore).toEqual(page.turns[0].createdAt);
    const earlier = await apiJson(runtime.url, `/api/v1/chat/turns?limit=50&before=${encodeURIComponent(page.nextBefore)}`);
    expect(earlier.turns.length).toBeGreaterThan(0);
    expect(earlier.turns.every((turn: { createdAt: string }) => turn.createdAt < page.nextBefore)).toBe(true);

    const replay = await api(runtime.url, '/api/v1/chat/turns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'What is the status of PR 16?', idempotencyKey: 'http-query' }),
    });
    expect(replay.status).toBe(200);
    expect((await replay.json() as { replayed: boolean }).replayed).toBe(true);

    const listed = listChatTurns(runtime.store, { limit: 10 });
    expect(listed.turns.every((turn) => {
      expect(() => assertChatTurn(turn)).not.toThrow();
      return turn.source === 'desktop_text';
    })).toBe(true);
  });

  it('emits grounded_result on the existing SSE stream for private identity questions', async () => {
    const search = vi.fn().mockResolvedValue({
      cached: false,
      results: [{
        path: 'People/Isabella Handel.md',
        title: 'Isabella Handel',
        excerpt: 'Carlos wife spouse married MasterBlox',
        score: 0.91,
      }],
    });
    const runtime = await startServer({ vaultSearch: { search } });
    const live = await openSse(runtime.url, '0');
    const created = await api(runtime.url, '/api/v1/chat/turns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Who is Isabella Handel?', idempotencyKey: 'isabella' }),
    });
    expect(created.status).toBe(201);
    const accepted = await created.json() as { groundedResult?: unknown; replyTurn: { text: string } };
    expect(accepted.groundedResult).toBeDefined();
    expect(() => assertGroundedResultEvent(accepted.groundedResult)).not.toThrow();
    expect(accepted.replyTurn.text).toMatch(/Isabella Handel/);
    expect(search).toHaveBeenCalled();
    const stream = await readUntil(live.reader, 'event: grounded_result');
    expect(stream).toContain('event: grounded_result');
    expect(stream).toMatch(/"phase":"(retrieving|resolved)"/);
    live.abort();
  });
});

function openStore(): JerichoStore {
  const store = new JerichoStore({ path: ':memory:', key: KEY });
  stores.push(store);
  return store;
}

async function startServer(overrides: {
  clock?: () => string;
  vaultSearch?: { search: ReturnType<typeof vi.fn> };
} = {}) {
  const store = openStore();
  const intake = new IntakeProcessor({ store });
  const server = createJerichoServer({
    store,
    apiToken: TOKEN,
    host: '127.0.0.1',
    allowedOrigins: [],
    geminiApiKey: undefined,
    ssePollMs: 10,
    intake,
    ...overrides,
  });
  servers.push(server);
  const address = await server.listen(0);
  return { store, url: `http://127.0.0.1:${address.port}` };
}

function api(url: string, path: string, init: RequestInit = {}) {
  return fetch(`${url}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(init.headers ?? {}),
    },
  });
}

async function apiJson(url: string, path: string) {
  return (await api(url, path)).json() as Promise<any>;
}

async function openSse(url: string, lastEventId: string) {
  const controller = new AbortController();
  const response = await api(url, '/api/v1/events', {
    headers: { 'last-event-id': lastEventId },
    signal: controller.signal,
  });
  expect(response.status).toBe(200);
  return { reader: response.body!.getReader(), abort: () => controller.abort() };
}

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, marker: string): Promise<string> {
  const decoder = new TextDecoder();
  let value = '';
  const deadline = Date.now() + 2_000;
  while (!value.includes(marker) && Date.now() < deadline) {
    const chunk = await reader.read();
    if (chunk.done) break;
    value += decoder.decode(chunk.value, { stream: true });
  }
  return value;
}
