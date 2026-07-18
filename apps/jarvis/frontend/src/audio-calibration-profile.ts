import type { AudioWindowMetrics, ClapMeasurement } from './audio';

export const AUDIO_CALIBRATION_VERSION = 1;
export const AUDIO_CALIBRATION_KEY_PREFIX = 'jericho.audio-calibration.v1.';

export interface AudioCalibrationProfile {
  schemaVersion: 1;
  micDeviceHash: string;
  createdAt: string;
  ambientNoiseFloor: number;
  speechActivationFloor: number;
  clapPeak: number;
  clapRms: number;
  clapCrest: number;
  clapSustainedEnergyLimit: number;
  inputSampleRate: number;
  phaseSampleCounts: {
    room: number;
    speech: number;
    clap: number;
  };
  liveResultId: string;
}

export interface AudioCalibrationProfileSummary {
  schemaVersion: 1;
  createdAt: string;
  ambientNoiseFloor: number;
  speechActivationFloor: number;
  clapPeak: number;
  clapRms: number;
  clapCrest: number;
  liveResultId: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function medianSorted(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return medianSorted(sorted);
}

export function deriveAudioCalibrationProfile(
  room: AudioWindowMetrics,
  speechWindows: AudioWindowMetrics[],
  clapMeasurements: ClapMeasurement[],
  micDeviceHash: string,
  inputSampleRate: number,
  liveResultId = '',
): AudioCalibrationProfile {
  if (speechWindows.length < 3) {
    throw new Error('Speech calibration requires exactly three measurements');
  }
  if (clapMeasurements.length < 3) {
    throw new Error('Clap calibration requires exactly three measurements');
  }
  if (micDeviceHash.length !== 64 || !/^[a-f0-9]{64}$/.test(micDeviceHash)) {
    throw new Error('Invalid microphone device hash');
  }

  const ambientNoiseFloor = clamp(room.rmsP95, 0.001, 0.25);

  const speechRmsMeans = speechWindows.map((m) => m.rmsMean);
  const speechActivationFloor = clamp(
    Math.max(ambientNoiseFloor * 2.2, median(speechRmsMeans) * 0.35),
    0.01,
    0.30,
  );

  const clapPeaks = clapMeasurements.map((m) => m.peak);
  const clapRmsValues = clapMeasurements.map((m) => m.rms);
  const clapCrests = clapMeasurements.map((m) => m.crestFactor);
  const clapSustainedFractions = clapMeasurements.map((m) => m.sustainedEnergyFraction);

  const medianPeak = median(clapPeaks);
  const medianRms = median(clapRmsValues);
  const medianCrest = median(clapCrests);
  const medianSustained = median(clapSustainedFractions);

  const clapPeak = clamp(Math.max(ambientNoiseFloor * 5, medianPeak * 0.60), 0.18, 0.98);
  const clapRms = clamp(Math.max(ambientNoiseFloor * 1.8, medianRms * 0.60), 0.02, 0.50);
  const clapCrest = clamp(medianCrest * 0.75, 2.5, 10);
  const clapSustainedEnergyLimit = clamp(medianSustained + 0.03, 0.05, 0.18);

  return {
    schemaVersion: 1,
    micDeviceHash,
    createdAt: new Date().toISOString(),
    ambientNoiseFloor,
    speechActivationFloor,
    clapPeak,
    clapRms,
    clapCrest,
    clapSustainedEnergyLimit,
    inputSampleRate,
    phaseSampleCounts: {
      room: room.blockCount,
      speech: speechWindows.reduce((sum, m) => sum + m.blockCount, 0),
      clap: clapMeasurements.length,
    },
    liveResultId,
  };
}

export function validateAudioCalibrationProfile(profile: unknown): profile is AudioCalibrationProfile {
  if (!profile || typeof profile !== 'object') return false;
  const p = profile as Record<string, unknown>;
  if (p.schemaVersion !== 1) return false;
  if (typeof p.micDeviceHash !== 'string' || p.micDeviceHash.length !== 64 || !/^[a-f0-9]{64}$/.test(p.micDeviceHash)) return false;
  if (typeof p.createdAt !== 'string' || Number.isNaN(Date.parse(p.createdAt as string))) return false;

  const metrics = ['ambientNoiseFloor', 'speechActivationFloor', 'clapPeak', 'clapRms', 'clapCrest', 'clapSustainedEnergyLimit'] as const;
  for (const key of metrics) {
    const v = p[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  }

  if (typeof p.inputSampleRate !== 'number' || !Number.isFinite(p.inputSampleRate) || p.inputSampleRate <= 0) return false;
  if (typeof p.liveResultId !== 'string') return false;

  const counts = p.phaseSampleCounts as Record<string, unknown> | undefined;
  if (!counts || typeof counts !== 'object') return false;
  if (typeof counts.room !== 'number' || !Number.isFinite(counts.room)) return false;
  if (typeof counts.speech !== 'number' || !Number.isFinite(counts.speech)) return false;
  if (typeof counts.clap !== 'number' || !Number.isFinite(counts.clap)) return false;

  return true;
}

export async function computeDeviceHash(
  deviceId: string,
  crypto: Pick<Crypto, 'subtle'>,
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`jericho-mic-device:${deviceId}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class AudioCalibrationProfileStore {
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'>) {}

  loadApproved(deviceHash: string): AudioCalibrationProfile | null {
    try {
      const key = `${AUDIO_CALIBRATION_KEY_PREFIX}${deviceHash}`;
      const raw = this.storage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!validateAudioCalibrationProfile(parsed)) return null;
      if (parsed.micDeviceHash !== deviceHash) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  commitApproved(profile: AudioCalibrationProfile): void {
    if (!validateAudioCalibrationProfile(profile)) {
      throw new Error('Invalid audio calibration profile');
    }
    const key = `${AUDIO_CALIBRATION_KEY_PREFIX}${profile.micDeviceHash}`;
    this.storage.setItem(key, JSON.stringify(profile));
  }

  profileSummary(profile: AudioCalibrationProfile): AudioCalibrationProfileSummary {
    return {
      schemaVersion: 1,
      createdAt: profile.createdAt,
      ambientNoiseFloor: profile.ambientNoiseFloor,
      speechActivationFloor: profile.speechActivationFloor,
      clapPeak: profile.clapPeak,
      clapRms: profile.clapRms,
      clapCrest: profile.clapCrest,
      liveResultId: profile.liveResultId,
    };
  }
}
