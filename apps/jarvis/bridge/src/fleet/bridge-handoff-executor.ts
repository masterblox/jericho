import { mkdirSync, writeFileSync, readdirSync, readFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import {
  MutationClass,
  ReceiptStatus,
  SourceType,
  type EventEnvelope,
  type ExternalActionSpec,
  type JsonObject,
  type MissionTask,
} from '@jericho/shared';

import type { JerichoStore } from '../core/store.js';
import {
  appendConnectorDeliveryEvent,
  type ApprovedConnectorExecutionResult,
  type ApprovedConnectorSendInput,
  type ConnectorActionAdapter,
  validateApprovedConnectorSend,
} from '../orchestration/connector-action-executor.js';
import type { PaperclipPort } from '../connectors/paperclip-executor.js';
import { paperclipKey } from '../connectors/paperclip-executor.js';
import type { FleetLaneRegistry } from './lane-registry.js';
import { paperclipTitleForLane } from './lane-registry.js';

export const FLEET_BRIDGE_BINDING = {
  connectorId: 'fleet-bridge',
  action: 'write_handoff',
  system: 'conductor-bridge',
  channel: 'filesystem',
  tool: 'fleet.bridge.write',
  credentialRef: 'fleet-bridge',
  dataScope: 'fleet:bridge',
  mutationClass: MutationClass.Reversible,
} as const;

export interface BridgeHandoffExecutorOptions {
  registry: FleetLaneRegistry;
  paperclip?: PaperclipPort;
  now?: () => string;
}

/**
 * Durable fleet dispatch: write a conductor-bridge handoff and optionally
 * create a Paperclip `[lane]` issue. Implements ConnectorActionAdapter so
 * MissionRunner receipts stay exact-plan bound.
 */
export class BridgeHandoffExecutor implements ConnectorActionAdapter {
  readonly descriptor = { id: 'fleet-bridge' as const };
  readonly #registry: FleetLaneRegistry;
  readonly #paperclip?: PaperclipPort;

  constructor(options: BridgeHandoffExecutorOptions) {
    this.#registry = options.registry;
    this.#paperclip = options.paperclip;
  }

  async executeApproved(
    store: JerichoStore,
    input: ApprovedConnectorSendInput,
  ): Promise<ApprovedConnectorExecutionResult> {
    const bridgeRoot = this.#registry.bridgeRoot;
    if (!bridgeRoot) throw new Error('Fleet bridge root is not configured');

    const bound = validateApprovedConnectorSend(store, input, FLEET_BRIDGE_BINDING);
    const { receipt, assignment, mission, task } = bound;
    if (receipt.status !== ReceiptStatus.Pending || receipt.startedAt) {
      throw new Error('Fleet bridge receipt is uncertain; refusing to rewrite');
    }
    store.startReceipt(receipt.id, input.now);

    const target = this.#registry.target(task.lane);
    if (!target) throw new Error(`No fleet lane target for ${task.lane}`);

    const outbox = join(bridgeRoot, 'outbox', target.bridgeHandoffDir);
    mkdirSync(outbox, { recursive: true });
    const fileName = `${assignment.id.replace(/[^a-zA-Z0-9._-]+/g, '_')}.md`;
    const filePath = join(outbox, fileName);
    const body = [
      `# Jericho Core handoff → ${target.label}`,
      '',
      `- Mission: \`${mission.id}\``,
      `- Assignment: \`${assignment.id}\``,
      `- Plan: \`${mission.planHash}\``,
      `- Lane: ${target.label} (\`${task.lane}\`)`,
      '',
      '## Objective',
      '',
      input.text.trim(),
      '',
      '## Protocol',
      '',
      '- Stay within approved scope.',
      `- Write replies under \`outbox/jericho-replies/\` referencing assignment \`${assignment.id}\`.`,
      '',
    ].join('\n');
    writeFileSync(filePath, body, 'utf8');

    let paperclipIssueId: string | undefined;
    if (this.#paperclip) {
      const missionTask = {
        id: task.id,
        missionId: mission.id,
        title: task.title,
      } as MissionTask;
      const key = paperclipKey(mission, missionTask, assignment);
      const existing = await this.#paperclip.findByIdempotencyKey(key, input.signal);
      const issue = existing ?? await this.#paperclip.createIssue({
        title: paperclipTitleForLane(task.lane, task.title),
        description: input.text.trim(),
        idempotencyKey: key,
        metadata: {
          missionId: mission.id,
          missionTaskId: task.id,
          assignmentId: assignment.id,
          planHash: mission.planHash,
          planVersion: mission.version,
          dispatchMode: 'hybrid_durable',
        },
      }, input.signal);
      paperclipIssueId = issue.id;
    }

    const result: JsonObject = {
      path: filePath,
      lane: task.lane,
      label: target.label,
      ...(paperclipIssueId ? { paperclipIssueId } : {}),
      dispatchMode: 'hybrid_durable',
    };
    const externalId = createHash('sha256').update(`${assignment.id}\0${filePath}`).digest('hex').slice(0, 32);
    const event = appendConnectorDeliveryEvent(store, {
      connectorId: this.descriptor.id,
      assignment,
      mission,
      task,
      receipt,
      recipient: input.recipient,
      text: input.text,
      externalId,
      result,
      occurredAt: input.now,
    });
    return { externalId, result, evidenceEventIds: [event.id] };
  }
}

export interface BridgeReplyCaptureOptions {
  bridgeRoot: string;
  store: JerichoStore;
  now?: () => string;
}

/** Ingest jericho-replies/*.md into Core as immutable capture events. */
export function captureBridgeReplies(options: BridgeReplyCaptureOptions): number {
  const repliesDir = join(options.bridgeRoot, 'outbox', 'jericho-replies');
  if (!existsSync(repliesDir)) return 0;
  const doneDir = join(repliesDir, 'done');
  mkdirSync(doneDir, { recursive: true });
  const now = options.now ?? (() => new Date().toISOString());
  let count = 0;
  for (const name of readdirSync(repliesDir)) {
    if (!name.endsWith('.md') && !name.endsWith('.json')) continue;
    const path = join(repliesDir, name);
    const text = readFileSync(path, 'utf8');
    const assignmentMatch = text.match(/assignment[`:\s]+([a-zA-Z0-9:_-]+)/i);
    const assignmentId = assignmentMatch?.[1] ?? name.replace(/\.(md|json)$/u, '');
    const eventId = `fleet-bridge-reply-${createHash('sha256').update(`${path}\0${text}`).digest('hex').slice(0, 24)}`;
    if (options.store.getEvent(eventId)) {
      renameSync(path, join(doneDir, name));
      continue;
    }
    const occurredAt = now();
    const event: EventEnvelope = {
      id: eventId,
      source: 'fleet:bridge-replies',
      sourceType: SourceType.System,
      sourceEventId: name,
      type: 'fleet.bridge_reply',
      occurredAt,
      ingestedAt: occurredAt,
      payload: {
        assignmentId,
        fileName: name,
        text,
      },
      provenance: [{
        source: 'fleet:bridge-replies',
        sourceType: SourceType.System,
        observedAt: occurredAt,
      }],
    };
    options.store.appendEvent(event);
    renameSync(path, join(doneDir, name));
    count += 1;
  }
  return count;
}

export function fleetBridgeExternalAction(input: {
  destination: string;
  recipient: string;
  idempotencyKey: string;
}): ExternalActionSpec {
  return {
    connectorId: FLEET_BRIDGE_BINDING.connectorId,
    action: FLEET_BRIDGE_BINDING.action,
    destination: input.destination,
    idempotencyKey: input.idempotencyKey,
    system: FLEET_BRIDGE_BINDING.system,
    channel: FLEET_BRIDGE_BINDING.channel,
    recipient: input.recipient,
    tool: FLEET_BRIDGE_BINDING.tool,
    credentialRef: FLEET_BRIDGE_BINDING.credentialRef,
    dataScope: FLEET_BRIDGE_BINDING.dataScope,
    mutationClass: FLEET_BRIDGE_BINDING.mutationClass,
  };
}

export function telegramWakeExternalAction(input: {
  recipient: string;
  idempotencyKey: string;
}): ExternalActionSpec {
  return {
    connectorId: 'telegram',
    action: 'send_message',
    destination: input.recipient,
    idempotencyKey: input.idempotencyKey,
    system: 'telegram',
    channel: 'telegram',
    recipient: input.recipient,
    tool: 'telegram.send',
    credentialRef: 'telegram-gateway',
    dataScope: 'telegram:selected',
    mutationClass: MutationClass.Reversible,
  };
}
