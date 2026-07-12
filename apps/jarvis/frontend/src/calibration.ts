import {
  PINCH_ENGAGE_RATIO,
  PINCH_RELEASE_RATIO,
  validPinchThresholds,
  type Handedness,
  type PinchThresholds,
  type Point,
} from './tracking';

export const CALIBRATION_VERSION = 2;
export const MAX_CENTER_RESIDUAL = 0.05;
export const MAX_VERIFICATION_RESIDUAL = 0.05;

export type CalibrationTarget = 'center' | 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';

export interface CalibrationSample {
  target: CalibrationTarget;
  camera: Point;
}

export interface VerificationPointResult {
  target: CalibrationTarget;
  distance: number;
  passed: boolean;
}

export interface VerificationResult {
  passed: boolean;
  perPoint: Partial<Record<CalibrationTarget, VerificationPointResult>>;
  maxError: number;
  failedPoints: CalibrationTarget[];
}

export interface CalibrationProfile {
  version: 2;
  cameraId: string;
  cameraAspectRatio: number;
  handedness: Handedness;
  samples: CalibrationSample[];
  /** Row-major 3x3 projective transform; matrix[8] is always 1. */
  matrix: [number, number, number, number, number, number, number, number, number];
  centerResidual: number;
  residualError: number;
  pinchEngageRatio: number;
  pinchReleaseRatio: number;
  createdAt: string;
  verificationTimestamp?: string;
}

export interface CalibrationProfileCard {
  handedness: Handedness;
  cameraLabel: string;
  aspectLabel: string;
  ageSeconds: number;
  residualError: number;
  pinchEngageRatio: number;
  pinchReleaseRatio: number;
}

export const CALIBRATION_ORDER: CalibrationTarget[] = [
  'center',
  'top-left',
  'top-right',
  'bottom-right',
  'bottom-left',
];

export const TARGET_POINTS: Record<CalibrationTarget, Point> = {
  center: { x: 0.5, y: 0.5 },
  'top-left': { x: 0.05, y: 0.05 },
  'top-right': { x: 0.95, y: 0.05 },
  'bottom-right': { x: 0.95, y: 0.95 },
  'bottom-left': { x: 0.05, y: 0.95 },
};

function solveLinearSystem(input: number[][], values: number[]): number[] {
  const n = values.length;
  const matrix = input.map((row, index) => [...row, values[index]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    }
    if (Math.abs(matrix[pivot][col]) < 1e-9) throw new Error('Calibration points are degenerate');
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    const divisor = matrix[col][col];
    for (let j = col; j <= n; j++) matrix[col][j] /= divisor;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = matrix[row][col];
      for (let j = col; j <= n; j++) matrix[row][j] -= factor * matrix[col][j];
    }
  }
  return matrix.map((row) => row[n]);
}

export function computeHomography(samples: CalibrationSample[]): CalibrationProfile['matrix'] {
  const corners = samples.filter((sample) => sample.target !== 'center');
  if (corners.length !== 4 || new Set(corners.map((sample) => sample.target)).size !== 4) {
    throw new Error('Calibration requires four unique corner samples');
  }
  const equations: number[][] = [];
  const values: number[] = [];
  for (const sample of corners) {
    const { x, y } = sample.camera;
    const target = TARGET_POINTS[sample.target];
    equations.push([x, y, 1, 0, 0, 0, -target.x * x, -target.x * y]);
    values.push(target.x);
    equations.push([0, 0, 0, x, y, 1, -target.y * x, -target.y * y]);
    values.push(target.y);
  }
  const h = solveLinearSystem(equations, values);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function applyCalibration(matrix: CalibrationProfile['matrix'], point: Point): Point {
  const denominator = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
  if (Math.abs(denominator) < 1e-9) throw new Error('Calibration transform is singular');
  return {
    x: Math.min(1, Math.max(0, (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / denominator)),
    y: Math.min(1, Math.max(0, (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / denominator)),
  };
}

export function verifyCalibration(
  samples: CalibrationSample[],
  matrix: CalibrationProfile['matrix'],
): VerificationResult {
  const perPoint: VerificationResult['perPoint'] = {};
  let maxError = 0;
  const failedPoints: CalibrationTarget[] = [];
  for (const sample of samples) {
    const mapped = applyCalibration(matrix, sample.camera);
    const target = TARGET_POINTS[sample.target];
    const distance = Math.hypot(mapped.x - target.x, mapped.y - target.y);
    const passed = distance <= MAX_VERIFICATION_RESIDUAL;
    perPoint[sample.target] = { target: sample.target, distance, passed };
    if (distance > maxError) maxError = distance;
    if (!passed) failedPoints.push(sample.target);
  }
  return { passed: failedPoints.length === 0, perPoint, maxError, failedPoints };
}

export function createCalibrationProfile(
  samples: CalibrationSample[],
  cameraId: string,
  cameraAspectRatio: number,
  handedness: Handedness,
  createdAt = new Date().toISOString(),
  pinchThresholds: PinchThresholds = {
    engageRatio: PINCH_ENGAGE_RATIO,
    releaseRatio: PINCH_RELEASE_RATIO,
  },
): CalibrationProfile {
  const center = samples.find((sample) => sample.target === 'center');
  if (!center || samples.length !== 5 || new Set(samples.map((sample) => sample.target)).size !== 5) {
    throw new Error('Calibration requires center plus four unique corners');
  }
  const matrix = computeHomography(samples);
  const mappedCenter = applyCalibration(matrix, center.camera);
  const centerResidual = Math.hypot(mappedCenter.x - 0.5, mappedCenter.y - 0.5);
  if (centerResidual > MAX_CENTER_RESIDUAL) {
    throw new Error(`Center residual ${(centerResidual * 100).toFixed(1)}% is too high`);
  }
  if (!validPinchThresholds(pinchThresholds)) throw new Error('Pinch calibration thresholds are invalid');
  const verification = verifyCalibration(samples, matrix);
  return {
    version: CALIBRATION_VERSION,
    cameraId,
    cameraAspectRatio,
    handedness,
    samples,
    matrix,
    centerResidual,
    residualError: verification.maxError,
    pinchEngageRatio: pinchThresholds.engageRatio,
    pinchReleaseRatio: pinchThresholds.releaseRatio,
    createdAt,
    verificationTimestamp: new Date().toISOString(),
  };
}

export function derivePinchThresholds(openRatios: number[], closedRatios: number[]): PinchThresholds {
  const open = median(openRatios.filter(validRatio));
  const closed = median(closedRatios.filter(validRatio));
  if (open === undefined || closed === undefined || open - closed < 0.12) {
    throw new Error('Open and closed pinch samples are too similar');
  }
  const thresholds = {
    engageRatio: round(closed + (open - closed) * 0.28),
    releaseRatio: round(closed + (open - closed) * 0.62),
  };
  if (!validPinchThresholds(thresholds)) throw new Error('Derived pinch thresholds are invalid');
  return thresholds;
}

export function isCalibrationCompatible(
  profile: CalibrationProfile,
  cameraId: string,
  cameraAspectRatio: number,
  handedness: Handedness,
): boolean {
  if (profile.version !== CALIBRATION_VERSION || profile.cameraId !== cameraId || profile.handedness !== handedness) {
    return false;
  }
  if (!Number.isFinite(cameraAspectRatio) || cameraAspectRatio <= 0) return false;
  return Math.abs(profile.cameraAspectRatio / cameraAspectRatio - 1) <= 0.02;
}

function storageKey(cameraId: string, handedness: Handedness): string {
  return `jericho.calibration.v${CALIBRATION_VERSION}.${encodeURIComponent(cameraId)}.${handedness}`;
}

function validRatio(value: number): boolean {
  return Number.isFinite(value) && value >= 0.02 && value <= 2;
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

export function loadCalibration(
  storage: Pick<Storage, 'getItem'>,
  cameraId: string,
  cameraAspectRatio: number,
  handedness: Handedness,
): CalibrationProfile | null {
  try {
    const value = storage.getItem(storageKey(cameraId, handedness));
    if (!value) return null;
    const profile = JSON.parse(value) as CalibrationProfile;
    return isCalibrationCompatible(profile, cameraId, cameraAspectRatio, handedness) ? profile : null;
  } catch {
    return null;
  }
}

export function saveCalibration(storage: Pick<Storage, 'setItem'>, profile: CalibrationProfile) {
  storage.setItem(storageKey(profile.cameraId, profile.handedness), JSON.stringify(profile));
}

export function resetCalibrations(storage: Pick<Storage, 'removeItem'>, cameraId: string) {
  storage.removeItem(storageKey(cameraId, 'Left'));
  storage.removeItem(storageKey(cameraId, 'Right'));
}

export function listProfiles(
  storage: Storage,
): CalibrationProfile[] {
  const profiles: CalibrationProfile[] = [];
  for (const handedness of ['Left', 'Right'] as const) {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || !key.startsWith(`jericho.calibration.v${CALIBRATION_VERSION}.`)) continue;
      if (!key.endsWith(`.${handedness}`)) continue;
      try {
        const value = storage.getItem(key);
        if (!value) continue;
        const profile = JSON.parse(value) as CalibrationProfile;
        if (profile.version === CALIBRATION_VERSION && profile.handedness === handedness) {
          profiles.push(profile);
        }
      } catch { /* corrupt entry */ }
    }
  }
  return profiles;
}

export function profileCard(profile: CalibrationProfile): CalibrationProfileCard {
  return {
    handedness: profile.handedness,
    cameraLabel: profile.cameraId === 'default' ? 'Default camera' : `Camera ${profile.cameraId.slice(0, 8)}`,
    aspectLabel: aspectLabel(profile.cameraAspectRatio),
    ageSeconds: Math.max(0, Math.floor((Date.now() - Date.parse(profile.createdAt)) / 1000)),
    residualError: profile.residualError,
    pinchEngageRatio: profile.pinchEngageRatio,
    pinchReleaseRatio: profile.pinchReleaseRatio,
  };
}

function aspectLabel(ratio: number): string {
  const delta = (candidate: number) => Math.abs(ratio / candidate - 1);
  if (delta(16 / 9) <= 0.02) return '16:9';
  if (delta(4 / 3) <= 0.02) return '4:3';
  if (delta(21 / 9) <= 0.02) return '21:9';
  return ratio.toFixed(2);
}

export class StableSampleBuffer {
  private samples: Point[] = [];

  push(point: Point) {
    this.samples.push({ ...point });
    if (this.samples.length > 15) this.samples.shift();
  }

  median(): Point | null {
    if (this.samples.length < 8) return null;
    const xs = this.samples.map((point) => point.x).sort((a, b) => a - b);
    const ys = this.samples.map((point) => point.y).sort((a, b) => a - b);
    const middle = Math.floor(xs.length / 2);
    const value = { x: xs[middle], y: ys[middle] };
    const maxDeviation = this.samples.reduce(
      (maximum, point) => Math.max(maximum, Math.hypot(point.x - value.x, point.y - value.y)),
      0,
    );
    return maxDeviation <= 0.025 ? value : null;
  }

  deviation(): number {
    if (this.samples.length < 4) return 1;
    const xs = this.samples.map((point) => point.x).sort((a, b) => a - b);
    const ys = this.samples.map((point) => point.y).sort((a, b) => a - b);
    const middle = Math.floor(xs.length / 2);
    const medX = xs[middle];
    const medY = ys[middle];
    return this.samples.reduce(
      (maximum, point) => Math.max(maximum, Math.hypot(point.x - medX, point.y - medY)),
      0,
    );
  }

  size(): number {
    return this.samples.length;
  }

  clear() {
    this.samples = [];
  }
}
