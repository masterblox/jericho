import {
  PHASE_FAILURE_SUBSETS,
  canonicalJson,
  type CalibrationFixProposalRequest,
  type GroundedTurnProgressEvent,
} from '@jericho/shared';
import type {
  AudioWindowMetrics,
  ClapMeasurement,
  ClapWakeCalibratedThresholds,
  LocalCalibrationSession,
} from './audio';
import {
  deriveAudioCalibrationProfile,
  deriveAudioCalibrationThresholds,
  type AudioCalibrationProfile,
  type AudioCalibrationProfileStore,
  type AudioCalibrationThresholds,
} from './audio-calibration-profile';
import type {
  CalibrationGreetingPhase,
  CalibrationNarrationEvent,
  GroundedResultPayload,
} from './bridge-client';
import type { CalibrationProposalClient } from './calibration-proposal-client';
import {
  JERICHO_AUDIO_CALIBRATION_STATE_EVENT,
  sanitizeCalibrationSnapshot,
  type ActiveCalibrationPhase,
  type AudioCalibrationProfileSummary,
  type CalibrationCommand,
  type CalibrationFailureReason,
  type CalibrationPhase,
  type CalibrationPhraseId,
  type CalibrationSnapshot,
} from './calibration-events';

const ROOM_DEADLINE_MS = 8_000;
const SPEECH_DEADLINE_MS = 45_000;
const CLAP_DEADLINE_MS = 30_000;
const LIVE_CANARY_DEADLINE_MS = 75_000;
const APPLY_DEADLINE_MS = 2_000;
const PROPOSAL_DEADLINE_MS = 10_000;
const ROOM_SETTLE_MS = 1_000;
const SPEECH_SETTLE_MS = 250;
const SPEECH_PHRASE_ORDER: readonly CalibrationPhraseId[] = [
  'voice_range_1',
  'voice_range_2',
  'voice_range_3',
];
const MAX_AMBIENT_RMS_P95 = 0.20;
const MAX_CLIPPED_SAMPLE_FRACTION = 0.01;
const MAX_CLAP_SUSTAINED_FRACTION = 0.18;

export interface CalibrationAudioPort {
  openLocalSession(): Promise<LocalCalibrationSession | null>;
  installTemporaryProfile(profile: Partial<ClapWakeCalibratedThresholds>): void;
  restoreProfile(profile: Partial<ClapWakeCalibratedThresholds> | null): void;
}

export interface CalibrationVoicePort {
  speakCalibrationPhrase(phraseId: CalibrationPhraseId): Promise<void>;
  cancelCalibrationPhrase(): void;
  addCalibrationTurnProgressListener(listener: (event: GroundedTurnProgressEvent) => void): () => void;
  addCalibrationNarrationListener(listener: (event: CalibrationNarrationEvent) => void): () => void;
  addCalibrationGreetingListener(listener: (phase: CalibrationGreetingPhase) => void): () => void;
  addCalibrationWakeListener(listener: (source: 'clap' | 'manual') => void): () => void;
  addCalibrationGroundedResultListener(listener: (result: GroundedResultPayload) => void): () => void;
  beginLiveCanary(): void;
  endLiveCanary(): void;
}

export interface CalibrationControllerOptions {
  audio: CalibrationAudioPort;
  voice: CalibrationVoicePort;
  profiles: AudioCalibrationProfileStore;
  proposals: Pick<CalibrationProposalClient, 'submitCalibrationFixProposal'>;
  eventTarget: EventTarget;
  clock: () => number;
  timers: {
    setTimeout: (callback: () => void, delayMs: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  };
  wallClock?: () => Date;
  buildSha?: string;
}

type ActionState = 'idle' | 'working' | 'succeeded' | 'failed';

interface CanaryCorrelation {
  stage: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  greetingStarted: boolean;
  turnId?: string;
  resultId?: string;
  seen: Set<string>;
}

let nextSessionId = 1;

export class CalibrationController {
  private sessionId = this.newSessionId();
  private phase: CalibrationPhase = 'idle';
  private failedPhase?: ActiveCalibrationPhase;
  private failureReason?: CalibrationFailureReason;
  private microphoneLabel?: string;
  private microphoneHash?: string;
  private inputSampleRate?: number;
  private completedPhases: ActiveCalibrationPhase[] = [];
  private speechChecks: Array<{ phraseId: CalibrationPhraseId; passed: boolean }> = [];
  private clapCount: 0 | 1 | 2 | 3 = 0;
  private liveResultId?: string;
  private proposalId?: string;
  private actionState: ActionState = 'idle';
  private deadlineRemainingMs?: number;
  private roomLevel?: number;

  private roomMetrics?: AudioWindowMetrics;
  private speechWindows: AudioWindowMetrics[] = [];
  private clapMeasurements: ClapMeasurement[] = [];
  private diagnosticMetrics?: AudioWindowMetrics;
  private temporaryThresholds?: AudioCalibrationThresholds;
  private candidateProfile?: AudioCalibrationProfile;
  private previousProfile?: AudioCalibrationProfile;
  private loadedProfileHash?: string;
  private session: LocalCalibrationSession | null = null;
  private canary?: CanaryCorrelation;

  private phaseToken: symbol | null = null;
  private phaseAbort: AbortController | null = null;
  private deadlineTimer: unknown = null;
  private phaseCleanups: Array<() => void> = [];
  private actionTimer: unknown = null;
  private actionToken: symbol | null = null;
  private disposed = false;

  constructor(private readonly options: CalibrationControllerOptions) {}

  snapshot(): CalibrationSnapshot {
    const previousProfile = this.previousProfile
      ? this.options.profiles.profileSummary(this.previousProfile)
      : undefined;
    const candidateProfile = this.candidateProfile
      ? this.options.profiles.profileSummary(this.candidateProfile)
      : undefined;
    return {
      sessionId: this.sessionId,
      phase: this.phase,
      failedPhase: this.failedPhase,
      failureReason: this.failureReason,
      microphoneLabel: this.microphoneLabel,
      previousProfile,
      candidateProfile,
      completedPhases: [...this.completedPhases],
      speechChecks: this.speechChecks.map((check) => ({ ...check })),
      clapCount: this.clapCount,
      liveResultId: this.liveResultId,
      proposalId: this.proposalId,
      actionState: this.actionState,
      deadlineRemainingMs: this.deadlineRemainingMs,
      roomLevel: this.roomLevel,
    };
  }

  async start(): Promise<void> {
    if (this.disposed) throw new Error('Calibration controller is disposed');
    if (this.phase !== 'idle') throw new Error('Calibration already in progress');
    this.resetAttempt();
    void this.runRoomPhase();
  }

  async loadApprovedProfile(): Promise<void> {
    if (this.disposed || this.phase !== 'idle') return;
    let session: LocalCalibrationSession | null = null;
    try {
      session = await this.options.audio.openLocalSession();
      if (!session || !/^[a-f0-9]{64}$/.test(session.identity.deviceHash)) {
        this.options.audio.restoreProfile(null);
        return;
      }
      const approved = this.options.profiles.loadApproved(session.identity.deviceHash);
      this.options.audio.restoreProfile(approved ? toDetectorThresholds(approved) : null);
    } catch {
      this.options.audio.restoreProfile(null);
    } finally {
      session?.close();
    }
  }

  async retryPhase(): Promise<void> {
    const failedPhase = this.failedPhase;
    if (this.disposed) throw new Error('Calibration controller is disposed');
    if (this.phase !== 'failed' || !failedPhase) throw new Error('Nothing to retry');
    this.failureReason = undefined;
    this.actionState = 'idle';
    this.proposalId = undefined;
    this.prepareRetry(failedPhase);
    void this.resumePhase(failedPhase);
  }

  exit(): void {
    if (this.disposed) return;
    this.cancelAllWork();
    this.restorePreviousProfile();
    this.phase = 'idle';
    this.actionState = 'idle';
    this.publish();
  }

  async applyProfile(): Promise<void> {
    if (this.phase !== 'review' || !this.candidateProfile) {
      throw new Error('No candidate to apply');
    }
    if (this.actionState === 'working') throw new Error('Calibration action already in progress');
    const token = this.beginAction(APPLY_DEADLINE_MS, () => {
      if (this.phase !== 'review') return;
      this.failureReason = 'profile_write_failed';
      this.actionState = 'failed';
      this.publish();
    });
    try {
      this.options.profiles.commitApproved(this.candidateProfile);
      if (!this.isCurrentAction(token)) return;
      this.previousProfile = this.candidateProfile;
      this.actionState = 'succeeded';
      this.phase = 'saved';
      this.failureReason = undefined;
      this.publish();
    } catch {
      if (!this.isCurrentAction(token)) return;
      this.failureReason = 'profile_write_failed';
      this.actionState = 'failed';
      this.publish();
    } finally {
      this.finishAction(token);
    }
  }

  discardProfile(): void {
    if (this.phase !== 'review') return;
    this.candidateProfile = undefined;
    this.cancelAllWork();
    this.restorePreviousProfile();
    this.phase = 'idle';
    this.actionState = 'succeeded';
    this.publish();
  }

  async createFixProposal(): Promise<void> {
    if (this.phase !== 'failed' || !this.failedPhase || !this.failureReason) {
      throw new Error('Fix proposals only available from failed state');
    }
    if (this.actionState === 'working') throw new Error('Calibration action already in progress');

    const request: CalibrationFixProposalRequest = {
      schemaVersion: 1,
      sessionId: this.sessionId,
      buildSha: this.buildSha(),
      ...(this.microphoneHash ? { micDeviceHash: this.microphoneHash } : {}),
      failedPhase: this.failedPhase,
      failureReason: this.failureReason,
      aggregateMetrics: this.diagnosticMetrics ? { ...this.diagnosticMetrics } : {},
      ...(this.liveResultId ? { correlatedResultId: this.liveResultId } : {}),
    };
    const idempotencyKey = await sha256Hex(canonicalJson(request));
    const token = this.beginAction(PROPOSAL_DEADLINE_MS, () => {
      this.actionState = 'failed';
      this.publish();
    });

    try {
      const response = await this.options.proposals.submitCalibrationFixProposal(request, idempotencyKey);
      if (!this.isCurrentAction(token)) return;
      this.proposalId = response.proposalId;
      this.actionState = 'succeeded';
      this.publish();
    } catch {
      if (!this.isCurrentAction(token)) return;
      this.actionState = 'failed';
      this.publish();
    } finally {
      this.finishAction(token);
    }
  }

  reportDecisionScopeConflict(): void {
    if (this.phase !== 'review') return;
    this.failureReason = 'decision_scope_conflict';
    this.actionState = 'failed';
    this.publish();
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancelAllWork();
    this.restorePreviousProfile();
    this.phase = 'idle';
    this.publish();
    this.disposed = true;
  }

  handleCommand(command: CalibrationCommand): void {
    switch (command) {
      case 'start': void this.start().catch(() => undefined); break;
      case 'retry_phase': void this.retryPhase().catch(() => undefined); break;
      case 'exit': this.exit(); break;
      case 'apply': void this.applyProfile().catch(() => undefined); break;
      case 'discard': this.discardProfile(); break;
      case 'create_fix_proposal': void this.createFixProposal().catch(() => undefined); break;
    }
  }

  private async runRoomPhase(): Promise<void> {
    const context = this.beginPhase('room', ROOM_DEADLINE_MS);
    try {
      const session = await this.ensureSession('room');
      if (!session || !this.isCurrentPhase(context.token, 'room')) return;
      const stopLevel = session.observeLevel((rms) => {
        if (!this.isCurrentPhase(context.token, 'room') || !Number.isFinite(rms)) return;
        this.roomLevel = Math.max(0, Math.min(1, rms));
        this.publish();
      });
      this.phaseCleanups.push(stopLevel);
      await this.delay(ROOM_SETTLE_MS, context.signal);
      if (!this.isCurrentPhase(context.token, 'room')) return;
      const metrics = await session.measure({ mode: 'room', durationMs: 5_000, signal: context.signal });
      if (!this.isCurrentPhase(context.token, 'room')) return;
      this.roomMetrics = metrics;
      this.diagnosticMetrics = metrics;
      if (metrics.rmsP95 > MAX_AMBIENT_RMS_P95) {
        this.fail('excessive_ambient_noise');
        return;
      }
      this.completePhase('room');
      this.roomLevel = undefined;
      void this.runSpeechPhase();
    } catch (error) {
      this.handlePhaseError(context.token, 'room', error, 'device_lost');
    }
  }

  private async runSpeechPhase(): Promise<void> {
    const context = this.beginPhase('speech', SPEECH_DEADLINE_MS);
    this.speechChecks = [];
    this.speechWindows = [];
    try {
      const session = await this.ensureSession('speech');
      if (!session || !this.isCurrentPhase(context.token, 'speech')) return;
      const room = this.roomMetrics;
      if (!room) {
        this.fail('device_lost');
        return;
      }
      for (const phraseId of SPEECH_PHRASE_ORDER) {
        try {
          await this.options.voice.speakCalibrationPhrase(phraseId);
        } catch {
          if (this.isCurrentPhase(context.token, 'speech')) this.fail('speaker_unavailable');
          return;
        }
        await this.delay(SPEECH_SETTLE_MS, context.signal);
        if (!this.isCurrentPhase(context.token, 'speech')) return;
        const metrics = await session.measure({ mode: 'speech', durationMs: 3_000, signal: context.signal });
        if (!this.isCurrentPhase(context.token, 'speech')) return;
        this.diagnosticMetrics = metrics;
        if (metrics.clippedSampleFraction > MAX_CLIPPED_SAMPLE_FRACTION) {
          this.speechChecks.push({ phraseId, passed: false });
          this.publish();
          this.fail('clipping');
          return;
        }
        const passed = metrics.rmsMean >= Math.max(0.01, room.rmsP95 * 2.2)
          && metrics.sustainedEnergyFraction >= 0.05;
        this.speechChecks.push({ phraseId, passed });
        this.publish();
        if (!passed) {
          this.fail('insufficient_speech_energy');
          return;
        }
        this.speechWindows.push(metrics);
      }
      if (this.speechWindows.length !== 3) {
        this.fail('insufficient_speech_energy');
        return;
      }
      this.completePhase('speech');
      void this.runClapPhase();
    } catch (error) {
      this.handlePhaseError(context.token, 'speech', error, 'device_lost');
    }
  }

  private async runClapPhase(): Promise<void> {
    const context = this.beginPhase('clap', CLAP_DEADLINE_MS);
    this.clapCount = 0;
    this.clapMeasurements = [];
    try {
      const session = await this.ensureSession('clap');
      if (!session || !this.isCurrentPhase(context.token, 'clap')) return;
      const unsubscribe = session.observeClaps((measurement) => {
        if (!this.isCurrentPhase(context.token, 'clap')) return;
        if (!validClap(measurement)) {
          this.fail('invalid_clap');
          return;
        }
        this.clapMeasurements.push({ ...measurement });
        this.clapCount = this.clapMeasurements.length as 1 | 2 | 3;
        this.publish();
        if (this.clapMeasurements.length !== 3) return;
        try {
          this.temporaryThresholds = deriveAudioCalibrationThresholds(
            this.roomMetrics!,
            this.speechWindows,
            this.clapMeasurements,
          );
        } catch {
          this.fail('invalid_clap');
          return;
        }
        this.completePhase('clap');
        void this.runLiveCanaryPhase();
      });
      this.phaseCleanups.push(unsubscribe);
    } catch (error) {
      this.handlePhaseError(context.token, 'clap', error, 'mic_denied');
    }
  }

  private async runLiveCanaryPhase(): Promise<void> {
    const context = this.beginPhase('live_canary', LIVE_CANARY_DEADLINE_MS);
    try {
      if (!this.temporaryThresholds || !this.roomMetrics || this.speechWindows.length !== 3 || this.clapMeasurements.length !== 3) {
        this.fail('event_mismatch');
        return;
      }
      this.closeSession();
      this.options.audio.installTemporaryProfile(toDetectorThresholds(this.temporaryThresholds));
      this.canary = { stage: 0, greetingStarted: false, seen: new Set() };
      this.phaseCleanups.push(
        this.options.voice.addCalibrationWakeListener((source) => this.onCanaryWake(source)),
        this.options.voice.addCalibrationGreetingListener((phase) => this.onCanaryGreeting(phase)),
        this.options.voice.addCalibrationTurnProgressListener((event) => this.onCanaryProgress(event)),
        this.options.voice.addCalibrationGroundedResultListener((result) => this.onCanaryResult(result)),
        this.options.voice.addCalibrationNarrationListener((event) => this.onCanaryNarration(event)),
      );
      if (!this.isCurrentPhase(context.token, 'live_canary')) return;
      this.options.voice.beginLiveCanary();
    } catch {
      if (this.isCurrentPhase(context.token, 'live_canary')) this.fail('gemini_connection_failed');
    }
  }

  private onCanaryWake(source: 'clap' | 'manual'): void {
    const canary = this.canary;
    if (!canary || this.phase !== 'live_canary') return;
    if (this.isDuplicate(canary, 'wake')) return;
    if (canary.stage !== 0 || source !== 'clap') {
      this.fail('event_mismatch');
      return;
    }
    canary.stage = 1;
  }

  private onCanaryGreeting(phase: CalibrationGreetingPhase): void {
    const canary = this.canary;
    if (!canary || this.phase !== 'live_canary') return;
    const key = `greeting:${phase}`;
    if (this.isDuplicate(canary, key)) return;
    if (canary.stage !== 1) {
      this.fail('event_mismatch');
      return;
    }
    if (phase === 'started') {
      canary.greetingStarted = true;
      return;
    }
    canary.stage = 2;
  }

  private onCanaryProgress(event: GroundedTurnProgressEvent): void {
    const canary = this.canary;
    if (!canary || this.phase !== 'live_canary') return;
    const key = `progress:${event.milestone}`;
    if (this.isDuplicate(canary, key)) return;
    if (event.milestone === 'capture_committed') {
      if (canary.stage !== 2) return this.fail('event_mismatch');
      canary.turnId = event.turnId;
      canary.stage = 3;
      return;
    }
    if (event.milestone === 'retrieval_started') {
      if (canary.stage !== 3 || event.turnId !== canary.turnId || !event.resultId) {
        return this.fail('event_mismatch');
      }
      canary.resultId = event.resultId;
      canary.stage = 4;
      return;
    }
    if (
      canary.stage !== 5
      || event.turnId !== canary.turnId
      || !event.resultId
      || event.resultId !== canary.resultId
    ) {
      return this.fail('event_mismatch');
    }
    canary.stage = 6;
  }

  private onCanaryResult(result: GroundedResultPayload): void {
    const canary = this.canary;
    if (!canary || this.phase !== 'live_canary') return;
    const terminal = result.phase !== 'retrieving';
    const key = terminal ? 'result:terminal' : 'result:retrieving';
    if (this.isDuplicate(canary, key)) return;
    if (result.phase === 'ambiguous' || result.phase === 'unavailable') {
      this.fail('memory_unavailable');
      return;
    }
    if (result.resultId !== canary.resultId) {
      this.fail('event_mismatch');
      return;
    }
    if (result.phase === 'retrieving') {
      if (canary.stage !== 4) return this.fail('event_mismatch');
      canary.stage = 5;
      return;
    }
    if (result.phase !== 'resolved' || canary.stage !== 6) {
      this.fail('event_mismatch');
      return;
    }
    if (!isAcceptedCanaryResult(result)) {
      this.fail('memory_unavailable');
      return;
    }
    try {
      this.candidateProfile = deriveAudioCalibrationProfile(
        this.roomMetrics!,
        this.speechWindows,
        this.clapMeasurements,
        this.microphoneHash!,
        this.inputSampleRate!,
        result.resultId,
        (this.options.wallClock?.() ?? new Date()).toISOString(),
      );
    } catch {
      this.fail('memory_unavailable');
      return;
    }
    this.liveResultId = result.resultId;
    canary.stage = 7;
    this.publish();
  }

  private onCanaryNarration(event: CalibrationNarrationEvent): void {
    const canary = this.canary;
    if (!canary || this.phase !== 'live_canary') return;
    const key = `narration:${event.phase}`;
    if (this.isDuplicate(canary, key)) return;
    if (event.resultId !== canary.resultId) {
      this.fail('event_mismatch');
      return;
    }
    if (event.phase === 'started') {
      if (canary.stage !== 7) return this.fail('event_mismatch');
      canary.stage = 8;
      return;
    }
    if (canary.stage !== 8) {
      this.fail('event_mismatch');
      return;
    }
    this.completePhase('live_canary');
    this.options.voice.endLiveCanary();
    this.phase = 'review';
    this.actionState = 'idle';
    this.failureReason = undefined;
    this.failedPhase = undefined;
    this.publish();
  }

  private isDuplicate(canary: CanaryCorrelation, key: string): boolean {
    if (!canary.seen.has(key)) {
      canary.seen.add(key);
      return false;
    }
    this.fail('event_duplication');
    return true;
  }

  private async ensureSession(phase: ActiveCalibrationPhase): Promise<LocalCalibrationSession | null> {
    if (this.session) return this.session;
    let session: LocalCalibrationSession | null;
    try {
      session = await this.options.audio.openLocalSession();
    } catch {
      session = null;
    }
    if (!session) {
      this.fail(phase === 'room' ? 'mic_denied' : 'mic_denied');
      return null;
    }
    const { deviceHash, label, sampleRate } = session.identity;
    if (!/^[a-f0-9]{64}$/.test(deviceHash) || !Number.isInteger(sampleRate)) {
      session.close();
      this.fail('device_lost');
      return null;
    }
    if (this.microphoneHash && this.microphoneHash !== deviceHash) {
      session.close();
      this.fail('device_lost');
      return null;
    }
    this.session = session;
    this.microphoneHash = deviceHash;
    this.microphoneLabel = label.trim() || 'Default microphone';
    this.inputSampleRate = sampleRate;
    if (this.loadedProfileHash !== deviceHash) {
      this.previousProfile = this.options.profiles.loadApproved(deviceHash) ?? undefined;
      this.loadedProfileHash = deviceHash;
      this.restorePreviousProfile();
    }
    this.publish();
    return session;
  }

  private beginPhase(phase: ActiveCalibrationPhase, deadlineMs: number): { token: symbol; signal: AbortSignal } {
    this.clearPhaseWork();
    const token = Symbol(phase);
    const abort = new AbortController();
    this.phaseToken = token;
    this.phaseAbort = abort;
    this.phase = phase;
    this.failedPhase = undefined;
    this.failureReason = undefined;
    this.actionState = 'idle';
    this.deadlineRemainingMs = deadlineMs;
    this.deadlineTimer = this.options.timers.setTimeout(() => {
      if (this.isCurrentPhase(token, phase)) this.fail('phase_timeout');
    }, deadlineMs);
    this.publish();
    return { token, signal: abort.signal };
  }

  private completePhase(phase: ActiveCalibrationPhase): void {
    if (!this.completedPhases.includes(phase)) this.completedPhases.push(phase);
    this.clearPhaseWork();
  }

  private fail(reason: CalibrationFailureReason): void {
    if (!isActivePhase(this.phase)) return;
    const failedPhase = this.phase;
    if (!(PHASE_FAILURE_SUBSETS[failedPhase] as readonly CalibrationFailureReason[]).includes(reason)) {
      reason = 'phase_timeout';
    }
    this.clearPhaseWork();
    this.closeSession();
    this.options.voice.cancelCalibrationPhrase();
    this.options.voice.endLiveCanary();
    this.restorePreviousProfile();
    this.failedPhase = failedPhase;
    this.failureReason = reason;
    this.phase = 'failed';
    this.actionState = 'idle';
    this.publish();
  }

  private handlePhaseError(
    token: symbol,
    phase: ActiveCalibrationPhase,
    error: unknown,
    fallback: CalibrationFailureReason,
  ): void {
    if (!this.isCurrentPhase(token, phase)) return;
    if (isAbortError(error)) this.fail('phase_timeout');
    else this.fail(fallback);
  }

  private isCurrentPhase(token: symbol, phase: ActiveCalibrationPhase): boolean {
    return !this.disposed && this.phaseToken === token && this.phase === phase;
  }

  private clearPhaseWork(): void {
    if (this.deadlineTimer !== null) {
      this.options.timers.clearTimeout(this.deadlineTimer);
      this.deadlineTimer = null;
    }
    this.phaseAbort?.abort();
    this.phaseAbort = null;
    this.phaseToken = null;
    for (const cleanup of this.phaseCleanups.splice(0)) cleanup();
    this.deadlineRemainingMs = undefined;
  }

  private closeSession(): void {
    this.session?.close();
    this.session = null;
  }

  private cancelAllWork(): void {
    this.clearPhaseWork();
    this.finishAction(this.actionToken);
    this.closeSession();
    this.options.voice.cancelCalibrationPhrase();
    this.options.voice.endLiveCanary();
    this.canary = undefined;
  }

  private restorePreviousProfile(): void {
    this.options.audio.restoreProfile(
      this.previousProfile ? toDetectorThresholds(this.previousProfile) : null,
    );
  }

  private prepareRetry(phase: ActiveCalibrationPhase): void {
    if (phase === 'room') {
      this.completedPhases = [];
      this.roomMetrics = undefined;
      this.speechWindows = [];
      this.speechChecks = [];
      this.clapMeasurements = [];
      this.clapCount = 0;
      this.temporaryThresholds = undefined;
    } else if (phase === 'speech') {
      this.completedPhases = this.completedPhases.filter((item) => item === 'room');
      this.speechWindows = [];
      this.speechChecks = [];
      this.clapMeasurements = [];
      this.clapCount = 0;
      this.temporaryThresholds = undefined;
    } else if (phase === 'clap') {
      this.completedPhases = this.completedPhases.filter((item) => item === 'room' || item === 'speech');
      this.clapMeasurements = [];
      this.clapCount = 0;
      this.temporaryThresholds = undefined;
    }
    this.candidateProfile = undefined;
    this.liveResultId = undefined;
    this.roomLevel = undefined;
    this.canary = undefined;
  }

  private resumePhase(phase: ActiveCalibrationPhase): void {
    if (phase === 'room') void this.runRoomPhase();
    else if (phase === 'speech') void this.runSpeechPhase();
    else if (phase === 'clap') void this.runClapPhase();
    else void this.runLiveCanaryPhase();
  }

  private resetAttempt(): void {
    this.cancelAllWork();
    this.restorePreviousProfile();
    this.sessionId = this.newSessionId();
    this.failedPhase = undefined;
    this.failureReason = undefined;
    this.microphoneLabel = undefined;
    this.microphoneHash = undefined;
    this.inputSampleRate = undefined;
    this.loadedProfileHash = undefined;
    this.previousProfile = undefined;
    this.candidateProfile = undefined;
    this.roomMetrics = undefined;
    this.speechWindows = [];
    this.clapMeasurements = [];
    this.diagnosticMetrics = undefined;
    this.temporaryThresholds = undefined;
    this.completedPhases = [];
    this.speechChecks = [];
    this.clapCount = 0;
    this.liveResultId = undefined;
    this.proposalId = undefined;
    this.actionState = 'idle';
  }

  private beginAction(deadlineMs: number, onTimeout: () => void): symbol {
    this.finishAction(this.actionToken);
    const token = Symbol('calibration-action');
    this.actionToken = token;
    this.actionState = 'working';
    this.actionTimer = this.options.timers.setTimeout(() => {
      if (!this.isCurrentAction(token)) return;
      this.actionToken = null;
      this.actionTimer = null;
      onTimeout();
    }, deadlineMs);
    this.publish();
    return token;
  }

  private finishAction(token: symbol | null): void {
    if (!token || this.actionToken !== token) return;
    if (this.actionTimer !== null) this.options.timers.clearTimeout(this.actionTimer);
    this.actionTimer = null;
    this.actionToken = null;
  }

  private isCurrentAction(token: symbol): boolean {
    return !this.disposed && this.actionToken === token;
  }

  private delay(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const timer = this.options.timers.setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        this.options.timers.clearTimeout(timer);
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private publish(): void {
    if (this.disposed) return;
    this.options.eventTarget.dispatchEvent(new CustomEvent(
      JERICHO_AUDIO_CALIBRATION_STATE_EVENT,
      { detail: sanitizeCalibrationSnapshot(this.snapshot()) },
    ));
  }

  private buildSha(): string {
    const value = this.options.buildSha
      ?? (typeof __JERICHO_COMMIT__ === 'string' ? __JERICHO_COMMIT__ : '0000000');
    return /^[a-f0-9]{7,40}$/.test(value) ? value : '0000000';
  }

  private newSessionId(): string {
    return `cal-${nextSessionId++}-${Date.now()}`;
  }
}

function isActivePhase(phase: CalibrationPhase): phase is ActiveCalibrationPhase {
  return phase === 'room' || phase === 'speech' || phase === 'clap' || phase === 'live_canary';
}

function validClap(measurement: ClapMeasurement): boolean {
  return Object.values(measurement).every((value) => Number.isFinite(value) && value >= 0)
    && measurement.peak > 0
    && measurement.rms > 0
    && measurement.crestFactor >= 2.5
    && measurement.sustainedEnergyFraction <= MAX_CLAP_SUSTAINED_FRACTION;
}

function toDetectorThresholds(
  profile: AudioCalibrationThresholds | AudioCalibrationProfile,
): ClapWakeCalibratedThresholds {
  return {
    clapPeakMin: profile.clapPeak,
    clapRmsMin: profile.clapRms,
    clapCrestMin: profile.clapCrest,
    clapSustainedEnergyLimit: profile.clapSustainedEnergyLimit,
  };
}

function isAcceptedCanaryResult(result: GroundedResultPayload): boolean {
  const identity = [result.subject, result.fullName, result.canonicalIdentity]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  if (!identity.includes('isabella handel')) return false;
  const supported = [
    ...(result.employment ?? []),
    ...(result.claims ?? []).map((claim) => claim.text),
  ];
  if (!supported.some((text) => /\bmasterblox\b/i.test(text))) return false;
  const relationshipAssertions = [
    result.relationship,
    result.summary,
    ...(result.claims ?? []).map((claim) => claim.text),
  ].filter((value): value is string => typeof value === 'string');
  return !relationshipAssertions.some(assertsCarlosSpouseRelationship);
}

function assertsCarlosSpouseRelationship(text: string): boolean {
  const normalized = text.toLowerCase();
  if (!/\bcarlos(?:\s+prada)?\b/.test(normalized)) return false;
  if (!/\b(wife|husband|spouse|married|marriage)\b/.test(normalized)) return false;
  if (/\b(no|not|never|unsupported|unverified|unconfirmed|excluded|conflicting|does not|isn't|is not)\b/.test(normalized)) {
    return false;
  }
  return true;
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
