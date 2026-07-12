import type { AgentLane } from '@jericho/shared';

import type { FleetLaneTarget } from './lane-registry.js';

export interface FleetWakeComposerInput {
  lane: AgentLane;
  laneLabel: string;
  missionId: string;
  assignmentId: string;
  planHash: string;
  objective: string;
  constraints?: string[];
}

/** Carlos-equivalent structured wake for a Hermes lane bot. */
export function composeFleetWakeText(input: FleetWakeComposerInput): string {
  const constraints = (input.constraints ?? [])
    .map((line) => `- ${line}`)
    .join('\n');
  return [
    `[Jericho Core → ${input.laneLabel}]`,
    `Mission: ${input.missionId}`,
    `Assignment: ${input.assignmentId}`,
    `Plan: ${input.planHash.slice(0, 12)}`,
    '',
    'Objective:',
    input.objective.trim(),
    ...(constraints ? ['', 'Constraints:', constraints] : []),
    '',
    'Reply in this chat with status and artifacts. Do not expand scope.',
  ].join('\n');
}

export function wakeRecipient(target: FleetLaneTarget): string | undefined {
  return target.telegramRecipient;
}
