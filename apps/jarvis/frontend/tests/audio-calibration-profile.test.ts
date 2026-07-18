import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AudioCalibrationProfileStore,
  computeDeviceHash,
  deriveAudioCalibrationProfile,
  validateAudioCalibrationProfile,
} from '../src/audio-calibration-profile';
import type { AudioWindowMetrics, ClapMeasurement } from '../src/audio';

// Synthetic fixture data
function roomMetrics(overrides: Partial<AudioWindowMetrics> = {}): AudioWindowMetrics {
  return {
    durationMs: 5_000,
    sampleCount: 240_000,
    blockCount: 48,
    rmsMin: 0.003,
    rmsMax: 0.018,
    rmsMean: 0.008,
    rmsP95: 0.012,
    peakMax: 0.045,
    clipCount: 0,
    clippedSampleFraction: 0,
    sustainedEnergyFraction: 0.02,
    ...overrides,
  };
}

function speechMetrics(overrides: Partial<AudioWindowMetrics> = {}): AudioWindowMetrics {
  return {
    durationMs: 3_000,
    sampleCount: 144_000,
    blockCount: 12,
    rmsMin: 0.08,
    rmsMax: 0.22,
    rmsMean: 0.14,
    rmsP95: 0.19,
    peakMax: 0.45,
    clipCount: 0,
    clippedSampleFraction: 0,
    sustainedEnergyFraction: 0.72,
    ...overrides,
  };
}

function clapMeasurement(overrides: Partial<ClapMeasurement> = {}): ClapMeasurement {
  return {
    occurredAtMs: 1_000,
    rms: 0.12,
    peak: 0.85,
    crestFactor: 7.1,
    sustainedEnergyFraction: 0.03,
    ...overrides,
  };
}

describe('deriveAudioCalibrationProfile', () => {
  it('derives deterministic profile from room, speech, and clap measurements', () => {
    const room = roomMetrics();
    const speech = [speechMetrics(), speechMetrics({ rmsMean: 0.15 }), speechMetrics({ rmsMean: 0.13 })];
    const claps = [clapMeasurement(), clapMeasurement({ rms: 0.11 }), clapMeasurement({ rms: 0.13 })];

    const profile = deriveAudioCalibrationProfile(
      room,
      speech,
      claps,
      'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      48_000,
    );

    // All fields must be finite and bounded
    expect(profile.schemaVersion).toBe(1);
    expect(profile.micDeviceHash).toBe('abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890');
    expect(typeof profile.createdAt).toBe('string');
    expect(Number.isFinite(profile.ambientNoiseFloor)).toBe(true);
    expect(profile.ambientNoiseFloor).toBeGreaterThan(0);
    expect(profile.ambientNoiseFloor).toBeLessThanOrEqual(0.25);
    expect(Number.isFinite(profile.speechActivationFloor)).toBe(true);
    expect(profile.speechActivationFloor).toBeGreaterThan(0);
    expect(Number.isFinite(profile.clapPeak)).toBe(true);
    expect(profile.clapPeak).toBeGreaterThanOrEqual(0.18);
    expect(profile.clapPeak).toBeLessThanOrEqual(0.98);
    expect(Number.isFinite(profile.clapRms)).toBe(true);
    expect(profile.clapRms).toBeGreaterThanOrEqual(0.02);
    expect(profile.clapRms).toBeLessThanOrEqual(0.50);
    expect(Number.isFinite(profile.clapCrest)).toBe(true);
    expect(profile.clapCrest).toBeGreaterThanOrEqual(2.5);
    expect(profile.clapCrest).toBeLessThanOrEqual(10);
    expect(Number.isFinite(profile.clapSustainedEnergyLimit)).toBe(true);
    expect(profile.inputSampleRate).toBe(48_000);
    expect(profile.phaseSampleCounts).toEqual({ room: 48, speech: 36, clap: 3 });
    expect(profile.liveResultId).toBe('');
  });

  it('uses median to resist one outlier', () => {
    const room = roomMetrics();
    const speech = [
      speechMetrics({ rmsMean: 0.50 }), // outlier
      speechMetrics({ rmsMean: 0.14 }),
      speechMetrics({ rmsMean: 0.12 }),
    ];
    const claps = [
      clapMeasurement({ peak: 0.99 }),
      clapMeasurement({ peak: 0.30 }), // outlier low
      clapMeasurement({ peak: 0.85 }),
    ];

    const profile = deriveAudioCalibrationProfile(
      room, speech, claps,
      'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      48_000,
    );

    // Median speech RMS should be ~0.14, not 0.50
    expect(profile.speechActivationFloor).toBeGreaterThan(0);
    expect(profile.speechActivationFloor).toBeLessThanOrEqual(0.30);
    // Clap peak should not be dragged down by 0.30 outlier
    expect(profile.clapPeak).toBeGreaterThanOrEqual(0.18);
  });

  it('clamps ambient noise floor to safe range', () => {
    // Very quiet room
    const quiet = roomMetrics({ rmsP95: 0.0005 });
    const speech = [speechMetrics(), speechMetrics(), speechMetrics()];
    const claps = [clapMeasurement(), clapMeasurement(), clapMeasurement()];
    const profile = deriveAudioCalibrationProfile(
      quiet, speech, claps,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      48_000,
    );
    expect(profile.ambientNoiseFloor).toBeGreaterThanOrEqual(0.001);

    // Very noisy room
    const noisy = roomMetrics({ rmsP95: 0.40 });
    const profile2 = deriveAudioCalibrationProfile(
      noisy, speech, claps,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      48_000,
    );
    expect(profile2.ambientNoiseFloor).toBeLessThanOrEqual(0.25);
  });

  it('rejects invalid input', () => {
    expect(() => deriveAudioCalibrationProfile(
      roomMetrics(),
      [],
      [],
      'short',
      48_000,
    )).toThrow();

    expect(() => deriveAudioCalibrationProfile(
      roomMetrics(),
      [speechMetrics()], // only 1 speech, need 3
      [clapMeasurement()],
      'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      48_000,
    )).toThrow();
  });
});

describe('computeDeviceHash', () => {
  it('returns a 64-character hex string', async () => {
    const mockDigest = vi.fn().mockResolvedValue(
      new Uint8Array(32).fill(0xab).buffer as ArrayBuffer,
    );
    const crypto = { subtle: { digest: mockDigest } };

    const hash = await computeDeviceHash('default-device-id-123', crypto as unknown as Crypto);
    expect(hash).toHaveLength(64);
    expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);
    expect(mockDigest).toHaveBeenCalledWith(
      'SHA-256',
      expect.any(Uint8Array),
    );
  });

  it('never outputs the raw deviceId', async () => {
    const rawDeviceId = 'raw-device-id-secret-12345';
    const mockDigest = vi.fn().mockResolvedValue(
      new Uint8Array(32).fill(0x42).buffer as ArrayBuffer,
    );
    const crypto = { subtle: { digest: mockDigest } };

    const hash = await computeDeviceHash(rawDeviceId, crypto as unknown as Crypto);
    // Hash must not contain the raw deviceId
    expect(hash).not.toContain('secret');
    expect(hash).not.toContain('raw');
  });

  it('is deterministic for the same deviceId', async () => {
    const mockDigest = vi.fn().mockResolvedValue(
      new Uint8Array(32).fill(0x12).buffer as ArrayBuffer,
    );
    const crypto = { subtle: { digest: mockDigest } };

    const hash1 = await computeDeviceHash('device-a', crypto as unknown as Crypto);
    const hash2 = await computeDeviceHash('device-a', crypto as unknown as Crypto);
    expect(hash1).toBe(hash2);
  });
});

describe('AudioCalibrationProfileStore', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not write without explicit commit', () => {
    const store = new AudioCalibrationProfileStore(storage);
    const profile = deriveAudioCalibrationProfile(
      roomMetrics(),
      [speechMetrics(), speechMetrics(), speechMetrics()],
      [clapMeasurement(), clapMeasurement(), clapMeasurement()],
      'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      48_000,
    );

    // Deriving a profile should not auto-persist
    expect(storage._size()).toBe(0);

    store.loadApproved(profile.micDeviceHash);
    expect(storage._size()).toBe(0); // load also doesn't write
  });

  it('commits and loads approved profiles', () => {
    const store = new AudioCalibrationProfileStore(storage);
    const profile = deriveAudioCalibrationProfile(
      roomMetrics(),
      [speechMetrics(), speechMetrics(), speechMetrics()],
      [clapMeasurement(), clapMeasurement(), clapMeasurement()],
      'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      48_000,
    );

    // commitApproved writes to storage
    store.commitApproved(profile);
    expect(storage._size()).toBe(1);

    const key = Array.from((storage as any).values.keys())[0];
    expect(key).toBe(`jericho.audio-calibration.v1.${profile.micDeviceHash}`);

    // loadApproved reads it back
    const loaded = store.loadApproved(profile.micDeviceHash);
    expect(loaded).not.toBeNull();
    expect(loaded!.schemaVersion).toBe(1);
    expect(loaded!.micDeviceHash).toBe(profile.micDeviceHash);
    expect(loaded!.ambientNoiseFloor).toBe(profile.ambientNoiseFloor);
  });

  it('rejects mismatched device hash on load', () => {
    const store = new AudioCalibrationProfileStore(storage);
    const profile = deriveAudioCalibrationProfile(
      roomMetrics(),
      [speechMetrics(), speechMetrics(), speechMetrics()],
      [clapMeasurement(), clapMeasurement(), clapMeasurement()],
      'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      48_000,
    );

    store.commitApproved(profile);
    const result = store.loadApproved('differenthashxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(result).toBeNull();
  });

  it('does not partially overwrite on storage failure', () => {
    const brokenStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('Quota exceeded'); },
    };
    const store = new AudioCalibrationProfileStore(brokenStorage);
    const profile = deriveAudioCalibrationProfile(
      roomMetrics(),
      [speechMetrics(), speechMetrics(), speechMetrics()],
      [clapMeasurement(), clapMeasurement(), clapMeasurement()],
      'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      48_000,
    );

    expect(() => store.commitApproved(profile)).toThrow();
    // Store should not have been modified
  });

  it('separates key namespace from camera calibration', () => {
    const store = new AudioCalibrationProfileStore(storage);
    const profile = deriveAudioCalibrationProfile(
      roomMetrics(),
      [speechMetrics(), speechMetrics(), speechMetrics()],
      [clapMeasurement(), clapMeasurement(), clapMeasurement()],
      'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      48_000,
    );

    store.commitApproved(profile);

    // Write a camera calibration with same deviceHash (simulates camera store)
    storage.setItem(
      `jericho.calibration.v2.camera-a.Right`,
      JSON.stringify({ version: 2 }),
    );

    // Audio store should still load its own profile correctly
    const loaded = store.loadApproved(profile.micDeviceHash);
    expect(loaded).not.toBeNull();
    expect(loaded!.schemaVersion).toBe(1);

    // Camera calibration should not be returned by audio store
    const camKey = Array.from((storage as any).values.keys()).find((k: string) =>
      k.startsWith('jericho.calibration.v2.'),
    );
    expect(camKey).toBeDefined();
  });
});

describe('validateAudioCalibrationProfile', () => {
  it('accepts valid profiles', () => {
    const profile = deriveAudioCalibrationProfile(
      roomMetrics(),
      [speechMetrics(), speechMetrics(), speechMetrics()],
      [clapMeasurement(), clapMeasurement(), clapMeasurement()],
      'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      48_000,
    );
    expect(validateAudioCalibrationProfile(profile)).toBe(true);
  });

  it('rejects wrong schema version', () => {
    const profile = deriveAudioCalibrationProfile(
      roomMetrics(),
      [speechMetrics(), speechMetrics(), speechMetrics()],
      [clapMeasurement(), clapMeasurement(), clapMeasurement()],
      'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      48_000,
    );
    (profile as any).schemaVersion = 2;
    expect(validateAudioCalibrationProfile(profile)).toBe(false);
  });

  it('rejects invalid device hash', () => {
    const profile = deriveAudioCalibrationProfile(
      roomMetrics(),
      [speechMetrics(), speechMetrics(), speechMetrics()],
      [clapMeasurement(), clapMeasurement(), clapMeasurement()],
      'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      48_000,
    );
    (profile as any).micDeviceHash = 'short';
    expect(validateAudioCalibrationProfile(profile)).toBe(false);
  });

  it('rejects non-finite metric values', () => {
    const profile = deriveAudioCalibrationProfile(
      roomMetrics(),
      [speechMetrics(), speechMetrics(), speechMetrics()],
      [clapMeasurement(), clapMeasurement(), clapMeasurement()],
      'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      48_000,
    );
    (profile as any).ambientNoiseFloor = Number.NaN;
    expect(validateAudioCalibrationProfile(profile)).toBe(false);

    (profile as any).ambientNoiseFloor = Number.POSITIVE_INFINITY;
    expect(validateAudioCalibrationProfile(profile)).toBe(false);
  });
});

class MemoryStorage {
  readonly values: Map<string, string> = new Map();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  _size(): number { return this.values.size; }
}
