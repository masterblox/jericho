import type {
  CommandCenterSnapshot,
  MissionDecisionRequest,
  MissionDecisionResponse,
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

  async #refresh(generation: number): Promise<void> {
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
      if (this.#started && generation === this.#generation) this.store.replace(snapshot);
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
