import type {
  CheckpointDecisionRequest,
  CheckpointDecisionResponse,
  CommandCenterSnapshot,
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
    if (decision.snapshot) this.store.replace(decision.snapshot);
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

  proposeRelationship(input: RelationshipProposalInput): Promise<unknown> {
    return this.#postWithSnapshot(
      '/api/v1/relationship-proposals',
      input,
      'Relationship proposal failed',
    );
  }

  async #postWithSnapshot(path: string, body: unknown, fallback: string): Promise<unknown> {
    const response = await this.#fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await responseError(response, fallback));
    const result = await response.json() as { snapshot?: CommandCenterSnapshot };
    if (result.snapshot) this.store.replace(result.snapshot);
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
      const snapshot = await response.json() as CommandCenterSnapshot;
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

function validSnapshot(value: CommandCenterSnapshot): boolean {
  return Boolean(
    value && typeof value === 'object' &&
    typeof value.revision === 'string' &&
    Number.isInteger(value.lastChangeSequence) &&
    typeof value.generatedAt === 'string' &&
    value.nucleus && Array.isArray(value.nucleus.nodes),
  );
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}
