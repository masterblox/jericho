export type {
  ActionDescriptor,
  CommandCenterApproval,
  CommandCenterEntityCard,
  CommandCenterMission,
  CommandCenterMissionTask,
  CommandCenterNucleus,
  CommandCenterOutcome,
  CommandCenterSnapshot,
  CommandCenterTimelineEntry,
  MissionDecisionRequest,
  MissionDecisionResponse,
  NucleusActivityPulse,
  NucleusEdge,
  NucleusNode,
} from '@jericho/shared';

import type { CommandCenterSnapshot } from '@jericho/shared';

export interface CommandCenterPatch {
  sequence: number;
  patch: Partial<Omit<CommandCenterSnapshot, 'lastChangeSequence'>>;
}

export type CommandCenterConnectionStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'disconnected'
  | 'unavailable';

export interface CommandCenterState {
  status: CommandCenterConnectionStatus;
  snapshot?: CommandCenterSnapshot;
  error?: string;
  needsRefetch: boolean;
}
