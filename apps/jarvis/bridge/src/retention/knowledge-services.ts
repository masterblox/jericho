import { createHash } from 'node:crypto';

import {
  LifecycleStatus,
  ProposalKind,
  ReceiptStatus,
  RouteType,
  SourceType,
  type ActionReceipt,
  type DecisionRecord,
  type EventEnvelope,
  type IntentEnvelope,
  type JsonObject,
  type MissionPlan,
  type MissionTask,
  type Proposal,
} from '@jericho/shared';

import {
  ReflectionEngine,
  type ReflectionSuggestion,
} from '../reflection/reflection-engine.js';
import {
  ObsidianRetentionWriter,
  type RetentionWriteResult,
  type VerifiedMissionKnowledge,
} from './obsidian-writer.js';

export interface MissionKnowledgeStore {
  getMission(id: string): MissionPlan | undefined;
  listMissionTasks(missionId: string): MissionTask[];
  listReceipts(): ActionReceipt[];
  listDecisions(missionId?: string): DecisionRecord[];
  appendEvent(event: EventEnvelope): unknown;
  getEvent(id: string): EventEnvelope | undefined;
}

/** Builds the narrow verified projection accepted by ObsidianRetentionWriter. */
export class MissionKnowledgeRetentionService {
  constructor(
    private readonly store: MissionKnowledgeStore,
    private readonly writer: ObsidianRetentionWriter,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  retainMission(missionId: string): RetentionWriteResult {
    const mission = this.store.getMission(missionId);
    if (
      !mission || mission.status !== LifecycleStatus.Succeeded ||
      !mission.completedAt
    ) {
      throw new Error(`Mission ${missionId} is not a verified completed mission`);
    }
    const tasks = this.store.listMissionTasks(mission.id);
    if (!tasks.length || tasks.some((task) =>
      task.status !== LifecycleStatus.Succeeded || !task.completedAt || !verifiedTaskEvidence(task).length
    )) {
      throw new Error(`Mission ${missionId} requires verified mission tasks and evidence`);
    }
    const taskIds = new Set(tasks.map((task) => task.id));
    const receipts = this.store.listReceipts().filter((receipt) =>
      receipt.missionTaskId && taskIds.has(receipt.missionTaskId),
    );
    if (receipts.some((receipt) => !verifiedReceipt(receipt))) {
      throw new Error(`Mission ${missionId} requires verified external receipts`);
    }
    for (const task of tasks) {
      if (task.externalAction && !receipts.some((receipt) =>
        receipt.missionTaskId === task.id && verifiedReceipt(receipt),
      )) {
        throw new Error(`Mission ${missionId} requires verified external receipts`);
      }
    }
    const decisions = this.store.listDecisions(mission.id);
    const taskEvidence = tasks.flatMap(verifiedTaskEvidence);
    const evidenceEventIds = unique([
      ...mission.evidenceEventIds,
      ...taskEvidence,
      ...receipts.flatMap((receipt) => receipt.evidenceEventIds),
      ...decisions.flatMap((decision) => decision.evidenceEventIds),
    ]);
    const knowledge: VerifiedMissionKnowledge = {
      missionId: mission.id,
      planHash: mission.planHash,
      title: mission.title,
      objective: mission.objective,
      completedAt: mission.completedAt,
      deliverables: mission.deliverables.map((deliverable) => deliverable.description),
      decisions: decisions.map((decision) => ({
        outcome: decision.outcome,
        rationale: decision.rationale,
        decidedBy: decision.decidedBy,
        decidedAt: decision.decidedAt,
        evidenceEventIds: [...decision.evidenceEventIds],
      })),
      outcomes: tasks.map((task) => ({
        taskId: task.id,
        status: task.status,
        completedAt: task.completedAt!,
        evidenceEventIds: verifiedTaskEvidence(task),
      })),
      receipts: receipts.map((receipt) => ({
        action: receipt.action,
        destination: receipt.destination,
        connectorId: receipt.connectorId ?? 'local',
        status: receipt.status,
        verified: receipt.verified,
        ...(receipt.externalId ? { externalId: receipt.externalId } : {}),
        evidenceEventIds: [...receipt.evidenceEventIds],
      })),
      evidenceEventIds,
    };
    const retained = this.writer.write(knowledge);
    const retainedAt = new Date(this.clock()).toISOString();
    const sourceEventId = `retention:${mission.id}:${mission.planHash}`;
    const eventId = `retention-${createHash('sha256').update(sourceEventId).digest('hex')}`;
    if (!this.store.getEvent(eventId)) this.store.appendEvent({
      id: eventId,
      source: 'jericho:retention',
      sourceType: SourceType.System,
      sourceEventId,
      type: 'jericho.retention.completed',
      occurredAt: retainedAt,
      ingestedAt: retainedAt,
      payload: {
        missionId: mission.id,
        planHash: mission.planHash,
        relativePath: retained.relativePath,
        status: retained.status,
      },
      provenance: [{
        source: 'jericho:retention',
        sourceType: SourceType.System,
        sourceEventId,
        observedAt: retainedAt,
      }],
    });
    return retained;
  }
}

export interface ReflectionReviewStore {
  listIntents(): IntentEnvelope[];
  listMissions(): MissionPlan[];
  listDecisions(): DecisionRecord[];
  getProposal(id: string): Proposal | undefined;
  saveProposal(proposal: Proposal): Proposal;
}

/** Persists reflection findings as pending proposals; it cannot decide them. */
export class ReflectionReviewService {
  readonly #engine = new ReflectionEngine();

  constructor(private readonly store: ReflectionReviewStore) {}

  runOnce(observedAt = new Date().toISOString()): Proposal[] {
    const suggestions = this.#engine.reflect({
      intents: this.store.listIntents(),
      missions: this.store.listMissions(),
      decisions: this.store.listDecisions(),
    }, observedAt);
    return this.publish(suggestions);
  }

  /** Publish scheduler-produced suggestions without granting decision authority. */
  publish(suggestions: readonly ReflectionSuggestion[]): Proposal[] {
    return suggestions.map((suggestion) => this.#publish(suggestion));
  }

  #publish(suggestion: ReflectionSuggestion): Proposal {
    const existing = this.store.getProposal(suggestion.id);
    if (existing) return existing;
    return this.store.saveProposal({
      id: suggestion.id,
      proposedByAgentId: 'jericho-reflection-v1',
      kind: ProposalKind.DataChange,
      summary: suggestion.summary,
      body: {
        kind: suggestion.kind,
        recordIds: [...suggestion.recordIds],
        evidenceEventIds: [...suggestion.evidenceEventIds],
        autoResolution: false,
        observedAt: suggestion.observedAt,
      } as JsonObject,
      status: LifecycleStatus.PendingApproval,
      route: RouteType.HumanApproval,
      risk: suggestion.risk,
      createdAt: suggestion.observedAt,
      provenance: [{
        source: 'jericho-reflection-v1',
        sourceType: SourceType.System,
        sourceEventId: suggestion.id,
        observedAt: suggestion.observedAt,
      }],
    });
  }
}

function verifiedReceipt(receipt: ActionReceipt): boolean {
  return receipt.status === ReceiptStatus.Succeeded && receipt.verified === true &&
    Boolean(receipt.externalId) && receipt.evidenceEventIds.length > 0;
}

function verifiedTaskEvidence(task: MissionTask): string[] {
  if (!isRecord(task.output) || task.output.verified !== true || !Array.isArray(task.output.evidence)) {
    return [];
  }
  return unique(task.output.evidence.flatMap((entry) =>
    isRecord(entry) && typeof entry.eventId === 'string' && entry.eventId.trim()
      ? [entry.eventId]
      : [],
  ));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}
