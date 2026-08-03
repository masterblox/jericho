import type { HubDispatchPlan, HubDispatchReceipt } from '@jericho/shared';

export interface HubDispatchGate {
  isConfirmed(idempotencyKey: string, confirmationToken?: string): boolean;
}

/**
 * Confirmation-gated, idempotent mesh dispatch.
 * Never performs agent domain work — emits bounded receipts only.
 */
export class HubDispatcher {
  readonly #gate: HubDispatchGate;
  readonly #receipts = new Map<string, HubDispatchReceipt>();
  readonly #now: () => string;

  constructor(gate: HubDispatchGate, now: () => string = () => new Date().toISOString()) {
    this.#gate = gate;
    this.#now = now;
  }

  enqueue(plan: HubDispatchPlan, idempotencyKey: string): HubDispatchReceipt {
    const existing = this.#receipts.get(idempotencyKey);
    if (existing) {
      return { ...existing, plan: structuredClone(existing.plan), replayed: true };
    }
    const pendingPlan: HubDispatchPlan = {
      ...plan,
      status: plan.requiresConfirmation ? 'pending_approval' : 'planned',
    };
    const receipt: HubDispatchReceipt = {
      idempotencyKey,
      commandId: plan.commandId,
      plan: pendingPlan,
      replayed: false,
      updatedAt: this.#now(),
    };
    this.#receipts.set(idempotencyKey, receipt);
    return structuredClone(receipt);
  }

  confirm(idempotencyKey: string, confirmationToken?: string): HubDispatchReceipt {
    const existing = this.#receipts.get(idempotencyKey);
    if (!existing) throw new Error(`Unknown Hub dispatch key: ${idempotencyKey}`);
    if (existing.plan.status === 'dispatched') {
      return { ...structuredClone(existing), replayed: true };
    }
    if (existing.plan.status === 'failed') {
      return { ...structuredClone(existing), replayed: true };
    }
    if (existing.plan.requiresConfirmation && !this.#gate.isConfirmed(idempotencyKey, confirmationToken)) {
      const pending: HubDispatchReceipt = {
        ...existing,
        plan: { ...existing.plan, status: 'pending_approval' },
        replayed: false,
        updatedAt: this.#now(),
      };
      this.#receipts.set(idempotencyKey, pending);
      return structuredClone(pending);
    }
    const dispatched: HubDispatchReceipt = {
      idempotencyKey,
      commandId: existing.commandId,
      plan: {
        ...existing.plan,
        status: 'dispatched',
        ...(existing.plan.requiresConfirmation ? { status: 'dispatched' as const } : {}),
      },
      replayed: false,
      updatedAt: this.#now(),
    };
    this.#receipts.set(idempotencyKey, dispatched);
    return structuredClone(dispatched);
  }

  get(idempotencyKey: string): HubDispatchReceipt | undefined {
    const receipt = this.#receipts.get(idempotencyKey);
    return receipt ? structuredClone(receipt) : undefined;
  }
}

export function createTokenDispatchGate(expectedToken: string): HubDispatchGate {
  return {
    isConfirmed(_key, confirmationToken) {
      return confirmationToken === expectedToken;
    },
  };
}
