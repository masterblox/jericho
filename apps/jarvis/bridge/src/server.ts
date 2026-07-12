import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { GoogleGenAI, Modality, type Session } from '@google/genai';
import { WebSocket, WebSocketServer } from 'ws';

import {
  DecisionOutcome,
  IdentityReviewDisposition,
  IntentRoute,
  KnowledgeDestination,
  LifecycleStatus,
  ProposalKind,
  RelationType,
  RetrievalCollection,
  ReviewIntentDisposition,
  RiskLevel,
  SourceType,
  RouteType,
  type DecisionRecord,
  type CheckpointDecisionRequest,
  type EventEnvelope,
  type IntentEnvelope,
  type IdentityReviewDecisionRequest,
  type IdentityReviewDecisionResponse,
  type JsonValue,
  type MissionDecisionRequest,
  type MissionDecisionResponse,
  type MissionPlan,
  type Proposal,
  type ProposalDecisionRequest,
  type ProposalDecisionResponse,
  type ReviewIntentDecisionRequest,
  type ReviewIntentDecisionResponse,
  type IndexVersion,
} from '@jericho/shared';

import { buildCommandCenterSnapshot } from './command-center.js';
import { loadConfig } from './config.js';
import { PaperclipFleetClient, type FleetPort } from './fleet/paperclip-client.js';
import { createFleetLaneRegistry } from './fleet/lane-registry.js';
import {
  EventConflictError,
  CheckpointDecisionConflictError,
  IdentityReviewDecisionConflictError,
  JerichoStore,
  MissionDecisionConflictError,
  ProposalDecisionConflictError,
  ReviewIntentDecisionConflictError,
} from './core/store.js';
import {
  IntakeProcessor,
  type IntakeProcessingResult,
  type IntakeRecoveryResult,
  type MissionQueueResult,
} from './orchestration/intake.js';
import { KnowledgeRuntime } from './retention/knowledge-runtime.js';
import type { FleetKnowledgeService } from './knowledge/fleet-knowledge.js';
import { FederatedRetrievalService } from './retrieval/federated-retrieval.js';
import { HttpPaperclipPort, PaperclipExecutor } from './connectors/paperclip-executor.js';
import { ObsidianNoteOpener } from './connectors/obsidian-open.js';
import { createPersonas, isPersonaMode, type PersonaMode } from './personas.js';
import {
  ProductionRuntimeLifecycle,
  createConnectorRuntime,
  createMissionExecutionRuntime,
} from './runtime.js';
import {
  createToolExecutor,
  executeVaultSearch,
  FUNCTION_DECLARATIONS,
  type ToolExecutor,
  type VaultToolSearchPort,
} from './tools.js';

export interface SyncPort {
  sync(connectorId: string, partition: string, signal: AbortSignal): Promise<unknown>;
}

export interface ObsidianSearchPort {
  search(query: string, limit: number): Promise<unknown>;
}

export interface IntakePort {
  processEvent(eventId: string): IntakeProcessingResult;
  prepareReviewedProject(intent: IntentEnvelope): MissionPlan;
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
  sendClientContent(input: unknown): void;
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
  megatronVoice?: string;
  defaultPersonaMode?: PersonaMode;
  personaAutoRevertMs?: number;
  systemInstruction?: string;
  frontendDir?: string;
  supervisor?: SyncPort;
  connectorDescriptors?: readonly unknown[];
  obsidianSearch?: ObsidianSearchPort;
  vaultSearch?: VaultToolSearchPort;
  fleet?: FleetPort;
  intake?: IntakePort;
  retention?: MissionRetentionPort;
  reflection?: ReflectionReviewPort;
  knowledge?: FleetKnowledgeService;
  retrieval?: FederatedRetrievalService;
  paperclip?: PaperclipExecutor;
  obsidianOpen?: { open(relativePath: string): Promise<{ relativePath: string }> };
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
  bootstrapUrl: string;
}

export interface JerichoServer {
  listen(port: number, host?: string): Promise<JerichoServerAddress>;
  close(): Promise<void>;
}

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; media-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
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
  if (
    options.personaAutoRevertMs !== undefined &&
    (!Number.isFinite(options.personaAutoRevertMs) || options.personaAutoRevertMs <= 0)
  ) throw new Error('Persona auto-revert duration must be positive');
  const host = options.host ?? '127.0.0.1';
  requireLoopbackBind(host);
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  const ssePollMs = options.ssePollMs ?? 250;
  const clock = options.clock ?? (() => new Date().toISOString());
  const decisionIdFactory = options.decisionIdFactory ?? randomUUID;
  const browserSessionToken = randomBytes(32).toString('base64url');
  const browserBootstrapToken = randomBytes(32).toString('base64url');
  let browserBootstrapAvailable = true;
  const sseClients = new Set<{ response: ServerResponse; timer: ReturnType<typeof setInterval> }>();
  const tools = options.toolExecutor ?? createToolExecutor({
    store: options.store,
    ...(options.vaultSearch ? { vaultSearch: options.vaultSearch } : {}),
  });
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
    if (url.pathname.startsWith('/.jericho/bootstrap/')) {
      response.setHeader('Cache-Control', 'no-store');
      if (request.method !== 'GET') {
        sendJson(response, 405, { error: 'method_not_allowed' });
        return;
      }
      const supplied = url.pathname.slice('/.jericho/bootstrap/'.length);
      if (!secretsEqual(supplied, browserBootstrapToken)) {
        sendJson(response, 404, { error: 'not_found' });
        return;
      }
      if (!browserBootstrapAvailable) {
        sendJson(response, 410, { error: 'bootstrap_consumed' });
        return;
      }
      browserBootstrapAvailable = false;
      response.setHeader(
        'Set-Cookie',
        `jericho_session=${browserSessionToken}; Path=/; HttpOnly; SameSite=Strict`,
      );
      response.setHeader('Location', '/');
      response.statusCode = 303;
      response.end();
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/session') {
      response.setHeader('Cache-Control', 'no-store');
      if (!authorized(request.headers.authorization, options.apiToken)) {
        response.setHeader('WWW-Authenticate', 'Bearer realm="jericho-local"');
        sendJson(response, 401, { error: 'unauthorized' });
        return;
      }
      response.setHeader(
        'Set-Cookie',
        `jericho_session=${browserSessionToken}; Path=/; HttpOnly; SameSite=Strict`,
      );
      response.statusCode = 204;
      response.end();
      return;
    }
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
    if (request.method === 'GET' && url.pathname === '/api/v1/knowledge/packages') {
      if (!options.knowledge) throw new HttpError(503, 'knowledge_unavailable');
      sendJson(response, 200, { packages: options.knowledge.listPackages() });
      return;
    }
    const knowledgeMissionMatch = url.pathname.match(/^\/api\/v1\/missions\/([^/]+)\/knowledge-package$/);
    if (request.method === 'POST' && knowledgeMissionMatch) {
      if (!options.knowledge) throw new HttpError(503, 'knowledge_unavailable');
      const missionId = decodedPathSegment(knowledgeMissionMatch[1], 'invalid_mission_id');
      try {
        sendJson(response, 201, { package: options.knowledge.createPackage(missionId) });
      } catch (error) {
        if (/not verified|requires verified|unverified/u.test(String(error))) throw new HttpError(409, 'knowledge_not_ready');
        throw error;
      }
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/knowledge/projections') {
      if (!options.knowledge) throw new HttpError(503, 'knowledge_unavailable');
      sendJson(response, 200, {
        projections: options.knowledge.listProjections(),
        receipts: options.knowledge.listProjectionReceipts(),
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/knowledge/projections') {
      if (!options.knowledge) throw new HttpError(503, 'knowledge_unavailable');
      const body = await readJsonBody(request, 64 * 1024);
      const input = recordBody(body);
      const packageId = requiredBodyString(input.packageId, 'invalid_package_id');
      const approvedFields = stringList(input.approvedFieldNames, 'invalid_projection_fields');
      const redactedFields = input.redactedFieldNames === undefined
        ? [] : stringList(input.redactedFieldNames, 'invalid_projection_redactions');
      sendJson(response, 201, { projection: options.knowledge.createProjection(
        packageId, KnowledgeDestination.Notion, approvedFields, redactedFields,
      ) });
      return;
    }
    const projectionApprovalMatch = url.pathname.match(/^\/api\/v1\/knowledge\/projections\/([^/]+)\/approve$/);
    if (request.method === 'POST' && projectionApprovalMatch) {
      if (!options.knowledge) throw new HttpError(503, 'knowledge_unavailable');
      sendJson(response, 200, { projection: options.knowledge.approveProjection(
        decodedPathSegment(projectionApprovalMatch[1], 'invalid_projection_id'),
      ) });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/retrieval/indexes') {
      if (!options.knowledge) throw new HttpError(503, 'knowledge_unavailable');
      sendJson(response, 200, { indexes: options.knowledge.listIndexes(), evaluations: options.knowledge.listEvaluations() });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/paperclip/reconciliation') {
      if (!options.knowledge) throw new HttpError(503, 'knowledge_unavailable');
      sendJson(response, 200, { reconciliations: options.knowledge.listPaperclip() });
      return;
    }
    const paperclipReconcileMatch = url.pathname.match(/^\/api\/v1\/paperclip\/assignments\/([^/]+)\/reconcile$/);
    if (request.method === 'POST' && paperclipReconcileMatch) {
      if (!options.paperclip || !options.knowledge) throw new HttpError(503, 'paperclip_unavailable');
      const assignmentId = decodedPathSegment(paperclipReconcileMatch[1], 'invalid_assignment_id');
      const assignment = options.store.getAssignment(assignmentId);
      const task = assignment ? options.store.getMissionTask(assignment.missionTaskId) : undefined;
      const mission = assignment ? options.store.getMission(assignment.missionId) : undefined;
      if (!assignment || !task || !mission) throw new HttpError(404, 'assignment_not_found');
      const reconciliation = await options.paperclip.reconcile(mission, task, assignment, requestSignal(request));
      options.knowledge.recordPaperclip(reconciliation);
      sendJson(response, 200, { reconciliation });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/retrieval/search') {
      if (!options.retrieval) throw new HttpError(503, 'retrieval_unavailable');
      const query = url.searchParams.get('q') ?? '';
      const requested = (url.searchParams.get('collections') ?? Object.values(RetrievalCollection).join(','))
        .split(',').filter(Boolean);
      if (!requested.every((item) => Object.values(RetrievalCollection).includes(item as RetrievalCollection))) {
        throw new HttpError(400, 'invalid_retrieval_collection');
      }
      const limit = boundedInteger(url.searchParams.get('limit'), 10, 1, 50);
      sendJson(response, 200, { results: await options.retrieval.search(
        query, requested as RetrievalCollection[], limit,
      ) });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/retrieval/indexes') {
      if (!options.knowledge) throw new HttpError(503, 'knowledge_unavailable');
      const input = recordBody(await readJsonBody(request, 128 * 1024));
      sendJson(response, 201, { index: options.knowledge.recordIndex(input as unknown as IndexVersion) });
      return;
    }
    const evaluationMatch = url.pathname.match(/^\/api\/v1\/retrieval\/indexes\/([^/]+)\/evaluate$/);
    if (request.method === 'POST' && evaluationMatch) {
      if (!options.knowledge) throw new HttpError(503, 'knowledge_unavailable');
      const input = recordBody(await readJsonBody(request, 16 * 1024));
      sendJson(response, 201, options.knowledge.evaluateAndPromote(
        decodedPathSegment(evaluationMatch[1], 'invalid_index_id'),
        requiredBodyString(input.benchmarkVersion, 'invalid_benchmark_version'),
      ));
      return;
    }
    const promotionMatch = url.pathname.match(/^\/api\/v1\/retrieval\/indexes\/([^/]+)\/promote$/);
    if (request.method === 'POST' && promotionMatch) {
      if (!options.knowledge) throw new HttpError(503, 'knowledge_unavailable');
      sendJson(response, 200, { index: options.knowledge.promoteCandidate(
        decodedPathSegment(promotionMatch[1], 'invalid_index_id'),
      ) });
      return;
    }
    const rollbackMatch = url.pathname.match(/^\/api\/v1\/retrieval\/indexes\/([^/]+)\/rollback$/);
    if (request.method === 'POST' && rollbackMatch) {
      if (!options.knowledge) throw new HttpError(503, 'knowledge_unavailable');
      sendJson(response, 200, { index: options.knowledge.rollbackIndex(
        decodedPathSegment(rollbackMatch[1], 'invalid_index_id'),
      ) });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/identity-reviews') {
      sendJson(response, 200, { reviews: options.store.listIdentityReviews() });
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
      if (
        !from.verified || !to.verified ||
        from.recordType !== 'entity' || to.recordType !== 'entity' ||
        !from.recordId || !to.recordId
      ) {
        throw new HttpError(409, 'relationship_requires_verified_entity_nodes');
      }
      const evidenceEventIds = [...new Set([
        ...from.evidenceEventIds,
        ...to.evidenceEventIds,
      ])];
      if (!evidenceEventIds.length) {
        throw new HttpError(409, 'relationship_requires_source_evidence');
      }
      const createdAt = now();
      const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 32);
      const proposal: Proposal = {
        id: `relationship-${digest}`,
        version: 1,
        proposedByAgentId: 'carlos',
        kind: ProposalKind.DataChange,
        summary: `Relate ${from.label} to ${to.label} as ${input.relation}`,
        body: {
          effect: 'create_relation',
          fromNodeId: input.fromNodeId,
          toNodeId: input.toNodeId,
          fromEntityId: from.recordId,
          toEntityId: to.recordId,
          relation: input.relation,
          evidenceEventIds,
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
    const identityReviewDecisionMatch = url.pathname.match(
      /^\/api\/v1\/identity-reviews\/([^/]+)\/decisions$/,
    );
    if (request.method === 'POST' && identityReviewDecisionMatch) {
      const failureId = decodedPathSegment(
        identityReviewDecisionMatch[1],
        'invalid_identity_review_id',
      );
      const review = options.store.listIdentityReviews()
        .find((candidate) => candidate.failureId === failureId);
      if (!review) throw new HttpError(404, 'identity_review_not_found');
      const input = identityReviewDecisionRequest(await readJsonBody(request, 64 * 1024));
      const decidedAt = now();
      const decisionId = validDecisionId(decisionIdFactory());
      const selectedEntityId = input.disposition === IdentityReviewDisposition.RelinkCandidate
        ? input.targetEntityId!
        : review.observedEntity.id;
      const resolved = options.store.resolveIdentityReview({
        failureId,
        reviewHash: input.reviewHash,
        reviewVersion: input.version,
        disposition: input.disposition,
        ...(input.targetEntityId ? { targetEntityId: input.targetEntityId } : {}),
        decision: {
          id: decisionId,
          identityReviewId: review.id,
          identityReviewFailureId: failureId,
          identityReviewHash: input.reviewHash,
          identityReviewVersion: input.version,
          identityDisposition: input.disposition,
          identitySelectedEntityId: selectedEntityId,
          decidedBy: 'carlos',
          outcome: DecisionOutcome.Approved,
          rationale: input.reason ?? (
            input.disposition === IdentityReviewDisposition.RelinkCandidate
              ? 'Explicitly relinked this provisional source identity to the selected candidate'
              : 'Explicitly kept and established the observed source identity'
          ),
          assumptions: [],
          evidenceEventIds: [...review.evidenceEventIds],
          route: RouteType.HumanApproval,
          risk: review.risk,
          decidedAt,
          provenance: [{
            source: 'local:command-center',
            sourceType: SourceType.User,
            sourceEventId: decisionId,
            observedAt: decidedAt,
          }],
        },
      });
      const snapshot = buildCommandCenterSnapshot(options.store, now());
      const result: IdentityReviewDecisionResponse = {
        ...resolved,
        snapshot,
      };
      sendJson(response, 200, result);
      return;
    }
    const proposalDecisionMatch = url.pathname.match(/^\/api\/v1\/proposals\/([^/]+)\/decisions$/);
    if (request.method === 'POST' && proposalDecisionMatch) {
      const proposalId = decodedPathSegment(proposalDecisionMatch[1], 'invalid_proposal_id');
      const proposal = options.store.getProposal(proposalId);
      if (!proposal) throw new HttpError(404, 'proposal_not_found');
      const input = proposalDecisionRequest(await readJsonBody(request, 64 * 1024));
      const decidedAt = now();
      const decisionId = validDecisionId(decisionIdFactory());
      const relationshipEffect = proposal.body.effect === 'create_relation';
      const resolved = options.store.resolveProposal({
        proposalId,
        proposalHash: input.proposalHash,
        proposalVersion: input.version,
        decision: {
          id: decisionId,
          proposalId,
          proposalHash: input.proposalHash,
          proposalVersion: input.version,
          decidedBy: 'carlos',
          outcome: input.outcome,
          rationale: input.reason ?? (input.outcome === DecisionOutcome.Approved
            ? relationshipEffect
              ? 'Approved the exact source-backed Nucleus relationship'
              : 'Reviewed and approved this draft; no external execution is authorized'
            : 'Reviewed and rejected this proposal'),
          assumptions: [],
          evidenceEventIds: proposalEvidenceEventIds(proposal),
          route: RouteType.HumanApproval,
          risk: proposal.risk,
          decidedAt,
          provenance: [{
            source: 'local:command-center',
            sourceType: SourceType.User,
            sourceEventId: decisionId,
            observedAt: decidedAt,
          }],
        },
      });
      const result: ProposalDecisionResponse = {
        ...resolved,
        snapshot: buildCommandCenterSnapshot(options.store, now()),
      };
      sendJson(response, 200, result);
      return;
    }
    const reviewDecisionMatch = url.pathname.match(/^\/api\/v1\/review-intents\/([^/]+)\/decisions$/);
    if (request.method === 'POST' && reviewDecisionMatch) {
      const intentId = decodedPathSegment(reviewDecisionMatch[1], 'invalid_review_intent_id');
      const intent = options.store.getIntent(intentId);
      if (!intent) throw new HttpError(404, 'review_intent_not_found');
      const input = reviewIntentDecisionRequest(await readJsonBody(request, 64 * 1024));
      const decidedAt = now();
      const decisionId = validDecisionId(decisionIdFactory());
      const reclassify = input.disposition === ReviewIntentDisposition.ReclassifyProject;
      if (reclassify && !options.intake) {
        throw new HttpError(503, 'review_project_planner_unavailable');
      }
      const provenance = {
        source: 'local:command-center',
        sourceType: SourceType.User,
        sourceEventId: decisionId,
        observedAt: decidedAt,
      } as const;
      const decision: DecisionRecord = {
        id: decisionId,
        intentId,
        intentHash: input.intentHash,
        decidedBy: 'carlos',
        outcome: reclassify ? DecisionOutcome.Superseded : DecisionOutcome.Rejected,
        rationale: input.reason ?? (reclassify
          ? 'Reclassified Review intent as a project requiring a new bounded mission approval'
          : 'Dismissed Review intent'),
        assumptions: intent.assumptions.map((assumption) => assumption.text),
        evidenceEventIds: [...new Set([
          ...intent.requiredEvidence.map((evidence) => evidence.eventId),
          ...intent.contradictoryEvidenceEventIds,
        ])],
        route: RouteType.HumanApproval,
        risk: intent.risk,
        confidence: intent.confidence,
        decidedAt,
        provenance: [provenance],
      };
      const { integrityHash: _originalIntegrityHash, ...derivedIntentBase } = intent;
      const derivedIntent = reclassify ? {
        ...derivedIntentBase,
        id: `reviewed-project-${createHash('sha256').update(`${intent.id}:${decisionId}`).digest('hex').slice(0, 32)}`,
        source: 'local:review',
        sourceType: SourceType.User,
        payload: {
          ...intent.payload,
          reviewedParentIntentId: intent.id,
          reviewDecisionId: decisionId,
        },
        status: LifecycleStatus.Active,
        route: IntentRoute.Project,
        routeRuleId: 'human-review:reclassify-project',
        provenance: [...intent.provenance, provenance],
        createdAt: decidedAt,
        updatedAt: decidedAt,
      } : undefined;
      const derivedMission = derivedIntent
        ? options.intake!.prepareReviewedProject(derivedIntent)
        : undefined;
      const resolved = options.store.resolveReviewIntent({
        intentId,
        intentHash: input.intentHash,
        decision,
        ...(derivedIntent ? { derivedIntent } : {}),
        ...(derivedMission ? { derivedMission } : {}),
      });
      const snapshot = buildCommandCenterSnapshot(options.store, now());
      const mission = resolved.mission
        ? snapshot.missions.find((candidate) => candidate.id === resolved.mission!.id)
        : undefined;
      if (resolved.mission && !mission) {
        throw new Error(`Reviewed mission ${resolved.mission.id} is not projectable`);
      }
      const result: ReviewIntentDecisionResponse = {
        decision: resolved.decision,
        originalIntent: resolved.originalIntent,
        ...(resolved.derivedIntent ? { derivedIntent: resolved.derivedIntent } : {}),
        ...(mission ? { mission } : {}),
        snapshot,
      };
      sendJson(response, 200, result);
      return;
    }
    const checkpointDecisionMatch = url.pathname.match(/^\/api\/v1\/checkpoints\/([^/]+)\/decisions$/);
    if (request.method === 'POST' && checkpointDecisionMatch) {
      const proposalId = decodedPathSegment(checkpointDecisionMatch[1], 'invalid_checkpoint_id');
      const proposal = options.store.getProposal(proposalId);
      if (!proposal) throw new HttpError(404, 'checkpoint_not_found');
      const input = checkpointDecisionRequest(await readJsonBody(request, 64 * 1024));
      const missionId = typeof proposal.body.missionId === 'string' ? proposal.body.missionId : '';
      const mission = options.store.getMission(missionId);
      if (!mission) throw new HttpError(409, 'checkpoint_context_missing');
      const decidedAt = now();
      const decisionId = validDecisionId(decisionIdFactory());
      const resolved = options.store.resolveCheckpoint({
        proposalId,
        planHash: input.planHash,
        planVersion: input.version,
        resume: input.outcome === DecisionOutcome.Approved,
        decision: {
          id: decisionId,
          proposalId,
          missionId,
          decidedBy: 'carlos',
          outcome: input.outcome,
          planHash: input.planHash,
          planVersion: input.version,
          rationale: input.reason ?? (input.outcome === DecisionOutcome.Approved
            ? 'Resume the exact approved plan without expanding scope'
            : 'Reject checkpoint; mission cancellation recorded'),
          assumptions: [],
          evidenceEventIds: [...mission.evidenceEventIds],
          route: RouteType.HumanApproval,
          risk: proposal.risk,
          decidedAt,
          provenance: [{
            source: 'local:command-center',
            sourceType: SourceType.User,
            sourceEventId: decisionId,
            observedAt: decidedAt,
          }],
        },
      });
      const snapshot = buildCommandCenterSnapshot(options.store, now());
      const projectedMission = snapshot.missions.find((candidate) => candidate.id === resolved.mission.id);
      if (!projectedMission) throw new Error(`Checkpoint mission ${resolved.mission.id} is not projectable`);
      sendJson(response, 200, {
        ...resolved,
        mission: projectedMission,
        snapshot,
      });
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
      const decisionId = validDecisionId(decisionIdFactory());
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
    if (request.method === 'GET' && url.pathname === '/api/v1/fleet') {
      if (!options.fleet) {
        sendJson(response, 503, { available: false, agents: [], issues: [] });
        return;
      }
      const snapshot = await options.fleet.snapshot();
      sendJson(response, snapshot.available ? 200 : 503, snapshot);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/obsidian/search') {
      if (!options.vaultSearch && !options.obsidianSearch) {
        sendJson(response, 503, {
          available: false, error: 'vault_search_unavailable', count: 0, results: [],
        });
        return;
      }
      const query = url.searchParams.get('q') ?? '';
      if (!query.trim()) throw new HttpError(400, 'invalid_search_query');
      const limit = boundedInteger(url.searchParams.get('limit'), 5, 1, 10);
      if (!options.vaultSearch && options.obsidianSearch) {
        const localResults = await options.obsidianSearch.search(query, limit) as Array<{ path: string; title: string; excerpt: string }>;
        sendJson(response, 200, {
          available: true, cached: false, count: localResults.length,
          results: localResults.map((result, index) => ({ ...result, score: Math.max(0.1, 1 - index * 0.08), provenance: 'obsidian-local' })),
        });
        return;
      }
      const result = await executeVaultSearch(options.vaultSearch, { query, limit });
      sendJson(response, result.available === true ? 200 : 503, result);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/obsidian/open') {
      if (!options.obsidianOpen) throw new HttpError(503, 'obsidian_open_unavailable');
      const input = recordBody(await readJsonBody(request, 8 * 1024));
      try {
        sendJson(response, 200, await options.obsidianOpen.open(
          requiredBodyString(input.relativePath, 'invalid_obsidian_note_path'),
        ));
      } catch (error) {
        if (/path|outside|regular file|resolution/iu.test(String(error))) throw new HttpError(400, 'invalid_obsidian_note_path');
        throw error;
      }
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
    listen: (port, requestedHost = host) => {
      try {
        requireLoopbackBind(requestedHost);
      } catch (error) {
        return Promise.reject(error);
      }
      return new Promise((resolveListen, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, requestedHost, () => {
          httpServer.off('error', reject);
          const address = httpServer.address();
          if (!address || typeof address === 'string') {
            reject(new Error('Jericho server did not bind a TCP address'));
            return;
          }
          const urlHost = address.address.includes(':')
            ? `[${address.address}]`
            : address.address;
          resolveListen({
            address: address.address,
            port: address.port,
            bootstrapUrl: `http://${urlHost}:${address.port}/.jericho/bootstrap/${browserBootstrapToken}`,
          });
        });
      });
    },
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
    const tokenAuthorized = authorized(request.headers.authorization, options.apiToken)
      || authorized(
        `Bearer ${url.searchParams.get('token') ?? ''}`,
        options.apiToken,
      )
      || authorizedSession(request.headers.cookie, browserSessionToken);
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
  const personaEnabled = options.defaultPersonaMode !== undefined || options.megatronVoice !== undefined;
  let currentMode: PersonaMode = options.defaultPersonaMode ?? 'jarvis';
  const personas = createPersonas({
    jarvisVoice: options.geminiVoice ?? 'Algieba',
    megatronVoice: options.megatronVoice ?? 'Fenrir',
    coreInstruction: options.systemInstruction ?? '',
  });
  let currentVoice = personas[currentMode].voice;
  let generation = 0;
  let clientClosed = false;
  let active = false;
  let activeTimer: ReturnType<typeof setTimeout> | undefined;
  let transcriptTimer: ReturnType<typeof setTimeout> | undefined;
  let personaRevertTimer: ReturnType<typeof setTimeout> | undefined;
  let greetingActive = false;
  let greetingPending = false;
  let captureTurn: { id: string; transcript: string } | undefined;

  const send = (message: Record<string, unknown>) => {
    if (webSocket.readyState === WebSocket.OPEN) webSocket.send(JSON.stringify(message));
  };
  const deactivate = (turnComplete = false) => {
    active = false;
    greetingActive = false;
    greetingPending = false;
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
    activeTimer = setTimeout(() => {
      if (greetingActive || greetingPending) send({ type: 'error', message: 'wake greeting unavailable' });
      deactivate();
    }, activeTurnMs);
  };
  const requestWakeGreeting = () => {
    if (!active || clientClosed) return;
    if (!session) {
      greetingPending = true;
      return;
    }
    greetingPending = false;
    greetingActive = true;
    send({ type: 'greeting_started' });
    session.sendClientContent({
      turns: [{
        role: 'user',
        parts: [{ text: 'Say exactly: “Hello, sir. What are we doing today?”' }],
      }],
      turnComplete: true,
    });
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
  const armPersonaRevert = () => {
    if (personaRevertTimer) clearTimeout(personaRevertTimer);
    personaRevertTimer = undefined;
    if (clientClosed || currentMode !== 'megatron') return;
    personaRevertTimer = setTimeout(() => {
      personaRevertTimer = undefined;
      if (clientClosed) return;
      currentMode = 'jarvis';
      connect(personas.jarvis.voice);
    }, options.personaAutoRevertMs ?? 120_000);
    // Presentation cleanup must never keep the private Core process alive.
    personaRevertTimer.unref();
  };
  const connect = (voice: string) => {
    if (personaRevertTimer) clearTimeout(personaRevertTimer);
    personaRevertTimer = undefined;
    if (clientClosed) return;
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
        systemInstruction: personaEnabled
          ? personas[currentMode].systemInstruction
          : options.systemInstruction,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        tools: [{ functionDeclarations: FUNCTION_DECLARATIONS as never }],
      },
      callbacks: {
        onopen: () => {
          if (connectionGeneration === generation) {
            send({ type: 'ready', voice });
            send({ type: 'mode_change', mode: currentMode, name: personas[currentMode].name });
            armPersonaRevert();
          }
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
          if (message.serverContent?.turnComplete) {
            if (greetingActive) {
              greetingActive = false;
              if (activeTimer) clearTimeout(activeTimer);
              activeTimer = setTimeout(() => deactivate(), activeTurnMs);
              send({ type: 'greeting_complete' });
              send({ type: 'armed', armed: true });
            } else {
              deactivate(true);
            }
          }
        },
        onerror: () => {
          if (connectionGeneration === generation) {
            send({ type: 'error', message: 'voice unavailable' });
            if (greetingActive || greetingPending) deactivate();
          }
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
      if (greetingPending && active) requestWakeGreeting();
    }).catch((cause: unknown) => {
      if (connectionGeneration === generation) {
        // Message only: the failure text must stay diagnosable without the key.
        console.error(
          '[jericho] voice connect failed:',
          cause instanceof Error ? cause.message : 'unknown error',
        );
        send({ type: 'error', message: 'voice unavailable' });
        if (greetingActive || greetingPending) deactivate();
      }
    });
  };

  send({ type: 'voices', voices: [...VOICES], active: currentVoice });
  send({ type: 'mode_change', mode: currentMode, name: personas[currentMode].name });
  send({ type: 'armed', armed: false });
  connect(currentVoice);
  webSocket.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (message.type === 'audio' && typeof message.data === 'string') {
        if (active && !greetingActive && !greetingPending) {
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
      if (message.type === 'set_mode' && isPersonaMode(message.mode) && message.mode !== currentMode) {
        currentMode = message.mode;
        connect(personas[currentMode].voice);
      }
      if (message.type === 'wake') {
        if (!active) {
          activate();
          requestWakeGreeting();
        }
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
    if (personaRevertTimer) clearTimeout(personaRevertTimer);
    captureTurn = undefined;
    session?.close();
  });
}

async function serveFrontend(
  request: IncomingMessage,
  response: ServerResponse,
  frontendDir: string | undefined,
  pathname: string,
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

function requireLoopbackBind(host: string): void {
  const normalized = host.startsWith('[') && host.endsWith(']')
    ? host.slice(1, -1)
    : host;
  const lower = normalized.toLowerCase();
  const ipv4 = isIP(normalized) === 4 ? normalized.split('.').map(Number) : undefined;
  if (
    lower === 'localhost' ||
    lower === '::1' ||
    (ipv4?.length === 4 && ipv4[0] === 127)
  ) return;
  throw new Error(`Jericho refuses non-loopback bind host ${host}`);
}

function authorized(header: string | undefined, token: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  return secretsEqual(header.slice(7), token);
}

function secretsEqual(value: string, expectedValue: string): boolean {
  const supplied = Buffer.from(value);
  const expected = Buffer.from(expectedValue);
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
  if (error instanceof ReviewIntentDecisionConflictError) {
    return { status: 409, code: 'review_intent_decision_conflict' };
  }
  if (error instanceof CheckpointDecisionConflictError) {
    return { status: 409, code: 'checkpoint_decision_conflict' };
  }
  if (error instanceof ProposalDecisionConflictError) {
    return { status: 409, code: 'proposal_decision_conflict' };
  }
  if (error instanceof IdentityReviewDecisionConflictError) {
    return { status: 409, code: 'identity_review_decision_conflict' };
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

function proposalDecisionRequest(body: Record<string, unknown>): ProposalDecisionRequest {
  const allowedFields = new Set(['outcome', 'proposalHash', 'version', 'reason']);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw new HttpError(400, 'proposal_decision_field_not_allowed');
  }
  if (body.outcome !== DecisionOutcome.Approved && body.outcome !== DecisionOutcome.Rejected) {
    throw new HttpError(400, 'invalid_proposal_decision_outcome');
  }
  if (typeof body.proposalHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.proposalHash)) {
    throw new HttpError(400, 'invalid_proposal_hash');
  }
  if (!Number.isInteger(body.version) || (body.version as number) < 1) {
    throw new HttpError(400, 'invalid_proposal_version');
  }
  const reason = optionalDecisionReason(body.reason, 'invalid_proposal_decision_reason');
  return {
    outcome: body.outcome,
    proposalHash: body.proposalHash,
    version: body.version as number,
    ...(reason ? { reason } : {}),
  };
}

function reviewIntentDecisionRequest(body: Record<string, unknown>): ReviewIntentDecisionRequest {
  const allowedFields = new Set(['disposition', 'intentHash', 'reason']);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw new HttpError(400, 'review_intent_decision_field_not_allowed');
  }
  if (
    body.disposition !== ReviewIntentDisposition.Dismiss &&
    body.disposition !== ReviewIntentDisposition.ReclassifyProject
  ) {
    throw new HttpError(400, 'invalid_review_intent_disposition');
  }
  if (typeof body.intentHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.intentHash)) {
    throw new HttpError(400, 'invalid_review_intent_hash');
  }
  const reason = optionalDecisionReason(body.reason, 'invalid_review_intent_reason');
  return {
    disposition: body.disposition,
    intentHash: body.intentHash,
    ...(reason ? { reason } : {}),
  };
}

function identityReviewDecisionRequest(body: Record<string, unknown>): IdentityReviewDecisionRequest {
  const allowedFields = new Set([
    'disposition',
    'reviewHash',
    'version',
    'targetEntityId',
    'reason',
  ]);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw new HttpError(400, 'identity_review_decision_field_not_allowed');
  }
  if (
    body.disposition !== IdentityReviewDisposition.EstablishObserved &&
    body.disposition !== IdentityReviewDisposition.RelinkCandidate
  ) {
    throw new HttpError(400, 'invalid_identity_review_disposition');
  }
  if (typeof body.reviewHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.reviewHash)) {
    throw new HttpError(400, 'invalid_identity_review_hash');
  }
  if (!Number.isInteger(body.version) || (body.version as number) < 1) {
    throw new HttpError(400, 'invalid_identity_review_version');
  }
  if (
    body.disposition === IdentityReviewDisposition.RelinkCandidate &&
    (typeof body.targetEntityId !== 'string' || !body.targetEntityId.trim() || body.targetEntityId.length > 512)
  ) {
    throw new HttpError(400, 'invalid_identity_review_target');
  }
  if (
    body.disposition === IdentityReviewDisposition.EstablishObserved &&
    body.targetEntityId !== undefined
  ) {
    throw new HttpError(400, 'identity_review_target_not_allowed');
  }
  const reason = optionalDecisionReason(body.reason, 'invalid_identity_review_reason');
  return {
    disposition: body.disposition,
    reviewHash: body.reviewHash,
    version: body.version as number,
    ...(typeof body.targetEntityId === 'string'
      ? { targetEntityId: body.targetEntityId.trim() }
      : {}),
    ...(reason ? { reason } : {}),
  };
}

function checkpointDecisionRequest(body: Record<string, unknown>): CheckpointDecisionRequest {
  const allowedFields = new Set(['outcome', 'planHash', 'version', 'reason']);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw new HttpError(400, 'checkpoint_decision_field_not_allowed');
  }
  if (body.outcome !== DecisionOutcome.Approved && body.outcome !== DecisionOutcome.Rejected) {
    throw new HttpError(400, 'invalid_checkpoint_decision_outcome');
  }
  if (typeof body.planHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.planHash)) {
    throw new HttpError(400, 'invalid_checkpoint_plan_hash');
  }
  if (!Number.isInteger(body.version) || (body.version as number) < 1) {
    throw new HttpError(400, 'invalid_checkpoint_plan_version');
  }
  const reason = optionalDecisionReason(body.reason, 'invalid_checkpoint_decision_reason');
  return {
    outcome: body.outcome,
    planHash: body.planHash,
    version: body.version as number,
    ...(reason ? { reason } : {}),
  };
}

function optionalDecisionReason(value: unknown, errorCode: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > 2_000) {
    throw new HttpError(400, errorCode);
  }
  return value.trim();
}

function validDecisionId(value: string): string {
  if (!value.trim() || value.length > 512) {
    throw new Error('Decision ID factory returned an invalid ID');
  }
  return value;
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

function proposalEvidenceEventIds(proposal: Proposal): string[] {
  if (!Array.isArray(proposal.body.evidenceEventIds)) return [];
  return [...new Set(proposal.body.evidenceEventIds.flatMap((value) =>
    typeof value === 'string' && value.trim() ? [value] : []))];
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

function recordBody(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new HttpError(400, 'invalid_request_body');
  return value;
}

function requiredBodyString(value: unknown, error: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1_024) throw new HttpError(400, error);
  return value.trim();
}

function stringList(value: unknown, error: string): string[] {
  if (!Array.isArray(value) || value.length > 64 || !value.every((item) =>
    typeof item === 'string' && item.trim() && item.length <= 128)) throw new HttpError(400, error);
  return [...new Set(value.map((item) => item.trim()))];
}

function requestSignal(request: IncomingMessage): AbortSignal {
  const controller = new AbortController();
  request.once('aborted', () => controller.abort());
  return controller.signal;
}

function contentType(path: string): string {
  switch (extname(path).toLocaleLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.wasm': return 'application/wasm';
    case '.task': return 'application/octet-stream';
    default: return 'application/octet-stream';
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new JerichoStore();
  const paperclipPort = config.paperclipUrl && config.paperclipApiKey && config.paperclipCompanyId
    ? new HttpPaperclipPort({
      url: config.paperclipUrl,
      apiKey: config.paperclipApiKey,
      companyId: config.paperclipCompanyId,
    })
    : undefined;
  const fleetRegistry = createFleetLaneRegistry({
    telegramRecipients: config.fleetTelegramRecipients,
    ...(config.fleetBridgeRoot ? { bridgeRoot: config.fleetBridgeRoot } : {}),
    dispatchMode: config.fleetDispatchMode,
  });
  const intake = new IntakeProcessor({
    store,
    repositoryGrants: config.missionRepositoryGrants,
    fleetRegistry,
  });
  intake.recover();
  const connectors = createConnectorRuntime(config, store, {
    intake,
    ...(paperclipPort ? { paperclipPort } : {}),
  });
  const knowledge = new KnowledgeRuntime({
    store,
    reflectionIntervalMs: config.reflectionIntervalMs,
    obsidianVaultPath: config.obsidianVaultPath,
    vaultGateway: connectors.vaultGateway,
    vaultMaintenanceIntervalMs: config.vaultMaintenanceIntervalMs,
    vaultRebuildWindowStartUtc: config.vaultRebuildWindowStartUtc,
    vaultRebuildWindowEndUtc: config.vaultRebuildWindowEndUtc,
  });
  const execution = createMissionExecutionRuntime(config, store, {
    connectorActions: connectors.actionAdapters,
  });
  const retrieval = new FederatedRetrievalService(store, connectors.vaultGateway);
  const paperclip = paperclipPort
    ? new PaperclipExecutor(paperclipPort)
    : undefined;
  const obsidianOpen = config.obsidianVaultPath
    ? new ObsidianNoteOpener({ vaultPath: config.obsidianVaultPath })
    : undefined;
  const runtime = new ProductionRuntimeLifecycle({
    knowledge,
    connectors,
    ...(execution ? { execution } : {}),
  });
  const server = createJerichoServer({
    store,
    apiToken: config.apiToken,
    host: config.host,
    allowedOrigins: config.allowedOrigins,
    geminiApiKey: config.geminiApiKey,
    geminiModel: config.model,
    geminiVoice: config.voice,
    megatronVoice: config.megatronVoice,
    defaultPersonaMode: config.defaultPersonaMode,
    personaAutoRevertMs: config.personaAutoRevertMs,
    systemInstruction: config.systemInstruction,
    voiceActiveTurnMs: config.voiceActiveTurnMs,
    frontendDir: resolve(fileURLToPath(new URL('../../frontend/dist', import.meta.url))),
    supervisor: connectors.supervisor,
    connectorDescriptors: connectors.descriptors,
    vaultSearch: connectors.vaultGateway,
    obsidianSearch: connectors.obsidianSearch,
    ...(config.paperclipUrl && config.paperclipApiKey && config.paperclipCompanyId
      ? {
        fleet: new PaperclipFleetClient({
          apiUrl: config.paperclipUrl,
          apiKey: config.paperclipApiKey,
          companyId: config.paperclipCompanyId,
        }),
      }
      : {}),
    intake,
    ...(knowledge.retention ? { retention: knowledge.retention } : {}),
    reflection: knowledge.reflection,
    knowledge: knowledge.fleet,
    retrieval,
    ...(paperclip ? { paperclip } : {}),
    ...(obsidianOpen ? { obsidianOpen } : {}),
  });
  const address = await server.listen(config.port, config.host);
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await server.close();
    await runtime.stop();
    store.close();
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
  try {
    await runtime.start();
  } catch (error) {
    await shutdown();
    throw error;
  }
  if (shuttingDown) return;
  console.log(`[jericho] listening on http://${config.host}:${address.port}`);
  console.log(`[jericho] one-time browser bootstrap ${address.bootstrapUrl}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
