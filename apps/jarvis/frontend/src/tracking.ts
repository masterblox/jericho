export type Handedness = 'Left' | 'Right';
export type GestureState = 'idle' | 'palm' | 'pinch';
export type PinchPhase = 'open' | 'engaging' | 'pinched' | 'releasing';

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface Point {
  x: number;
  y: number;
}

export const PINCH_ENGAGE_RATIO = 0.35;
export const PINCH_RELEASE_RATIO = 0.5;
export const PINCH_ENGAGE_MS = 80;
export const PINCH_RELEASE_MS = 60;
export const OWNER_LOSS_MS = 350;

const PALM_LANDMARKS = [0, 5, 9, 13, 17] as const;

export function palmAnchor(landmarks: Landmark[]): Point {
  if (landmarks.length < 18) throw new Error('A complete MediaPipe hand needs 21 landmarks');
  const sum = PALM_LANDMARKS.reduce(
    (value, index) => ({ x: value.x + landmarks[index].x, y: value.y + landmarks[index].y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / PALM_LANDMARKS.length, y: sum.y / PALM_LANDMARKS.length };
}

export function pinchPoint(landmarks: Landmark[]): Point {
  if (landmarks.length < 9) throw new Error('A complete MediaPipe hand needs 21 landmarks');
  const thumb = landmarks[4];
  const index = landmarks[8];
  return { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 };
}

export function palmWidth(landmarks: Landmark[]): number {
  const index = landmarks[5];
  const pinky = landmarks[17];
  return Math.max(0.0001, Math.hypot(index.x - pinky.x, index.y - pinky.y));
}

export function normalizedPinchRatio(landmarks: Landmark[]): number {
  const thumb = landmarks[4];
  const index = landmarks[8];
  return Math.hypot(thumb.x - index.x, thumb.y - index.y) / palmWidth(landmarks);
}

function fingerExtended(landmarks: Landmark[], tip: number, pip: number): boolean {
  const wrist = landmarks[0];
  const tipDistance = Math.hypot(landmarks[tip].x - wrist.x, landmarks[tip].y - wrist.y);
  const pipDistance = Math.hypot(landmarks[pip].x - wrist.x, landmarks[pip].y - wrist.y);
  return tipDistance > pipDistance * 1.08;
}

export function hasOpenPalmGeometry(landmarks: Landmark[]): boolean {
  if (landmarks.length < 21) return false;
  const extended = [
    fingerExtended(landmarks, 8, 6),
    fingerExtended(landmarks, 12, 10),
    fingerExtended(landmarks, 16, 14),
    fingerExtended(landmarks, 20, 18),
  ].filter(Boolean).length;
  return extended >= 3;
}

export class PinchLatch {
  private pinched = false;
  private candidateSince: number | null = null;
  private candidatePhase: PinchPhase = 'open';

  update(ratio: number, blockNewEngagement: boolean, now: number): boolean {
    const wantsPinch = !blockNewEngagement && ratio <= PINCH_ENGAGE_RATIO;
    const wantsRelease = ratio >= PINCH_RELEASE_RATIO;

    if (!this.pinched) {
      if (!wantsPinch) {
        this.candidateSince = null;
        this.candidatePhase = 'open';
      } else if (this.candidateSince === null) {
        this.candidateSince = now;
        this.candidatePhase = 'engaging';
      } else if (now - this.candidateSince >= PINCH_ENGAGE_MS) {
        this.pinched = true;
        this.candidateSince = null;
        this.candidatePhase = 'pinched';
      }
    } else if (!wantsRelease) {
      this.candidateSince = null;
      this.candidatePhase = 'pinched';
    } else if (this.candidateSince === null) {
      this.candidateSince = now;
      this.candidatePhase = 'releasing';
    } else if (now - this.candidateSince >= PINCH_RELEASE_MS) {
      this.pinched = false;
      this.candidateSince = null;
      this.candidatePhase = 'open';
    }

    return this.pinched;
  }

  reset() {
    this.pinched = false;
    this.candidateSince = null;
    this.candidatePhase = 'open';
  }

  get phase(): PinchPhase {
    return this.candidatePhase;
  }

  candidateMs(now: number): number {
    return this.candidateSince === null ? 0 : now - this.candidateSince;
  }
}

export class AdaptivePointFilter {
  private point: Point | null = null;

  push(next: Point): Point {
    if (!this.point) {
      this.point = { ...next };
      return { ...next };
    }
    const speed = Math.hypot(next.x - this.point.x, next.y - this.point.y);
    const alpha = Math.min(0.68, Math.max(0.24, 0.28 + speed * 7));
    this.point = {
      x: this.point.x + (next.x - this.point.x) * alpha,
      y: this.point.y + (next.y - this.point.y) * alpha,
    };
    return { ...this.point };
  }

  reset() {
    this.point = null;
  }
}
