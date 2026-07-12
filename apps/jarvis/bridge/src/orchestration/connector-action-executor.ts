import { createHash } from 'node:crypto';

import {
  LifecycleStatus,
  MutationClass,
  ReceiptStatus,
  RouteType,
  SourceType,
  type ActionReceipt,
  type Assignment,
  type EventEnvelope,
  type ExternalActionSpec,
  type JsonObject,
  type JsonValue,
  type MissionPlan,
  type MissionTaskDefinition,
} from '@jericho/shared';

import type { JerichoStore } from '../core/store.js';
import type {
  ArtifactVerificationContext,
  ArtifactVerificationResult,
  ArtifactVerifier,
  AssignmentExecutionContext,
  AssignmentExecutor,
  DynamicAssignmentExecutor,
  ExecutorDescriptor,
  ExecutorResult,
} from './runner.js';
import { externalActionScopeViolations } from './scope.js';

export interface ApprovedConnectorSendInput {
  assignmentId: string;
  missionPlanHash: string;
  receiptId: string;
  recipient: string;
  text: string;
  now: string;
  signal: AbortSignal;
}

export interface ApprovedConnectorExecutionResult {
  externalId: string;
  result: JsonValue;
  evidenceEventIds: string[];
}

export interface ConnectorActionAdapter {
  readonly descriptor: { readonly id: string };
  executeApproved(
    store: JerichoStore,
    input: ApprovedConnectorSendInput,
  ): Promise<ApprovedConnectorExecutionResult>;
}

export type ConnectorActionAdapters = Readonly<Record<string, ConnectorActionAdapter>>;

export interface ApprovedConnectorBinding {
  connectorId: string;
  /** Exact approved action verb (e.g. send_message, write_handoff). */
  action?: string;
  system: string;
  channel: string;
  tool: string;
  credentialRef: string;
  dataScope: string;
  mutationClass: MutationClass;
}

export interface ValidatedConnectorSend {
  assignment: Assignment;
  mission: MissionPlan;
  task: MissionTaskDefinition;
  receipt: ActionReceipt;
  action: ExternalActionSpec;
}

/**
 * Revalidates every mutable-looking execution input against the immutable,
 * approved plan before an adapter is allowed to start its durable receipt.
 */
export function validateApprovedConnectorSend(
  store: JerichoStore,
  input: ApprovedConnectorSendInput,
  expected: ApprovedConnectorBinding,
): ValidatedConnectorSend {
  const assignment = store.getAssignment(input.assignmentId);
  const mission = assignment ? store.getMission(assignment.missionId) : undefined;
  const task = mission?.taskGraph.find((candidate) => candidate.id === assignment?.missionTaskId);
  const receipt = store.getReceipt(input.receiptId);
  const action = assignment?.externalAction;
  const approvedAction = task?.externalAction;
  if (
    !assignment || !mission || !task || !receipt || !action || !approvedAction ||
    (mission.status !== LifecycleStatus.Approved && mission.status !== LifecycleStatus.Active) ||
    mission.planHash !== input.missionPlanHash ||
    assignment.missionId !== mission.id ||
    assignment.missionTaskId !== task.id ||
    canonicalJson(action) !== canonicalJson(approvedAction) ||
    action.connectorId !== expected.connectorId ||
    action.action !== (expected.action ?? 'send_message') ||
    action.system !== expected.system ||
    action.channel !== expected.channel ||
    action.tool !== expected.tool ||
    action.credentialRef !== expected.credentialRef ||
    action.dataScope !== expected.dataScope ||
    action.mutationClass !== expected.mutationClass ||
    !task.requiredActions.includes(action.action) ||
    !task.requiredTools.includes(expected.tool) ||
    externalActionScopeViolations(action, task.writableScope).length > 0 ||
    externalActionScopeViolations(action, mission.permissions).length > 0 ||
    action.recipient !== input.recipient ||
    action.destination !== input.recipient ||
    !input.text.trim() ||
    assignment.instructions.text !== input.text ||
    task.input.text !== input.text ||
    receipt.assignmentId !== assignment.id ||
    receipt.missionTaskId !== assignment.missionTaskId ||
    receipt.connectorId !== action.connectorId ||
    receipt.action !== action.action ||
    receipt.destination !== action.destination ||
    receipt.idempotencyKey !== action.idempotencyKey
  ) {
    throw new Error(`${expected.connectorId} outbox action is not bound to the approved mission and receipt`);
  }
  return { assignment, mission, task, receipt, action };
}

export interface ConnectorDeliveryEventInput {
  connectorId: string;
  mission: MissionPlan;
  assignment: Assignment;
  task: MissionTaskDefinition;
  receipt: ActionReceipt;
  recipient: string;
  text: string;
  externalId: string;
  result: JsonValue;
  occurredAt: string;
}

/** Persists the gateway acknowledgement as immutable evidence, without raw message text. */
export function appendConnectorDeliveryEvent(
  store: JerichoStore,
  input: ConnectorDeliveryEventInput,
): EventEnvelope {
  const sourceEventId = connectorDeliverySourceEventId(input.receipt.idempotencyKey);
  const event: EventEnvelope = {
    id: connectorDeliveryEventId(input.connectorId, input.receipt.idempotencyKey),
    source: input.connectorId,
    sourceType: SourceType.Connector,
    sourceEventId,
    type: `${input.connectorId}.message.sent`,
    occurredAt: input.occurredAt,
    ingestedAt: input.occurredAt,
    payload: {
      direction: 'outbound',
      acknowledgement: 'gateway_accepted',
      missionId: input.mission.id,
      missionPlanHash: input.mission.planHash,
      missionTaskId: input.task.id,
      assignmentId: input.assignment.id,
      receiptId: input.receipt.id,
      connectorId: input.connectorId,
      action: input.receipt.action,
      destination: input.recipient,
      idempotencyKeyHash: sha256(input.receipt.idempotencyKey),
      textHash: sha256(input.text),
      externalId: input.externalId,
      result: structuredClone(input.result),
    },
    status: LifecycleStatus.Succeeded,
    route: RouteType.Connector,
    risk: input.assignment.risk,
    provenance: [{
      source: input.connectorId,
      sourceType: SourceType.Connector,
      sourceEventId,
      observedAt: input.occurredAt,
    }],
  };
  return store.appendEvent(event).event;
}

export function connectorDeliveryEventId(connectorId: string, idempotencyKey: string): string {
  return `${connectorId}-${sha256(`${connectorId}\0${connectorDeliverySourceEventId(idempotencyKey)}`).slice(0, 32)}`;
}

function connectorDeliverySourceEventId(idempotencyKey: string): string {
  return `outbound:${sha256(idempotencyKey)}`;
}

export interface RoutedAssignmentExecutorOptions {
  fallback?: AssignmentExecutor;
  now?: () => string;
}

/** Routes external sends to their bounded connector; all other work to compatible Hermes. */
export class RoutedAssignmentExecutor implements DynamicAssignmentExecutor {
  readonly #adapters: ReadonlyMap<string, ConnectorActionAdapter>;
  readonly #now: () => string;

  constructor(
    private readonly store: JerichoStore,
    adapters: ConnectorActionAdapters,
    private readonly options: RoutedAssignmentExecutorOptions = {},
  ) {
    const entries = Object.entries(adapters);
    for (const [id, adapter] of entries) {
      if (!id.trim() || adapter.descriptor.id !== id) {
        throw new TypeError('Connector action adapter registry identity is invalid');
      }
    }
    this.#adapters = new Map(entries);
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  descriptorFor(context: AssignmentExecutionContext): ExecutorDescriptor {
    if (!context.assignment.externalAction) {
      if (!this.options.fallback) throw new Error('No compatible Hermes executor is available');
      return descriptorFor(this.options.fallback, context);
    }
    this.#adapterFor(context.assignment.externalAction.connectorId);
    return {
      model: context.task.model,
      maxTokens: context.task.maxTokens,
      tools: [...context.task.requiredTools],
      writableScope: structuredClone(context.task.writableScope),
      mayCreateAssignments: false,
    };
  }

  async execute(context: AssignmentExecutionContext): Promise<ExecutorResult> {
    const action = context.assignment.externalAction;
    if (!action) {
      if (!this.options.fallback) throw new Error('No compatible Hermes executor is available');
      return this.options.fallback.execute(context);
    }
    if (canonicalJson(action) !== canonicalJson(context.task.externalAction ?? null)) {
      throw new Error('Connector assignment action differs from the approved mission task');
    }
    const text = context.assignment.instructions.text;
    if (typeof text !== 'string' || !text.trim() || context.task.input.text !== text) {
      throw new Error('Connector assignment text differs from the approved mission task');
    }
    const receipt = this.store.getReceiptByIdempotencyKey(action.idempotencyKey);
    if (!receipt) throw new Error('Connector action has no reserved receipt');
    const executed = await this.#adapterFor(action.connectorId).executeApproved(this.store, {
      assignmentId: context.assignment.id,
      missionPlanHash: context.mission.planHash,
      receiptId: receipt.id,
      recipient: action.recipient ?? action.destination,
      text,
      now: this.#now(),
      signal: context.signal,
    });
    return {
      artifact: {
        type: context.assignment.expectedArtifact.type,
        data: structuredClone(executed.result),
      },
      costs: [],
      external: {
        externalId: executed.externalId,
        result: structuredClone(executed.result),
        verified: true,
        evidenceEventIds: [...executed.evidenceEventIds],
      },
    };
  }

  #adapterFor(connectorId: string): ConnectorActionAdapter {
    const adapter = this.#adapters.get(connectorId);
    if (!adapter) throw new Error(`Unsupported external action connector ${connectorId}`);
    return adapter;
  }
}

export interface RoutedArtifactVerifierOptions {
  fallback?: ArtifactVerifier;
}

/** Verifies connector artifacts from the encrypted immutable event, not executor claims. */
export class RoutedArtifactVerifier implements ArtifactVerifier {
  readonly id = 'routed-truth-verifier';

  constructor(
    private readonly store: JerichoStore,
    private readonly options: RoutedArtifactVerifierOptions = {},
  ) {}

  async verify(context: ArtifactVerificationContext): Promise<ArtifactVerificationResult> {
    const action = context.assignment.externalAction;
    if (!action) {
      if (!this.options.fallback) return { verified: false, checks: [], evidence: [] };
      return this.options.fallback.verify(context);
    }
    if (
      context.requirement.verification.some((check) => !CONNECTOR_RECEIPT_CHECKS.has(check)) ||
      context.requirement.requiredEvidence.some(
        (selector) => !CONNECTOR_RECEIPT_EVIDENCE.has(selector),
      )
    ) {
      return { verified: false, checks: [], evidence: [] };
    }
    const receipt = this.store.getReceiptByIdempotencyKey(action.idempotencyKey);
    const event = this.store.getEvent(connectorDeliveryEventId(action.connectorId, action.idempotencyKey));
    if (!receipt || !event || !event.integrityHash || !validConnectorDelivery(context, receipt, event)) {
      return { verified: false, checks: [], evidence: [] };
    }
    return {
      verified: true,
      checks: [...context.requirement.verification],
      evidence: context.requirement.requiredEvidence.map((selector) => ({
        eventId: event.id,
        selector,
      })),
    };
  }
}

const CONNECTOR_RECEIPT_CHECKS = new Set([
  'gateway-acknowledged',
  'destination-matched',
  'idempotency-bound',
]);

const CONNECTOR_RECEIPT_EVIDENCE = new Set([
  'destination-receipt',
]);

function validConnectorDelivery(
  context: ArtifactVerificationContext,
  receipt: ActionReceipt,
  event: EventEnvelope,
): boolean {
  const action = context.assignment.externalAction!;
  const payload = isRecord(event.payload) ? event.payload : undefined;
  const text = context.assignment.instructions.text;
  const expectedEventId = connectorDeliveryEventId(action.connectorId, action.idempotencyKey);
  return Boolean(
    payload && typeof text === 'string' && text.trim() &&
    event.id === expectedEventId &&
    event.source === action.connectorId &&
    event.sourceType === SourceType.Connector &&
    event.sourceEventId === connectorDeliverySourceEventId(action.idempotencyKey) &&
    event.type === `${action.connectorId}.message.sent` &&
    event.status === LifecycleStatus.Succeeded &&
    event.route === RouteType.Connector &&
    receipt.assignmentId === context.assignment.id &&
    receipt.missionTaskId === context.task.id &&
    receipt.connectorId === action.connectorId &&
    receipt.action === action.action &&
    receipt.destination === action.destination &&
    receipt.idempotencyKey === action.idempotencyKey &&
    payload.direction === 'outbound' &&
    payload.acknowledgement === 'gateway_accepted' &&
    payload.missionId === context.mission.id &&
    payload.missionPlanHash === context.mission.planHash &&
    payload.missionTaskId === context.task.id &&
    payload.assignmentId === context.assignment.id &&
    payload.receiptId === receipt.id &&
    payload.connectorId === action.connectorId &&
    payload.action === action.action &&
    payload.destination === action.destination &&
    payload.idempotencyKeyHash === sha256(action.idempotencyKey) &&
    payload.textHash === sha256(text) &&
    typeof payload.externalId === 'string' && payload.externalId.length > 0 &&
    canonicalJson(payload.result ?? null) === canonicalJson(context.artifact.data) &&
    (
      (receipt.status === ReceiptStatus.Pending && Boolean(receipt.startedAt)) ||
      (receipt.status === ReceiptStatus.Succeeded &&
        receipt.verified &&
        receipt.externalId === payload.externalId &&
        receipt.evidenceEventIds.includes(event.id))
    )
  );
}

function descriptorFor(
  executor: AssignmentExecutor,
  context: AssignmentExecutionContext,
): ExecutorDescriptor {
  return 'descriptorFor' in executor
    ? executor.descriptorFor(context)
    : executor.descriptor;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  )).join(',')}}`;
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
