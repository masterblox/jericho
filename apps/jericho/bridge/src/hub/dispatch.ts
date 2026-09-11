import type {
  HubDispatchPlan,
  HubDispatchReceipt,
  HubDispatchVerdict,
} from '@jericho/shared';

export interface HubDispatchGate {
  isConfirmed(idempotencyKey: string, confirmationToken?: string): boolean;
}

/**
 * Confirmation-gated, idempotent mesh dispatch with a full maestro lifecycle:
 *
 *    enqueue -> (confirm) -> dispatch -> verify -> archive
 *                                 \-> failed (verdict.status = failed)
 *
 * Never performs agent domain work — emits bounded receipts only. Every
 * transition is idempotent: replaying a settled key returns the stored
 * receipt with `replayed: true` instead of double-running anything.
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
    if (
      existing.plan.status === 'dispatched' ||
      existing.plan.status === 'failed' ||
      existing.plan.status === 'verified' ||
      existing.plan.status === 'archived'
    ) {
      // Terminal/closed receipts never reopen on a confirmation retry — replay
      // the stored receipt (verdict + archive metadata intact) instead.
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

  /**
   * Maestro `dispatch` hook. Explicitly moves a non-terminal receipt to
   * `dispatched`. Confirmation-gated plans still need a confirmed token;
   * plans that never required confirmation dispatch immediately.
   */
  dispatch(idempotencyKey: string, confirmationToken?: string): HubDispatchReceipt {
    const existing = this.#receipts.get(idempotencyKey);
    if (!existing) throw new Error(`Unknown Hub dispatch key: ${idempotencyKey}`);
    if (existing.plan.status !== 'planned' && existing.plan.status !== 'pending_approval' && existing.plan.status !== 'approved') {
      return { ...structuredClone(existing), replayed: true };
    }
    if (
      existing.plan.requiresConfirmation &&
      !this.#gate.isConfirmed(idempotencyKey, confirmationToken)
    ) {
      return { ...structuredClone(existing), replayed: false };
    }
    const receipt: HubDispatchReceipt = {
      ...existing,
      plan: { ...existing.plan, status: 'dispatched' },
      replayed: false,
      updatedAt: this.#now(),
    };
    this.#receipts.set(idempotencyKey, receipt);
    return structuredClone(receipt);
  }

  /**
   * Maestro `verify` hook. Binds an independent verdict (evidence, never a
   * bare worker claim) and moves the receipt to `verified` or `failed`.
   */
  verify(idempotencyKey: string, verdict: HubDispatchVerdict): HubDispatchReceipt {
    const existing = this.#receipts.get(idempotencyKey);
    if (!existing) throw new Error(`Unknown Hub dispatch key: ${idempotencyKey}`);
    if (
      existing.plan.status === 'verified' ||
      existing.plan.status === 'failed' ||
      existing.plan.status === 'archived'
    ) {
      return { ...structuredClone(existing), replayed: true };
    }
    // An independent verdict only binds to a receipt that actually went through
    // the dispatch gate. planned / pending_approval / approved receipts must be
    // dispatched (confirmed) first — they never fall through to verification.
    if (existing.plan.status !== 'dispatched') {
      throw new Error(
        `Cannot verify receipt in status ${existing.plan.status}; ` +
          'verify requires dispatched (confirmation-gated plans must pass the gate)',
      );
    }
    if (verdict.status !== 'verified' && verdict.status !== 'failed') {
      throw new Error(`Unsupported verdict status: ${verdict.status}`);
    }
    const plan =
      verdict.status === 'verified'
        ? { ...existing.plan, status: 'verified' as const }
        : { ...existing.plan, status: 'failed' as const };
    const receipt: HubDispatchReceipt = {
      ...existing,
      plan,
      verdict: { ...verdict, at: verdict.at ?? this.#now() },
      ...(verdict.status === 'failed' ? { failureReason: verdict.evidence } : {}),
      replayed: false,
      updatedAt: this.#now(),
    };
    this.#receipts.set(idempotencyKey, receipt);
    return structuredClone(receipt);
  }

  /**
   * Maestro `archive` hook. Closes a terminal receipt (verified|failed) into
   * the archive ledger. Open/dispatched receipts cannot be archived directly.
   */
  archive(idempotencyKey: string): HubDispatchReceipt {
    const existing = this.#receipts.get(idempotencyKey);
    if (!existing) throw new Error(`Unknown Hub dispatch key: ${idempotencyKey}`);
    if (existing.plan.status === 'archived') {
      return { ...structuredClone(existing), replayed: true };
    }
    if (existing.plan.status !== 'verified' && existing.plan.status !== 'failed') {
      throw new Error(
        `Cannot archive receipt in status ${existing.plan.status}; ` +
          'archive requires verified|failed',
      );
    }
    const receipt: HubDispatchReceipt = {
      ...existing,
      plan: { ...existing.plan, status: 'archived' },
      archivedAt: this.#now(),
      replayed: false,
      updatedAt: this.#now(),
    };
    this.#receipts.set(idempotencyKey, receipt);
    return structuredClone(receipt);
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
