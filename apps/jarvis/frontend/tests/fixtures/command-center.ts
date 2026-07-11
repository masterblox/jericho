import type { CommandCenterSnapshot } from '../../src/command-center-types';

export const emptySnapshot: CommandCenterSnapshot = {
  revision: 'revision-0',
  generatedAt: '2026-07-11T00:00:00.000Z',
  today: {
    date: '2026-07-11', taskIds: [], commitmentIds: [],
    activeMissionIds: [], pendingApprovalIds: [],
  },
  tasks: [],
  communications: [],
  people: [],
  commitments: [],
  missions: [],
  approvals: [],
  proposals: [],
  activeAssignments: [],
  outcomes: [],
  receipts: [],
  history: [],
  connectors: [],
  captureFailures: [],
  lastChangeSequence: 0,
  nucleus: { nodes: [], edges: [], activityPulses: [] },
};

export function snapshot(overrides: Partial<CommandCenterSnapshot> = {}): CommandCenterSnapshot {
  return {
    ...emptySnapshot,
    ...overrides,
    revision: overrides.revision ?? `revision-${overrides.lastChangeSequence ?? 0}`,
  };
}
