export const JERICHO_APPROVAL_GESTURE_EVENT = 'jericho:approval-gesture';
export const JERICHO_CANCEL_PENDING_EVENT = 'jericho:cancel-pending';
export const JERICHO_NUCLEUS_CAMERA_EVENT = 'jericho:nucleus-camera';
export const JERICHO_NUCLEUS_DEPTH_EVENT = 'jericho:nucleus-depth';

export interface ApprovalGestureDetail {
  outcome: 'approved' | 'rejected';
  missionId: string;
  planHash: string;
  version: number;
}

export interface CancelPendingDetail {
  source: 'both-open-palms' | 'keyboard';
}

export type NucleusCameraDetail =
  | { phase: 'start'; point: { x: number; y: number } }
  | { phase: 'move'; point: { x: number; y: number }; delta: { x: number; y: number } }
  | { phase: 'end'; cancelled: boolean };

export interface NucleusDepthDetail {
  delta: -1 | 1;
}

export const JERICHO_CALIBRATION_DECISION_EVENT = 'jericho:calibration-decision';
export const JERICHO_CALIBRATION_HOLD_PROGRESS_EVENT = 'jericho:calibration-hold-progress';

export interface CalibrationDecisionDetail {
  outcome: 'apply' | 'discard';
}

export interface CalibrationHoldProgressDetail {
  outcome: 'apply' | 'discard';
  ratio: number;
}
