// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntentKind, IntentRoute, LifecycleStatus, RiskLevel, SourceType } from '@jericho/shared';

import { ChatShell } from '../src/chat-shell';
import { ChatSessionStore } from '../src/chat-session';
import { CommandCenterStore } from '../src/command-center-store';
import { CoreClient, type EventSourcePort } from '../src/core-client';
import {
  GROUNDED_RESULT_EVENT,
  SPEECH_PLAYING_EVENT,
} from '../src/grounded-result';
import {
  VOICE_STATUS_EVENT,
  VOICE_TEXT_EVENT,
  VOICE_TOOL_START_EVENT,
  VOICE_WAKE_EVENT,
} from '../src/chat-events';
import { snapshot } from './fixtures/command-center';

vi.mock('../src/sphere-shell', () => ({
  SphereShell: () => (
    <div data-testid="sphere-shell" data-jericho-nucleus-space="true">Sphere</div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

beforeEach(() => {
  localStorage.clear();
});

describe('ChatShell', () => {
  it('renders the chat thread, composer, and required gesture contracts', async () => {
    const view = mountChat();
    expect(await screen.findByLabelText('Conversation with Jericho')).toBeTruthy();
    expect(document.querySelector('.jericho-bay--left')).toBeTruthy();
    expect(document.querySelector('[data-gesture-target="chat:send"]')).toBeTruthy();
    expect(document.querySelector('[data-gesture-target="chat:mic"]')).toBeTruthy();
    expect(document.querySelector('[data-gesture-target="view:chat"]')).toBeTruthy();
    expect(document.querySelector('[data-gesture-target="view:sphere"]')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Message Jericho' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sphere' }));
    expect(await screen.findByTestId('sphere-shell')).toBeTruthy();
    expect(document.querySelector('[data-jericho-nucleus-space="true"]')).toBeTruthy();
    view.unmount();
  });

  it('sends typed turns to the chat API and projects the reply without persisting transcripts', async () => {
    const { session, fetchPort, unmount } = mountChat();
    fireEvent.change(screen.getByRole('textbox', { name: 'Message Jericho' }), {
      target: { value: 'Prepare the Isabella brief' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(fetchPort).toHaveBeenCalledWith(
      '/api/v1/chat/turns',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    ));
    const body = JSON.parse(String(
      fetchPort.mock.calls.find((call) => call[0] === '/api/v1/chat/turns')?.[1]?.body,
    )) as { text?: string };
    expect(body.text).toBe('Prepare the Isabella brief');
    expect((await screen.findAllByText('Understood, sir.')).length).toBeGreaterThan(0);
    const state = session.getSnapshot();
    expect(state.turns.some((turn) => turn.kind === 'user' && turn.text === 'Prepare the Isabella brief')).toBe(true);
    expect(state.turns.some((turn) => turn.kind === 'jericho' && turn.text === 'Understood, sir.')).toBe(true);
    expect(localStorage.length).toBe(0);
    unmount();
  });

  it('projects voice text, agent states, tool activity, and grounded-result cards from runtime events', async () => {
    const { unmount } = mountChat();
    act(() => {
      document.dispatchEvent(new CustomEvent(VOICE_WAKE_EVENT, { detail: { source: 'manual' } }));
      document.dispatchEvent(new CustomEvent(VOICE_STATUS_EVENT, { detail: { status: 'listening' } }));
    });
    expect(screen.getAllByText('Listening').length).toBeGreaterThan(0);

    act(() => {
      document.dispatchEvent(new CustomEvent(VOICE_TOOL_START_EVENT, { detail: { name: 'arrange_window' } }));
    });
    expect(screen.getByText('Arranging window…')).toBeTruthy();
    expect(screen.getAllByText('Thinking').length).toBeGreaterThan(0);

    act(() => {
      document.dispatchEvent(new CustomEvent(SPEECH_PLAYING_EVENT, { detail: { playing: true } }));
      document.dispatchEvent(new CustomEvent(VOICE_TEXT_EVENT, { detail: { text: 'The window is arranged.' } }));
    });
    expect(screen.getAllByText('The window is arranged.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Speaking').length).toBeGreaterThan(0);

    act(() => {
      document.dispatchEvent(new CustomEvent(GROUNDED_RESULT_EVENT, {
        detail: {
          resultId: 'gr-chat',
          phase: 'resolved',
          route: 'private_knowledge',
          subject: 'Isabella',
          fullName: 'Isabella Handel',
          confidence: 'strong',
          provenance: [{ relativePath: 'People/Isabella Handel.md', title: 'Isabella Handel', excerpt: 'Family', score: 0.9 }],
          actions: {},
          retrievalCount: 1,
        },
      }));
    });
    expect(document.querySelector('[data-gesture-target="knowledge:gr-chat"]')).toBeTruthy();
    expect(document.querySelector('[data-gesture-draggable="true"]')).toBeTruthy();
    expect(screen.getAllByText('Isabella Handel').length).toBeGreaterThan(0);
    unmount();
  });

  it('renders inline exact-plan approval and review cards with gesture datasets', async () => {
    const store = new CommandCenterStore();
    store.replace(snapshot({
      approvals: [{
        id: 'approval-1',
        missionId: 'mission-9',
        planHash: 'plan-hash-9',
        version: 4,
        title: 'Retain verified brief',
        objective: 'Write the bounded note',
        risk: RiskLevel.Low,
        affectedParties: [],
        affectedSystems: [],
        externalActions: [],
        deliverables: [],
        taskGraph: [],
        agents: [],
        budget: { limits: { maxCostMicroUsd: 1, maxRuntimeMs: 1, maxConcurrency: 1, maxRetries: 1 }, plannedCostMicroUsd: 1, actualCostMicroUsd: 0, actualRuntimeMs: 0 },
        permissions: { tools: [], writable: [], recipients: [], systems: [] },
        escalationConditions: [],
        cost: { maximumMicroUsd: 1, plannedMicroUsd: 1, actualMicroUsd: 0 },
        time: { maximumRuntimeMs: 1, elapsedRuntimeMs: 0 },
        acceptanceTests: [],
        rollback: { strategy: 'none', steps: [] },
        actions: [],
      }],
      reviewIntents: [{
        id: 'intent-1',
        source: 'manual',
        sourceType: SourceType.Manual,
        kind: IntentKind.Action,
        summary: 'Ambiguous request held for review',
        payload: {},
        status: LifecycleStatus.PendingApproval,
        route: IntentRoute.Review,
        routeRuleId: 'review',
        entityIds: [],
        commitments: [],
        claims: [],
        assumptions: [],
        deadlines: [],
        affectedPartyIds: [],
        requiredEvidence: [],
        requiredCapabilities: [],
        ambiguityReasons: ['low confidence'],
        contradictoryEvidenceEventIds: [],
        risk: RiskLevel.Medium,
        confidence: 0.2,
        provenance: [],
        createdAt: '2026-07-11T00:00:00.000Z',
        updatedAt: '2026-07-11T00:00:00.000Z',
        integrityHash: 'intent-hash-1',
      }],
    }));
    const { unmount } = mountChat({ store });
    const card = document.querySelector('[data-jericho-active-approval="true"]');
    expect(card).toBeTruthy();
    expect(card?.getAttribute('data-jericho-approval-mission-id')).toBe('mission-9');
    expect(card?.getAttribute('data-jericho-approval-plan-hash')).toBe('plan-hash-9');
    expect(card?.getAttribute('data-jericho-approval-version')).toBe('4');
    expect(document.querySelector('[data-gesture-target="approval:approve:mission-9"]')).toBeTruthy();
    expect(document.querySelector('[data-gesture-target="review:intent-1"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    unmount();
  });

  it('renders the Efferd sidebar, usage meter, and conversation list from Core data', async () => {
    const store = new CommandCenterStore();
    store.replace(snapshot({
      connectors: [{
        connectorId: 'obsidian',
        status: 'healthy' as never,
        checkedAt: '2026-09-11T00:00:00.000Z',
        consecutiveFailures: 0,
        freshness: 'fresh' as never,
        capabilities: [],
        details: {},
        provenance: [],
      }],
    }));
    const { unmount } = mountChat({
      store,
      history: {
        schemaVersion: 1,
        turns: [{
          id: 'hist-1',
          conversationId: 'desktop',
          role: 'user',
          text: 'Prepare the Isabella brief',
          createdAt: '2026-09-11T20:00:00.000Z',
        }],
      },
    });
    expect(await screen.findByRole('complementary', { name: 'Workspace' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New chat' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Chats/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Projects/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Artifacts/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Images/ })).toBeTruthy();
    expect(await screen.findByLabelText('Core usage')).toBeTruthy();
    expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0);
    expect(screen.getByText('1/1 connectors healthy')).toBeTruthy();
    expect(await screen.findByRole('list', { name: 'Conversation list' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Prepare the Isabella brief/ })).toBeTruthy();
    expect(document.querySelector('[data-gesture-target="chat:new"]')).toBeTruthy();
    expect(document.querySelector('[data-gesture-target="usage:meter"]')).toBeTruthy();
    expect(document.querySelector('[data-gesture-target="user:menu"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(screen.getByText('Talk with Jericho. Text stays on this Mac; voice greets first, then listens.')).toBeTruthy();
    unmount();
  });

  it('wakes the engaged runtime from the composer mic and keeps keyboard send complete', async () => {
    const runtime = { engage: vi.fn(), wake: vi.fn(), recalibrate: vi.fn(), dispose: vi.fn() };
    const { unmount } = mountChat({ runtime });
    fireEvent.click(screen.getByRole('button', { name: 'Wake Jericho voice' }));
    expect(runtime.wake).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole('textbox', { name: 'Message Jericho' }), { target: { value: 'Keyboard path' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message Jericho' }), { key: 'Enter' });
    await waitFor(() => expect(screen.getAllByText('Keyboard path').length).toBeGreaterThan(0));
    unmount();
  });
});

function mountChat(options: {
  store?: CommandCenterStore;
  runtime?: { engage: () => void; wake: () => void; recalibrate: () => void; dispose: () => void };
  history?: { schemaVersion: 1; turns: Array<Record<string, unknown>> };
} = {}) {
  const store = options.store ?? new CommandCenterStore();
  const fetchPort = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (path === '/api/v1/health') {
      return new Response(JSON.stringify({
        ok: true,
        startup: { storage: 'persistent', database: '~/.jericho/jericho.db', initializedNewCore: false },
        connectors: [{ connectorId: 'obsidian', status: 'healthy' }],
        vault: { ready: true },
        voice: { status: 'available' },
      }), { status: 200 });
    }
    if (path === '/api/v1/command-center') {
      return new Response(JSON.stringify(store.getSnapshot().snapshot ?? snapshot()), { status: 200 });
    }
    if (path === '/api/v1/captures') {
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    }
    if (path.startsWith('/api/v1/chat/turns')) {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({
          schemaVersion: 1,
          conversationId: 'local',
          userTurn: { id: 'u1', role: 'user', state: 'answer', text: 'Prepare the Isabella brief' },
          replyTurn: { id: 'r1', role: 'assistant', state: 'answer', text: 'Understood, sir.' },
          receipt: { replayed: false },
          replayed: false,
        }), { status: 201 });
      }
      return new Response(JSON.stringify(options.history ?? { schemaVersion: 1, turns: [] }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
  const client = new CoreClient(store, {
    fetch: fetchPort as typeof fetch,
    createEventSource: () => new FakeEventSource(),
  });
  vi.stubGlobal('fetch', fetchPort);
  const session = new ChatSessionStore();
  const view = render(
    <ChatShell store={store} client={client} session={session} runtime={options.runtime ?? null} />,
  );
  return { ...view, store, client, session, fetchPort };
}

class FakeEventSource implements EventSourcePort {
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  addEventListener(): void {}
  close(): void {}
}
