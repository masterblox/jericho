import { createHash } from 'node:crypto';

import {
  IndexLifecycleStatus,
  KnowledgeDestination,
  KnowledgeSensitivity,
  LifecycleStatus,
  ReceiptStatus,
  SourceType,
  type ActionReceipt,
  type DecisionRecord,
  type EvaluationRun,
  type EventEnvelope,
  type IndexVersion,
  type JsonObject,
  type KnowledgePackage,
  type KnowledgeProjection,
  type MissionPlan,
  type MissionTask,
  type ProjectionReceipt,
  type RetrievalMetrics,
} from '@jericho/shared';

const SOURCE = 'jericho:knowledge-v1';

export interface FleetKnowledgeStore {
  getMission(id: string): MissionPlan | undefined;
  listMissionTasks(missionId: string): MissionTask[];
  listReceipts(): ActionReceipt[];
  listDecisions(missionId?: string): DecisionRecord[];
  getEvent(id: string): EventEnvelope | undefined;
  listEvents(options?: { source?: string; limit?: number }): EventEnvelope[];
  appendEvent(event: EventEnvelope): unknown;
}

export class FleetKnowledgeService {
  constructor(
    private readonly store: FleetKnowledgeStore,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  createPackage(missionId: string): KnowledgePackage {
    const existing = this.listPackages().find((item) => item.missionId === missionId);
    if (existing) return existing;
    const mission = this.store.getMission(missionId);
    if (!mission || mission.status !== LifecycleStatus.Succeeded || !mission.completedAt) {
      throw new Error(`Mission ${missionId} is not verified and succeeded`);
    }
    const tasks = this.store.listMissionTasks(missionId);
    if (!tasks.length || tasks.some((task) => task.status !== LifecycleStatus.Succeeded || !verifiedTaskEvidence(task).length)) {
      throw new Error(`Mission ${missionId} requires verified task evidence`);
    }
    const taskIds = new Set(tasks.map((task) => task.id));
    const receipts = this.store.listReceipts().filter((receipt) => receipt.missionTaskId && taskIds.has(receipt.missionTaskId));
    for (const task of tasks) {
      if (task.externalAction && !receipts.some((receipt) => receipt.missionTaskId === task.id && verifiedReceipt(receipt))) {
        throw new Error(`Mission ${missionId} requires verified external receipts`);
      }
    }
    if (receipts.some((receipt) => !verifiedReceipt(receipt))) {
      throw new Error(`Mission ${missionId} contains an unverified external receipt`);
    }
    const decisions = this.store.listDecisions(missionId);
    const evidence = unique([
      ...mission.evidenceEventIds,
      ...tasks.flatMap(verifiedTaskEvidence),
      ...receipts.flatMap((receipt) => receipt.evidenceEventIds),
      ...decisions.flatMap((decision) => decision.evidenceEventIds),
    ]).map((eventId) => ({ eventId }));
    const createdAt = new Date(this.clock()).toISOString();
    const material = {
      missionId: mission.id,
      planHash: mission.planHash,
      title: mission.title,
      objective: mission.objective,
      deliverables: mission.deliverables.map((item) => item.description),
      outcomeTaskIds: tasks.map((task) => task.id).sort(),
      decisionIds: decisions.map((decision) => decision.id).sort(),
      receiptIds: receipts.map((receipt) => receipt.id).sort(),
      decisions: decisions.map((decision) => ({
        id: decision.id, outcome: decision.outcome, rationale: decision.rationale,
        decidedBy: decision.decidedBy, decidedAt: decision.decidedAt,
      })),
      outcomes: tasks.map((task) => ({
        taskId: task.id, status: task.status, completedAt: task.completedAt!,
      })),
      receipts: receipts.map((receipt) => ({
        id: receipt.id,
        connectorId: receipt.connectorId ?? 'local',
        action: receipt.action,
        destination: receipt.destination,
        externalId: receipt.externalId!,
      })),
      evidence,
      completedAt: mission.completedAt,
    };
    const packageHash = digest(material);
    const knowledge: KnowledgePackage = {
      id: `knowledge-${packageHash}`,
      version: 1,
      packageHash,
      ...material,
      classification: ['verified-mission'],
      sensitivity: KnowledgeSensitivity.Private,
      retentionPolicy: 'verified-mission-v1',
      createdAt,
    };
    this.persist('package', knowledge.id, knowledge, createdAt);
    return knowledge;
  }

  listPackages(): KnowledgePackage[] {
    return this.records<KnowledgePackage>('package');
  }

  createProjection(
    packageId: string,
    destination: KnowledgeDestination,
    approvedFieldNames: string[],
    redactedFieldNames: string[] = [],
  ): KnowledgeProjection {
    const knowledge = this.listPackages().find((item) => item.id === packageId);
    if (!knowledge) throw new Error(`Knowledge package ${packageId} does not exist`);
    if (destination === KnowledgeDestination.Notion && !approvedFieldNames.length) {
      throw new Error('Notion projection requires an explicit field allowlist');
    }
    const createdAt = new Date(this.clock()).toISOString();
    const id = `projection-${digest({ packageId, destination, approvedFieldNames: [...approvedFieldNames].sort() })}`;
    const projection: KnowledgeProjection = {
      id, packageId, packageHash: knowledge.packageHash, destination,
      status: destination === KnowledgeDestination.Obsidian
        ? LifecycleStatus.Approved
        : LifecycleStatus.PendingApproval,
      approvedFieldNames: unique(approvedFieldNames),
      redactedFieldNames: unique(redactedFieldNames),
      createdAt,
      ...(destination === KnowledgeDestination.Obsidian ? { approvedAt: createdAt } : {}),
    };
    this.persist('projection', id, projection, createdAt);
    return projection;
  }

  listProjections(): KnowledgeProjection[] {
    const values = new Map(this.records<KnowledgeProjection>('projection').map((item) => [item.id, item]));
    for (const item of this.records<KnowledgeProjection>('projection-approval').reverse()) values.set(item.id, item);
    return [...values.values()];
  }

  approveProjection(id: string): KnowledgeProjection {
    const projection = this.listProjections().find((item) => item.id === id);
    if (!projection) throw new Error(`Projection ${id} does not exist`);
    if (projection.destination !== KnowledgeDestination.Notion) throw new Error('Only Notion projections require approval');
    if (projection.status === LifecycleStatus.Approved) return projection;
    const approvedAt = new Date(this.clock()).toISOString();
    const approved = { ...projection, status: LifecycleStatus.Approved, approvedAt };
    this.persist('projection-approval', `${id}:${approvedAt}`, approved, approvedAt);
    return approved;
  }

  recordProjectionReceipt(receipt: ProjectionReceipt): ProjectionReceipt {
    const projection = this.listProjections().find((item) => item.id === receipt.projectionId);
    if (!projection || projection.packageId !== receipt.packageId || projection.packageHash !== receipt.packageHash) {
      throw new Error('Projection receipt binding does not match');
    }
    if (receipt.verified && receipt.status !== ReceiptStatus.Succeeded) {
      throw new Error('Only succeeded projection receipts may be verified');
    }
    this.persist('projection-receipt', receipt.id, receipt, receipt.attemptedAt);
    return receipt;
  }

  listProjectionReceipts(): ProjectionReceipt[] {
    return this.records<ProjectionReceipt>('projection-receipt');
  }

  recordIndex(index: IndexVersion): IndexVersion {
    validateIndex(index);
    this.persist('index', index.id, index, index.createdAt);
    return index;
  }

  listIndexes(): IndexVersion[] {
    const values = new Map(this.records<IndexVersion>('index').map((item) => [item.id, item]));
    for (const item of this.records<IndexVersion>('index-state').reverse()) values.set(item.id, item);
    return [...values.values()];
  }

  evaluateCandidate(candidateId: string, benchmarkVersion: string): EvaluationRun {
    const indexes = this.listIndexes();
    const candidate = indexes.find((item) => item.id === candidateId);
    if (!candidate || candidate.status !== IndexLifecycleStatus.Candidate) throw new Error('Candidate index is unavailable');
    const active = indexes.find((item) => item.collection === candidate.collection && item.status === IndexLifecycleStatus.Active);
    const reasons = evaluationReasons(candidate.metrics, active?.metrics);
    const completedAt = new Date(this.clock()).toISOString();
    const evaluation: EvaluationRun = {
      id: `evaluation-${digest({ candidateId, benchmarkVersion, completedAt })}`,
      candidateIndexId: candidate.id,
      ...(active ? { activeIndexId: active.id, baselineMetrics: active.metrics } : {}),
      benchmarkVersion,
      candidateMetrics: candidate.metrics,
      passed: reasons.length === 0,
      privacyPassed: candidate.metrics.evidenceCoverage === 1,
      reasons,
      completedAt,
    };
    this.persist('evaluation', evaluation.id, evaluation, completedAt);
    return evaluation;
  }

  evaluateAndPromote(candidateId: string, benchmarkVersion: string): {
    evaluation: EvaluationRun;
    promoted?: IndexVersion;
  } {
    const evaluation = this.evaluateCandidate(candidateId, benchmarkVersion);
    return evaluation.passed && evaluation.privacyPassed
      ? { evaluation, promoted: this.promoteCandidate(candidateId) }
      : { evaluation };
  }

  listEvaluations(): EvaluationRun[] {
    return this.records<EvaluationRun>('evaluation');
  }

  recordPaperclip(record: import('@jericho/shared').PaperclipReconciliation): import('@jericho/shared').PaperclipReconciliation {
    this.persist('paperclip', `${record.id}:${record.lastObservedAt}`, record, record.lastObservedAt);
    return record;
  }

  listPaperclip(): import('@jericho/shared').PaperclipReconciliation[] {
    const values = new Map<string, import('@jericho/shared').PaperclipReconciliation>();
    for (const item of this.records<import('@jericho/shared').PaperclipReconciliation>('paperclip').reverse()) {
      values.set(item.id, item);
    }
    return [...values.values()];
  }

  promoteCandidate(candidateId: string): IndexVersion {
    const indexes = this.listIndexes();
    const candidate = indexes.find((item) => item.id === candidateId);
    if (!candidate || candidate.status !== IndexLifecycleStatus.Candidate) throw new Error('Candidate index is unavailable');
    const evaluation = this.listEvaluations()
      .filter((item) => item.candidateIndexId === candidateId)
      .sort((left, right) => right.completedAt.localeCompare(left.completedAt))[0];
    if (!evaluation?.passed || !evaluation.privacyPassed) throw new Error('Candidate index has not passed evaluation');
    const promotedAt = new Date(this.clock()).toISOString();
    for (const active of indexes.filter((item) => item.collection === candidate.collection && item.status === IndexLifecycleStatus.Active)) {
      this.persist('index-state', `${active.id}:superseded:${promotedAt}`, {
        ...active, status: IndexLifecycleStatus.Superseded,
      }, promotedAt);
    }
    const promoted = { ...candidate, status: IndexLifecycleStatus.Active, promotedAt };
    this.persist('index-state', `${candidate.id}:active:${promotedAt}`, promoted, promotedAt);
    return promoted;
  }

  rollbackIndex(activeId: string): IndexVersion {
    const indexes = this.listIndexes();
    const active = indexes.find((item) => item.id === activeId && item.status === IndexLifecycleStatus.Active);
    if (!active?.supersedesId) throw new Error('Active index has no rollback target');
    const previous = indexes.find((item) => item.id === active.supersedesId);
    if (!previous) throw new Error('Rollback index is unavailable');
    const at = new Date(this.clock()).toISOString();
    this.persist('index-state', `${active.id}:rolled-back:${at}`, { ...active, status: IndexLifecycleStatus.RolledBack }, at);
    const restored = { ...previous, status: IndexLifecycleStatus.Active, promotedAt: at };
    this.persist('index-state', `${previous.id}:restored:${at}`, restored, at);
    return restored;
  }

  private records<T>(kind: string): T[] {
    return this.store.listEvents({ source: SOURCE, limit: 10_000 })
      .filter((event) => event.type === `jericho.knowledge.${kind}`)
      .map((event) => payloadRecord(event) as unknown as T);
  }

  private persist(kind: string, id: string, record: object, occurredAt: string): void {
    const eventId = `${kind}-${digest({ id })}`;
    const existing = this.store.getEvent(eventId);
    if (existing) {
      if (digest(payloadRecord(existing)) !== digest(record)) throw new Error(`${kind} ${id} conflicts with persisted Core truth`);
      return;
    }
    this.store.appendEvent({
      id: eventId,
      source: SOURCE,
      sourceType: SourceType.System,
      sourceEventId: `${kind}:${id}`,
      type: `jericho.knowledge.${kind}`,
      occurredAt,
      ingestedAt: occurredAt,
      payload: { record: record as JsonObject },
      provenance: [{ source: SOURCE, sourceType: SourceType.System, sourceEventId: `${kind}:${id}`, observedAt: occurredAt }],
    });
  }
}

function payloadRecord(event: EventEnvelope): unknown {
  if (!isRecord(event.payload) || !Object.hasOwn(event.payload, 'record')) {
    throw new Error(`Knowledge event ${event.id} is malformed`);
  }
  return event.payload.record;
}

function evaluationReasons(candidate: RetrievalMetrics, baseline?: RetrievalMetrics): string[] {
  const reasons: string[] = [];
  if (candidate.evidenceCoverage !== 1) reasons.push('evidence_coverage_regressed');
  if (candidate.freshness < 0.8) reasons.push('freshness_below_threshold');
  if (candidate.latencyMs > 1_500) reasons.push('latency_above_threshold');
  if (baseline) {
    if (candidate.quality <= baseline.quality) reasons.push('quality_not_improved');
    if (candidate.duplicateRate > baseline.duplicateRate) reasons.push('duplicate_rate_regressed');
    if (candidate.contradictionRate > baseline.contradictionRate) reasons.push('contradiction_rate_regressed');
  }
  return reasons;
}

function validateIndex(index: IndexVersion): void {
  if (!index.id?.trim() || !Number.isInteger(index.version) || index.version < 1
    || !/^[a-f0-9]{64}$/u.test(index.configurationHash)
    || !Object.values(IndexLifecycleStatus).includes(index.status)
    || !Number.isFinite(Date.parse(index.createdAt))) throw new Error('Index version is invalid');
  for (const value of [
    index.metrics.quality, index.metrics.freshness, index.metrics.duplicateRate,
    index.metrics.contradictionRate, index.metrics.evidenceCoverage,
  ]) if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Index metrics are invalid');
  if (!Number.isFinite(index.metrics.latencyMs) || index.metrics.latencyMs < 0) throw new Error('Index latency is invalid');
}

function verifiedReceipt(receipt: ActionReceipt): boolean {
  return receipt.status === ReceiptStatus.Succeeded && receipt.verified === true &&
    Boolean(receipt.externalId) && receipt.evidenceEventIds.length > 0;
}

function verifiedTaskEvidence(task: MissionTask): string[] {
  if (!isRecord(task.output) || task.output.verified !== true || !Array.isArray(task.output.evidence)) return [];
  return task.output.evidence.flatMap((entry) => isRecord(entry) && typeof entry.eventId === 'string' ? [entry.eventId] : []);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortValue(value))).digest('hex');
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  return value;
}
