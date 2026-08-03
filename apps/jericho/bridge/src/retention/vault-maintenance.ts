import type { VaultGatewayPort } from '../vault/vault-gateway-client.js';

export type VaultMaintenanceStatus =
  | 'rebuilt'
  | 'outside_window'
  | 'sync_unhealthy'
  | 'index_current'
  | 'stopped';

export interface VaultMaintenanceSchedulerOptions {
  gateway: VaultGatewayPort;
  intervalMs: number;
  windowStartUtcHour: number;
  windowEndUtcHour: number;
  clock?: () => string;
}

export class VaultMaintenanceScheduler {
  readonly #clock: () => string;
  #running = false;
  #timer?: ReturnType<typeof setTimeout>;
  #controller?: AbortController;
  #inFlight?: Promise<{ status: VaultMaintenanceStatus }>;

  constructor(private readonly options: VaultMaintenanceSchedulerOptions) {
    if (!Number.isInteger(options.intervalMs) || options.intervalMs < 1) {
      throw new TypeError('Vault maintenance interval is invalid');
    }
    for (const [name, hour] of [
      ['start', options.windowStartUtcHour], ['end', options.windowEndUtcHour],
    ] as const) {
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
        throw new TypeError(`Vault maintenance ${name} hour is invalid`);
      }
    }
    if (options.windowStartUtcHour === options.windowEndUtcHour) {
      throw new TypeError('Vault maintenance window cannot be empty');
    }
    this.#clock = options.clock ?? (() => new Date().toISOString());
  }

  async start(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    await this.runOnce();
    this.#schedule();
  }

  async stop(): Promise<void> {
    this.#running = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#controller?.abort(new Error('Vault maintenance stopped'));
    await this.#inFlight;
  }

  runOnce(): Promise<{ status: VaultMaintenanceStatus }> {
    if (this.#inFlight) return this.#inFlight;
    const controller = new AbortController();
    this.#controller = controller;
    const execution = this.#execute(controller.signal);
    this.#inFlight = execution;
    return execution.finally(() => {
      if (this.#inFlight === execution) this.#inFlight = undefined;
      if (this.#controller === controller) this.#controller = undefined;
    });
  }

  #schedule(): void {
    if (!this.#running || this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.runOnce().finally(() => this.#schedule());
    }, this.options.intervalMs);
    this.#timer.unref?.();
  }

  async #execute(signal: AbortSignal): Promise<{ status: VaultMaintenanceStatus }> {
    const now = parseTimestamp(this.#clock(), 'Vault maintenance clock');
    if (!insideUtcWindow(now.getUTCHours(), this.options.windowStartUtcHour, this.options.windowEndUtcHour)) {
      return { status: 'outside_window' };
    }
    try {
      const health = await this.options.gateway.health(signal);
      if (health.status !== 'healthy' || !health.lastCommitAt) return { status: 'sync_unhealthy' };
      const commit = parseTimestamp(health.lastCommitAt, 'Vault commit timestamp');
      const index = health.lastIndexAt
        ? parseTimestamp(health.lastIndexAt, 'Vault index timestamp')
        : undefined;
      if (index && index.getTime() >= commit.getTime()) return { status: 'index_current' };
      await this.options.gateway.rebuildIndex(signal);
      return { status: 'rebuilt' };
    } catch (error) {
      if (signal.aborted) return { status: 'stopped' };
      return { status: 'sync_unhealthy' };
    }
  }
}

function insideUtcWindow(hour: number, start: number, end: number): boolean {
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

function parseTimestamp(value: string, label: string): Date {
  const parsed = new Date(value);
  if (!value || !Number.isFinite(parsed.getTime())) throw new Error(`${label} is invalid`);
  return parsed;
}
