import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import {
  CostCategory,
  LifecycleStatus,
  RouteType,
  SourceType,
  type ArtifactRequirement,
  type EventEnvelope,
  type JsonObject,
  type JsonValue,
  type MissionPermissions,
} from '@jericho/shared';

import type { JerichoStore } from '../core/store.js';
import type {
  AssignmentExecutionContext,
  ArtifactVerificationContext,
  ArtifactVerificationResult,
  ArtifactVerifier,
  DynamicAssignmentExecutor,
  ExecutorDescriptor,
  ExecutorCost,
  ExecutorResult,
} from './runner.js';

const TASK_PROTOCOL_VERSION = 1;
const MAX_RESULT_BYTES = 1_048_576;
export const HERMES_PROTOCOL_MANIFEST = 'jericho-operator-capabilities.json';
const REQUIRED_PROTOCOL_CAPABILITIES = [
  'bounded_stop',
  'idempotent_dispatch',
  'independent_verification_evidence',
  'metered_cost_evidence',
  'structured_artifacts',
] as const;

export type HermesProtocolReason =
  | 'compatible'
  | 'missing_manifest'
  | 'invalid_manifest'
  | 'unsupported_protocol'
  | 'missing_capability'
  | 'stale_manifest';

export interface HermesProtocolCompatibility {
  compatible: boolean;
  reason: HermesProtocolReason;
  protocolVersion?: number;
  operatorId?: string;
  operatorVersion?: string;
  capabilities?: string[];
  generatedAt?: string;
  expiresAt?: string;
}

export interface HermesWorkspace {
  repo: string;
  branch: string;
}

export interface HermesFilesystemExecutorOptions {
  busRoot: string;
  store: JerichoStore;
  workspace: HermesWorkspace;
  pollIntervalMs?: number;
  maxWaitMs?: number;
  now?: () => string;
}

interface HermesOutboxTask {
  id: string;
  created_at: string;
  source: 'jericho';
  action: 'prompt';
  workspace: HermesWorkspace;
  message: string;
  priority: 'normal';
  on_blocked: 'write_inbox';
  jericho: {
    protocol_version: 1;
    mission_id: string;
    mission_task_id: string;
    assignment_id: string;
    idempotency_key: string;
    evidence_event_ids: string[];
    approved: {
      actions: string[];
      tools: string[];
      writable_scope: MissionPermissions;
      expected_artifact: ArtifactRequirement;
    };
  };
}

interface HermesStopTask {
  id: string;
  created_at: string;
  source: 'jericho';
  action: 'stop';
  workspace: HermesWorkspace;
  message: string;
  priority: 'high';
  on_blocked: 'skip';
  jericho: {
    protocol_version: 1;
    parent_task_id: string;
    assignment_id: string;
    mission_id: string;
    mission_task_id: string;
  };
}

interface HermesResult {
  taskId: string;
  completedAt: string;
  status: 'success' | 'blocked' | 'error' | 'in_progress';
  summary: string;
  error: string | null;
  artifact?: { type: string; data: JsonValue };
  verification?: { checks: string[]; evidence: string[] };
  costs?: HermesCostEvidence[];
}

interface HermesCostEvidence {
  category: CostCategory;
  estimatedMicroUsd: number;
  actualMicroUsd: number;
  evidence: string[];
  provider?: string;
  model?: string;
  tool?: string;
}

export class HermesFilesystemExecutor implements DynamicAssignmentExecutor {
  readonly #busRoot: string;
  readonly #outbox: string;
  readonly #inbox: string;
  readonly #pollIntervalMs: number;
  readonly #maxWaitMs: number;
  readonly #now: () => string;

  constructor(private readonly options: HermesFilesystemExecutorOptions) {
    this.#pollIntervalMs = options.pollIntervalMs ?? 250;
    this.#maxWaitMs = options.maxWaitMs ?? 15 * 60_000;
    if (!Number.isInteger(this.#pollIntervalMs) || this.#pollIntervalMs < 1) {
      throw new TypeError('Hermes poll interval is invalid');
    }
    if (!Number.isInteger(this.#maxWaitMs) || this.#maxWaitMs < this.#pollIntervalMs) {
      throw new TypeError('Hermes maximum wait is invalid');
    }
    this.#now = options.now ?? (() => new Date().toISOString());
    const compatibility = inspectHermesProtocol(options.busRoot, this.#now());
    if (!compatibility.compatible) {
      throw new Error(`Hermes protocol unavailable: ${compatibility.reason}`);
    }
    this.#busRoot = prepareDirectory(options.busRoot);
    this.#outbox = prepareChildDirectory(this.#busRoot, 'outbox');
    this.#inbox = prepareChildDirectory(this.#busRoot, 'inbox');
    assertWorkspace(options.workspace);
  }

  descriptorFor(context: AssignmentExecutionContext): ExecutorDescriptor {
    return {
      model: context.task.model,
      maxTokens: context.task.maxTokens,
      tools: [...context.task.requiredTools],
      writableScope: structuredClone(context.task.writableScope),
      mayCreateAssignments: false,
    };
  }

  async execute(context: AssignmentExecutionContext): Promise<ExecutorResult> {
    this.#assertProtocolCompatible();
    assertApprovedContext(context, this.options.workspace);
    const task = taskFor(context, this.options.workspace);
    assertBusDirectory(this.#busRoot, this.#outbox, 'outbox');
    writeAtomicIdempotent(join(this.#outbox, `${task.id}.json`), canonicalJson(task));

    const started = Date.now();
    try {
      while (Date.now() - started <= this.#maxWaitMs) {
        if (context.signal.aborted) throw abortError(context.signal.reason);
        this.#assertProtocolCompatible();
        assertBusDirectory(this.#busRoot, this.#inbox, 'inbox');
        const resultPath = join(this.#inbox, `${task.id}.json`);
        if (existsSync(resultPath)) {
          const result = readResult(resultPath, task.id);
          if (result.status === 'in_progress') {
            appendLegacyCheckpoint(this.options.store, context, result);
            await wait(this.#pollIntervalMs, context.signal);
            continue;
          }
          if (result.status !== 'success') {
            assertTerminalFailure(result);
            appendResultEvent(this.options.store, context, result);
            throw new Error(`Hermes task ${task.id} ${result.status}: ${result.error ?? result.summary}`);
          }
          if (!result.artifact || !result.verification || !result.costs) {
            appendLegacyCheckpoint(this.options.store, context, result);
            throw new TypeError(
              `Hermes task ${task.id} returned a legacy unverified checkpoint, not a verified result`,
            );
          }
          assertSuccessfulResultMatches(context, result);
          appendResultEvent(this.options.store, context, result);
          return {
            artifact: structuredClone(result.artifact),
            costs: executorCosts(context, result),
          };
        }
        await wait(this.#pollIntervalMs, context.signal);
      }
    } catch (error) {
      if (context.signal.aborted) this.#writeStop(context, task);
      throw error;
    }
    this.#writeStop(context, task);
    throw new Error(`Hermes task ${task.id} exceeded its bounded wait`);
  }

  #writeStop(context: AssignmentExecutionContext, task: HermesOutboxTask): void {
    if (!inspectHermesProtocol(this.#busRoot, this.#now()).compatible) return;
    assertBusDirectory(this.#busRoot, this.#outbox, 'outbox');
    const stop = stopTaskFor(context, task, this.options.workspace);
    writeAtomicIdempotent(join(this.#outbox, `${stop.id}.json`), canonicalJson(stop));
  }

  #assertProtocolCompatible(): void {
    const compatibility = inspectHermesProtocol(this.#busRoot, this.#now());
    if (!compatibility.compatible) {
      throw new Error(`Hermes protocol unavailable: ${compatibility.reason}`);
    }
  }
}

/**
 * Reads the operator-owned, short-lived capability handshake without creating
 * or mutating the bus. Legacy Hermes installations therefore remain visible
 * but cannot receive executable Jericho assignments.
 */
export function inspectHermesProtocol(
  busRoot: string,
  now: string = new Date().toISOString(),
): HermesProtocolCompatibility {
  const absoluteRoot = resolve(busRoot);
  const manifestPath = join(absoluteRoot, HERMES_PROTOCOL_MANIFEST);
  if (!existsSync(manifestPath)) {
    return { compatible: false, reason: 'missing_manifest' };
  }
  try {
    const rootStat = lstatSync(absoluteRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      return { compatible: false, reason: 'invalid_manifest' };
    }
    const value: unknown = JSON.parse(readRegularFile(manifestPath, 64 * 1024));
    if (!isRecord(value)) return { compatible: false, reason: 'invalid_manifest' };
    const protocolVersion = value.protocol_version;
    const operatorId = value.operator_id;
    const operatorVersion = value.operator_version;
    const generatedAt = value.generated_at;
    const expiresAt = value.expires_at;
    const capabilities = value.capabilities;
    const base = {
      ...(typeof protocolVersion === 'number' ? { protocolVersion } : {}),
      ...(typeof operatorId === 'string' ? { operatorId } : {}),
      ...(typeof operatorVersion === 'string' ? { operatorVersion } : {}),
      ...(isStringArray(capabilities) ? { capabilities: [...capabilities].sort() } : {}),
      ...(typeof generatedAt === 'string' ? { generatedAt } : {}),
      ...(typeof expiresAt === 'string' ? { expiresAt } : {}),
    };
    if (
      !Number.isInteger(protocolVersion) ||
      typeof operatorId !== 'string' || !operatorId.trim() ||
      typeof operatorVersion !== 'string' || !operatorVersion.trim() ||
      !isIsoTimestamp(generatedAt) ||
      !isIsoTimestamp(expiresAt) ||
      !isStringArray(capabilities) ||
      !isIsoTimestamp(now)
    ) {
      return { compatible: false, reason: 'invalid_manifest', ...base };
    }
    if (protocolVersion !== TASK_PROTOCOL_VERSION) {
      return { compatible: false, reason: 'unsupported_protocol', ...base };
    }
    if (REQUIRED_PROTOCOL_CAPABILITIES.some((item) => !capabilities.includes(item))) {
      return { compatible: false, reason: 'missing_capability', ...base };
    }
    const nowEpoch = Date.parse(now);
    if (Date.parse(generatedAt) > nowEpoch || Date.parse(expiresAt) <= nowEpoch) {
      return { compatible: false, reason: 'stale_manifest', ...base };
    }
    return { compatible: true, reason: 'compatible', ...base };
  } catch {
    return { compatible: false, reason: 'invalid_manifest' };
  }
}

function assertTerminalFailure(result: HermesResult): void {
  if (result.status === 'error' && (!result.error || result.error.trim().length === 0)) {
    throw new TypeError('Hermes error result must describe its error');
  }
  if (result.artifact || result.verification) {
    throw new TypeError(`Hermes ${result.status} result may not claim a verified artifact`);
  }
}

function assertSuccessfulResultMatches(
  context: AssignmentExecutionContext,
  result: HermesResult,
): void {
  if (result.error !== null) {
    throw new TypeError('Hermes success result may not include an error');
  }
  if (result.artifact?.type !== context.assignment.expectedArtifact.type) {
    throw new TypeError('Hermes result artifact type does not match the assignment');
  }
  if (
    context.assignment.expectedArtifact.verification.some(
      (check) => !result.verification?.checks.includes(check),
    ) ||
    context.assignment.expectedArtifact.requiredEvidence.some(
      (selector) => !result.verification?.evidence.includes(selector),
    )
  ) {
    throw new TypeError('Hermes result verification does not satisfy the assignment');
  }
  const costs = result.costs ?? [];
  if (
    costs.reduce((total, cost) => total + cost.estimatedMicroUsd, 0) !==
      context.assignment.estimatedCostMicroUsd
  ) {
    throw new TypeError('Hermes cost evidence does not match the approved estimate');
  }
  for (const cost of costs) {
    if (cost.category === CostCategory.Model && cost.model !== context.task.model) {
      throw new TypeError('Hermes model cost is outside the approved model');
    }
    if (
      cost.category === CostCategory.Tool &&
      (!cost.tool || !context.task.requiredTools.includes(cost.tool))
    ) {
      throw new TypeError('Hermes tool cost is outside the approved tools');
    }
  }
}

function executorCosts(
  context: AssignmentExecutionContext,
  result: HermesResult,
): ExecutorCost[] {
  return (result.costs ?? []).map((cost, index) => ({
    id: `hermes-cost-${createHash('sha256').update(`${result.taskId}\0${index}`).digest('hex').slice(0, 32)}`,
    category: cost.category,
    estimatedMicroUsd: cost.estimatedMicroUsd,
    actualMicroUsd: cost.actualMicroUsd,
    idempotencyKey: `hermes-cost-key-${createHash('sha256')
      .update(`${context.assignment.idempotencyKey}\0${index}`)
      .digest('hex').slice(0, 32)}`,
    ...(cost.provider ? { provider: cost.provider } : {}),
    ...(cost.model ? { model: cost.model } : {}),
    ...(cost.tool ? { tool: cost.tool } : {}),
  }));
}

export class HermesResultVerifier implements ArtifactVerifier {
  readonly id = 'hermes-result-verifier';

  constructor(private readonly store: JerichoStore) {}

  async verify(context: ArtifactVerificationContext): Promise<ArtifactVerificationResult> {
    const taskId = taskIdFor(context.assignment.idempotencyKey);
    const event = this.store.getEvent(resultEventId(taskId));
    if (!event || !validStoredResult(event, context, taskId)) {
      return { verified: false, checks: [], evidence: [] };
    }
    const payload = event.payload as JsonObject;
    const verification = payload.verification;
    if (!isRecord(verification)) {
      return { verified: false, checks: [], evidence: [] };
    }
    const checks = verification.checks;
    const evidence = verification.evidence;
    if (
      !isStringArray(checks) ||
      !isStringArray(evidence) ||
      context.requirement.verification.some((check) => !checks.includes(check)) ||
      context.requirement.requiredEvidence.some((selector) => !evidence.includes(selector))
    ) {
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

function taskFor(
  context: AssignmentExecutionContext,
  workspace: HermesWorkspace,
): HermesOutboxTask {
  const { assignment, mission, task } = context;
  return {
    id: taskIdFor(assignment.idempotencyKey),
    created_at: assignment.assignedAt,
    source: 'jericho',
    action: 'prompt',
    workspace: structuredClone(workspace),
    message: [
      `Execute approved Jericho assignment ${assignment.id}.`,
      `Execute approved mission task "${task.title}".`,
      `Return artifact type ${assignment.expectedArtifact.type} for task ${task.id}.`,
      'Use only the evidence identifiers, tools, and writable scope in this task descriptor.',
      'Do not create subagents or expand scope.',
    ].join(' '),
    priority: 'normal',
    on_blocked: 'write_inbox',
    jericho: {
      protocol_version: TASK_PROTOCOL_VERSION,
      mission_id: mission.id,
      mission_task_id: task.id,
      assignment_id: assignment.id,
      idempotency_key: assignment.idempotencyKey,
      evidence_event_ids: [...assignment.evidenceEventIds].sort(),
      approved: {
        actions: [...task.requiredActions].sort(),
        tools: [...task.requiredTools].sort(),
        writable_scope: canonicalPermissions(task.writableScope),
        expected_artifact: structuredClone(assignment.expectedArtifact),
      },
    },
  };
}

function stopTaskFor(
  context: AssignmentExecutionContext,
  task: HermesOutboxTask,
  workspace: HermesWorkspace,
): HermesStopTask {
  return {
    id: `${task.id}-stop`,
    created_at: context.assignment.assignedAt,
    source: 'jericho',
    action: 'stop',
    workspace: structuredClone(workspace),
    message: `Stop approved Jericho assignment ${context.assignment.id}.`,
    priority: 'high',
    on_blocked: 'skip',
    jericho: {
      protocol_version: TASK_PROTOCOL_VERSION,
      parent_task_id: task.id,
      assignment_id: context.assignment.id,
      mission_id: context.mission.id,
      mission_task_id: context.task.id,
    },
  };
}

function assertApprovedContext(
  context: AssignmentExecutionContext,
  workspace: HermesWorkspace,
): void {
  const { assignment, mission, task } = context;
  if (assignment.missionId !== mission.id || assignment.missionTaskId !== task.id) {
    throw new TypeError('Hermes assignment context does not match its approved mission task');
  }
  if (task.missionId !== mission.id || assignment.agentId !== task.selectedAgentId) {
    throw new TypeError('Hermes assignment identity is outside the approved mission task');
  }
  if (canonicalJson(assignment.expectedArtifact) !== canonicalJson(task.expectedArtifact)) {
    throw new TypeError('Hermes assignment artifact differs from the approved mission task');
  }
  if (task.requiredActions.some((action) =>
    action === 'spawn' ||
    action.startsWith('spawn.') ||
    action === 'assignment.create' ||
    action.startsWith('assignment.create.')
  )) {
    throw new TypeError('Hermes executor may not spawn recursive workers');
  }
  const approvedEvidence = new Set(task.evidenceEventIds);
  if (assignment.evidenceEventIds.some((eventId) => !approvedEvidence.has(eventId))) {
    throw new TypeError('Hermes assignment contains unapproved evidence');
  }
  if (!task.writableScope.allowedRepositories.some((grant) => grant.repository === workspace.repo)) {
    throw new TypeError(`Hermes workspace ${workspace.repo} is outside the approved task scope`);
  }
  if (assignment.externalAction || task.externalAction) {
    throw new TypeError('Hermes v1 external action receipts are unsupported');
  }
}

function canonicalPermissions(permissions: MissionPermissions): MissionPermissions {
  return {
    allowedTools: [...permissions.allowedTools].sort(),
    allowedSystems: [...permissions.allowedSystems].sort(),
    allowedRepositories: permissions.allowedRepositories
      .map((grant) => ({
        repository: grant.repository,
        writablePaths: [...grant.writablePaths].sort(),
        mutationClasses: [...grant.mutationClasses].sort(),
      }))
      .sort((left, right) => left.repository.localeCompare(right.repository)),
    allowedChannels: [...permissions.allowedChannels].sort(),
    allowedRecipients: [...permissions.allowedRecipients].sort(),
    allowedCredentialRefs: [...permissions.allowedCredentialRefs].sort(),
    allowedDataScopes: [...permissions.allowedDataScopes].sort(),
    allowedMutationClasses: [...permissions.allowedMutationClasses].sort(),
  };
}

function taskIdFor(idempotencyKey: string): string {
  return `jericho-${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32)}`;
}

function appendResultEvent(
  store: JerichoStore,
  context: AssignmentExecutionContext,
  result: HermesResult,
): EventEnvelope {
  const event: EventEnvelope = {
    id: resultEventId(result.taskId),
    source: 'hermes-filesystem',
    sourceType: SourceType.Agent,
    sourceEventId: result.taskId,
    type: 'hermes.assignment_result',
    occurredAt: result.completedAt,
    ingestedAt: result.completedAt,
    payload: {
      assignmentId: context.assignment.id,
      missionId: context.mission.id,
      missionTaskId: context.task.id,
      taskId: result.taskId,
      status: result.status,
      summary: result.summary,
      error: result.error,
      artifact: result.artifact ? structuredClone(result.artifact) : null,
      verification: result.verification ? structuredClone(result.verification) : null,
      costs: result.costs ? structuredClone(result.costs.map((cost) => ({
        category: cost.category,
        estimated_micro_usd: cost.estimatedMicroUsd,
        actual_micro_usd: cost.actualMicroUsd,
        evidence: [...cost.evidence],
        ...(cost.provider ? { provider: cost.provider } : {}),
        ...(cost.model ? { model: cost.model } : {}),
        ...(cost.tool ? { tool: cost.tool } : {}),
      }))) : null,
    },
    status: result.status === 'success'
      ? LifecycleStatus.Succeeded
      : result.status === 'blocked'
        ? LifecycleStatus.Paused
        : LifecycleStatus.Failed,
    route: result.status === 'success' ? RouteType.Agent : RouteType.Blocked,
    risk: context.assignment.risk,
    provenance: [{
      source: 'hermes-filesystem',
      sourceType: SourceType.Agent,
      sourceEventId: result.taskId,
      observedAt: result.completedAt,
    }],
  };
  return store.appendEvent(event).event;
}

function appendLegacyCheckpoint(
  store: JerichoStore,
  context: AssignmentExecutionContext,
  result: HermesResult,
): EventEnvelope {
  const sourceEventId = [
    result.taskId,
    result.status,
    result.completedAt,
    createHash('sha256').update(result.summary).digest('hex').slice(0, 16),
  ].join(':');
  const event: EventEnvelope = {
    id: `hermes-checkpoint-${createHash('sha256').update(sourceEventId).digest('hex').slice(0, 32)}`,
    source: 'hermes-filesystem',
    sourceType: SourceType.Agent,
    sourceEventId,
    type: 'hermes.legacy_result_checkpoint',
    occurredAt: result.completedAt,
    ingestedAt: result.completedAt,
    payload: {
      assignmentId: context.assignment.id,
      missionId: context.mission.id,
      missionTaskId: context.task.id,
      taskId: result.taskId,
      status: result.status,
      summary: result.summary,
      error: result.error,
      verified: false,
      // Never retain an unverified body as a completed artifact. Its declared
      // type is enough for review without projecting private result data.
      artifact: result.artifact ? { type: result.artifact.type } : null,
      verification: null,
    },
    status: LifecycleStatus.PendingApproval,
    route: RouteType.HumanApproval,
    risk: context.assignment.risk,
    provenance: [{
      source: 'hermes-filesystem',
      sourceType: SourceType.Agent,
      sourceEventId,
      observedAt: result.completedAt,
    }],
  };
  return store.appendEvent(event).event;
}

function resultEventId(taskId: string): string {
  return `hermes-result-${createHash('sha256').update(taskId).digest('hex').slice(0, 32)}`;
}

function validStoredResult(
  event: EventEnvelope,
  context: ArtifactVerificationContext,
  taskId: string,
): boolean {
  if (
    event.source !== 'hermes-filesystem' ||
    event.sourceType !== SourceType.Agent ||
    event.sourceEventId !== taskId ||
    event.type !== 'hermes.assignment_result' ||
    event.status !== LifecycleStatus.Succeeded ||
    event.route !== RouteType.Agent ||
    !isRecord(event.payload)
  ) {
    return false;
  }
  const payload = event.payload;
  return payload.assignmentId === context.assignment.id &&
    payload.missionId === context.mission.id &&
    payload.missionTaskId === context.task.id &&
    payload.taskId === taskId &&
    payload.status === 'success' &&
    canonicalJson(payload.artifact) === canonicalJson(context.artifact) &&
    canonicalJson(context.requirement) === canonicalJson(context.assignment.expectedArtifact) &&
    canonicalJson(context.requirement) === canonicalJson(context.task.expectedArtifact);
}

function readResult(path: string, expectedTaskId: string): HermesResult {
  const text = readRegularFile(path, MAX_RESULT_BYTES);
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new TypeError('Hermes result must be an object');
  if (value.task_id !== expectedTaskId) throw new TypeError('Hermes result task does not match');
  if (!isIsoTimestamp(value.completed_at)) throw new TypeError('Hermes result timestamp is invalid');
  if (!['success', 'blocked', 'error', 'in_progress'].includes(String(value.status))) {
    throw new TypeError('Hermes result status is invalid');
  }
  if (typeof value.summary !== 'string' || value.summary.trim().length === 0) {
    throw new TypeError('Hermes result summary is invalid');
  }
  if (value.error !== null && typeof value.error !== 'string') {
    throw new TypeError('Hermes result error is invalid');
  }
  const status = value.status as HermesResult['status'];
  const artifact = parseArtifact(value.artifact);
  const verification = parseVerification(value.verification);
  const costs = parseCosts(value.costs);
  return {
    taskId: value.task_id,
    completedAt: value.completed_at,
    status,
    summary: value.summary,
    error: value.error,
    ...(artifact ? { artifact } : {}),
    ...(verification ? { verification } : {}),
    ...(costs ? { costs } : {}),
  };
}

function parseArtifact(value: unknown): HermesResult['artifact'] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value.type !== 'string' || !Object.hasOwn(value, 'data')) {
    throw new TypeError('Hermes result artifact is invalid');
  }
  return { type: value.type, data: value.data as JsonValue };
}

function parseVerification(value: unknown): HermesResult['verification'] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !isStringArray(value.checks) || !isStringArray(value.evidence)) {
    throw new TypeError('Hermes result verification is invalid');
  }
  return { checks: [...value.checks], evidence: [...value.evidence] };
}

function parseCosts(value: unknown): HermesCostEvidence[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError('Hermes result costs are invalid');
  const categories = new Set(Object.values(CostCategory));
  return value.map((item) => {
    if (!isRecord(item)) throw new TypeError('Hermes result cost is invalid');
    const category = item.category;
    const estimated = item.estimated_micro_usd;
    const actual = item.actual_micro_usd;
    if (
      typeof category !== 'string' || !categories.has(category as CostCategory) ||
      !Number.isSafeInteger(estimated) || (estimated as number) < 0 ||
      !Number.isSafeInteger(actual) || (actual as number) < 0 ||
      !isStringArray(item.evidence) || item.evidence.length === 0
    ) {
      throw new TypeError('Hermes result cost evidence is invalid');
    }
    for (const field of ['provider', 'model', 'tool'] as const) {
      if (item[field] !== undefined && (typeof item[field] !== 'string' || !item[field].trim())) {
        throw new TypeError('Hermes result cost identity is invalid');
      }
    }
    return {
      category: category as CostCategory,
      estimatedMicroUsd: estimated as number,
      actualMicroUsd: actual as number,
      evidence: [...item.evidence],
      ...(typeof item.provider === 'string' ? { provider: item.provider } : {}),
      ...(typeof item.model === 'string' ? { model: item.model } : {}),
      ...(typeof item.tool === 'string' ? { tool: item.tool } : {}),
    };
  });
}

function prepareDirectory(path: string): string {
  const absolute = resolve(path);
  mkdirSync(absolute, { recursive: true, mode: 0o700 });
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new TypeError('Hermes bus root must be a real directory');
  }
  const real = realpathSync(absolute);
  return real;
}

function prepareChildDirectory(root: string, name: 'outbox' | 'inbox'): string {
  const path = join(root, name);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path) {
    throw new TypeError(`Hermes ${name} must be a real directory inside the bus root`);
  }
  return path;
}

function assertBusDirectory(
  root: string,
  path: string,
  name: 'outbox' | 'inbox',
): void {
  const expected = join(root, name);
  const stat = lstatSync(path);
  if (
    path !== expected ||
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    realpathSync(path) !== expected
  ) {
    throw new TypeError(`Hermes ${name} must remain a real directory inside the bus root`);
  }
}

function writeAtomicIdempotent(path: string, body: string): void {
  if (existsSync(path)) {
    if (readRegularFile(path, MAX_RESULT_BYTES) !== body) {
      throw new Error('Hermes idempotency conflict: an existing task has different content');
    }
    return;
  }
  const temporary = join(resolve(path, '..'), `.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, body, { flag: 'wx', mode: 0o600 });
    const descriptor = openSync(temporary, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    try {
      linkSync(temporary, path);
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
      if (readRegularFile(path, MAX_RESULT_BYTES) !== body) {
        throw new Error('Hermes idempotency conflict: a concurrent task differs');
      }
    }
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function readRegularFile(path: string, maxBytes: number): string {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
    throw new TypeError('Hermes bus entry must be a bounded regular file');
  }
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return readFileSync(descriptor, 'utf8');
  } finally {
    closeSync(descriptor);
  }
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value))}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]),
  );
}

function assertWorkspace(workspace: HermesWorkspace): void {
  if (!workspace.repo.trim() || !workspace.branch.trim()) {
    throw new TypeError('Hermes workspace repository and branch are required');
  }
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function abortError(reason: unknown): Error {
  return reason instanceof Error
    ? reason
    : new DOMException('Hermes execution was aborted', 'AbortError');
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolveWait, rejectWait) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      cleanup();
      rejectWait(abortError(signal.reason));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      cleanup();
      resolveWait();
    }, ms);
  });
}
