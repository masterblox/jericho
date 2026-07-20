import type {
  CheckpointDecisionRequest,
  CheckpointDecisionResponse,
  CommandCenterSnapshot,
  CorrectionConfirmRequest,
  CorrectionConfirmResponse,
  CorrectionPreviewRequest,
  CorrectionPreviewResponse,
  IdentityReviewDecisionRequest,
  IdentityReviewDecisionResponse,
  MissionDecisionRequest,
  MissionDecisionResponse,
  ProposalDecisionRequest,
  ProposalDecisionResponse,
  RelationType,
  ReviewIntentDecisionRequest,
  ReviewIntentDecisionResponse,
} from '@jericho/shared';

import type { CommandCenterStore } from './command-center-store';

export interface EventSourcePort {
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

export interface CoreClientPorts {
  fetch?: typeof globalThis.fetch;
  createEventSource?: (url: string) => EventSourcePort;
}

export interface MissionDecisionInput extends MissionDecisionRequest {
  missionId: string;
}

export interface MissionCancellationInput {
  missionId: string;
  planHash: string;
  version: number;
  reason: string;
}

export interface RelationshipProposalInput {
  fromNodeId: string;
  toNodeId: string;
  relation: RelationType;
}

export interface ReviewIntentDecisionInput extends ReviewIntentDecisionRequest {
  intentId: string;
}

export interface CheckpointDecisionInput extends CheckpointDecisionRequest {
  proposalId: string;
}

export interface IdentityReviewDecisionInput extends IdentityReviewDecisionRequest {
  failureId: string;
}

export interface ProposalDecisionInput extends ProposalDecisionRequest {
  proposalId: string;
}

export interface RetentionResult {
  relativePath: string;
  status: 'created' | 'updated' | 'unchanged';
}

export interface VaultSearchResult {
  path: string;
  title: string;
  excerpt: string;
  score: number;
}

export interface VaultSearchResponse {
  available: boolean;
  cached?: boolean;
  count: number;
  results: VaultSearchResult[];
  error?: string;
}

export interface NoteReorganizationProposalInput {
  relativePath: string;
  title: string;
}

export interface CoreHealth {
  ok: boolean;
  startup: {
    storage: 'persistent';
    database: '~/.jericho/jericho.db';
    initializedNewCore: boolean;
    recovery?: { outcome: 'archived_not_migrated'; archive: string };
  };
  connectors: Array<{ connectorId: string; status: string }>;
  vault: { ready: boolean };
  voice: { status: 'available' | 'unavailable' };
}

export class CoreClient {
  readonly #fetch: typeof globalThis.fetch;
  readonly #createEventSource: (url: string) => EventSourcePort;
  #source?: EventSourcePort;
  #controller?: AbortController;
  #started = false;
  #generation = 0;

  constructor(
    private readonly store: CommandCenterStore,
    ports: CoreClientPorts = {},
  ) {
    this.#fetch = ports.fetch ?? globalThis.fetch.bind(globalThis);
    this.#createEventSource = ports.createEventSource ?? ((url) =>
      new EventSource(url, { withCredentials: true }));
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    const generation = ++this.#generation;
    this.store.loading();
    await this.#refresh(generation);
    if (!this.#started || generation !== this.#generation) return;
    this.#source = this.#createEventSource('/api/v1/events');
    this.#source.onopen = () => {
      const current = this.store.getSnapshot();
      if (current.snapshot && current.status === 'disconnected') {
        this.store.replace(current.snapshot);
      }
    };
    this.#source.onerror = () => this.store.disconnected('Live updates disconnected');
    this.#source.addEventListener('change', (event) => {
      const change = parseRecord(event.data);
      const sequence = typeof change?.sequence === 'number' ? change.sequence : undefined;
      if (sequence === undefined) return;
      const current = this.store.getSnapshot().snapshot?.lastChangeSequence ?? -1;
      if (sequence <= current) return;
      if (current >= 0 && sequence > current + 1) this.store.gap();
      void this.#refresh(this.#generation);
    });
    this.#source.addEventListener('gap', () => {
      this.store.gap();
      void this.#refresh(this.#generation);
    });
  }

  async health(): Promise<CoreHealth> {
    const response = await this.#fetch('/api/v1/health', {
      credentials: 'same-origin', headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(await responseError(response, 'Core health unavailable'));
    return response.json() as Promise<CoreHealth>;
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;
    this.#generation += 1;
    this.#controller?.abort();
    this.#controller = undefined;
    this.#source?.close();
    this.#source = undefined;
  }

  async decideMission(input: MissionDecisionInput): Promise<MissionDecisionResponse> {
    const { missionId, ...request } = input;
    const response = await this.#fetch(
      `/api/v1/missions/${encodeURIComponent(missionId)}/decisions`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(request),
      },
    );
    if (!response.ok) throw new Error(await responseError(response, 'Mission decision failed'));
    const decision = await response.json() as MissionDecisionResponse;
    if (decision.snapshot) {
      if (!validSnapshot(decision.snapshot)) throw new Error('Jericho Core returned an invalid snapshot');
      this.store.replace(decision.snapshot);
    }
    else await this.#refresh(this.#generation);
    return decision;
  }

  async cancelMission(input: MissionCancellationInput): Promise<unknown> {
    const { missionId, ...request } = input;
    return this.#postWithSnapshot(
      `/api/v1/missions/${encodeURIComponent(missionId)}/cancel`,
      request,
      'Mission cancellation failed',
    );
  }

  decideReviewIntent(input: ReviewIntentDecisionInput): Promise<ReviewIntentDecisionResponse> {
    const { intentId, ...request } = input;
    return this.#postWithSnapshot(
      `/api/v1/review-intents/${encodeURIComponent(intentId)}/decisions`,
      request,
      'Review intent decision failed',
    ) as Promise<ReviewIntentDecisionResponse>;
  }

  decideCheckpoint(input: CheckpointDecisionInput): Promise<CheckpointDecisionResponse> {
    const { proposalId, ...request } = input;
    return this.#postWithSnapshot(
      `/api/v1/checkpoints/${encodeURIComponent(proposalId)}/decisions`,
      request,
      'Checkpoint decision failed',
    ) as Promise<CheckpointDecisionResponse>;
  }

  decideIdentityReview(input: IdentityReviewDecisionInput): Promise<IdentityReviewDecisionResponse> {
    const { failureId, ...request } = input;
    return this.#postWithSnapshot(
      `/api/v1/identity-reviews/${encodeURIComponent(failureId)}/decisions`,
      request,
      'Identity review decision failed',
    ) as Promise<IdentityReviewDecisionResponse>;
  }

  decideProposal(input: ProposalDecisionInput): Promise<ProposalDecisionResponse> {
    const { proposalId, ...request } = input;
    return this.#postWithSnapshot(
      `/api/v1/proposals/${encodeURIComponent(proposalId)}/decisions`,
      request,
      'Proposal decision failed',
    ) as Promise<ProposalDecisionResponse>;
  }

  async retainMission(missionId: string): Promise<RetentionResult> {
    const response = await this.#fetch(
      `/api/v1/missions/${encodeURIComponent(missionId)}/retain`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      },
    );
    if (!response.ok) throw new Error(await responseError(response, 'Mission retention failed'));
    const result = await response.json() as RetentionResult;
    // Retention appends an immutable Core event after the filesystem write.
    // Refetch so its replay entry and Nucleus pulse appear immediately.
    await this.#refresh(this.#generation, true);
    return result;
  }

  async createCorrectionPreview(input: CorrectionPreviewRequest): Promise<CorrectionPreviewResponse> {
    const response = await this.#fetch('/api/v1/corrections/preview', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await responseError(response, 'Correction preview failed'));
    return response.json() as Promise<CorrectionPreviewResponse>;
  }

  async confirmCorrection(input: CorrectionConfirmRequest): Promise<CorrectionConfirmResponse> {
    const response = await this.#fetch('/api/v1/corrections/confirm', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await responseError(response, 'Correction confirm failed'));
    const result = await response.json() as CorrectionConfirmResponse;
    await this.#refresh(this.#generation);
    return result;
  }

  async searchVault(query: string, limit = 6): Promise<VaultSearchResponse> {
    const params = new URLSearchParams({ q: query.trim(), limit: String(limit) });
    const response = await this.#fetch(`/api/v1/obsidian/search?${params}`, {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
    const result = await response.json() as VaultSearchResponse;
    if (!response.ok || !result.available) {
      throw new Error(result.error === 'vault_search_unavailable'
        ? 'Jarvis memory search is unavailable'
        : 'Jarvis memory search failed');
    }
    return result;
  }

  async openVaultNote(relativePath: string): Promise<{ relativePath: string }> {
    const response = await this.#fetch('/api/v1/obsidian/open', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ relativePath }),
    });
    if (!response.ok) throw new Error(await responseError(response, 'Opening Obsidian note failed'));
    return response.json() as Promise<{ relativePath: string }>;
  }

  proposeRelationship(input: RelationshipProposalInput): Promise<unknown> {
    return this.#postWithSnapshot(
      '/api/v1/relationship-proposals',
      input,
      'Relationship proposal failed',
    );
  }

  proposeNoteReorganization(input: NoteReorganizationProposalInput): Promise<unknown> {
    return this.#postWithSnapshot(
      '/api/v1/obsidian/reorganization-proposals',
      input,
      'Note reorganization proposal failed',
    );
  }

  // --- grounded-result v2 actions ---

  async openGroundedResult(resultId: string, sourceId: string): Promise<unknown> {
    const response = await this.#fetch(
      `/api/v1/grounded-results/${encodeURIComponent(resultId)}/actions/open`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sourceId }),
      },
    );
    if (!response.ok) throw new Error(await responseError(response, 'Grounded result open failed'));
    return response.json();
  }

  async reorganizeGroundedResult(resultId: string, sourceId: string): Promise<unknown> {
    const response = await this.#fetch(
      `/api/v1/grounded-results/${encodeURIComponent(resultId)}/actions/reorganize`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sourceId }),
      },
    );
    if (!response.ok) throw new Error(await responseError(response, 'Grounded result reorganize failed'));
    return response.json();
  }

  async correctIdentityPreview(resultId: string, conflictId: string): Promise<CorrectionPreviewResponse> {
    const response = await this.#fetch(
      `/api/v1/grounded-results/${encodeURIComponent(resultId)}/actions/correct/preview`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ conflictId }),
      },
    );
    if (!response.ok) throw new Error(await responseError(response, 'Identity correction preview failed'));
    return response.json() as Promise<CorrectionPreviewResponse>;
  }

  // Grounded correction confirmation: sends only opaque {conflictId, previewId}
  async confirmGroundedResult(resultId: string, conflictId: string, previewId: string): Promise<unknown> {
    const response = await this.#fetch(
      `/api/v1/grounded-results/${encodeURIComponent(resultId)}/actions/correct/confirm`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ conflictId, previewId }),
      },
    );
    if (!response.ok) throw new Error(await responseError(response, 'Grounded correction confirm failed'));
    return response.json();
  }

  async #postWithSnapshot(path: string, body: unknown, fallback: string): Promise<unknown> {
    const response = await this.#fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await responseError(response, fallback));
    const result = await response.json() as { snapshot?: unknown };
    if (result.snapshot) {
      if (!validSnapshot(result.snapshot)) throw new Error('Jericho Core returned an invalid snapshot');
      this.store.replace(result.snapshot);
    }
    else await this.#refresh(this.#generation);
    return result;
  }

  async #refresh(generation: number, forceReplace = false): Promise<void> {
    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;
    try {
      const response = await this.#fetch('/api/v1/command-center', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await responseError(response, 'Jericho Core unavailable'));
      const snapshot = await response.json() as unknown;
      if (!validSnapshot(snapshot)) throw new Error('Jericho Core returned an invalid snapshot');
      if (forceReplace || (this.#started && generation === this.#generation)) this.store.replace(snapshot);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (this.#started && generation === this.#generation) {
        this.store.unavailable(error instanceof Error ? error.message : 'Jericho Core unavailable');
      }
    } finally {
      if (this.#controller === controller) this.#controller = undefined;
    }
  }
}

function parseRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function validSnapshot(value: unknown): value is CommandCenterSnapshot {
  if (!record(value)) return false;
  if (!nonEmptyString(value.revision) || !isoTimestamp(value.generatedAt)) return false;
  if (!Number.isSafeInteger(value.lastChangeSequence) || Number(value.lastChangeSequence) < 0) return false;
  if (!record(value.today) || !isoDate(value.today.date)) return false;
  for (const key of ['taskIds', 'commitmentIds', 'activeMissionIds', 'pendingApprovalIds']) {
    if (!stringArray(value.today[key])) return false;
  }

  const entityCollections = ['tasks', 'communications', 'people', 'commitments'];
  if (!entityCollections.every((key) => recordArray(value[key], entityCard))) return false;
  if (!recordArray(value.missions, missionCard)) return false;
  if (!recordArray(value.approvals, approvalCard)) return false;
  if (!recordArray(value.proposals, identifiedRecord)) return false;
  if (!recordArray(value.activeAssignments, identifiedRecord)) return false;
  if (!recordArray(value.outcomes, identifiedRecord)) return false;
  if (!recordArray(value.receipts, identifiedRecord)) return false;
  if (!recordArray(value.history, identifiedRecord)) return false;
  if (!recordArray(value.connectors, (item) => nonEmptyString(item.connectorId) && nonEmptyString(item.status))) return false;
  if (!recordArray(value.captureFailures, identifiedRecord)) return false;
  if (value.reviewIntents !== undefined && !recordArray(value.reviewIntents, identifiedRecord)) return false;
  if (value.identityReviews !== undefined && !recordArray(value.identityReviews, identifiedRecord)) return false;

  if (!record(value.nucleus)) return false;
  if (!recordArray(value.nucleus.nodes, nucleusNode)) return false;
  if (!recordArray(value.nucleus.edges, nucleusEdge)) return false;
  if (!recordArray(value.nucleus.activityPulses, nucleusPulse)) return false;
  if (value.knowledge !== undefined) {
    if (!record(value.knowledge)) return false;
    for (const key of ['packages', 'projections', 'projectionReceipts', 'indexes', 'evaluations', 'paperclip']) {
      if (!recordArray(value.knowledge[key], identifiedRecord)) return false;
    }
  }
  return true;
}

const MAX_SNAPSHOT_COLLECTION = 50_000;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown, maximum = 4_096): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && value.trim().length > 0;
}

function isoTimestamp(value: unknown): value is string {
  return nonEmptyString(value, 64) && Number.isFinite(Date.parse(value));
}

function isoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_SNAPSHOT_COLLECTION &&
    value.every((item) => nonEmptyString(item, 1_024));
}

function recordArray(
  value: unknown,
  predicate: (item: Record<string, unknown>) => boolean,
): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.length <= MAX_SNAPSHOT_COLLECTION &&
    value.every((item) => record(item) && predicate(item));
}

function identifiedRecord(item: Record<string, unknown>): boolean {
  return nonEmptyString(item.id, 1_024);
}

function entityCard(item: Record<string, unknown>): boolean {
  return identifiedRecord(item) && nonEmptyString(item.label) &&
    Number.isFinite(item.rank) && isoTimestamp(item.updatedAt) && stringArray(item.evidenceEventIds) &&
    record(item.attributes) && record(item.freshness);
}

function missionCard(item: Record<string, unknown>): boolean {
  return identifiedRecord(item) && nonEmptyString(item.seriesId, 1_024) &&
    Number.isSafeInteger(item.version) && Number(item.version) > 0 &&
    nonEmptyString(item.planHash, 128) && nonEmptyString(item.title) && nonEmptyString(item.objective) &&
    Array.isArray(item.taskGraph) && Array.isArray(item.agents) && Array.isArray(item.timeline) &&
    isoTimestamp(item.createdAt) && isoTimestamp(item.updatedAt);
}

function approvalCard(item: Record<string, unknown>): boolean {
  if (!identifiedRecord(item) || !nonEmptyString(item.missionId, 1_024) ||
    !nonEmptyString(item.planHash, 128) || !Number.isSafeInteger(item.version) || Number(item.version) <= 0 ||
    !nonEmptyString(item.title) || !nonEmptyString(item.objective) || !record(item.permissions)) return false;
  return recordArray(item.actions, (action) =>
    identifiedRecord(action) && action.targetType === 'mission' && action.targetId === item.missionId &&
    action.method === 'POST' && nonEmptyString(action.endpoint, 2_048) &&
    typeof action.enabled === 'boolean' && typeof action.requiresConfirmation === 'boolean' &&
    record(action.payload) && action.payload.planHash === item.planHash && action.payload.version === item.version,
  );
}

function nucleusNode(item: Record<string, unknown>): boolean {
  return identifiedRecord(item) && nonEmptyString(item.recordType) && nonEmptyString(item.recordId) &&
    nonEmptyString(item.label) && isoTimestamp(item.updatedAt) && stringArray(item.evidenceEventIds) &&
    item.verified === true;
}

function nucleusEdge(item: Record<string, unknown>): boolean {
  return identifiedRecord(item) && nonEmptyString(item.fromNodeId) && nonEmptyString(item.toNodeId) &&
    nonEmptyString(item.relation) && stringArray(item.evidenceEventIds) && item.verified === true;
}

function nucleusPulse(item: Record<string, unknown>): boolean {
  return identifiedRecord(item) && nonEmptyString(item.nodeId) && nonEmptyString(item.label) &&
    isoTimestamp(item.occurredAt) && stringArray(item.evidenceEventIds) && item.verified === true;
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}
