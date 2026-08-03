import {
  HubDispatchStatus,
  type HubDispatchReceipt,
  type HubDispatchRequest,
} from '@jericho/shared';

export interface HubDispatchGate {
  /** Returns true only when the confirmation token authorizes this request. */
  isConfirmed(request: Readonly<HubDispatchRequest>): boolean;
}

/**
 * Confirmation-gated, idempotent Hub dispatch.
 * Identical idempotency keys replay the prior terminal receipt and never double-send.
 */
export class HubDispatcher {
  readonly #gate: HubDispatchGate;
  readonly #receipts = new Map<string, HubDispatchReceipt>();
  readonly #now: () => string;

  constructor(gate: HubDispatchGate, now: () => string = () => new Date().toISOString()) {
    this.#gate = gate;
    this.#now = now;
  }

  /** Queue work without confirmation — status stays awaiting_confirmation. */
  enqueue(request: Readonly<HubDispatchRequest>): HubDispatchReceipt {
    const existing = this.#receipts.get(request.idempotencyKey);
    if (existing) {
      return { ...existing, replayed: true, status: HubDispatchStatus.Duplicate };
    }
    const pending: HubDispatchReceipt = {
      idempotencyKey: request.idempotencyKey,
      commandId: request.commandId,
      status: HubDispatchStatus.AwaitingConfirmation,
      capability: request.capability,
      summary: request.summary,
      updatedAt: this.#now(),
      replayed: false,
    };
    this.#receipts.set(request.idempotencyKey, pending);
    return { ...pending };
  }

  /**
   * Confirm and dispatch a previously enqueued request.
   * Replaying the same confirmed key returns Duplicate without re-dispatch.
   */
  confirm(request: Readonly<HubDispatchRequest>): HubDispatchReceipt {
    const existing = this.#receipts.get(request.idempotencyKey);
    if (!existing) {
      throw new Error(`Unknown Hub dispatch key: ${request.idempotencyKey}`);
    }
    if (
      existing.status === HubDispatchStatus.Dispatched ||
      existing.status === HubDispatchStatus.Duplicate
    ) {
      return { ...existing, replayed: true, status: HubDispatchStatus.Duplicate };
    }
    if (existing.status === HubDispatchStatus.Rejected) {
      return { ...existing, replayed: true };
    }
    if (!request.confirmationToken || !this.#gate.isConfirmed(request)) {
      const blocked: HubDispatchReceipt = {
        ...existing,
        status: HubDispatchStatus.AwaitingConfirmation,
        updatedAt: this.#now(),
        replayed: false,
      };
      this.#receipts.set(request.idempotencyKey, blocked);
      return { ...blocked };
    }
    const dispatched: HubDispatchReceipt = {
      idempotencyKey: request.idempotencyKey,
      commandId: request.commandId,
      status: HubDispatchStatus.Dispatched,
      capability: request.capability,
      summary: request.summary,
      updatedAt: this.#now(),
      replayed: false,
    };
    this.#receipts.set(request.idempotencyKey, dispatched);
    return { ...dispatched };
  }

  reject(idempotencyKey: string, reasonSummary?: string): HubDispatchReceipt | undefined {
    const existing = this.#receipts.get(idempotencyKey);
    if (!existing) return undefined;
    if (
      existing.status === HubDispatchStatus.Dispatched ||
      existing.status === HubDispatchStatus.Duplicate
    ) {
      return { ...existing, replayed: true };
    }
    const rejected: HubDispatchReceipt = {
      ...existing,
      status: HubDispatchStatus.Rejected,
      summary: reasonSummary ?? existing.summary,
      updatedAt: this.#now(),
      replayed: false,
    };
    this.#receipts.set(idempotencyKey, rejected);
    return { ...rejected };
  }

  get(idempotencyKey: string): HubDispatchReceipt | undefined {
    const receipt = this.#receipts.get(idempotencyKey);
    return receipt ? { ...receipt } : undefined;
  }

  list(): HubDispatchReceipt[] {
    return [...this.#receipts.values()].map((receipt) => ({ ...receipt }));
  }
}

/** Simple token equality gate for injected confirmation flows. */
export function createTokenDispatchGate(expectedToken: string): HubDispatchGate {
  return {
    isConfirmed(request) {
      return request.confirmationToken === expectedToken;
    },
  };
}
