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
    // No-op: raw audio is NEVER retained
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

export class NoopSpeakerVerifier implements SpeakerVerifier {
  status: SpeakerVerificationStatus = 'verified';
  private enrolled_ = true;

  async enroll(_audioChunk: Float32Array): Promise<void> {
    // No-op: raw audio is NEVER retained
  }

  async verify(_audioChunk: Float32Array): Promise<SpeakerVerificationResult> {
    return {
      status: 'verified',
      speakerId: 'default',
      confidence: 1,
      enrolled: this.enrolled_,
    };
  }

  reset(): void {
    this.status = 'verified';
    this.enrolled_ = true;
  }
}

export function createSpeakerVerifier(evaluatedModelExists: boolean): SpeakerVerifier {
  if (!evaluatedModelExists) {
    return new RejectingSpeakerVerifier();
  }
  return new NoopSpeakerVerifier();
}

export function isSpeakerVerified(result: SpeakerVerificationResult): boolean {
  return result.status === 'verified' && (result.enrolled ?? false) && (result.confidence ?? 0) > 0;
}
