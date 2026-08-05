import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DeterministicSpeakerVerifier,
  LocalCarlosSpeakerVerifier,
  RejectingSpeakerVerifier,
  UnavailableSpeakerVerifier,
  createSpeakerVerifier,
  isSpeakerVerified,
} from '../src/voice/speaker-verifier.js';
import {
  DeterministicEmbedder,
  speakerExecutionProviders,
} from '../src/voice/speaker-embedding.js';
import { computeLogMelFbank } from '../src/voice/speaker-fbank.js';
import { VoiceprintStore } from '../src/voice/voiceprint-store.js';
import {
  SPEAKER_ACCEPT_THRESHOLD,
  SPEAKER_OWNER_ID,
  SPEAKER_SAMPLE_RATE,
} from '../src/voice/speaker-model.js';
import {
  AuthorityRejectionReason,
  CommandAuthority,
} from '../src/voice/command-authority.js';

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length) {
    // Best-effort; voiceprint files are tiny and gitignored outside temp.
    tempRoots.pop();
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jericho-speaker-'));
  tempRoots.push(dir);
  return dir;
}

function tone(seconds: number, hz: number, phase = 0): Float32Array {
  const samples = new Float32Array(Math.floor(16_000 * seconds));
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = 0.2 * Math.sin((2 * Math.PI * hz * i) / 16_000 + phase);
  }
  return samples;
}

describe('SpeakerVerifier', () => {
  it('uses onnxruntime-node provider identifiers and official CMN preprocessing', () => {
    expect(speakerExecutionProviders('darwin')).toEqual(['coreml', 'cpu']);
    expect(speakerExecutionProviders('linux')).toEqual(['cpu']);

    const features = computeLogMelFbank(tone(1.2, 440));
    const frames = features.length / 80;
    for (let mel = 0; mel < 80; mel += 1) {
      let mean = 0;
      for (let frame = 0; frame < frames; frame += 1) {
        mean += features[frame * 80 + mel]!;
      }
      expect(Math.abs(mean / frames)).toBeLessThan(1e-5);
    }
  });

  it('UnavailableSpeakerVerifier fails closed without claiming an owner match', async () => {
    const verifier = new UnavailableSpeakerVerifier();
    expect(verifier.status).toBe('unavailable');
    await expect(verifier.enroll(new Float32Array(16_000)))
      .rejects.toThrow('speaker_model_unavailable');
    const result = await verifier.verify(new Float32Array(16_000));
    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('speaker_model_unavailable');
    expect(isSpeakerVerified(result)).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/carlos/i);
  });

  it('RejectingSpeakerVerifier remains a fail-closed legacy alias', async () => {
    const verifier = new RejectingSpeakerVerifier();
    await expect(verifier.enroll(new Float32Array(16_000)))
      .rejects.toThrow('evaluated_speaker_model_required');
    const result = await verifier.verify(new Float32Array(16_000));
    expect(result.status).toBe('unavailable');
    expect(isSpeakerVerified(result)).toBe(false);
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

  it('createSpeakerVerifier fails closed when the model file is missing', async () => {
    const root = tempDir();
    const verifier = createSpeakerVerifier(undefined, {
      modelPath: join(root, 'missing.onnx'),
      voiceprintPath: join(root, 'voiceprint.enc'),
    });
    expect(verifier.status).toBe('unavailable');
    const result = await verifier.verify(tone(1, 220));
    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('speaker_model_unavailable');
    expect(isSpeakerVerified(result)).toBe(false);
  });

  it('isSpeakerVerified handles edge cases', () => {
    expect(isSpeakerVerified({
      status: 'verified', speakerId: 'owner', enrolled: true, confidence: 0.9,
    })).toBe(true);
    expect(isSpeakerVerified({
      status: 'verified', enrolled: true, confidence: 0.9,
    })).toBe(false);
    expect(isSpeakerVerified({
      status: 'verified', speakerId: 'owner', enrolled: false, confidence: 0.9,
    })).toBe(false);
    expect(isSpeakerVerified({
      status: 'verified', speakerId: 'owner', enrolled: true,
      confidence: SPEAKER_ACCEPT_THRESHOLD - 0.01,
    })).toBe(false);
    expect(isSpeakerVerified({
      status: 'enrollment_required', speakerId: 'owner', enrolled: true, confidence: 1,
    })).toBe(false);
    expect(isSpeakerVerified({ status: 'rejected' })).toBe(false);
    expect(isSpeakerVerified({ status: 'verifying' })).toBe(false);
    expect(isSpeakerVerified({ status: 'unavailable' })).toBe(false);
  });
});

describe('DeterministicSpeakerVerifier', () => {
  it('enrolls multiple samples, verifies a match, and rejects a mismatch', async () => {
    const verifier = new DeterministicSpeakerVerifier({
      acceptThreshold: 0.99,
      rejectThreshold: 0.5,
    });
    expect(verifier.status).toBe('enrollment_required');

    const copies = [tone(1.2, 440), tone(1.2, 440), tone(1.2, 440)];
    await verifier.enrollSamples(copies);
    for (const sample of copies) expect(sample.every((value) => value === 0)).toBe(true);

    const matched = await verifier.verify(tone(1.2, 440));
    expect(matched.status).toBe('verified');
    expect(matched.speakerId).toBe('test-owner');
    expect(matched.enrolled).toBe(true);
    expect(isSpeakerVerified(matched, 0.99)).toBe(true);

    const rejected = await verifier.verify(tone(1.2, 110));
    expect(rejected.status).toBe('rejected');
    expect(rejected.reason).toMatch(/speaker_mismatch|speaker_ambiguous/);
    expect(isSpeakerVerified(rejected, 0.99)).toBe(false);
  });

  it('reports enrollment_required before any samples are enrolled', async () => {
    const verifier = new DeterministicSpeakerVerifier();
    const result = await verifier.verify(tone(1, 440));
    expect(result).toEqual({
      status: 'enrollment_required',
      enrolled: false,
      reason: 'speaker_not_enrolled',
    });
  });

  it('never retains raw enrollment audio after processing', async () => {
    const verifier = new DeterministicSpeakerVerifier();
    const audio = tone(1.1, 330);
    await verifier.enroll(audio);
    expect(audio.every((value) => value === 0)).toBe(true);
  });
});

describe('LocalCarlosSpeakerVerifier enrollment lifecycle', () => {
  it('requires the confirmation phrase and multiple consistent samples', async () => {
    const root = tempDir();
    const secrets = new Map<string, string>();
    const store = new VoiceprintStore({
      path: join(root, 'carlos.voiceprint.enc'),
      platform: 'linux',
      readSecret: (service) => {
        const value = secrets.get(service);
        if (!value) {
          const error = new Error('missing');
          (error as { status?: number }).status = 44;
          throw error;
        }
        return value;
      },
      writeSecret: (service, secret) => {
        secrets.set(service, secret);
      },
      generateKey: () => randomBytes(32),
    });
    const verifier = new LocalCarlosSpeakerVerifier({
      embedder: new DeterministicEmbedder(),
      store,
      acceptThreshold: 0.99,
      rejectThreshold: 0.5,
    });

    await expect(verifier.enroll(tone(1.2, 440))).rejects.toThrow('speaker_enrollment_requires_cli');
    await expect(verifier.enrollSamples([tone(1.2, 440), tone(1.2, 440), tone(1.2, 440)], {
      confirmPhrase: 'nope',
    })).rejects.toThrow('speaker_enrollment_confirmation_required');
    await expect(verifier.enrollSamples([tone(1.2, 440), tone(1.2, 440)], {
      confirmPhrase: 'ENROLL CARLOS VOICEPRINT',
    })).rejects.toThrow('speaker_enrollment_insufficient_samples');
    await expect(verifier.enrollSamples([
      tone(1.2, 440), tone(1.2, 440), tone(1.2, 90),
    ], {
      confirmPhrase: 'ENROLL CARLOS VOICEPRINT',
    })).rejects.toThrow('speaker_enrollment_inconsistent');

    const samples = [tone(1.2, 440), tone(1.2, 440), tone(1.2, 440)];
    const enrollment = await verifier.enrollSamples(samples, {
      confirmPhrase: 'ENROLL CARLOS VOICEPRINT',
    });
    expect(enrollment.evaluated).toBe(true);
    expect(enrollment.modelId).toContain('wespeaker');
    for (const sample of samples) expect(sample.every((value) => value === 0)).toBe(true);

    const matched = await verifier.verify(tone(1.2, 440));
    expect(matched.status).toBe('verified');
    expect(matched.speakerId).toBe(SPEAKER_OWNER_ID);
    expect(isSpeakerVerified(matched, 0.99)).toBe(true);

    const reloaded = new LocalCarlosSpeakerVerifier({
      embedder: new DeterministicEmbedder(),
      store,
      acceptThreshold: 0.99,
      rejectThreshold: 0.5,
    });
    const again = await reloaded.verify(tone(1.2, 440));
    expect(again.status).toBe('verified');
    expect(store.load()?.embedding.length).toBe(256);
  });

  it('rejects ambiguous confidence inside the gray band', async () => {
    const enrolled = new Float32Array(256);
    enrolled[0] = 1;
    const probe = new Float32Array(256);
    // Cosine with [1,0,...] equals probe[0] when both are unit-ish; set gray-band score.
    probe[0] = 0.8;
    probe[1] = Math.sqrt(1 - 0.8 * 0.8);
    const embedder: import('../src/voice/speaker-embedding.js').SpeakerEmbedder = {
      modelPath: 'deterministic://fixture',
      embed: async (audio) => {
        audio.fill(0);
        return probe.slice();
      },
      dispose: () => undefined,
    };
    const root = tempDir();
    const secrets = new Map<string, string>();
    const store = new VoiceprintStore({
      path: join(root, 'amb.enc'),
      platform: 'linux',
      readSecret: (service) => {
        const value = secrets.get(service);
        if (!value) {
          const error = new Error('missing');
          (error as { status?: number }).status = 44;
          throw error;
        }
        return value;
      },
      writeSecret: (service, secret) => {
        secrets.set(service, secret);
      },
      generateKey: () => randomBytes(32),
    });
    store.save({
      speakerId: 'carlos',
      modelId: 'wespeaker-voxceleb-resnet34-LM',
      voiceprintVersion: 1,
      enrolledAt: Date.now(),
      evaluated: true,
      embedding: Array.from(enrolled),
      sampleCount: 3,
      acceptThreshold: 0.95,
      rejectThreshold: 0.5,
    });
    const verifier = new LocalCarlosSpeakerVerifier({
      embedder,
      store,
      acceptThreshold: 0.95,
      rejectThreshold: 0.5,
    });
    const result = await verifier.verify(new Float32Array(SPEAKER_SAMPLE_RATE));
    expect(result.status).toBe('rejected');
    expect(result.reason).toBe('speaker_ambiguous');
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result.confidence).toBeLessThan(0.95);
    expect(isSpeakerVerified(result, 0.95)).toBe(false);
  });
});

describe('speaker authority and replay', () => {
  it('mints authority only for a verified enrolled match and rejects replay', () => {
    const authority = new CommandAuthority({
      sessionId: createHash('sha256').update('session').digest('hex').slice(0, 32),
      clock: () => 1_000_000,
    });
    authority.activate();

    const unverified = authority.mint({
      toolName: 'open_browser',
      args: { url: 'https://example.com' },
      maxAgeMs: 5_000,
      speakerVerified: false,
    });
    expect(authority.validate(unverified, 'open_browser', { url: 'https://example.com' }))
      .toEqual({ ok: false, reason: AuthorityRejectionReason.SpeakerUnverified });

    const token = authority.mint({
      toolName: 'open_browser',
      args: { url: 'https://example.com' },
      maxAgeMs: 5_000,
      speakerVerified: true,
    });
    expect(authority.validate(token, 'open_browser', { url: 'https://example.com' })).toEqual({ ok: true });
    expect(authority.validate(token, 'open_browser', { url: 'https://example.com' }))
      .toEqual({ ok: false, reason: AuthorityRejectionReason.Replayed });
  });

  it('does not treat stale verified results as current authority outside the match window', async () => {
    const verifier = new DeterministicSpeakerVerifier({ acceptThreshold: 0.99, rejectThreshold: 0.5 });
    await verifier.enrollSamples([tone(1.2, 440), tone(1.2, 440), tone(1.2, 440)]);
    const result = await verifier.verify(tone(1.2, 440));
    expect(isSpeakerVerified(result, 0.99)).toBe(true);
    const verifiedAt = Date.now() - 20_000;
    const fresh = isSpeakerVerified(result, 0.99) && Date.now() - verifiedAt <= 15_000;
    expect(fresh).toBe(false);
  });
});

describe('VoiceprintStore', () => {
  it('encrypts voiceprints and refuses unevaluated records', () => {
    const root = tempDir();
    const secrets = new Map<string, string>();
    const store = new VoiceprintStore({
      path: join(root, 'vp.enc'),
      platform: 'linux',
      readSecret: (service) => {
        const value = secrets.get(service);
        if (!value) {
          const error = new Error('missing');
          (error as { status?: number }).status = 44;
          throw error;
        }
        return value;
      },
      writeSecret: (service, secret) => {
        secrets.set(service, secret);
      },
      generateKey: () => Buffer.alloc(32, 7),
    });
    expect(() => store.save({
      speakerId: 'carlos',
      modelId: 'wespeaker-voxceleb-resnet34-LM',
      voiceprintVersion: 1,
      enrolledAt: Date.now(),
      evaluated: false,
      embedding: Array.from({ length: 256 }, () => 0),
      sampleCount: 3,
      acceptThreshold: 0.7,
      rejectThreshold: 0.55,
    })).toThrow('speaker_voiceprint_not_evaluated');

    store.save({
      speakerId: 'carlos',
      modelId: 'wespeaker-voxceleb-resnet34-LM',
      voiceprintVersion: 1,
      enrolledAt: 1_700_000_000_000,
      evaluated: true,
      embedding: Array.from({ length: 256 }, (_, i) => (i === 0 ? 1 : 0)),
      sampleCount: 3,
      acceptThreshold: 0.7,
      rejectThreshold: 0.55,
    });
    const loaded = store.load();
    expect(loaded?.speakerId).toBe('carlos');
    expect(loaded?.evaluated).toBe(true);
    writeFileSync(join(root, 'vp.enc'), Buffer.alloc(64, 1));
    expect(() => store.load()).toThrow(/speaker_voiceprint_corrupt/);
  });
});
