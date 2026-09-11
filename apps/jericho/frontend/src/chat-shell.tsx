import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  DecisionOutcome,
  LifecycleStatus,
  ReviewIntentDisposition,
  type CommandCenterApproval,
  type IntentEnvelope,
  type Proposal,
} from '@jericho/shared';

import { BridgeClient } from './bridge-client';
import {
  VOICE_STATUS_EVENT,
  VOICE_TEXT_EVENT,
  VOICE_TOOL_RESULT_EVENT,
  VOICE_TOOL_START_EVENT,
  VOICE_WAKE_EVENT,
} from './chat-events';
import {
  conversationsFromHistory,
  fetchChatHistory,
  mapHistoryTurns,
  type ConversationListItem,
} from './chat-history';
import { ChatSessionStore, type AgentState, type ChatSurface, type ChatTurn } from './chat-session';
import { ChatSidebar, type SidebarSection } from './chat-sidebar';
import { coreUsageMeter } from './chat-usage';
import { CoreClient, CoreRequestError, type CoreHealth } from './core-client';
import { CommandCenterStore } from './command-center-store';
import type { RuntimeLifecyclePort } from './engage-gate';
import {
  JERICHO_APPROVAL_GESTURE_EVENT,
  JERICHO_CANCEL_PENDING_EVENT,
  type ApprovalGestureDetail,
} from './gesture-events';
import {
  GROUNDED_RESULT_EVENT,
  SPEECH_PLAYING_EVENT,
  parseGroundedResultMessage,
  type GroundedResultPayload,
} from './grounded-result';
const SphereShell = lazy(async () => {
  const module = await import('./sphere-shell');
  return { default: module.SphereShell };
});

const TOOL_LABELS: Record<string, [string, string]> = {
  open_browser: ['Opening browser', 'Browser opened'],
  open_application: ['Opening application', 'Application opened'],
  computer_status: ['Checking screens', 'Computer status ready'],
  arrange_window: ['Arranging window', 'Window arranged'],
  inspect_repository: ['Inspecting repository', 'Repository inspected'],
  open_repository: ['Opening repository', 'Repository opened'],
  create_coding_workspace: ['Queueing coding task', 'Coding task queued'],
  coding_agent_status: ['Checking coding agent', 'Coding agent status ready'],
  steer_coding_agent: ['Steering coding agent', 'Coding agent steered'],
  cancel_coding_agent: ['Stopping coding agent', 'Coding agent stopped'],
  open_wifi_mapping: ['Opening Wi-Fi observatory', 'Wi-Fi observatory opened'],
};

const AGENT_LABEL: Record<AgentState, string> = {
  idle: 'Standby',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
};

export function ChatShell({
  store,
  client,
  session,
  runtime,
}: {
  store: CommandCenterStore;
  client: CoreClient;
  session: ChatSessionStore;
  runtime: RuntimeLifecyclePort | null;
}) {
  const core = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const chat = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [surface, setSurface] = useState<ChatSurface>('chat');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [health, setHealth] = useState<CoreHealth | undefined>();
  const [healthStatus, setHealthStatus] = useState<'loading' | 'ready' | 'locked' | 'unavailable' | 'degraded'>('loading');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarSection, setSidebarSection] = useState<SidebarSection>('chats');
  const [historyConversations, setHistoryConversations] = useState<ConversationListItem[]>([]);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const threadRef = useRef<HTMLDivElement>(null);
  const standalone = useRef<BridgeClient | null>(null);
  const startingVoice = useRef(false);

  useEffect(() => {
    void client.start();
    void client.health()
      .then((result) => {
        setHealth(result);
        setHealthStatus(result.ok ? 'ready' : 'degraded');
      })
      .catch((err: unknown) => {
        setHealth(undefined);
        setHealthStatus(err instanceof CoreRequestError && err.status === 401 ? 'locked' : 'unavailable');
      });
    return () => client.stop();
  }, [client]);

  useEffect(() => {
    const decide = (event: Event) => {
      const detail = (event as CustomEvent<ApprovalGestureDetail>).detail;
      if (!detail) return;
      void client.decideMission({
        missionId: detail.missionId,
        planHash: detail.planHash,
        version: detail.version,
        outcome: detail.outcome === 'approved' ? DecisionOutcome.Approved : DecisionOutcome.Rejected,
        reason: 'Held gesture from the active exact-plan approval',
      });
    };
    const cancel = () => {
      const active = document.querySelector<HTMLElement>('[data-jericho-active-approval="true"]');
      const missionId = active?.dataset.jerichoApprovalMissionId;
      const planHash = active?.dataset.jerichoApprovalPlanHash;
      const version = Number(active?.dataset.jerichoApprovalVersion);
      if (!missionId || !planHash || !Number.isSafeInteger(version)) return;
      void client.cancelMission({ missionId, planHash, version, reason: 'Both-open-palms cancellation' });
    };
    document.addEventListener(JERICHO_APPROVAL_GESTURE_EVENT, decide);
    document.addEventListener(JERICHO_CANCEL_PENDING_EVENT, cancel);
    return () => {
      document.removeEventListener(JERICHO_APPROVAL_GESTURE_EVENT, decide);
      document.removeEventListener(JERICHO_CANCEL_PENDING_EVENT, cancel);
    };
  }, [client]);

  useEffect(() => {
    const onText = (event: Event) => {
      const text = (event as CustomEvent<{ text?: string }>).detail?.text;
      if (typeof text === 'string') session.appendJerichoText(text);
    };
    const onStatus = (event: Event) => {
      const status = (event as CustomEvent<{ status?: string }>).detail?.status;
      if (typeof status === 'string') session.setVoiceStatus(status);
    };
    const onWake = () => session.appendVoiceWake();
    const onSpeech = (event: Event) => {
      session.setSpeechPlaying(Boolean((event as CustomEvent<{ playing?: boolean }>).detail?.playing));
    };
    const onGrounded = (event: Event) => {
      const result = (event as CustomEvent<GroundedResultPayload>).detail;
      if (result?.resultId) session.appendGroundedResult(result);
    };
    const onToolStart = (event: Event) => {
      const name = String((event as CustomEvent<{ name?: string }>).detail?.name ?? '');
      const labels = toolLabels(name);
      if (!labels) return;
      session.setTool({ name, state: 'running', message: `${labels[0]}…` });
    };
    const onToolResult = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string; result?: Record<string, unknown> }>).detail;
      const name = String(detail?.name ?? '');
      const labels = toolLabels(name);
      if (!labels) return;
      const result = detail?.result ?? {};
      const failed = result.available === false || result.status === 'failed';
      session.setTool({
        name,
        state: failed ? 'failed' : 'succeeded',
        message: failed ? 'Local action failed safely' : String(result.summary ?? labels[1]),
      });
    };
    document.addEventListener(VOICE_TEXT_EVENT, onText);
    document.addEventListener(VOICE_STATUS_EVENT, onStatus);
    document.addEventListener(VOICE_WAKE_EVENT, onWake);
    document.addEventListener(SPEECH_PLAYING_EVENT, onSpeech);
    document.addEventListener(GROUNDED_RESULT_EVENT, onGrounded);
    document.addEventListener(VOICE_TOOL_START_EVENT, onToolStart);
    document.addEventListener(VOICE_TOOL_RESULT_EVENT, onToolResult);
    return () => {
      document.removeEventListener(VOICE_TEXT_EVENT, onText);
      document.removeEventListener(VOICE_STATUS_EVENT, onStatus);
      document.removeEventListener(VOICE_WAKE_EVENT, onWake);
      document.removeEventListener(SPEECH_PLAYING_EVENT, onSpeech);
      document.removeEventListener(GROUNDED_RESULT_EVENT, onGrounded);
      document.removeEventListener(VOICE_TOOL_START_EVENT, onToolStart);
      document.removeEventListener(VOICE_TOOL_RESULT_EVENT, onToolResult);
    };
  }, [session]);

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [chat.turns.length, chat.agentState, chat.tool]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchChatHistory({ limit: 50, signal: controller.signal })
      .then((page) => {
        if (page) setHistoryConversations(conversationsFromHistory(page.turns));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => () => {
    void standalone.current?.dispose();
    standalone.current = null;
  }, []);

  useEffect(() => {
    if (!runtime) return;
    void standalone.current?.dispose();
    standalone.current = null;
  }, [runtime]);

  const snapshot = core.snapshot;
  const approvals = snapshot?.approvals ?? [];
  const reviews = snapshot?.reviewIntents ?? [];
  const proposals = (snapshot?.proposals ?? []).filter((proposal) => proposal.status === LifecycleStatus.PendingApproval);

  const sendChatTurn = useCallback(async (text: string) => {
    const response = await fetch('/api/v1/chat/turns', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ text, conversationId: session.getSnapshot().conversationId }),
    });
    if (!response.ok) throw new Error('Chat turn failed');
    const accepted = await response.json() as {
      replyTurn?: { text?: string };
      groundedResult?: unknown;
    };
    if (typeof accepted.replyTurn?.text === 'string' && accepted.replyTurn.text.trim()) {
      session.appendJerichoReply(accepted.replyTurn.text);
    }
    const grounded = parseGroundedResultMessage(accepted.groundedResult);
    if (grounded) session.appendGroundedResult(grounded);
  }, [session]);

  const sendText = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    session.appendUserText(text);
    setDraft('');
    try {
      await sendChatTurn(text);
    } catch (error) {
      session.setComposerError(error instanceof Error ? error.message : 'Chat turn failed');
    } finally {
      setSending(false);
    }
  };

  const startNewChat = () => {
    session.startNewChat();
    setDraft('');
    setSidebarSection('chats');
  };

  const selectConversation = useCallback(async (conversationId: string) => {
    if (conversationId === session.getSnapshot().conversationId) return;
    try {
      const page = await fetchChatHistory({ conversationId, limit: 50 });
      session.hydrateFromCore(conversationId, page ? mapHistoryTurns(page.turns) : []);
    } catch {
      session.hydrateFromCore(conversationId, []);
    }
  }, [session]);

  const wakeVoice = async () => {
    if (runtime) {
      runtime.wake();
      return;
    }
    if (!standalone.current && !startingVoice.current) {
      startingVoice.current = true;
      const bridge = new BridgeClient(standaloneVoiceEvents());
      standalone.current = bridge;
      try {
        await bridge.start();
      } catch (error) {
        session.setComposerError(error instanceof Error ? error.message : 'Voice unavailable');
        await bridge.dispose();
        if (standalone.current === bridge) standalone.current = null;
        startingVoice.current = false;
        return;
      }
      startingVoice.current = false;
    }
    standalone.current?.wake('manual');
  };

  const connection = healthStatus === 'ready' && core.status === 'ready'
    ? 'ready'
    : healthStatus === 'locked'
      ? 'locked'
      : core.status === 'disconnected' || healthStatus === 'unavailable'
        ? 'unavailable'
        : 'loading';

  const missions = snapshot?.missions ?? [];
  const outcomes = snapshot?.outcomes ?? [];
  const packages = snapshot?.knowledge?.packages ?? [];
  const groundedCount = chat.turns.filter((turn) => turn.kind === 'grounded').length;
  const usage = coreUsageMeter(snapshot, health);
  const conversations = mergeLiveConversations(historyConversations, chat.conversationId, chat.turns);
  const operatorLabel = 'Operator';
  const operatorMeta = connection === 'ready' ? 'Core live' : connection === 'locked' ? 'Core locked' : connection === 'unavailable' ? 'Core unavailable' : 'Connecting';

  return (
    <div className="jericho-shell jericho-chat-shell" data-surface={surface} data-theme={theme}>
      <a className="jericho-skip-link" href="#jericho-composer">Skip to composer</a>
      <ChatSidebar
        collapsed={sidebarCollapsed}
        section={sidebarSection}
        conversations={conversations}
        activeConversationId={chat.conversationId}
        missions={missions}
        outcomes={outcomes}
        packages={packages}
        artifactCount={packages.length + outcomes.length + groundedCount}
        imageCount={0}
        usage={usage}
        operatorLabel={operatorLabel}
        operatorMeta={`${operatorMeta} · ${health?.voice.status === 'available' ? 'Voice ready' : 'Voice gated'}`}
        theme={theme}
        userMenuOpen={userMenuOpen}
        onToggle={() => setSidebarCollapsed((value) => !value)}
        onNewChat={startNewChat}
        onSelectConversation={(id) => void selectConversation(id)}
        onSection={setSidebarSection}
        onToggleUserMenu={() => setUserMenuOpen((value) => !value)}
        onToggleTheme={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')}
      />
      <div className="jericho-chat-main">
        <header className="jericho-masthead jericho-chat-masthead">
          <div>
            <span className="jericho-eyebrow">Private local intelligence</span>
            <h1>JERICHO</h1>
          </div>
          <div className="jericho-chat-masthead__meta">
            <p className="jericho-core-status" role="status">
              <span className={`jericho-status-light ${connection === 'ready' ? 'jericho-status-light--ready' : connection === 'unavailable' || connection === 'locked' ? 'jericho-status-light--unavailable' : ''}`} />
              <span>{connection === 'ready' ? 'Core live' : connection === 'locked' ? 'Core locked' : connection === 'unavailable' ? 'Core unavailable' : 'Connecting'}</span>
              <span>{health?.voice.status === 'available' ? 'Voice ready' : 'Voice gated'}</span>
            </p>
            <AgentStatusBadge state={chat.agentState} />
            <nav className="jericho-chat-surfaces" aria-label="Interface">
              <button
                type="button"
                data-gesture-target="view:chat"
                aria-pressed={surface === 'chat'}
                onClick={() => setSurface('chat')}
              >
                Chat
              </button>
              <button
                type="button"
                data-gesture-target="view:sphere"
                aria-pressed={surface === 'sphere'}
                onClick={() => setSurface('sphere')}
              >
                Sphere
              </button>
            </nav>
          </div>
        </header>

        {(core.status === 'disconnected' || core.status === 'unavailable') && (
          <p className="jericho-connection-banner" role="status">{core.error ?? 'Live updates disconnected'}</p>
        )}

        <div className="jericho-chat-toolstrip" aria-live="polite">
          {chat.tool && (
            <p className="jericho-chat-tool" data-state={chat.tool.state} role="status">
              {chat.tool.message}
            </p>
          )}
        </div>

        {surface === 'sphere' ? (
          <Suspense fallback={<div className="jericho-loading">CONNECTING TO JERICHO CORE</div>}>
            <SphereShell store={store} client={client} manageClient={false} onRecalibrate={runtime ? () => runtime.recalibrate() : undefined} />
          </Suspense>
        ) : (
          <div className="jericho-chat-layout">
            <section
              ref={threadRef}
              className="jericho-bay jericho-bay--left jericho-chat-thread"
              aria-label="Conversation with Jericho"
            >
              {chat.turns.length === 0 && approvals.length === 0 && reviews.length === 0 && (
                <p className="jericho-empty">Talk with Jericho. Text stays on this Mac; voice greets first, then listens.</p>
              )}
              {chat.turns.map((turn) => <ChatTurnView key={turn.id} turn={turn} />)}
              {chat.agentState !== 'idle' && (
                <p className="jericho-chat-agent" data-state={chat.agentState} role="status">
                  Jericho is {AGENT_LABEL[chat.agentState].toLowerCase()}
                </p>
              )}
            </section>

            <aside className="jericho-chat-rail" aria-label="Pending review">
              {approvals.map((approval, index) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  active={index === 0}
                  onDecide={(outcome) => void client.decideMission({
                    missionId: approval.missionId,
                    planHash: approval.planHash,
                    version: approval.version,
                    outcome,
                    reason: `${outcome === DecisionOutcome.Approved ? 'Approved' : 'Rejected'} from chat`,
                  })}
                  onCancel={() => void client.cancelMission({
                    missionId: approval.missionId,
                    planHash: approval.planHash,
                    version: approval.version,
                    reason: 'Cancelled from chat',
                  })}
                />
              ))}
              {reviews.map((intent) => (
                <ReviewCard
                  key={intent.id}
                  intent={intent}
                  onDecide={(disposition) => {
                    if (!intent.integrityHash) return;
                    void client.decideReviewIntent({
                      intentId: intent.id,
                      intentHash: intent.integrityHash,
                      disposition,
                      reason: 'Reviewed from chat',
                    });
                  }}
                />
              ))}
              {proposals.map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  onDecide={(outcome) => {
                    if (!proposal.integrityHash || proposal.version === undefined) return;
                    void client.decideProposal({
                      proposalId: proposal.id,
                      proposalHash: proposal.integrityHash,
                      version: proposal.version,
                      outcome,
                      reason: 'Reviewed from chat',
                    });
                  }}
                />
              ))}
              {approvals[0] && <p className="jericho-chat-hint">Thumb up or down holds the exact visible plan.</p>}
            </aside>
          </div>
        )}

        {surface === 'chat' && (
          <form
            id="jericho-composer"
            className="jericho-chat-composer cn-card"
            onSubmit={(event) => {
              event.preventDefault();
              void sendText();
            }}
          >
            <label className="jericho-eyebrow" htmlFor="jericho-composer-input">Message Jericho</label>
            <div className="jericho-chat-composer__row">
              <textarea
                id="jericho-composer-input"
                value={draft}
                rows={2}
                placeholder="Ask Jericho…"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendText();
                  }
                }}
              />
              <button
                type="button"
                data-gesture-target="chat:mic"
                aria-pressed={chat.agentState === 'listening' || chat.agentState === 'speaking'}
                aria-label="Wake Jericho voice"
                onClick={() => void wakeVoice()}
              >
                Mic
              </button>
              <button
                type="submit"
                data-gesture-target="chat:send"
                disabled={!draft.trim() || sending}
              >
                Send
              </button>
            </div>
            {chat.composerError && <p className="jericho-error" role="alert">{chat.composerError}</p>}
          </form>
        )}
      </div>
    </div>
  );
}

function standaloneVoiceEvents() {
  return {
    onText: (text: string) => {
      document.dispatchEvent(new CustomEvent(VOICE_TEXT_EVENT, { detail: { text } }));
    },
    onStatus: (status: string) => {
      document.dispatchEvent(new CustomEvent(VOICE_STATUS_EVENT, { detail: { status } }));
    },
    onWake: (source: 'clap' | 'manual') => {
      document.dispatchEvent(new CustomEvent(VOICE_WAKE_EVENT, { detail: { source } }));
    },
    onGroundedResult: (result: GroundedResultPayload) => {
      document.dispatchEvent(new CustomEvent(GROUNDED_RESULT_EVENT, { detail: result }));
    },
    onSpeechPlaying: (playing: boolean) => {
      document.dispatchEvent(new CustomEvent(SPEECH_PLAYING_EVENT, { detail: { playing } }));
    },
    onToolStart: (name: string, args: Record<string, unknown>) => {
      document.dispatchEvent(new CustomEvent(VOICE_TOOL_START_EVENT, { detail: { name, args } }));
    },
    onToolResult: (name: string, result: Record<string, unknown>) => {
      document.dispatchEvent(new CustomEvent(VOICE_TOOL_RESULT_EVENT, { detail: { name, result } }));
    },
  };
}

function toolLabels(name: string): [string, string] | null {
  if (TOOL_LABELS[name]) return TOOL_LABELS[name];
  if (name.startsWith('mcp_')) return ['Running MCP tool', 'MCP tool complete'];
  return null;
}

function AgentStatusBadge({ state }: { state: AgentState }) {
  return (
    <span className="jericho-chat-state" data-state={state} role="status">
      {AGENT_LABEL[state]}
    </span>
  );
}

function ChatTurnView({ turn }: { turn: ChatTurn }) {
  if (turn.kind === 'grounded') return <GroundedResultCard result={turn.result} />;
  if (turn.kind === 'system') {
    return <p className="jericho-chat-system">{turn.text}</p>;
  }
  return (
    <article
      className={`jericho-chat-turn jericho-chat-turn--${turn.kind} cn-card`}
      data-channel={turn.channel}
      data-gesture-target={`turn:${turn.id}`}
    >
      <header>
        <span>{turn.kind === 'user' ? 'You' : 'Jericho'}</span>
        <time dateTime={turn.at}>{formatTime(turn.at)}</time>
      </header>
      <p>{turn.text}</p>
    </article>
  );
}

function GroundedResultCard({ result }: { result: GroundedResultPayload }) {
  return (
    <article
      className="jericho-chat-card jericho-chat-card--grounded cn-card"
      data-gesture-target={`knowledge:${result.resultId}`}
      data-gesture-draggable="true"
    >
      <header>
        <span className="jericho-eyebrow">{result.phase} · {result.route.replaceAll('_', ' ')}</span>
        <strong>{result.fullName ?? result.subject}</strong>
      </header>
      {result.relationship && <p>{result.relationship}</p>}
      {result.provenance.length > 0 && (
        <ul>
          {result.provenance.slice(0, 4).map((item) => (
            <li key={item.relativePath}>
              <strong>{item.title}</strong>
              <code>{item.relativePath}</code>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function ApprovalCard({
  approval,
  active,
  onDecide,
  onCancel,
}: {
  approval: CommandCenterApproval;
  active: boolean;
  onDecide: (outcome: DecisionOutcome.Approved | DecisionOutcome.Rejected) => void;
  onCancel: () => void;
}) {
  return (
    <article
      className="jericho-approval-card jericho-chat-card cn-card"
      data-gesture-target={`approval:${approval.missionId}`}
      data-jericho-active-approval={active ? 'true' : undefined}
      data-jericho-approval-mission-id={approval.missionId}
      data-jericho-approval-plan-hash={approval.planHash}
      data-jericho-approval-version={String(approval.version)}
    >
      <div className="jericho-approval-title">
        <span>Exact plan</span>
        <h3>{approval.title}</h3>
      </div>
      <p>{approval.objective}</p>
      <dl>
        <div><dt>Version</dt><dd>V{approval.version}</dd></div>
        <div><dt>Plan hash</dt><dd><code>{approval.planHash}</code></dd></div>
      </dl>
      <div className="jericho-action-row">
        <button type="button" data-gesture-target={`approval:approve:${approval.missionId}`} onClick={() => onDecide(DecisionOutcome.Approved)}>Approve</button>
        <button type="button" data-gesture-target={`approval:reject:${approval.missionId}`} onClick={() => onDecide(DecisionOutcome.Rejected)}>Reject</button>
        <button type="button" data-gesture-target={`approval:cancel:${approval.missionId}`} onClick={onCancel}>Cancel</button>
      </div>
    </article>
  );
}

function ReviewCard({
  intent,
  onDecide,
}: {
  intent: IntentEnvelope;
  onDecide: (disposition: ReviewIntentDisposition) => void;
}) {
  return (
    <article className="jericho-review-card jericho-chat-card cn-card" data-gesture-target={`review:${intent.id}`}>
      <div className="jericho-review-title">
        <strong>Review</strong>
        <span className="jericho-status jericho-status--pending">{intent.risk}</span>
      </div>
      <p>{intent.summary}</p>
      {intent.integrityHash && (
        <div className="jericho-action-row">
          <button type="button" data-gesture-target={`review:dismiss:${intent.id}`} onClick={() => onDecide(ReviewIntentDisposition.Dismiss)}>Dismiss</button>
          <button type="button" data-gesture-target={`review:reclassify:${intent.id}`} onClick={() => onDecide(ReviewIntentDisposition.ReclassifyProject)}>Reclassify</button>
        </div>
      )}
    </article>
  );
}

function ProposalCard({
  proposal,
  onDecide,
}: {
  proposal: Proposal;
  onDecide: (outcome: DecisionOutcome.Approved | DecisionOutcome.Rejected) => void;
}) {
  const ready = Boolean(proposal.integrityHash && proposal.version !== undefined);
  return (
    <article className="jericho-proposal-row jericho-chat-card cn-card" data-gesture-target={`proposal:${proposal.id}`}>
      <div>
        <strong>{String(proposal.kind).replaceAll('_', ' ')}</strong>
        <span>{proposal.risk}</span>
      </div>
      <p>{proposal.summary}</p>
      {ready && (
        <div className="jericho-action-row">
          <button type="button" data-gesture-target={`proposal:approve:${proposal.id}`} onClick={() => onDecide(DecisionOutcome.Approved)}>Approve</button>
          <button type="button" data-gesture-target={`proposal:reject:${proposal.id}`} onClick={() => onDecide(DecisionOutcome.Rejected)}>Reject</button>
        </div>
      )}
    </article>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

function mergeLiveConversations(
  history: ConversationListItem[],
  conversationId: string,
  turns: ChatTurn[],
): ConversationListItem[] {
  const rest = history.filter((item) => item.id !== conversationId);
  const fromHistory = history.find((item) => item.id === conversationId);
  if (turns.length === 0) {
    if (fromHistory) return [fromHistory, ...rest];
    return [{
      id: conversationId,
      preview: 'Current chat',
      at: new Date().toISOString(),
      turnCount: 0,
    }, ...rest];
  }
  const last = [...turns].reverse().find((turn) => turn.kind === 'user' || turn.kind === 'jericho');
  const previewText = last && 'text' in last ? last.text.trim().replace(/\s+/g, ' ') : '';
  const preview = previewText
    ? (previewText.length > 72 ? `${previewText.slice(0, 72)}…` : previewText)
    : 'Current chat';
  return [{
    id: conversationId,
    preview,
    at: last?.at ?? new Date().toISOString(),
    turnCount: turns.length,
  }, ...rest];
}
