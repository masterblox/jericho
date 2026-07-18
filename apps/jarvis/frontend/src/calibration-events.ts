export type ActiveCalibrationPhase = 'room' | 'speech' | 'clap' | 'live_canary';
export type CalibrationPhase = 'idle' | ActiveCalibrationPhase | 'review' | 'saved' | 'failed';
export type CalibrationCommand = 'start' | 'retry_phase' | 'exit' | 'apply' | 'discard' | 'create_fix_proposal';
export type CalibrationFailureReason =
  | 'mic_denied'
  | 'device_lost'
  | 'speaker_unavailable'
  | 'excessive_ambient_noise'
  | 'clipping'
  | 'insufficient_speech_energy'
  | 'invalid_clap'
  | 'gemini_connection_failed'
  | 'memory_unavailable'
  | 'event_duplication'
  | 'event_mismatch'
  | 'phase_timeout'
  | 'decision_scope_conflict'
  | 'profile_write_failed';

export type CalibrationPhraseId = 'voice_range_1' | 'voice_range_2' | 'voice_range_3';

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
}

export function isCalibrationCommand(value: unknown): value is CalibrationCommand {
  return typeof value === 'string' && VALID_CALIBRATION_COMMANDS.has(value);
}

export function parseCalibrationCommandDetail(detail: unknown): CalibrationCommand | null {
  if (!detail || typeof detail !== 'object') return null;
  const d = detail as Record<string, unknown>;
  const command = d.action ?? d.command;
  return isCalibrationCommand(command) ? command : null;
}

export function sanitizeCalibrationSnapshot(snapshot: CalibrationSnapshot): CalibrationSnapshot {
  return { ...snapshot };
}
