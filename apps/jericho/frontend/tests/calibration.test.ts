import { describe, expect, it } from 'vitest';
import {
  TARGET_POINTS,
  applyCalibration,
  createCalibrationProfile,
  isCalibrationCompatible,
  loadCalibration,
  profileCard,
  resetCalibrations,
  saveCalibration,
  StableSampleBuffer,
  verifyCalibration,
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

describe('verification pass', () => {
  it('passes all points when samples are exact', () => {
    const matrix = createCalibrationProfile(samples, 'camera-a', 16 / 9, 'Right').matrix;
    const result = verifyCalibration(samples, matrix);
    expect(result.passed).toBe(true);
    expect(result.failedPoints).toHaveLength(0);
    expect(result.maxError).toBeLessThan(0.001);
    for (const target of Object.keys(TARGET_POINTS) as (keyof typeof TARGET_POINTS)[]) {
      expect(result.perPoint[target]?.passed).toBe(true);
    }
  });

  it('fails a point outside the 5% verification threshold', () => {
    const matrix = createCalibrationProfile(samples, 'camera-a', 16 / 9, 'Right').matrix;
    const offSamples: CalibrationSample[] = [
      ...samples.slice(0, 4),
      { target: 'bottom-left', camera: { x: 0.35, y: 0.82 } },
    ];
    const result = verifyCalibration(offSamples, matrix);
    expect(result.passed).toBe(false);
    expect(result.failedPoints).toContain('bottom-left');
    expect(result.perPoint['bottom-left']?.passed).toBe(false);
  });

  it('includes residualError in the profile', () => {
    const profile = createCalibrationProfile(samples, 'camera-a', 16 / 9, 'Right');
    expect(profile.residualError).toBeLessThan(0.001);
    expect(profile.verificationTimestamp).toBeTruthy();
  });

  it('fails all points when matrix is inverted', () => {
    const inverted: CalibrationProfile['matrix'] = [0.5, 0, 0.3, 0, 0.5, 0.3, 0, 0, 1];
    const result = verifyCalibration(samples, inverted);
    expect(result.passed).toBe(false);
    expect(result.failedPoints.length).toBeGreaterThan(0);
  });
});

describe('profile metadata', () => {
  it('returns a card with camera, aspect, age, and thresholds', () => {
    const profile = createCalibrationProfile(samples, 'camera-a', 16 / 9, 'Left', new Date(Date.now() - 120_000).toISOString());
    const card = profileCard(profile);
    expect(card.handedness).toBe('Left');
    expect(card.cameraLabel).toContain('camera-a');
    expect(card.aspectLabel).toBe('16:9');
    expect(card.ageSeconds).toBeGreaterThanOrEqual(120);
    expect(card.residualError).toBeLessThan(0.001);
    expect(card.pinchEngageRatio).toBe(0.35);
    expect(card.pinchReleaseRatio).toBe(0.5);
  });

  it('labels 4:3 and 21:9 aspect ratios', () => {
    const p43 = createCalibrationProfile(samples, 'cam-b', 4 / 3, 'Right');
    const p219 = createCalibrationProfile(samples, 'cam-c', 21 / 9, 'Right');
    expect(profileCard(p43).aspectLabel).toBe('4:3');
    expect(profileCard(p219).aspectLabel).toBe('21:9');
  });
});

describe('StableSampleBuffer', () => {
  it('returns deviation > 0 with varied samples', () => {
    const buffer = new StableSampleBuffer();
    buffer.push({ x: 0.5, y: 0.5 });
    buffer.push({ x: 0.51, y: 0.49 });
    buffer.push({ x: 0.49, y: 0.51 });
    buffer.push({ x: 0.5, y: 0.5 });
    buffer.push({ x: 0.52, y: 0.48 });
    expect(buffer.size()).toBe(5);
    expect(buffer.deviation()).toBeGreaterThan(0);
    expect(buffer.median()).toBeNull();
  });

  it('returns median when stable', () => {
    const buffer = new StableSampleBuffer();
    for (let i = 0; i < 10; i++) {
      buffer.push({ x: 0.5 + (Math.random() - 0.5) * 0.002, y: 0.5 + (Math.random() - 0.5) * 0.002 });
    }
    expect(buffer.size()).toBe(10);
    const median = buffer.median();
    expect(median).not.toBeNull();
    expect(median!.x).toBeCloseTo(0.5, 2);
    expect(median!.y).toBeCloseTo(0.5, 2);
    expect(buffer.deviation()).toBeLessThan(0.03);
  });

  it('clears samples', () => {
    const buffer = new StableSampleBuffer();
    buffer.push({ x: 0.5, y: 0.5 });
    buffer.push({ x: 0.5, y: 0.5 });
    buffer.clear();
    expect(buffer.size()).toBe(0);
    expect(buffer.median()).toBeNull();
  });
});
