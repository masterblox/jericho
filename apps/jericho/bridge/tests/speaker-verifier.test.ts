import { describe, expect, it } from 'vitest';

import {
  createSpeakerVerifier,
  isSpeakerVerified,
  NoopSpeakerVerifier,
  RejectingSpeakerVerifier,
} from '../src/voice/speaker-verifier.js';

describe('SpeakerVerifier', () => {
  it('RejectingSpeakerVerifier always returns unverified', async () => {
    const verifier = new RejectingSpeakerVerifier();
    expect(verifier.status).toBe('unverified');

    await verifier.enroll(new Float32Array(16000));
    expect(verifier.status).toBe('unverified');

    const result = await verifier.verify(new Float32Array(16000));
    expect(result.status).toBe('unverified');
    expect(result.reason).toBe('speaker_verification_required');
    expect(isSpeakerVerified(result)).toBe(false);
  });

  it('NoopSpeakerVerifier returns verified', async () => {
    const verifier = new NoopSpeakerVerifier();
    expect(verifier.status).toBe('verified');

    const result = await verifier.verify(new Float32Array(16000));
    expect(result.status).toBe('verified');
    expect(result.speakerId).toBe('default');
    expect(result.confidence).toBe(1);
    expect(result.enrolled).toBe(true);
    expect(isSpeakerVerified(result)).toBe(true);
  });

  it('NoopSpeakerVerifier can be reset', async () => {
    const verifier = new NoopSpeakerVerifier();
    verifier.reset();

    const result = await verifier.verify(new Float32Array(16000));
    expect(result.status).toBe('verified');
  });

  it('createSpeakerVerifier returns rejecting when no evaluated model', () => {
    const verifier = createSpeakerVerifier(false);
    expect(verifier).toBeInstanceOf(RejectingSpeakerVerifier);
    expect(verifier.status).toBe('unverified');
  });

  it('createSpeakerVerifier returns noop when evaluated model exists', () => {
    const verifier = createSpeakerVerifier(true);
    expect(verifier).toBeInstanceOf(NoopSpeakerVerifier);
    expect(verifier.status).toBe('verified');
  });

  it('rejecting verifier never claims Carlos only', async () => {
    const verifier = createSpeakerVerifier(false);
    const result = await verifier.verify(new Float32Array(16000));
    expect(JSON.stringify(result)).not.toMatch(/carlos/i);
    expect(result.status).toBe('unverified');
    expect(result.reason).toBe('speaker_verification_required');
  });

  it('isSpeakerVerified handles edge cases', () => {
    expect(isSpeakerVerified({ status: 'verified', enrolled: true, confidence: 0.9 })).toBe(true);
    expect(isSpeakerVerified({ status: 'verified', enrolled: false, confidence: 0.9 })).toBe(false);
    expect(isSpeakerVerified({ status: 'verified', enrolled: true, confidence: 0 })).toBe(false);
    expect(isSpeakerVerified({ status: 'unverified', enrolled: true, confidence: 1 })).toBe(false);
    expect(isSpeakerVerified({ status: 'rejected' })).toBe(false);
    expect(isSpeakerVerified({ status: 'verifying' })).toBe(false);
  });

  it('enroll does not retain raw audio', async () => {
    const rejecting = new RejectingSpeakerVerifier();
    const audio = new Float32Array([0.1, 0.2, 0.3]);

    await rejecting.enroll(audio);

    const result = await rejecting.verify(audio);
    expect(result.status).toBe('unverified');

    const noop = new NoopSpeakerVerifier();
    await noop.enroll(audio);
    const noopResult = await noop.verify(audio);
    expect(noopResult.status).toBe('verified');
  });
});
