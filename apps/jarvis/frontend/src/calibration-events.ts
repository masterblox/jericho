import type {
  ActiveCalibrationPhase,
  CalibrationFailureReason,
  CalibrationPhase,
  CalibrationPhraseId,
} from '@jericho/shared';
import {
  CALIBRATION_FAILURE_REASONS,
  CALIBRATION_PHRASES,
  PHASE_FAILURE_SUBSETS,
} from '@jericho/shared';

export type {
  ActiveCalibrationPhase,
  CalibrationFailureReason,
  CalibrationPhase,
  CalibrationPhraseId,
} from '@jericho/shared';

export type CalibrationCommand = 'start' | 'retry_phase' | 'exit' | 'apply' | 'discard' | 'create_fix_proposal';

export const JERICHO_AUDIO_CALIBRATION_COMMAND_EVENT = 'jericho:audio-calibration-command';
export const JERICHO_AUDIO_CALIBRATION_STATE_EVENT = 'jericho:audio-calibration-state';

export const VALID_CALIBRATION_COMMANDS: ReadonlySet<string> = new Set([
  'start', 'retry_phase', 'exit', 'apply', 'discard', 'create_fix_proposal',
]);

export interface AudioCalibrationProfileSummary {
  schemaVersion: 1;
  createdAt: string;
  ambientNoiseFloor: number;
  speechActivationFloor: number;
  clapPeak: number;
  clapRms: number;
  clapCrest: number;
  clapSustainedEnergyLimit: number;
  inputSampleRate: number;
  liveResultId: string;
}

export interface CalibrationSnapshot {
  sessionId: string;
  phase: CalibrationPhase;
  failedPhase?: ActiveCalibrationPhase;
  failureReason?: CalibrationFailureReason;
  microphoneLabel?: string;
  previousProfile?: AudioCalibrationProfileSummary;
  candidateProfile?: AudioCalibrationProfileSummary;
  completedPhases: ActiveCalibrationPhase[];
  speechChecks: Array<{ phraseId: CalibrationPhraseId; passed: boolean }>;
  clapCount: 0 | 1 | 2 | 3;
  liveResultId?: string;
  proposalId?: string;
  actionState?: 'idle' | 'working' | 'succeeded' | 'failed';
  deadlineRemainingMs?: number;
  roomLevel?: number;
}

export function isCalibrationCommand(value: unknown): value is CalibrationCommand {
  return typeof value === 'string' && VALID_CALIBRATION_COMMANDS.has(value);
}

export function parseCalibrationCommandDetail(detail: unknown): CalibrationCommand | null {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null;
  const d = detail as Record<string, unknown>;
  const keys = Object.keys(d);
  if (keys.length !== 1 || (keys[0] !== 'action' && keys[0] !== 'command')) return null;
  const command = d.action ?? d.command;
  return isCalibrationCommand(command) ? command : null;
}

export function sanitizeCalibrationSnapshot(snapshot: CalibrationSnapshot): CalibrationSnapshot {
  return {
    sessionId: snapshot.sessionId,
    phase: snapshot.phase,
    ...(snapshot.failedPhase ? { failedPhase: snapshot.failedPhase } : {}),
    ...(snapshot.failureReason ? { failureReason: snapshot.failureReason } : {}),
    ...(snapshot.microphoneLabel ? { microphoneLabel: snapshot.microphoneLabel } : {}),
    ...(snapshot.previousProfile ? { previousProfile: { ...snapshot.previousProfile } } : {}),
    ...(snapshot.candidateProfile ? { candidateProfile: { ...snapshot.candidateProfile } } : {}),
    completedPhases: [...snapshot.completedPhases],
    speechChecks: snapshot.speechChecks.map((check) => ({ ...check })),
    clapCount: snapshot.clapCount,
    ...(snapshot.liveResultId ? { liveResultId: snapshot.liveResultId } : {}),
    ...(snapshot.proposalId ? { proposalId: snapshot.proposalId } : {}),
    ...(snapshot.actionState ? { actionState: snapshot.actionState } : {}),
    ...(snapshot.deadlineRemainingMs !== undefined
      ? { deadlineRemainingMs: snapshot.deadlineRemainingMs }
      : {}),
    ...(snapshot.roomLevel !== undefined ? { roomLevel: snapshot.roomLevel } : {}),
  };
}

export function parseCalibrationSnapshot(value: unknown): CalibrationSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const allowed = new Set([
    'sessionId', 'phase', 'failedPhase', 'failureReason', 'microphoneLabel', 'previousProfile',
    'candidateProfile', 'completedPhases', 'speechChecks', 'clapCount', 'liveResultId',
    'proposalId', 'actionState', 'deadlineRemainingMs', 'roomLevel',
  ]);
  if (Object.keys(source).some((key) => !allowed.has(key))) return null;
  if (!boundedString(source.sessionId, 128)) return null;
  if (!isCalibrationPhase(source.phase)) return null;
  if (!Array.isArray(source.completedPhases) || source.completedPhases.length > 4) return null;
  if (!source.completedPhases.every(isActivePhase) || new Set(source.completedPhases).size !== source.completedPhases.length) return null;
  if (!Array.isArray(source.speechChecks) || source.speechChecks.length > 3) return null;
  const speechChecks: CalibrationSnapshot['speechChecks'] = [];
  for (const item of source.speechChecks) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const check = item as Record<string, unknown>;
    if (Object.keys(check).sort().join(',') !== 'passed,phraseId') return null;
    if (!isPhraseId(check.phraseId) || typeof check.passed !== 'boolean') return null;
    speechChecks.push({ phraseId: check.phraseId, passed: check.passed });
  }
  if (new Set(speechChecks.map((check) => check.phraseId)).size !== speechChecks.length) return null;
  if (!Number.isInteger(source.clapCount) || Number(source.clapCount) < 0 || Number(source.clapCount) > 3) return null;

  const failedPhase = source.failedPhase;
  const failureReason = source.failureReason;
  if (failedPhase !== undefined && !isActivePhase(failedPhase)) return null;
  if (failureReason !== undefined && !CALIBRATION_FAILURE_REASONS.includes(failureReason as CalibrationFailureReason)) return null;
  if (source.phase === 'failed') {
    if (!isActivePhase(failedPhase) || typeof failureReason !== 'string') return null;
    if (!(PHASE_FAILURE_SUBSETS[failedPhase] as readonly string[]).includes(failureReason)) return null;
  }
  if (source.microphoneLabel !== undefined && !boundedString(source.microphoneLabel, 256)) return null;
  if (source.liveResultId !== undefined && !boundedString(source.liveResultId, 1_024)) return null;
  if (source.proposalId !== undefined && !boundedString(source.proposalId, 1_024)) return null;
  if (source.actionState !== undefined && !['idle', 'working', 'succeeded', 'failed'].includes(String(source.actionState))) return null;
  if (source.deadlineRemainingMs !== undefined
    && (typeof source.deadlineRemainingMs !== 'number' || !Number.isFinite(source.deadlineRemainingMs) || source.deadlineRemainingMs < 0)) return null;
  if (source.roomLevel !== undefined
    && (typeof source.roomLevel !== 'number' || !Number.isFinite(source.roomLevel) || source.roomLevel < 0 || source.roomLevel > 1)) return null;
  const previousProfile = parseProfileSummary(source.previousProfile);
  const candidateProfile = parseProfileSummary(source.candidateProfile);
  if (source.previousProfile !== undefined && !previousProfile) return null;
  if (source.candidateProfile !== undefined && !candidateProfile) return null;

  return sanitizeCalibrationSnapshot({
    sessionId: source.sessionId,
    phase: source.phase,
    ...(isActivePhase(failedPhase) ? { failedPhase } : {}),
    ...(typeof failureReason === 'string' ? { failureReason: failureReason as CalibrationFailureReason } : {}),
    ...(typeof source.microphoneLabel === 'string' ? { microphoneLabel: source.microphoneLabel } : {}),
    ...(previousProfile ? { previousProfile } : {}),
    ...(candidateProfile ? { candidateProfile } : {}),
    completedPhases: [...source.completedPhases] as ActiveCalibrationPhase[],
    speechChecks,
    clapCount: source.clapCount as 0 | 1 | 2 | 3,
    ...(typeof source.liveResultId === 'string' ? { liveResultId: source.liveResultId } : {}),
    ...(typeof source.proposalId === 'string' ? { proposalId: source.proposalId } : {}),
    ...(typeof source.actionState === 'string' ? { actionState: source.actionState as CalibrationSnapshot['actionState'] } : {}),
    ...(typeof source.deadlineRemainingMs === 'number' ? { deadlineRemainingMs: source.deadlineRemainingMs } : {}),
    ...(typeof source.roomLevel === 'number' ? { roomLevel: source.roomLevel } : {}),
  });
}

function parseProfileSummary(value: unknown): AudioCalibrationProfileSummary | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const profile = value as Record<string, unknown>;
  const keys = [
    'schemaVersion', 'createdAt', 'ambientNoiseFloor', 'speechActivationFloor', 'clapPeak',
    'clapRms', 'clapCrest', 'clapSustainedEnergyLimit', 'inputSampleRate', 'liveResultId',
  ].sort();
  if (Object.keys(profile).sort().join(',') !== keys.join(',')) return null;
  if (profile.schemaVersion !== 1 || typeof profile.createdAt !== 'string' || Number.isNaN(Date.parse(profile.createdAt))) return null;
  for (const key of ['ambientNoiseFloor', 'speechActivationFloor', 'clapPeak', 'clapRms', 'clapCrest', 'clapSustainedEnergyLimit']) {
    if (typeof profile[key] !== 'number' || !Number.isFinite(profile[key]) || Number(profile[key]) < 0) return null;
  }
  if (!Number.isInteger(profile.inputSampleRate) || Number(profile.inputSampleRate) < 8_000 || Number(profile.inputSampleRate) > 384_000) return null;
  if (!boundedString(profile.liveResultId, 1_024)) return null;
  return { ...(profile as unknown as AudioCalibrationProfileSummary) };
}

function isCalibrationPhase(value: unknown): value is CalibrationPhase {
  return ['idle', 'room', 'speech', 'clap', 'live_canary', 'review', 'saved', 'failed'].includes(String(value));
}

function isActivePhase(value: unknown): value is ActiveCalibrationPhase {
  return value === 'room' || value === 'speech' || value === 'clap' || value === 'live_canary';
}

function isPhraseId(value: unknown): value is CalibrationPhraseId {
  return typeof value === 'string' && Object.hasOwn(CALIBRATION_PHRASES, value);
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && value.length <= maximum;
}
