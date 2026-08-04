export type SpeakerVerificationStatus =
  | 'unverified'
  | 'verifying'
  | 'verified'
  | 'rejected';

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

export class RejectingSpeakerVerifier implements SpeakerVerifier {
  status: SpeakerVerificationStatus = 'unverified';

  async enroll(_audioChunk: Float32Array): Promise<void> {
    throw new Error('evaluated_speaker_model_required');
  }

  async verify(_audioChunk: Float32Array): Promise<SpeakerVerificationResult> {
    return {
      status: 'unverified',
      reason: 'speaker_verification_required',
    };
  }

  reset(): void {
    this.status = 'unverified';
  }
}

export function createSpeakerVerifier(verifier?: SpeakerVerifier): SpeakerVerifier {
  return verifier ?? new RejectingSpeakerVerifier();
}

export function isSpeakerVerified(
  result: SpeakerVerificationResult,
  minimumConfidence = 0.8,
): boolean {
  return result.status === 'verified' &&
    Boolean(result.speakerId?.trim()) &&
    result.enrolled === true &&
    Number.isFinite(result.confidence) &&
    (result.confidence ?? 0) >= minimumConfidence;
}
