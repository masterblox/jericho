import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { GoogleGenAI, Modality, type Session } from '@google/genai';
import { WebSocket, WebSocketServer } from 'ws';

import {
  DecisionOutcome,
  LifecycleStatus,
  ProposalKind,
  RelationType,
  RiskLevel,
  SourceType,
  RouteType,
  type DecisionRecord,
  type EventEnvelope,
  type JsonValue,
  type MissionDecisionRequest,
  type MissionDecisionResponse,
  type Proposal,
} from '@jericho/shared';

import { buildCommandCenterSnapshot } from './command-center.js';
import { loadConfig } from './config.js';
import {
  EventConflictError,
  JerichoStore,
  MissionDecisionConflictError,
} from './core/store.js';
import {
  IntakeProcessor,
  type IntakeProcessingResult,
  type IntakeRecoveryResult,
  type MissionQueueResult,
} from './orchestration/intake.js';
import { createConnectorRuntime } from './runtime.js';
import { createToolExecutor, FUNCTION_DECLARATIONS, type ToolExecutor } from './tools.js';

export interface SyncPort {
  sync(connectorId: string, partition: string, signal: AbortSignal): Promise<unknown>;
}

export interface ObsidianSearchPort {
  search(query: string, limit: number): Promise<unknown>;
}

export interface IntakePort {
  processEvent(eventId: string): IntakeProcessingResult;
  queueApprovedMission(missionId: string): MissionQueueResult;
  recover(): IntakeRecoveryResult;
}

export interface MissionRetentionPort {
  retainMission(missionId: string): {
    relativePath: string;
    status: 'created' | 'updated' | 'unchanged';
  };
}

export interface ReflectionReviewPort {
  runOnce(observedAt?: string): unknown[];
}

export interface VoiceSessionPort {
  sendRealtimeInput(input: unknown): void;
  sendToolResponse(input: unknown): void;
  close(): void;
}

export interface VoiceConnectionCallbacks {
  onopen(): void;
  onmessage(message: any): void;
  onerror(error?: unknown): void;
  onclose(): void;
}

export interface VoiceConnectionRequest {
  model: string;
  config: Record<string, unknown>;
  callbacks: VoiceConnectionCallbacks;
}

export type VoiceConnect = (
  request: VoiceConnectionRequest,
) => Promise<VoiceSessionPort>;

export interface JerichoServerOptions {
  store: JerichoStore;
  apiToken: string;
  host?: string;
  allowedOrigins?: string[];
  geminiApiKey?: string;
  geminiModel?: string;
  geminiVoice?: string;
  systemInstruction?: string;
  frontendDir?: string;
  supervisor?: SyncPort;
  connectorDescriptors?: readonly unknown[];
  obsidianSearch?: ObsidianSearchPort;
  intake?: IntakePort;
  retention?: MissionRetentionPort;
  reflection?: ReflectionReviewPort;
  ssePollMs?: number;
  toolExecutor?: ToolExecutor;
  clock?: () => string;
  decisionIdFactory?: () => string;
  voiceConnect?: VoiceConnect;
  voiceActiveTurnMs?: number;
}

export interface JerichoServerAddress {
  address: string;
  port: number;
}

export interface JerichoServer {
  listen(port: number, host?: string): Promise<JerichoServerAddress>;
  close(): Promise<void>;
}

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; media-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
} as const;

export const VOICES = [
  'Fenrir', 'Charon', 'Orus', 'Iapetus', 'Sulafat',
  'Enceladus', 'Erinome', 'Algieba', 'Algenib', 'Kratos',
] as const;

export function createJerichoServer(options: JerichoServerOptions): JerichoServer {
  if (!options.apiToken) throw new Error('Local Core API token is required');
  if (
    options.voiceActiveTurnMs !== undefined &&
    (!Number.isFinite(options.voiceActiveTurnMs) || options.voiceActiveTurnMs <= 0)
  ) throw new Error('Active voice turn duration must be positive');
  const host = options.host ?? '127.0.0.1';
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  const ssePollMs = options.ssePollMs ?? 250;
  const clock = options.clock ?? (() => new Date().toISOString());
  const decisionIdFactory = options.decisionIdFactory ?? randomUUID;
  const browserSessionToken = randomBytes(32).toString('base64url');
  const sseClients = new Set<{ response: ServerResponse; timer: ReturnType<typeof setInterval> }>();
  const tools = options.toolExecutor ?? createToolExecutor({ store: options.store });
  const httpServer = createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      const failure = httpFailure(error);
      if (!response.headersSent) sendJson(response, failure.status, { error: failure.code });
      else response.end();
      if (failure.status >= 500 && process.env.NODE_ENV !== 'test') {
        console.error('[jericho] request failed', error);
      }
    });
  });
  const voice = attachVoice(
    httpServer,
    options,
    tools,
    host,
    allowedOrigins,
    browserSessionToken,
  );

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    applySecurityHeaders(response);
    const hostHeader = request.headers.host;
    if (!hostHeader || !hostAllowed(hostHeader, host)) {
      sendJson(response, 421, { error: 'misdirected_request' });
      return;
    }
    const origin = request.headers.origin;
    if (origin && origin !== `http://${hostHeader}` && origin !== `https://${hostHeader}` && !allowedOrigins.has(origin)) {
      sendJson(response, 403, { error: 'origin_forbidden' });
      return;
    }

    const url = new URL(request.url ?? '/', `http://${hostHeader}`);
    if (url.pathname.startsWith('/api/v1/')) {
      response.setHeader('Cache-Control', 'no-store');
      if (
        !authorized(request.headers.authorization, options.apiToken) &&
        !authorizedSession(request.headers.cookie, browserSessionToken)
      ) {
        response.setHeader('WWW-Authenticate', 'Bearer realm="jericho-local"');
        sendJson(response, 401, { error: 'unauthorized' });
        return;
      }
      await handleApi(request, response, url);
      return;
    }
    await serveFrontend(
      request,
      response,
      options.frontendDir,
      url.pathname,
      browserSessionToken,
    );
  }

  async function handleApi(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> {
    if (request.method === 'GET' && url.pathname === '/api/v1/health') {
      sendJson(response, 200, {
        ok: true,
        voice: { status: options.geminiApiKey ? 'available' : 'unavailable' },
        connectors: options.store.listConnectorHealth(),
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/command-center') {
      sendJson(response, 200, buildCommandCenterSnapshot(options.store, now()));
      return;
    }
    const missionRetentionMatch = url.pathname.match(/^\/api\/v1\/missions\/([^/]+)\/retain$/);
    if (request.method === 'POST' && missionRetentionMatch) {
      if (!options.retention) {
        sendJson(response, 503, { error: 'mission_retention_unavailable' });
        return;
      }
      const missionId = decodedPathSegment(missionRetentionMatch[1], 'invalid_mission_id');
      if (!options.store.getMission(missionId)) throw new HttpError(404, 'mission_not_found');
      let result: ReturnType<MissionRetentionPort['retainMission']>;
      try {
        result = options.retention.retainMission(missionId);
      } catch (error) {
        if (/not a verified completed mission|requires verified/u.test(String(error))) {
          throw new HttpError(409, 'mission_retention_not_ready');
        }
        throw error;
      }
      // Absolute vault paths never leave the local service boundary.
      sendJson(response, 200, { relativePath: result.relativePath, status: result.status });
      return;
    }
    const missionCancellationMatch = url.pathname.match(/^\/api\/v1\/missions\/([^/]+)\/cancel$/);
    if (request.method === 'POST' && missionCancellationMatch) {
      const missionId = decodedPathSegment(missionCancellationMatch[1], 'invalid_mission_id');
      const mission = options.store.getMission(missionId);
      if (!mission) throw new HttpError(404, 'mission_not_found');
      const input = missionCancellationRequest(await readJsonBody(request, 64 * 1024));
      const decidedAt = now();
      const decisionId = decisionIdFactory();
      if (!decisionId.trim() || decisionId.length > 512) {
        throw new Error('Mission decision ID factory returned an invalid ID');
      }
      const cancelled = options.store.requestMissionCancellation(
        mission.id,
        input.reason,
        decidedAt,
        {
          planHash: input.planHash,
          planVersion: input.version,
          decision: {
            id: decisionId,
            missionId: mission.id,
            decidedBy: 'carlos',
            outcome: DecisionOutcome.Superseded,
            planHash: input.planHash,
            planVersion: input.version,
            rationale: input.reason,
            assumptions: [],
            evidenceEventIds: [...mission.evidenceEventIds],
            route: RouteType.HumanApproval,
            risk: mission.risk,
            decidedAt,
            provenance: [{
              source: 'local:command-center',
              sourceType: SourceType.User,
              sourceEventId: decisionId,
              observedAt: decidedAt,
            }],
          },
        },
      );
      sendJson(response, 200, {
        mission: cancelled,
        decision: options.store.getDecision(decisionId),
        snapshot: buildCommandCenterSnapshot(options.store, now()),
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/relationship-proposals') {
      const input = relationshipProposalRequest(await readJsonBody(request, 64 * 1024));
      const snapshot = buildCommandCenterSnapshot(options.store, now());
      const from = snapshot.nucleus.nodes.find((node) => node.id === input.fromNodeId);
      const to = snapshot.nucleus.nodes.find((node) => node.id === input.toNodeId);
      if (!from || !to) throw new HttpError(404, 'nucleus_node_not_found');
      const createdAt = now();
      const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 32);
      const proposal: Proposal = {
        id: `relationship-${digest}`,
        proposedByAgentId: 'carlos',
        kind: ProposalKind.DataChange,
        summary: `Relate ${from.label} to ${to.label} as ${input.relation}`,
        body: {
          fromNodeId: input.fromNodeId,
          toNodeId: input.toNodeId,
          relation: input.relation,
          evidenceEventIds: [...new Set([
            ...from.evidenceEventIds,
            ...to.evidenceEventIds,
          ])],
          verified: false,
        },
        status: LifecycleStatus.PendingApproval,
        route: RouteType.HumanApproval,
        risk: RiskLevel.Low,
        createdAt,
        provenance: [{
          source: 'local:nucleus',
          sourceType: SourceType.User,
          sourceEventId: `relationship-${digest}`,
          observedAt: createdAt,
        }],
      };
      const stored = options.store.saveProposal(proposal);
      sendJson(response, 201, {
        proposal: stored,
        snapshot: buildCommandCenterSnapshot(options.store, now()),
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/reflection/run') {
      if (!options.reflection) {
        sendJson(response, 503, { error: 'reflection_unavailable' });
        return;
      }
      const proposals = options.reflection.runOnce(now());
      sendJson(response, 200, { proposals });
      return;
    }
    const missionDecisionMatch = url.pathname.match(/^\/api\/v1\/missions\/([^/]+)\/decisions$/);
    if (request.method === 'POST' && missionDecisionMatch) {
      let missionId: string;
      try {
        missionId = decodeURIComponent(missionDecisionMatch[1]);
      } catch {
        throw new HttpError(400, 'invalid_mission_id');
      }
      if (!missionId || missionId.length > 512) {
        throw new HttpError(400, 'invalid_mission_id');
      }
      const mission = options.store.getMission(missionId);
      if (!mission) throw new HttpError(404, 'mission_not_found');
      const input = missionDecisionRequest(await readJsonBody(request, 64 * 1024));
      const decidedAt = now();
      const decisionId = decisionIdFactory();
      if (!decisionId.trim() || decisionId.length > 512) {
        throw new Error('Mission decision ID factory returned an invalid ID');
      }
      const intent = options.store.getIntent(mission.intentId);
      const decision: DecisionRecord = {
        id: decisionId,
        missionId,
        decidedBy: 'carlos',
        outcome: input.outcome,
        planHash: input.planHash,
        planVersion: input.version,
        rationale: input.reason ?? (input.outcome === DecisionOutcome.Approved
          ? 'Approved the bounded mission plan'
          : 'Rejected the bounded mission plan'),
        assumptions: intent?.assumptions.map((assumption) => assumption.text) ?? [],
        evidenceEventIds: [...mission.evidenceEventIds],
        route: RouteType.HumanApproval,
        risk: mission.risk,
        decidedAt,
        provenance: [{
          source: 'local:command-center',
          sourceType: SourceType.User,
          sourceEventId: decisionId,
          observedAt: decidedAt,
        }],
      };
      const decidedMission = options.store.decideMission(
        missionId,
        input.planHash,
        input.version,
        decision,
      );
      const queue = input.outcome === DecisionOutcome.Approved
        ? options.intake?.queueApprovedMission(decidedMission.id)
        : undefined;
      const snapshot = buildCommandCenterSnapshot(options.store, now());
      const projectedMission = snapshot.missions.find((item) => item.id === decidedMission.id);
      if (!projectedMission) throw new Error(`Decided mission ${missionId} is not projectable`);
      const storedDecision = options.store.getDecision(decisionId);
      if (!storedDecision) throw new Error(`Decision ${decisionId} was not retained`);
      const result: MissionDecisionResponse = {
        decision: storedDecision,
        mission: projectedMission,
        snapshot,
      };
      sendJson(response, 200, { ...result, ...(queue ? { queue } : {}) });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/connectors') {
      sendJson(response, 200, {
        connectors: options.connectorDescriptors ?? [],
        health: options.store.listConnectorHealth(),
      });
      return;
    }
    const syncMatch = url.pathname.match(/^\/api\/v1\/connectors\/([^/]+)\/sync$/);
    if (request.method === 'POST' && syncMatch) {
      if (!options.supervisor) {
        sendJson(response, 503, { error: 'connector_supervisor_unavailable' });
        return;
      }
      let connectorId: string;
      try {
        connectorId = decodeURIComponent(syncMatch[1]);
      } catch {
        throw new HttpError(400, 'invalid_connector_id');
      }
      const descriptor = findConnectorDescriptor(options.connectorDescriptors, connectorId);
      if (options.connectorDescriptors && !descriptor) {
        throw new HttpError(404, 'connector_not_found');
      }
      const body = await readJsonBody(request, 64 * 1024);
      const partition = typeof body.partition === 'string' ? body.partition : 'primary';
      if (!partition || partition.length > 512) {
        throw new HttpError(400, 'invalid_connector_partition');
      }
      if (descriptor && !descriptor.partitions.includes(partition)) {
        throw new HttpError(400, 'invalid_connector_partition');
      }
      const controller = new AbortController();
      request.once('aborted', () => controller.abort());
      let result: unknown;
      try {
        result = await options.supervisor.sync(connectorId, partition, controller.signal);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/not registered/i.test(message)) throw new HttpError(404, 'connector_not_found');
        if (/does not own partition/i.test(message)) {
          throw new HttpError(400, 'invalid_connector_partition');
        }
        throw error;
      }
      sendJson(response, 200, result);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/captures') {
      const body = await readJsonBody(request, 256 * 1024);
      const receivedAt = new Date(clock()).toISOString();
      const event = localCaptureEvent(body);
      const result = options.store.commitLocalCapture(event);
      let processing: IntakeProcessingResult | undefined;
      if (options.intake) {
        try {
          processing = options.intake.processEvent(result.event.id);
        } catch (error) {
          processing = {
            status: 'failed',
            failure: undefined,
          };
          if (process.env.NODE_ENV !== 'test') {
            console.error('[jericho] local capture intake failed', error);
          }
        }
      }
      sendJson(response, result.inserted ? 201 : 200, {
        ...result,
        receivedAt,
        ...(processing ? { processing } : {}),
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/captures') {
      const limit = boundedInteger(url.searchParams.get('limit'), 100, 1, 1_000);
      sendJson(response, 200, { events: options.store.listEvents({ limit }) });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/obsidian/search') {
      if (!options.obsidianSearch) {
        sendJson(response, 503, { error: 'obsidian_search_unavailable' });
        return;
      }
      const query = url.searchParams.get('q') ?? '';
      if (!query.trim()) throw new HttpError(400, 'invalid_search_query');
      const limit = boundedInteger(url.searchParams.get('limit'), 10, 1, 50);
      const results = await options.obsidianSearch.search(query, limit);
      sendJson(response, 200, { results });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/events') {
      openEventStream(request, response);
      return;
    }
    sendJson(response, 404, { error: 'not_found' });
  }

  function now(): string {
    return new Date(clock()).toISOString();
  }

  function openEventStream(request: IncomingMessage, response: ServerResponse): void {
    const rawLast = request.headers['last-event-id'];
    const after = rawLast === undefined || rawLast === '' ? 0 : Number(rawLast);
    if (!Number.isInteger(after) || after < 0) {
      sendJson(response, 400, { error: 'invalid_last_event_id' });
      return;
    }
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.write(': connected\n\n');
    let cursor = after;
    const latest = options.store.getLatestChangeSequence();
    if (cursor > latest) {
      writeSse(response, 'gap', undefined, {
        reason: 'cursor_ahead',
        refetch: '/api/v1/command-center',
        latest,
      });
      cursor = latest;
    } else {
      cursor = flushChanges(response, cursor);
    }
    const timer = setInterval(() => {
      if (!response.destroyed) cursor = flushChanges(response, cursor);
    }, ssePollMs);
    const client = { response, timer };
    sseClients.add(client);
    request.once('close', () => {
      clearInterval(timer);
      sseClients.delete(client);
    });
  }

  function flushChanges(response: ServerResponse, after: number): number {
    const changes = options.store.listChangeLog({ afterSequence: after, limit: 1_000 });
    if (changes.length && changes[0].sequence > after + 1) {
      writeSse(response, 'gap', undefined, {
        reason: 'retention_gap',
        refetch: '/api/v1/command-center',
        firstAvailable: changes[0].sequence,
      });
    }
    for (const change of changes) writeSse(response, 'change', change.sequence, change);
    return changes.at(-1)?.sequence ?? after;
  }

  return {
    listen: (port, requestedHost = host) => new Promise((resolveListen, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(port, requestedHost, () => {
        httpServer.off('error', reject);
        const address = httpServer.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Jericho server did not bind a TCP address'));
          return;
        }
        resolveListen({ address: address.address, port: address.port });
      });
    }),
    close: async () => {
      for (const client of sseClients) {
        clearInterval(client.timer);
        client.response.end();
      }
      sseClients.clear();
      await voice.close();
      if (!httpServer.listening) return;
      await new Promise<void>((resolveClose, reject) => {
        httpServer.close((error) => error ? reject(error) : resolveClose());
        httpServer.closeIdleConnections();
        httpServer.closeAllConnections();
      });
    },
  };
}

function attachVoice(
  server: ReturnType<typeof createServer>,
  options: JerichoServerOptions,
  tools: ToolExecutor,
  host: string,
  allowedOrigins: Set<string>,
  browserSessionToken: string,
) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const hostHeader = request.headers.host;
    if (!hostHeader || !hostAllowed(hostHeader, host)) {
      socket.end('HTTP/1.1 421 Misdirected Request\r\n\r\n');
      return;
    }
    const url = new URL(request.url ?? '/', `http://${hostHeader}`);
    if (url.pathname !== '/ws/audio' && url.pathname !== '/ws') {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    const origin = request.headers.origin;
    const trustedBrowserOrigin = Boolean(
      origin && (
        origin === `http://${hostHeader}` ||
        origin === `https://${hostHeader}` ||
        allowedOrigins.has(origin)
      ),
    );
    if (origin && !trustedBrowserOrigin) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const tokenAuthorized = authorized(
      `Bearer ${url.searchParams.get('token') ?? ''}`,
      options.apiToken,
    ) || authorizedSession(request.headers.cookie, browserSessionToken);
    if (!tokenAuthorized) {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return;
    }
    if (!options.geminiApiKey) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, (webSocket) => wss.emit('connection', webSocket));
  });
  wss.on('connection', (webSocket: WebSocket) => {
    openVoiceSession(webSocket, options, tools);
  });
  return {
    close: () => new Promise<void>((resolveClose) => {
      for (const client of wss.clients) client.terminate();
      wss.close(() => resolveClose());
    }),
  };
}

function openVoiceSession(webSocket: WebSocket, options: JerichoServerOptions, tools: ToolExecutor): void {
  const ai = options.voiceConnect
    ? undefined
    : new GoogleGenAI({ apiKey: options.geminiApiKey! });
  const voiceConnect: VoiceConnect = options.voiceConnect ?? (async (request) =>
    ai!.live.connect(request as never) as unknown as Promise<Session>);
  const activeTurnMs = options.voiceActiveTurnMs ?? 30_000;
  let session: VoiceSessionPort | undefined;
  let currentVoice = options.geminiVoice ?? 'Algieba';
  let generation = 0;
  let clientClosed = false;
  let active = false;
  let activeTimer: ReturnType<typeof setTimeout> | undefined;
  let transcriptTimer: ReturnType<typeof setTimeout> | undefined;
  let captureTurn: { id: string; transcript: string } | undefined;

  const send = (message: Record<string, unknown>) => {
    if (webSocket.readyState === WebSocket.OPEN) webSocket.send(JSON.stringify(message));
  };
  const deactivate = (turnComplete = false) => {
    active = false;
    if (activeTimer) clearTimeout(activeTimer);
    activeTimer = undefined;
    if (captureTurn) {
      if (transcriptTimer) clearTimeout(transcriptTimer);
      // Input transcription is explicitly unordered with model completion.
      transcriptTimer = setTimeout(() => { captureTurn = undefined; }, 5_000);
    }
    if (turnComplete) send({ type: 'turn_complete' });
    send({ type: 'armed', armed: false });
  };
  const activate = () => {
    active = true;
    if (transcriptTimer) clearTimeout(transcriptTimer);
    transcriptTimer = undefined;
    captureTurn = { id: randomUUID(), transcript: '' };
    if (activeTimer) clearTimeout(activeTimer);
    send({ type: 'armed', armed: true });
    activeTimer = setTimeout(() => deactivate(), activeTurnMs);
  };
  const captureInputTranscription = (value: unknown) => {
    if (!captureTurn || !isRecord(value)) return;
    if (typeof value.text === 'string') {
      const combined = `${captureTurn.transcript}${value.text}`;
      if (combined.length > 64 * 1024) {
        captureTurn = undefined;
        if (transcriptTimer) clearTimeout(transcriptTimer);
        transcriptTimer = undefined;
        send({ type: 'error', message: 'spoken capture exceeded the local limit' });
        return;
      }
      captureTurn.transcript = combined;
    }
    if (value.finished !== true) return;
    const turn = captureTurn;
    captureTurn = undefined;
    if (transcriptTimer) clearTimeout(transcriptTimer);
    transcriptTimer = undefined;
    const transcript = turn.transcript.replace(/\s+/gu, ' ').trim();
    if (!transcript) return;
    const occurredAt = new Date(options.clock?.() ?? new Date().toISOString()).toISOString();
    try {
      const result = options.store.commitLocalCapture(localCaptureEvent({
        kind: 'spoken',
        sourceEventId: `live-turn:${turn.id}`,
        occurredAt,
        payload: { transcript },
      }));
      options.intake?.processEvent(result.event.id);
    } catch {
      // Never echo or log transcript contents on a failed private capture.
      send({ type: 'error', message: 'spoken capture unavailable' });
    }
  };
  const connect = (voice: string) => {
    const connectionGeneration = ++generation;
    if (active) deactivate();
    session?.close();
    session = undefined;
    currentVoice = voice;
    send({ type: 'voice_switching', voice });
    void voiceConnect({
      model: options.geminiModel ?? 'gemini-2.5-flash-native-audio-latest',
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        systemInstruction: options.systemInstruction,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        tools: [{ functionDeclarations: FUNCTION_DECLARATIONS as never }],
      },
      callbacks: {
        onopen: () => {
          if (connectionGeneration === generation) send({ type: 'ready', voice });
        },
        onmessage: (message: any) => {
          if (connectionGeneration !== generation) return;
          captureInputTranscription(message.serverContent?.inputTranscription);
          if (!active) return;
          if (message.serverContent?.interrupted) send({ type: 'interrupt' });
          for (const part of message.serverContent?.modelTurn?.parts ?? []) {
            if (part.inlineData?.data) {
              send({
                type: 'audio',
                mimeType: part.inlineData.mimeType ?? 'audio/pcm;rate=24000',
                data: part.inlineData.data,
              });
            }
            if (part.text) send({ type: 'text', text: part.text });
          }
          const calls = message.toolCall?.functionCalls ?? [];
          const activeSession = session;
          if (calls.length && activeSession) {
            void Promise.all(calls.map(async (call: any) => {
              const args = call.args ?? {};
              send({ type: 'tool_start', name: call.name, args });
              const result = await tools.execute(call.name, args);
              send({ type: 'tool_result', name: call.name, result });
              return { id: call.id, name: call.name, response: result };
            })).then((responses) => {
              if (session === activeSession) {
                activeSession.sendToolResponse({ functionResponses: responses as never });
              }
            }).catch(() => send({ type: 'error', message: 'tool execution failed' }));
          }
          if (message.serverContent?.turnComplete) deactivate(true);
        },
        onerror: () => {
          if (connectionGeneration === generation) send({ type: 'error', message: 'voice unavailable' });
        },
        onclose: () => {
          if (!clientClosed && connectionGeneration === generation) {
            if (active) deactivate();
            send({ type: 'closed' });
          }
        },
      },
    }).then((connected) => {
      if (clientClosed || connectionGeneration !== generation) {
        connected.close();
        return;
      }
      session = connected;
    }).catch(() => {
      if (connectionGeneration === generation) send({ type: 'error', message: 'voice unavailable' });
    });
  };

  send({ type: 'voices', voices: [...VOICES], active: currentVoice });
  send({ type: 'armed', armed: false });
  connect(currentVoice);
  webSocket.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (message.type === 'audio' && typeof message.data === 'string') {
        if (active) {
          session?.sendRealtimeInput({
            media: { data: message.data, mimeType: 'audio/pcm;rate=16000' },
          });
        }
      }
      if (
        message.type === 'set_voice' &&
        typeof message.voice === 'string' &&
        (VOICES as readonly string[]).includes(message.voice) &&
        message.voice !== currentVoice
      ) {
        connect(message.voice);
      }
      if (message.type === 'wake') {
        activate();
      }
      if (message.type === 'standby') {
        deactivate();
      }
    } catch { /* invalid client frame */ }
  });
  webSocket.on('close', () => {
    clientClosed = true;
    generation += 1;
    if (activeTimer) clearTimeout(activeTimer);
    if (transcriptTimer) clearTimeout(transcriptTimer);
    captureTurn = undefined;
    session?.close();
  });
}

async function serveFrontend(
  request: IncomingMessage,
  response: ServerResponse,
  frontendDir: string | undefined,
  pathname: string,
  browserSessionToken: string,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }
  if (!frontendDir || !existsSync(frontendDir)) {
    sendJson(response, 404, { error: 'not_found' });
    return;
  }
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch {
    sendJson(response, 400, { error: 'invalid_path' });
    return;
  }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) {
    sendJson(response, 400, { error: 'invalid_path' });
    return;
  }
  const root = realpathSync(frontendDir);
  const candidate = resolve(root, `.${decoded}`);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    sendJson(response, 400, { error: 'invalid_path' });
    return;
  }
  let file = candidate;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (extname(decoded)) {
      sendJson(response, 404, { error: 'not_found' });
      return;
    }
    file = join(root, 'index.html');
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    sendJson(response, 404, { error: 'not_found' });
    return;
  }
  try {
    file = realpathSync(file);
  } catch {
    sendJson(response, 404, { error: 'not_found' });
    return;
  }
  if (file !== root && !file.startsWith(`${root}${sep}`)) {
    sendJson(response, 400, { error: 'invalid_path' });
    return;
  }
  const indexPath = join(root, 'index.html');
  if (existsSync(indexPath) && file === realpathSync(indexPath)) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Set-Cookie',
      `jericho_session=${browserSessionToken}; Path=/; HttpOnly; SameSite=Strict`,
    );
  }
  response.statusCode = 200;
  response.setHeader('Content-Type', contentType(file));
  if (request.method === 'HEAD') { response.end(); return; }
  await new Promise<void>((resolveStream, reject) => {
    const stream = createReadStream(file);
    stream.on('error', reject);
    stream.on('end', resolveStream);
    stream.pipe(response);
  });
}

function applySecurityHeaders(response: ServerResponse): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  applySecurityHeaders(response);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function writeSse(response: ServerResponse, event: string, id: number | undefined, data: unknown): void {
  if (id !== undefined) response.write(`id: ${id}\n`);
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function hostAllowed(hostHeader: string, configuredHost: string): boolean {
  const hostname = hostHeader.startsWith('[')
    ? hostHeader.slice(1, hostHeader.indexOf(']'))
    : hostHeader.split(':')[0];
  return hostname === configuredHost || hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
}

function authorized(header: string | undefined, token: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function authorizedSession(cookieHeader: string | undefined, token: string): boolean {
  if (!cookieHeader) return false;
  const value = cookieHeader.split(';').map((item) => item.trim()).find((item) =>
    item.startsWith('jericho_session='),
  )?.slice('jericho_session='.length);
  if (!value) return false;
  const supplied = Buffer.from(value);
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  const contentLength = request.headers['content-length'];
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new HttpError(413, 'request_body_too_large');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new HttpError(413, 'request_body_too_large');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, 'invalid_json_body');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'invalid_json_body');
  }
  return parsed as Record<string, unknown>;
}

function boundedInteger(raw: string | null, fallback: number, minimum: number, maximum: number): number {
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new HttpError(400, 'invalid_numeric_bound');
  }
  return value;
}

function decodedPathSegment(raw: string, errorCode: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, errorCode);
  }
  if (!decoded || decoded.length > 512) throw new HttpError(400, errorCode);
  return decoded;
}

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = 'HttpError';
  }
}

function httpFailure(error: unknown): { status: number; code: string } {
  if (error instanceof HttpError) return error;
  if (error instanceof EventConflictError) return { status: 409, code: 'event_conflict' };
  if (error instanceof MissionDecisionConflictError) {
    return { status: 409, code: 'mission_decision_conflict' };
  }
  if (error instanceof TypeError) return { status: 400, code: 'invalid_request' };
  return { status: 500, code: 'internal_error' };
}

function findConnectorDescriptor(
  descriptors: readonly unknown[] | undefined,
  connectorId: string,
): { id: string; partitions: string[] } | undefined {
  for (const descriptor of descriptors ?? []) {
    if (!isRecord(descriptor) || descriptor.id !== connectorId || !Array.isArray(descriptor.partitions)) {
      continue;
    }
    return {
      id: connectorId,
      partitions: descriptor.partitions.filter(
        (partition): partition is string => typeof partition === 'string',
      ),
    };
  }
  return undefined;
}

function missionDecisionRequest(body: Record<string, unknown>): MissionDecisionRequest {
  const allowedFields = new Set(['outcome', 'planHash', 'version', 'reason']);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw new HttpError(400, 'mission_decision_field_not_allowed');
  }
  if (
    body.outcome !== DecisionOutcome.Approved &&
    body.outcome !== DecisionOutcome.Rejected
  ) {
    throw new HttpError(400, 'invalid_mission_decision_outcome');
  }
  if (typeof body.planHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.planHash)) {
    throw new HttpError(400, 'invalid_mission_plan_hash');
  }
  if (!Number.isInteger(body.version) || (body.version as number) < 1) {
    throw new HttpError(400, 'invalid_mission_plan_version');
  }
  if (
    body.reason !== undefined &&
    (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 2_000)
  ) {
    throw new HttpError(400, 'invalid_mission_decision_reason');
  }
  return {
    outcome: body.outcome,
    planHash: body.planHash,
    version: body.version as number,
    ...(typeof body.reason === 'string' ? { reason: body.reason.trim() } : {}),
  };
}

function missionCancellationRequest(body: Record<string, unknown>): {
  planHash: string;
  version: number;
  reason: string;
} {
  const allowedFields = new Set(['planHash', 'version', 'reason']);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw new HttpError(400, 'mission_cancellation_field_not_allowed');
  }
  if (typeof body.planHash !== 'string' || !/^[a-f0-9]{64}$/u.test(body.planHash)) {
    throw new HttpError(400, 'invalid_mission_plan_hash');
  }
  if (!Number.isInteger(body.version) || (body.version as number) < 1) {
    throw new HttpError(400, 'invalid_mission_plan_version');
  }
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 2_000) {
    throw new HttpError(400, 'invalid_mission_cancellation_reason');
  }
  return {
    planHash: body.planHash,
    version: body.version as number,
    reason: body.reason.trim(),
  };
}

function relationshipProposalRequest(body: Record<string, unknown>): {
  fromNodeId: string;
  toNodeId: string;
  relation: RelationType;
} {
  const allowedFields = new Set(['fromNodeId', 'toNodeId', 'relation']);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw new HttpError(400, 'relationship_field_not_allowed');
  }
  for (const field of ['fromNodeId', 'toNodeId'] as const) {
    if (typeof body[field] !== 'string' || !body[field].trim() || body[field].length > 512) {
      throw new HttpError(400, `invalid_${field}`);
    }
  }
  if (body.fromNodeId === body.toNodeId) throw new HttpError(400, 'relationship_self_reference');
  if (!Object.values(RelationType).includes(body.relation as RelationType)) {
    throw new HttpError(400, 'invalid_relationship_type');
  }
  return {
    fromNodeId: (body.fromNodeId as string).trim(),
    toNodeId: (body.toNodeId as string).trim(),
    relation: body.relation as RelationType,
  };
}

function localCaptureEvent(body: Record<string, unknown>): EventEnvelope {
  const allowedFields = new Set(['kind', 'sourceEventId', 'occurredAt', 'payload']);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw new HttpError(400, 'capture_field_not_allowed');
  }
  const kind = body.kind;
  if (kind !== 'spoken' && kind !== 'manual' && kind !== 'file') {
    throw new HttpError(400, 'invalid_capture_kind');
  }
  if (
    typeof body.sourceEventId !== 'string' ||
    !body.sourceEventId.trim() ||
    body.sourceEventId.length > 512
  ) {
    throw new HttpError(400, 'invalid_source_event_id');
  }
  if (typeof body.occurredAt !== 'string' || !Number.isFinite(Date.parse(body.occurredAt))) {
    throw new HttpError(400, 'invalid_occurred_at');
  }
  if (!Object.hasOwn(body, 'payload') || body.payload === undefined) {
    throw new HttpError(400, 'capture_payload_required');
  }
  const occurredAt = new Date(body.occurredAt).toISOString();
  const source = `local:${kind}`;
  const sourceEventId = body.sourceEventId.trim();
  const digest = createHash('sha256')
    .update(`${source}\0${sourceEventId}`)
    .digest('hex')
    .slice(0, 32);
  const sourceType = kind === 'file' ? SourceType.Import : SourceType.User;
  return {
    id: `${source}-${digest}`,
    source,
    sourceType,
    sourceEventId,
    type: `local.capture.${kind}`,
    occurredAt,
    // Source time is deliberate so an HTTP retry builds the same immutable event.
    ingestedAt: occurredAt,
    payload: structuredClone(body.payload) as JsonValue,
    provenance: [{
      source,
      sourceType,
      sourceEventId,
      observedAt: occurredAt,
    }],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function contentType(path: string): string {
  switch (extname(path).toLocaleLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new JerichoStore();
  const intake = new IntakeProcessor({ store });
  intake.recover();
  const connectors = createConnectorRuntime(config, store, { intake });
  const server = createJerichoServer({
    store,
    apiToken: config.apiToken,
    host: config.host,
    allowedOrigins: config.allowedOrigins,
    geminiApiKey: config.geminiApiKey,
    geminiModel: config.model,
    geminiVoice: config.voice,
    systemInstruction: config.systemInstruction,
    voiceActiveTurnMs: config.voiceActiveTurnMs,
    frontendDir: resolve(fileURLToPath(new URL('../../frontend/dist', import.meta.url))),
    supervisor: connectors.supervisor,
    connectorDescriptors: connectors.descriptors,
    obsidianSearch: connectors.obsidianSearch,
    intake,
  });
  const address = await server.listen(config.port, config.host);
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await connectors.stop();
    await server.close();
    store.close();
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
  await connectors.start();
  if (shuttingDown) return;
  console.log(`[jericho] listening on http://${config.host}:${address.port}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
