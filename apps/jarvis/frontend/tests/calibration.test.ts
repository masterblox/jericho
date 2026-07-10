import { describe, expect, it } from 'vitest';
import {
  TARGET_POINTS,
  applyCalibration,
  createCalibrationProfile,
  isCalibrationCompatible,
  loadCalibration,
  resetCalibrations,
  saveCalibration,
  type CalibrationSample,
} from '../src/calibration';

const samples: CalibrationSample[] = [
  { target: 'center', camera: { x: 0.5, y: 0.5 } },
  { target: 'top-left', camera: { x: 0.2, y: 0.2 } },
  { target: 'top-right', camera: { x: 0.8, y: 0.2 } },
  { target: 'bottom-right', camera: { x: 0.8, y: 0.8 } },
  { target: 'bottom-left', camera: { x: 0.2, y: 0.8 } },
];

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe('five-point calibration', () => {
  it('maps all corners and validates center', () => {
    const profile = createCalibrationProfile(samples, 'camera-a', 16 / 9, 'Right', '2026-07-10T00:00:00Z');
    for (const sample of samples) {
      const mapped = applyCalibration(profile.matrix, sample.camera);
      expect(mapped.x).toBeCloseTo(TARGET_POINTS[sample.target].x, 6);
      expect(mapped.y).toBeCloseTo(TARGET_POINTS[sample.target].y, 6);
    }
    expect(profile.centerResidual).toBeLessThan(0.001);
  });

  it('meets the 1920x1080 nine-target replay budget and survives viewport resize', () => {
    const profile = createCalibrationProfile(samples, 'camera-a', 16 / 9, 'Left');
    const cameraAxis = [0.2, 0.5, 0.8];
    const screenAxis = [0.05, 0.5, 0.95];
    const errors: number[] = [];
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        const mapped = applyCalibration(profile.matrix, { x: cameraAxis[x], y: cameraAxis[y] });
        errors.push(Math.hypot((mapped.x - screenAxis[x]) * 1920, (mapped.y - screenAxis[y]) * 1080));
        expect({ x: mapped.x * 1280, y: mapped.y * 720 }).toEqual({
          x: expect.closeTo(screenAxis[x] * 1280, 6),
          y: expect.closeTo(screenAxis[y] * 720, 6),
        });
      }
    }
    errors.sort((a, b) => a - b);
    expect(errors[4]).toBeLessThanOrEqual(24);
    expect(errors[8]).toBeLessThanOrEqual(48);
  });

  it('rejects incomplete and degenerate samples', () => {
    expect(() => createCalibrationProfile(samples.slice(0, 4), 'camera-a', 16 / 9, 'Left')).toThrow();
    const degenerate = samples.map((sample) => ({ ...sample, camera: { x: 0.5, y: 0.5 } }));
    expect(() => createCalibrationProfile(degenerate, 'camera-a', 16 / 9, 'Left')).toThrow();
  });

  it('persists per camera/hand and invalidates camera or aspect changes over 2%', () => {
    const storage = new MemoryStorage();
    const profile = createCalibrationProfile(samples, 'camera-a', 16 / 9, 'Right');
    saveCalibration(storage, profile);
    expect(loadCalibration(storage, 'camera-a', 16 / 9, 'Right')).not.toBeNull();
    expect(loadCalibration(storage, 'camera-b', 16 / 9, 'Right')).toBeNull();
    expect(loadCalibration(storage, 'camera-a', 4 / 3, 'Right')).toBeNull();
    expect(isCalibrationCompatible(profile, 'camera-a', (16 / 9) * 1.019, 'Right')).toBe(true);
    resetCalibrations(storage, 'camera-a');
    expect(loadCalibration(storage, 'camera-a', 16 / 9, 'Right')).toBeNull();
  });
});
