import type { TrackedHandFrame } from './hand-tracks';
import type { Point } from './tracking';

export const GESTURE_HOLD_MS = 700;
export const GESTURE_DEBOUNCE_MS = 900;
export const NUCLEUS_DEPTH_HOLD_MS = 700;
export const NUCLEUS_DEPTH_STEP_PX = 72;
export const NUCLEUS_DEPTH_DEBOUNCE_MS = 240;
export const NUCLEUS_CLUTCH_DRAG_PX = 12;

export interface ActiveApprovalScope {
  missionId: string;
  planHash: string;
  version: number;
}

export type HeldGestureAction =
  | {
    type: 'approval-decision';
    outcome: 'approved' | 'rejected';
    approval: ActiveApprovalScope;
  }
  | { type: 'cancel-pending' }
  | { type: 'calibration-decision'; outcome: 'apply' | 'discard' };

export interface HeldGestureInput {
  left?: TrackedHandFrame;
  right?: TrackedHandFrame;
  now: number;
  activeApproval?: ActiveApprovalScope;
  activeCalibrationDecision?: boolean;
  cancelEnabled: boolean;
}

export interface HeldGestureProgress {
  target: 'mission' | 'calibration';
  outcome: 'approved' | 'rejected' | 'apply' | 'discard';
  ratio: number;
}

type Candidate =
  | { type: 'approve' | 'reject'; approval: ActiveApprovalScope }
  | { type: 'cal-apply' | 'cal-discard' }
  | { type: 'cancel' };

/** Deterministic recognition only: callers own every resulting side effect. */
export class HeldGestureInterpreter {
  private candidate: Candidate | null = null;
  private candidateSince = 0;
  private latched = false;
  private lastFiredAt = Number.NEGATIVE_INFINITY;

  update(input: HeldGestureInput): HeldGestureAction[] {
    const candidate = classify(input);
    if (!candidate) {
      this.candidate = null;
      this.latched = false;
      return [];
    }
    if (candidateKey(candidate) !== candidateKey(this.candidate)) {
      this.candidate = candidate;
      this.candidateSince = input.now;
      this.latched = false;
      return [];
    }
    if (
      this.latched
      || input.now - this.candidateSince < GESTURE_HOLD_MS
      || input.now - this.lastFiredAt < GESTURE_DEBOUNCE_MS
    ) return [];

    this.latched = true;
    this.lastFiredAt = input.now;
    if (candidate.type === 'cancel') return [{ type: 'cancel-pending' }];
    if (candidate.type === 'cal-apply') return [{ type: 'calibration-decision', outcome: 'apply' }];
    if (candidate.type === 'cal-discard') return [{ type: 'calibration-decision', outcome: 'discard' }];
    const approvalCandidate = candidate as { type: 'approve' | 'reject'; approval: ActiveApprovalScope };
    return [{
      type: 'approval-decision',
      outcome: approvalCandidate.type === 'approve' ? 'approved' : 'rejected',
      approval: { ...approvalCandidate.approval },
    }];
  }

  getProgress(input: HeldGestureInput): HeldGestureProgress | null {
    if (!this.candidate) return null;
    const elapsed = input.now - this.candidateSince;
    const ratio = Math.min(1, Math.max(0, elapsed / GESTURE_HOLD_MS));

    if (this.candidate.type === 'cancel') return null;

    if (this.candidate.type === 'approve' || this.candidate.type === 'reject') {
      return {
        target: 'mission',
        outcome: this.candidate.type === 'approve' ? 'approved' : 'rejected',
        ratio,
      };
    }

    if (this.candidate.type === 'cal-apply' || this.candidate.type === 'cal-discard') {
      return {
        target: 'calibration',
        outcome: this.candidate.type === 'cal-apply' ? 'apply' : 'discard',
        ratio,
      };
    }

    return null;
  }

  reset(): void {
    this.candidate = null;
    this.candidateSince = 0;
    this.latched = false;
    this.lastFiredAt = Number.NEGATIVE_INFINITY;
  }
}

function classify(input: HeldGestureInput): Candidate | null {
  if (
    input.cancelEnabled
    && isFreshGesture(input.left, 'Open_Palm')
    && isFreshGesture(input.right, 'Open_Palm')
  ) return { type: 'cancel' };

  // Calibration decision: thumb up/down during REVIEW
  if (input.activeCalibrationDecision) {
    // Fail closed when both calibration AND mission approval active
    if (input.activeApproval) return null;
    const thumbs = [input.left, input.right]
      .filter((hand): hand is TrackedHandFrame => hand?.fresh === true)
      .map((hand) => hand.recognizedGesture)
      .filter((gesture): gesture is 'Thumb_Up' | 'Thumb_Down' =>
        gesture === 'Thumb_Up' || gesture === 'Thumb_Down');
    if (!thumbs.length || new Set(thumbs).size !== 1) return null;
    return { type: thumbs[0] === 'Thumb_Up' ? 'cal-apply' : 'cal-discard' };
  }

  if (!input.activeApproval) return null;
  const thumbs = [input.left, input.right]
    .filter((hand): hand is TrackedHandFrame => hand?.fresh === true)
    .map((hand) => hand.recognizedGesture)
    .filter((gesture): gesture is 'Thumb_Up' | 'Thumb_Down' =>
      gesture === 'Thumb_Up' || gesture === 'Thumb_Down');
  if (!thumbs.length || new Set(thumbs).size !== 1) return null;
  return {
    type: thumbs[0] === 'Thumb_Up' ? 'approve' : 'reject',
    approval: input.activeApproval,
  };
}

function candidateKey(candidate: Candidate | null): string {
  if (!candidate) return '';
  if (candidate.type === 'cancel' || candidate.type === 'cal-apply' || candidate.type === 'cal-discard') return candidate.type;
  const { missionId, planHash, version } = (candidate as { approval: ActiveApprovalScope }).approval;
  return `${candidate.type}:${missionId}:${planHash}:${version}`;
}

function isFreshGesture(hand: TrackedHandFrame | undefined, gesture: string): boolean {
  return hand?.fresh === true && hand.recognizedGesture === gesture;
}

export type NucleusGestureAction =
  | { type: 'camera'; phase: 'start'; point: Point }
  | { type: 'camera'; phase: 'move'; point: Point; delta: Point }
  | { type: 'camera'; phase: 'end'; cancelled: boolean }
  | { type: 'depth'; delta: -1 | 1 };

export interface NucleusGestureInput {
  left?: TrackedHandFrame;
  right?: TrackedHandFrame;
  leftPoint?: Point;
  rightPoint?: Point;
  rightOnEmptyNucleus: boolean;
  bothHandsInsideNucleus: boolean;
  now: number;
}

/**
 * Pure, context-gated Nucleus grammar. A right pinch can clutch the camera
 * only when its edge starts over empty graph space. Two open palms must stay
 * inside Nucleus for a hold period before span changes become depth steps.
 */
export class NucleusGestureInterpreter {
  private previousRightPinching = false;
  private cameraCandidatePoint: Point | null = null;
  private cameraPoint: Point | null = null;
  private depthCandidateSince: number | null = null;
  private depthAnchorSpan: number | null = null;
  private lastDepthAt = Number.NEGATIVE_INFINITY;

  update(input: NucleusGestureInput): NucleusGestureAction[] {
    const actions: NucleusGestureAction[] = [];
    const rightPinching = input.right?.fresh === true
      && input.right.state === 'pinch'
      && Boolean(input.rightPoint);
    const pinchStarted = rightPinching && !this.previousRightPinching;

    if (this.cameraPoint) {
      if (rightPinching && input.rightPoint) {
        const point = { ...input.rightPoint };
        const delta = subtract(point, this.cameraPoint);
        this.cameraPoint = point;
        if (delta.x !== 0 || delta.y !== 0) {
          actions.push({ type: 'camera', phase: 'move', point, delta });
        }
      } else {
        const cancelled = input.right?.fresh !== true;
        this.cameraPoint = null;
        actions.push({ type: 'camera', phase: 'end', cancelled });
      }
    } else if (this.cameraCandidatePoint) {
      if (!rightPinching || !input.rightPoint) {
        this.cameraCandidatePoint = null;
      } else if (distance(this.cameraCandidatePoint, input.rightPoint) >= NUCLEUS_CLUTCH_DRAG_PX) {
        const start = { ...this.cameraCandidatePoint };
        const point = { ...input.rightPoint };
        this.cameraCandidatePoint = null;
        this.cameraPoint = point;
        actions.push({ type: 'camera', phase: 'start', point: start });
        actions.push({ type: 'camera', phase: 'move', point, delta: subtract(point, start) });
      }
    } else if (pinchStarted && input.rightOnEmptyNucleus && input.rightPoint) {
      // Empty-space pinches are only candidates. Registered targets are resolved
      // before this interpreter and a clutch starts only after intentional drag.
      this.cameraCandidatePoint = { ...input.rightPoint };
    }
    this.previousRightPinching = rightPinching;

    const depthActive = !this.cameraPoint
      && input.bothHandsInsideNucleus
      && isFreshGesture(input.left, 'Open_Palm')
      && isFreshGesture(input.right, 'Open_Palm')
      && Boolean(input.leftPoint)
      && Boolean(input.rightPoint);
    if (!depthActive || !input.leftPoint || !input.rightPoint) {
      this.resetDepth();
      return actions;
    }

    const span = distance(input.leftPoint, input.rightPoint);
    if (this.depthCandidateSince === null) {
      this.depthCandidateSince = input.now;
      this.depthAnchorSpan = span;
      return actions;
    }
    if (input.now - this.depthCandidateSince < NUCLEUS_DEPTH_HOLD_MS) return actions;
    if (this.depthAnchorSpan === null) {
      this.depthAnchorSpan = span;
      return actions;
    }

    const spanDelta = span - this.depthAnchorSpan;
    if (
      Math.abs(spanDelta) >= NUCLEUS_DEPTH_STEP_PX
      && input.now - this.lastDepthAt >= NUCLEUS_DEPTH_DEBOUNCE_MS
    ) {
      const delta = Math.sign(spanDelta) as -1 | 1;
      this.depthAnchorSpan = span;
      this.lastDepthAt = input.now;
      actions.push({ type: 'depth', delta });
    }
    return actions;
  }

  isCameraActive(): boolean {
    return this.cameraPoint !== null;
  }

  isDepthActive(): boolean {
    return this.depthCandidateSince !== null;
  }

  reset(): NucleusGestureAction[] {
    const actions: NucleusGestureAction[] = this.cameraPoint
      ? [{ type: 'camera', phase: 'end', cancelled: true }]
      : [];
    this.previousRightPinching = false;
    this.cameraCandidatePoint = null;
    this.cameraPoint = null;
    this.resetDepth();
    return actions;
  }

  private resetDepth(): void {
    this.depthCandidateSince = null;
    this.depthAnchorSpan = null;
  }
}

function subtract(point: Point, origin: Point): Point {
  return { x: point.x - origin.x, y: point.y - origin.y };
}

function distance(left: Point, right: Point): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}
