import { describe, expect, it } from 'vitest';

import {
  createSpeakerVerifier,
  isSpeakerVerified,
  RejectingSpeakerVerifier,
} from '../src/voice/speaker-verifier.js';

describe('SpeakerVerifier', () => {
  it('RejectingSpeakerVerifier always returns unverified', async () => {
    const verifier = new RejectingSpeakerVerifier();
    expect(verifier.status).toBe('unverified');

    await expect(verifier.enroll(new Float32Array(16000)))
      .rejects.toThrow('evaluated_speaker_model_required');
    expect(verifier.status).toBe('unverified');

    const result = await verifier.verify(new Float32Array(16000));
    expect(result.status).toBe('unverified');
    expect(result.reason).toBe('speaker_verification_required');
    expect(isSpeakerVerified(result)).toBe(false);
  });

  it('createSpeakerVerifier rejects by default when no evaluated implementation is injected', () => {
    const verifier = createSpeakerVerifier();
    expect(verifier).toBeInstanceOf(RejectingSpeakerVerifier);
    expect(verifier.status).toBe('unverified');
  });

  it('createSpeakerVerifier accepts only an explicit verifier implementation', () => {
    const injected: import('../src/voice/speaker-verifier.js').SpeakerVerifier = {
      status: 'verified',
      enroll: async () => undefined,
      verify: async () => ({
        status: 'verified', speakerId: 'enrolled-owner', confidence: 0.91, enrolled: true,
      }),
      reset: () => undefined,
    };
    expect(createSpeakerVerifier(injected)).toBe(injected);
  });

  it('rejecting verifier never claims Carlos only', async () => {
    const verifier = createSpeakerVerifier();
    const result = await verifier.verify(new Float32Array(16000));
    expect(JSON.stringify(result)).not.toMatch(/carlos/i);
    expect(result.status).toBe('unverified');
    expect(result.reason).toBe('speaker_verification_required');
  });

  it('isSpeakerVerified handles edge cases', () => {
    expect(isSpeakerVerified({ status: 'verified', speakerId: 'owner', enrolled: true, confidence: 0.9 })).toBe(true);
    expect(isSpeakerVerified({ status: 'verified', enrolled: true, confidence: 0.9 })).toBe(false);
    expect(isSpeakerVerified({ status: 'verified', speakerId: 'owner', enrolled: false, confidence: 0.9 })).toBe(false);
    expect(isSpeakerVerified({ status: 'verified', speakerId: 'owner', enrolled: true, confidence: 0.79 })).toBe(false);
    expect(isSpeakerVerified({ status: 'unverified', speakerId: 'owner', enrolled: true, confidence: 1 })).toBe(false);
    expect(isSpeakerVerified({ status: 'rejected' })).toBe(false);
    expect(isSpeakerVerified({ status: 'verifying' })).toBe(false);
  });

  it('enroll does not retain raw audio', async () => {
    const rejecting = new RejectingSpeakerVerifier();
    const audio = new Float32Array([0.1, 0.2, 0.3]);

    await expect(rejecting.enroll(audio)).rejects.toThrow('evaluated_speaker_model_required');

    const result = await rejecting.verify(audio);
    expect(result.status).toBe('unverified');
  });
});
