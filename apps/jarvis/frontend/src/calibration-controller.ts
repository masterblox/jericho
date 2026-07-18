import type { AudioWindowMetrics, ClapMeasurement, LocalCalibrationSession } from './audio';
import type { AudioCalibrationProfile, AudioCalibrationProfileStore } from './audio-calibration-profile';
import type { CalibrationPhraseId, GroundedTurnProgressEvent } from './bridge-client';
import type { CalibrationProposalClient } from './calibration-proposal-client';
import {
  JERICHO_AUDIO_CALIBRATION_STATE_EVENT,
  sanitizeCalibrationSnapshot,
  type ActiveCalibrationPhase,
  type CalibrationCommand,
  type CalibrationFailureReason,
  type CalibrationPhase,
  type CalibrationSnapshot,
  type AudioCalibrationProfileSummary,
} from './calibration-events';

const ROOM_DEADLINE_MS = 8_000;
const SPEECH_DEADLINE_MS = 45_000;
const CLAP_DEADLINE_MS = 30_000;
const LIVE_CANARY_DEADLINE_MS = 75_000;
const APPLY_DEADLINE_MS = 2_000;
const PROPOSAL_DEADLINE_MS = 10_000;

const SPEECH_SETTLE_MS = 250;
const SPEECH_PHRASE_ORDER: CalibrationPhraseId[] = ['voice_range_1', 'voice_range_2', 'voice_range_3'];

export interface CalibrationAudioPort {
  openLocalSession(): Promise<LocalCalibrationSession | null>;
  installTemporaryProfile(profile: Partial<{ clapPeakMin: number; clapRmsMin: number; clapCrestMin: number; clapSustainedEnergyLimit: number }>): void;
  restoreDefaultProfile(): void;
}

export interface CalibrationVoicePort {
  speakCalibrationPhrase(phraseId: CalibrationPhraseId): void;
  addCalibrationTurnProgressListener(listener: (event: GroundedTurnProgressEvent) => void): () => void;
  addCalibrationNarrationListener(listener: (event: { resultId: string; phase: 'started' | 'complete' }) => void): () => void;
  beginLiveCanary(): void;
  endLiveCanary(): void;
}

export interface CalibrationControllerOptions {
  audio: CalibrationAudioPort;
  voice: CalibrationVoicePort;
  profiles: AudioCalibrationProfileStore;
  proposals: CalibrationProposalClient;
  eventTarget: EventTarget;
  clock: () => number;
  timers: {
    setTimeout: (callback: () => void, delayMs: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  };
}

let nextSessionId = 1;

export class CalibrationController {
  private sessionId = `cal-${nextSessionId++}-${Date.now()}`;
  private phase: CalibrationPhase = 'idle';
  private failedPhase?: ActiveCalibrationPhase;
  private failureReason?: CalibrationFailureReason;
  private microphoneLabel?: string;
  private completedPhases: ActiveCalibrationPhase[] = [];
  private speechChecks: Array<{ phraseId: CalibrationPhraseId; passed: boolean }> = [];
  private clapCount: 0 | 1 | 2 | 3 = 0;
  private liveResultId?: string;
  private proposalId?: string;
  private actionState: 'idle' | 'working' | 'succeeded' | 'failed' = 'idle';
  private deadlineRemainingMs?: number;

  private candidateProfile?: AudioCalibrationProfile;
  private previousProfile?: AudioCalibrationProfile;
  private session: LocalCalibrationSession | null = null;
  private deadlineTimer: unknown = null;
  private cleanupFns: Array<() => void> = [];
  private disposed = false;

  constructor(private options: CalibrationControllerOptions) {}

  snapshot(): CalibrationSnapshot {
    const previousSummary = this.previousProfile
      ? this.options.profiles.profileSummary(this.previousProfile)
      : undefined;
    const candidateSummary = this.candidateProfile
      ? this.options.profiles.profileSummary(this.candidateProfile)
      : undefined;

    return {
      sessionId: this.sessionId,
      phase: this.phase,
      failedPhase: this.failedPhase,
      failureReason: this.failureReason,
      microphoneLabel: this.microphoneLabel,
      previousProfile: previousSummary,
      candidateProfile: candidateSummary,
      completedPhases: [...this.completedPhases],
      speechChecks: [...this.speechChecks],
      clapCount: this.clapCount,
      liveResultId: this.liveResultId,
      proposalId: this.proposalId,
      actionState: this.actionState,
      deadlineRemainingMs: this.deadlineRemainingMs,
    };
  }

  async start(): Promise<void> {
    if (this.phase !== 'idle') throw new Error('Calibration already in progress');
    this.transition('room');
    // Start the chain; each phase advances to the next
    void this.runRoomPhase();
  }

  async retryPhase(): Promise<void> {
    const failedPhase = this.failedPhase;
    if (this.phase !== 'failed' || !failedPhase) throw new Error('Nothing to retry');
    this.transition(failedPhase);
    await this.resumePhase(failedPhase);
  }

  exit(): void {
    this.cleanupInternal();
    this.transition('idle');
  }

  async applyProfile(): Promise<void> {
    if (this.phase !== 'review' || !this.candidateProfile) throw new Error('No candidate to apply');
    this.actionState = 'working';
    this.publish();
    try {
      this.options.profiles.commitApproved(this.candidateProfile);
      this.actionState = 'succeeded';
      this.transition('saved');
    } catch {
      this.actionState = 'failed';
      this.failureReason = 'profile_write_failed';
      this.publish();
    }
  }

  discardProfile(): void {
    if (this.phase !== 'review') return;
    this.candidateProfile = undefined;
    this.options.audio.restoreDefaultProfile();
    this.cleanupInternal();
    this.transition('idle');
  }

  async createFixProposal(): Promise<void> {
    if (this.phase !== 'failed') throw new Error('Fix proposals only available from failed state');
    this.actionState = 'working';
    this.publish();

    try {
      this.setDeadline(PROPOSAL_DEADLINE_MS);
      const response = await this.options.proposals.submitCalibrationFixProposal(
        {
          schemaVersion: 1,
          sessionId: this.sessionId,
          buildSha: (globalThis as any).__JERICHO_COMMIT__ ?? '0000000',
          failedPhase: this.failedPhase ?? 'room',
          failureReason: this.failureReason ?? 'phase_timeout',
          aggregateMetrics: {},
        },
        await this.computeIdempotencyKey(),
      );
      this.proposalId = response.proposalId;
      this.actionState = 'succeeded';
    } catch {
      this.actionState = 'failed';
    }
    this.clearDeadline();
    this.publish();
  }

  dispose(): void {
    this.disposed = true;
    this.cleanupInternal();
    this.transition('idle');
  }

  handleCommand(command: CalibrationCommand): void {
    switch (command) {
      case 'start': void this.start(); break;
      case 'retry_phase': void this.retryPhase(); break;
      case 'exit': this.exit(); break;
      case 'apply': void this.applyProfile(); break;
      case 'discard': this.discardProfile(); break;
      case 'create_fix_proposal': void this.createFixProposal(); break;
    }
  }

  // --- private phase runners ---

  private async runRoomPhase(): Promise<void> {
    try {
      this.setDeadline(ROOM_DEADLINE_MS);
      this.session = await this.openSession();
      if (!this.session) { this.fail('mic_denied'); return; }

      const metrics = await this.session.measure({
        mode: 'room',
        durationMs: 5_000,
        signal: AbortSignal.timeout(ROOM_DEADLINE_MS),
      });

      if (metrics.rmsP95 > 0.20) {
        this.fail('excessive_ambient_noise');
        return;
      }

      this.completedPhases.push('room');
      this.clearDeadline();
      this.transition('speech');
      await this.runSpeechPhase();
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        this.fail('phase_timeout');
      } else {
        this.fail(this.phase === 'room' ? 'device_lost' : 'device_lost');
      }
    }
  }

  private async runSpeechPhase(): Promise<void> {
    try {
      this.setDeadline(SPEECH_DEADLINE_MS);
      if (!this.session) { this.fail('device_lost'); return; }

      this.speechChecks = [];
      const speechResults: AudioWindowMetrics[] = [];

      for (const phraseId of SPEECH_PHRASE_ORDER) {
        // Request phrase playback from bridge
        this.options.voice.speakCalibrationPhrase(phraseId);

        // Wait for settle period then measure
        await this.delay(SPEECH_SETTLE_MS);
        if (this.phase !== 'speech') return;

        const metrics = await this.session.measure({
          mode: 'speech',
          durationMs: 3_000,
          signal: AbortSignal.timeout(SPEECH_DEADLINE_MS),
        });

        const passed = metrics.rmsMean > 0.04 && !(metrics.clippedSampleFraction > 0.1);
        this.speechChecks.push({ phraseId, passed });
        if (passed) speechResults.push(metrics);
        this.publish();
      }

      if (speechResults.length === 0) {
        this.fail('insufficient_speech_energy');
        return;
      }

      this.completedPhases.push('speech');
      this.clearDeadline();
      this.transition('clap');
      await this.runClapPhase();
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        this.fail('phase_timeout');
      } else {
        this.fail('device_lost');
      }
    }
  }

  private async runClapPhase(): Promise<void> {
    try {
      this.setDeadline(CLAP_DEADLINE_MS);
      if (!this.session) { this.fail('device_lost'); return; }

      this.clapCount = 0;

      const unsubClaps = this.session.observeClaps((_measurement) => {
        if (this.phase !== 'clap') return;
        if (_measurement.sustainedEnergyFraction > 0.08) return; // reject speech-like
        this.clapCount = Math.min(3, this.clapCount + 1) as 0 | 1 | 2 | 3;
        this.publish();
        if (this.clapCount >= 3) {
          this.onClapPhaseComplete();
        }
      });
      this.cleanupFns.push(unsubClaps);
    } catch {
      this.fail('mic_denied');
    }
  }

  private onClapPhaseComplete(): void {
    if (this.phase !== 'clap') return;
    this.completedPhases.push('clap');
    this.clearDeadline();
    this.transition('live_canary');
    void this.runLiveCanaryPhase();
  }

  private async runLiveCanaryPhase(): Promise<void> {
    try {
      this.setDeadline(LIVE_CANARY_DEADLINE_MS);

      // Close local measurement, install candidate, begin ordinary wake
      this.session?.close();
      this.session = null;
      this.options.audio.installTemporaryProfile({
        clapSustainedEnergyLimit: this.candidateProfile?.clapSustainedEnergyLimit,
      });
      this.options.voice.beginLiveCanary();

      // Subscribe to progress events
      const progressCleanup = this.options.voice.addCalibrationTurnProgressListener((event) => {
        if (this.phase !== 'live_canary') return;
        if (event.milestone === 'terminal_result_sent' && event.resultId) {
          this.liveResultId = event.resultId;
          this.publish();
        }
      });
      this.cleanupFns.push(progressCleanup);

      const narrationCleanup = this.options.voice.addCalibrationNarrationListener((event) => {
        if (this.phase !== 'live_canary') return;
        if (event.phase === 'complete') {
          this.onLiveCanaryComplete();
        }
      });
      this.cleanupFns.push(narrationCleanup);
    } catch {
      this.fail('gemini_connection_failed');
    }
  }

  private onLiveCanaryComplete(): void {
    if (this.phase !== 'live_canary') return;
    this.options.voice.endLiveCanary();
    this.completedPhases.push('live_canary');
    this.clearDeadline();
    this.transition('review');
  }

  // --- helpers ---

  private async openSession(): Promise<LocalCalibrationSession | null> {
    try {
      const session = await this.options.audio.openLocalSession();
      if (!session) return null;
      this.microphoneLabel = session.identity.label;
      return session;
    } catch {
      return null;
    }
  }

  private fail(reason: CalibrationFailureReason): void {
    this.clearDeadline();
    this.session?.close();
    this.session = null;
    this.failureReason = reason;
    this.failedPhase = this.phase === 'idle' ? undefined : this.phase as ActiveCalibrationPhase;
    this.transition('failed');
  }

  private transition(next: CalibrationPhase): void {
    if (this.disposed) return;
    this.phase = next;
    this.actionState = 'idle';
    this.publish();
  }

  private publish(): void {
    if (this.disposed) return;
    const snapshot = sanitizeCalibrationSnapshot(this.snapshot());
    this.options.eventTarget.dispatchEvent(
      new CustomEvent(JERICHO_AUDIO_CALIBRATION_STATE_EVENT, { detail: snapshot }),
    );
  }

  private setDeadline(ms: number): void {
    this.clearDeadline();
    const start = this.options.clock();
    let elapsed = 0;
    const tick = () => {
      elapsed = this.options.clock() - start;
      this.deadlineRemainingMs = Math.max(0, ms - elapsed);
      if (elapsed >= ms) {
        this.fail('phase_timeout');
      }
    };
    this.deadlineTimer = this.options.timers.setTimeout(tick, ms);
  }

  private clearDeadline(): void {
    if (this.deadlineTimer !== null) {
      this.options.timers.clearTimeout(this.deadlineTimer);
      this.deadlineTimer = null;
    }
    this.deadlineRemainingMs = undefined;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.options.timers.setTimeout(resolve, ms);
    });
  }

  private cleanupInternal(): void {
    this.clearDeadline();
    this.session?.close();
    this.session = null;
    for (const fn of this.cleanupFns) fn();
    this.cleanupFns = [];
    this.options.audio.restoreDefaultProfile();
    this.options.voice.endLiveCanary();
  }

  private async resumePhase(phase: ActiveCalibrationPhase): Promise<void> {
    switch (phase) {
      case 'room': return this.runRoomPhase();
      case 'speech': return this.runSpeechPhase();
      case 'clap': return this.runClapPhase();
      case 'live_canary': return this.runLiveCanaryPhase();
    }
  }

  private async computeIdempotencyKey(): Promise<string> {
    const data = JSON.stringify({ sessionId: this.sessionId, phase: this.phase });
    const encoder = new TextEncoder();
    const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}
