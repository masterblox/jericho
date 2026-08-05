import {
  DeterministicEmbedder,
  OnnxSpeakerEmbedder,
  type SpeakerEmbedder,
} from './speaker-embedding.js';
import {
  SPEAKER_ACCEPT_THRESHOLD,
  SPEAKER_ENROLLMENT_CONSISTENCY,
  SPEAKER_ENROLLMENT_MIN_SAMPLES,
  SPEAKER_ENROLLMENT_MIN_SECONDS,
  SPEAKER_MODEL_ID,
  SPEAKER_OWNER_ID,
  SPEAKER_REJECT_THRESHOLD,
  SPEAKER_SAMPLE_RATE,
  SPEAKER_VOICEPRINT_VERSION,
  cosineSimilarity,
  defaultSpeakerModelPath,
  defaultVoiceprintPath,
  zeroFill,
} from './speaker-model.js';
import { VoiceprintStore, meanEmbedding, type StoredVoiceprint } from './voiceprint-store.js';

export type SpeakerVerificationStatus =
  | 'enrollment_required'
  | 'verifying'
  | 'verified'
  | 'rejected'
  | 'unavailable';

export interface SpeakerEnrollment {
  modelId: string;
  enrolledAt: number;
  voiceprintVersion: number;
  evaluated: boolean;
}

export interface SpeakerVerificationResult {
  status: SpeakerVerificationStatus;
  speakerId?: string;
  confidence?: number;
  enrolled?: boolean;
  reason?: string;
}

export interface SpeakerVerifier {
  readonly status: SpeakerVerificationStatus;

  enroll(audioChunk: Float32Array): Promise<void>;

  verify(audioChunk: Float32Array): Promise<SpeakerVerificationResult>;

  reset(): void;
}

export interface LocalSpeakerVerifierOptions {
  modelPath?: string;
  voiceprintPath?: string;
  acceptThreshold?: number;
  rejectThreshold?: number;
  embedder?: SpeakerEmbedder;
  store?: VoiceprintStore;
  clock?: () => number;
}

/**
 * Local Carlos enrollment/verification path.
 * Fail-closed: missing model, missing/corrupt voiceprint, ambiguous scores,
 * and unknown speakers never mint authority.
 */
export class LocalCarlosSpeakerVerifier implements SpeakerVerifier {
  status: SpeakerVerificationStatus = 'enrollment_required';
  readonly modelPath: string;
  readonly acceptThreshold: number;
  readonly rejectThreshold: number;
  readonly #store: VoiceprintStore;
  readonly #embedder: SpeakerEmbedder | undefined;
  readonly #clock: () => number;
  #voiceprint: StoredVoiceprint | undefined;
  #embedderError: string | undefined;

  constructor(options: LocalSpeakerVerifierOptions = {}) {
    this.modelPath = options.modelPath ?? defaultSpeakerModelPath();
    this.acceptThreshold = options.acceptThreshold ?? SPEAKER_ACCEPT_THRESHOLD;
    this.rejectThreshold = options.rejectThreshold ?? SPEAKER_REJECT_THRESHOLD;
    if (!(this.rejectThreshold < this.acceptThreshold)) {
      throw new Error('speaker_threshold_invalid');
    }
    this.#store = options.store ?? new VoiceprintStore({ path: options.voiceprintPath ?? defaultVoiceprintPath() });
    this.#clock = options.clock ?? (() => Date.now());
    this.#embedder = options.embedder;
    this.#refreshEnrollmentState();
  }

  static create(options: LocalSpeakerVerifierOptions = {}): LocalCarlosSpeakerVerifier {
    if (options.embedder) return new LocalCarlosSpeakerVerifier(options);
    try {
      const embedder = new OnnxSpeakerEmbedder({
        modelPath: options.modelPath ?? defaultSpeakerModelPath(),
      });
      return new LocalCarlosSpeakerVerifier({ ...options, embedder });
    } catch (cause) {
      const verifier = new LocalCarlosSpeakerVerifier(options);
      verifier.#embedderError = cause instanceof Error ? cause.message : 'speaker_model_unavailable';
      verifier.status = 'unavailable';
      return verifier;
    }
  }

  enrollment(): SpeakerEnrollment | undefined {
    if (!this.#voiceprint) return undefined;
    return {
      modelId: this.#voiceprint.modelId,
      enrolledAt: this.#voiceprint.enrolledAt,
      voiceprintVersion: this.#voiceprint.voiceprintVersion,
      evaluated: this.#voiceprint.evaluated,
    };
  }

  async enroll(audioChunk: Float32Array): Promise<void> {
    // Runtime WebSocket turns must never silently enroll. Use the explicit CLI.
    zeroFill(audioChunk);
    throw new Error('speaker_enrollment_requires_cli');
  }

  /**
   * One-time multi-sample enrollment. Raw PCM is zeroed before return.
   * Callers must pass SPEAKER_ENROLLMENT_MIN_SAMPLES consistent clips.
   */
  async enrollSamples(samples: Float32Array[], options: {
    confirmPhrase: string;
    replaceExisting?: boolean;
  }): Promise<SpeakerEnrollment> {
    if (options.confirmPhrase !== 'ENROLL CARLOS VOICEPRINT') {
      throw new Error('speaker_enrollment_confirmation_required');
    }
    if (!this.#embedder) {
      throw new Error(this.#embedderError ?? 'speaker_model_unavailable');
    }
    if (samples.length < SPEAKER_ENROLLMENT_MIN_SAMPLES) {
      throw new Error('speaker_enrollment_insufficient_samples');
    }
    if (this.#store.exists() && !options.replaceExisting) {
      throw new Error('speaker_enrollment_already_exists');
    }

    const embeddings: Float32Array[] = [];
    try {
      for (const sample of samples) {
        assertEnrollmentSample(sample);
        embeddings.push(await this.#embedder.embed(sample));
      }
      for (let i = 0; i < embeddings.length; i += 1) {
        for (let j = i + 1; j < embeddings.length; j += 1) {
          const score = cosineSimilarity(embeddings[i]!, embeddings[j]!);
          if (!Number.isFinite(score) || score < SPEAKER_ENROLLMENT_CONSISTENCY) {
            throw new Error('speaker_enrollment_inconsistent');
          }
        }
      }
      const mean = meanEmbedding(embeddings);
      const record: StoredVoiceprint = {
        speakerId: SPEAKER_OWNER_ID,
        modelId: SPEAKER_MODEL_ID,
        voiceprintVersion: SPEAKER_VOICEPRINT_VERSION,
        enrolledAt: this.#clock(),
        evaluated: true,
        embedding: Array.from(mean),
        sampleCount: samples.length,
        acceptThreshold: this.acceptThreshold,
        rejectThreshold: this.rejectThreshold,
      };
      this.#store.save(record);
      zeroFill(mean);
      this.#voiceprint = record;
      this.status = 'enrollment_required';
      this.reset();
      return this.enrollment()!;
    } finally {
      for (const sample of samples) zeroFill(sample);
      for (const embedding of embeddings) zeroFill(embedding);
    }
  }

  async verify(audioChunk: Float32Array): Promise<SpeakerVerificationResult> {
    this.status = 'verifying';
    try {
      if (!this.#embedder) {
        return this.#finish({
          status: 'unavailable',
          enrolled: false,
          reason: 'speaker_model_unavailable',
        });
      }
      if (!this.#voiceprint || !this.#voiceprint.evaluated) {
        return this.#finish({
          status: 'enrollment_required',
          enrolled: false,
          reason: 'speaker_not_enrolled',
        });
      }
      if (audioChunk.length < SPEAKER_SAMPLE_RATE * 0.5) {
        return this.#finish({
          status: 'rejected',
          enrolled: true,
          reason: 'speaker_verification_failed',
        });
      }

      let probe: Float32Array | undefined;
      try {
        probe = await this.#embedder.embed(audioChunk);
      } catch {
        return this.#finish({
          status: 'unavailable',
          enrolled: true,
          reason: 'speaker_model_unavailable',
        });
      }

      const enrolled = Float32Array.from(this.#voiceprint.embedding);
      const confidence = cosineSimilarity(probe, enrolled);
      zeroFill(probe);
      zeroFill(enrolled);

      if (!Number.isFinite(confidence)) {
        return this.#finish({
          status: 'rejected',
          enrolled: true,
          confidence,
          reason: 'speaker_verification_failed',
        });
      }
      if (confidence >= this.acceptThreshold) {
        return this.#finish({
          status: 'verified',
          speakerId: SPEAKER_OWNER_ID,
          confidence,
          enrolled: true,
        });
      }
      if (confidence >= this.rejectThreshold) {
        return this.#finish({
          status: 'rejected',
          enrolled: true,
          confidence,
          reason: 'speaker_ambiguous',
        });
      }
      return this.#finish({
        status: 'rejected',
        enrolled: true,
        confidence,
        reason: 'speaker_mismatch',
      });
    } finally {
      zeroFill(audioChunk);
    }
  }

  reset(): void {
    if (!this.#embedder) {
      this.status = 'unavailable';
      return;
    }
    this.status = this.#voiceprint?.evaluated ? 'rejected' : 'enrollment_required';
  }

  #refreshEnrollmentState(): void {
    if (!this.#embedder && this.#embedderError) {
      this.status = 'unavailable';
      return;
    }
    try {
      this.#voiceprint = this.#store.load();
    } catch {
      this.#voiceprint = undefined;
      this.status = 'unavailable';
      return;
    }
    this.status = this.#voiceprint?.evaluated ? 'rejected' : 'enrollment_required';
  }

  #finish(result: SpeakerVerificationResult): SpeakerVerificationResult {
    this.status = result.status;
    return result;
  }
}

/**
 * Deterministic in-memory verifier for tests. Never loads Carlos biometrics.
 */
export class DeterministicSpeakerVerifier implements SpeakerVerifier {
  status: SpeakerVerificationStatus = 'enrollment_required';
  readonly #embedder = new DeterministicEmbedder();
  #enrollment: Float32Array | undefined;
  #acceptThreshold: number;
  #rejectThreshold: number;

  constructor(options: { acceptThreshold?: number; rejectThreshold?: number } = {}) {
    this.#acceptThreshold = options.acceptThreshold ?? SPEAKER_ACCEPT_THRESHOLD;
    this.#rejectThreshold = options.rejectThreshold ?? SPEAKER_REJECT_THRESHOLD;
  }

  async enroll(audioChunk: Float32Array): Promise<void> {
    this.#enrollment = await this.#embedder.embed(audioChunk);
    zeroFill(audioChunk);
    this.status = 'enrollment_required';
  }

  async enrollSamples(samples: Float32Array[]): Promise<void> {
    const embeddings: Float32Array[] = [];
    try {
      for (const sample of samples) {
        embeddings.push(await this.#embedder.embed(sample));
      }
      this.#enrollment = meanEmbedding(embeddings);
      this.status = 'enrollment_required';
    } finally {
      for (const sample of samples) zeroFill(sample);
      for (const embedding of embeddings) zeroFill(embedding);
    }
  }

  async verify(audioChunk: Float32Array): Promise<SpeakerVerificationResult> {
    this.status = 'verifying';
    try {
      if (!this.#enrollment) {
        this.status = 'enrollment_required';
        return { status: 'enrollment_required', enrolled: false, reason: 'speaker_not_enrolled' };
      }
      const probe = await this.#embedder.embed(audioChunk);
      const confidence = cosineSimilarity(probe, this.#enrollment);
      zeroFill(probe);
      if (!Number.isFinite(confidence)) {
        this.status = 'rejected';
        return { status: 'rejected', enrolled: true, reason: 'speaker_verification_failed' };
      }
      if (confidence >= this.#acceptThreshold) {
        this.status = 'verified';
        return {
          status: 'verified',
          speakerId: 'test-owner',
          confidence,
          enrolled: true,
        };
      }
      if (confidence >= this.#rejectThreshold) {
        this.status = 'rejected';
        return {
          status: 'rejected',
          enrolled: true,
          confidence,
          reason: 'speaker_ambiguous',
        };
      }
      this.status = 'rejected';
      return {
        status: 'rejected',
        enrolled: true,
        confidence,
        reason: 'speaker_mismatch',
      };
    } finally {
      zeroFill(audioChunk);
    }
  }

  reset(): void {
    this.status = this.#enrollment ? 'enrollment_required' : 'enrollment_required';
  }
}

/** Fail-closed stand-in when composition explicitly opts out of local verification. */
export class UnavailableSpeakerVerifier implements SpeakerVerifier {
  status: SpeakerVerificationStatus = 'unavailable';

  async enroll(_audioChunk: Float32Array): Promise<void> {
    throw new Error('speaker_model_unavailable');
  }

  async verify(_audioChunk: Float32Array): Promise<SpeakerVerificationResult> {
    return {
      status: 'unavailable',
      enrolled: false,
      reason: 'speaker_model_unavailable',
    };
  }

  reset(): void {
    this.status = 'unavailable';
  }
}

/** @deprecated Prefer UnavailableSpeakerVerifier / LocalCarlosSpeakerVerifier. */
export class RejectingSpeakerVerifier extends UnavailableSpeakerVerifier {
  override status: SpeakerVerificationStatus = 'unavailable';

  override async enroll(_audioChunk: Float32Array): Promise<void> {
    throw new Error('evaluated_speaker_model_required');
  }

  override async verify(_audioChunk: Float32Array): Promise<SpeakerVerificationResult> {
    return {
      status: 'unavailable',
      reason: 'speaker_verification_required',
    };
  }

  override reset(): void {
    this.status = 'unavailable';
  }
}

export function createSpeakerVerifier(
  verifier?: SpeakerVerifier,
  options?: LocalSpeakerVerifierOptions,
): SpeakerVerifier {
  if (verifier) return verifier;
  return LocalCarlosSpeakerVerifier.create(options ?? {});
}

export function isSpeakerVerified(
  result: SpeakerVerificationResult,
  minimumConfidence = SPEAKER_ACCEPT_THRESHOLD,
): boolean {
  return result.status === 'verified' &&
    Boolean(result.speakerId?.trim()) &&
    result.enrolled === true &&
    Number.isFinite(result.confidence) &&
    (result.confidence ?? 0) >= minimumConfidence;
}

function assertEnrollmentSample(sample: Float32Array): void {
  const minSamples = SPEAKER_SAMPLE_RATE * SPEAKER_ENROLLMENT_MIN_SECONDS;
  if (sample.length < minSamples) throw new Error('speaker_enrollment_sample_too_short');
  let energy = 0;
  for (let i = 0; i < sample.length; i += 1) energy += Math.abs(sample[i]!);
  if (energy / sample.length < 0.01) throw new Error('speaker_enrollment_sample_too_quiet');
}
