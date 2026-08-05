#!/usr/bin/env node
/**
 * One-time Carlos voiceprint enrollment.
 *
 * Exact post-integration command (after model download):
 *   pnpm --filter bridge enroll-carlos-voice -- \
 *     --i-am-carlos \
 *     --confirm 'ENROLL CARLOS VOICEPRINT' \
 *     --wav ~/jericho-enrollment/sample1.wav \
 *     --wav ~/jericho-enrollment/sample2.wav \
 *     --wav ~/jericho-enrollment/sample3.wav
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LocalCarlosSpeakerVerifier } from './speaker-verifier.js';
import {
  SPEAKER_ENROLLMENT_MIN_SAMPLES,
  SPEAKER_SAMPLE_RATE,
  defaultSpeakerModelPath,
  defaultVoiceprintPath,
} from './speaker-model.js';

interface CliOptions {
  iAmCarlos: boolean;
  confirm: string | undefined;
  wavPaths: string[];
  replaceExisting: boolean;
  modelPath: string;
  voiceprintPath: string;
}

function parseArgs(argv: string[]): CliOptions {
  const wavPaths: string[] = [];
  let iAmCarlos = false;
  let confirm: string | undefined;
  let replaceExisting = false;
  let modelPath = defaultSpeakerModelPath();
  let voiceprintPath = defaultVoiceprintPath();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--i-am-carlos') {
      iAmCarlos = true;
      continue;
    }
    if (arg === '--replace-existing') {
      replaceExisting = true;
      continue;
    }
    if (arg === '--confirm') {
      confirm = argv[++i];
      continue;
    }
    if (arg === '--wav') {
      const path = argv[++i];
      if (!path) throw new Error('speaker_enrollment_wav_missing');
      wavPaths.push(resolve(path));
      continue;
    }
    if (arg === '--model') {
      const path = argv[++i];
      if (!path) throw new Error('speaker_model_path_invalid');
      modelPath = resolve(path);
      continue;
    }
    if (arg === '--voiceprint') {
      const path = argv[++i];
      if (!path) throw new Error('speaker_voiceprint_path_invalid');
      voiceprintPath = resolve(path);
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    throw new Error(`speaker_enrollment_unknown_arg:${arg}`);
  }

  return { iAmCarlos, confirm, wavPaths, replaceExisting, modelPath, voiceprintPath };
}

function printUsage(): void {
  process.stdout.write(`Usage:
  pnpm --filter bridge enroll-carlos-voice -- --i-am-carlos --confirm 'ENROLL CARLOS VOICEPRINT' \\
    --wav sample1.wav --wav sample2.wav --wav sample3.wav

Safeguards:
  - Requires --i-am-carlos and the exact confirmation phrase
  - Requires at least ${SPEAKER_ENROLLMENT_MIN_SAMPLES} 16 kHz mono WAV samples (≥1s speech each)
  - Refuses overwrite unless --replace-existing
  - Never stores raw WAV bytes; embeddings only, encrypted under Application Support + Keychain
`);
}

function readWavPcm16Mono(path: string): Float32Array {
  const bytes = readFileSync(path);
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`speaker_enrollment_wav_invalid:${path}`);
  }
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const next = offset + 8 + size;
    if (id === 'fmt ') {
      channels = bytes.readUInt16LE(offset + 10);
      sampleRate = bytes.readUInt32LE(offset + 12);
      bitsPerSample = bytes.readUInt16LE(offset + 22);
    } else if (id === 'data') {
      dataOffset = offset + 8;
      dataSize = size;
      break;
    }
    offset = next + (size % 2);
  }
  if (dataOffset < 0 || sampleRate !== SPEAKER_SAMPLE_RATE || channels !== 1 || bitsPerSample !== 16) {
    throw new Error(`speaker_enrollment_wav_format:${path}:need_16khz_mono_pcm16`);
  }
  const sampleCount = Math.floor(dataSize / 2);
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    samples[i] = bytes.readInt16LE(dataOffset + i * 2) / 32_768;
  }
  bytes.fill(0);
  return samples;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.iAmCarlos) {
    throw new Error('speaker_enrollment_requires_i_am_carlos');
  }
  if (options.confirm !== 'ENROLL CARLOS VOICEPRINT') {
    throw new Error('speaker_enrollment_confirmation_required');
  }
  if (options.wavPaths.length < SPEAKER_ENROLLMENT_MIN_SAMPLES) {
    throw new Error(`speaker_enrollment_insufficient_samples:need_${SPEAKER_ENROLLMENT_MIN_SAMPLES}`);
  }

  const samples = options.wavPaths.map((path) => readWavPcm16Mono(path));
  const verifier = LocalCarlosSpeakerVerifier.create({
    modelPath: options.modelPath,
    voiceprintPath: options.voiceprintPath,
  });
  const enrollment = await verifier.enrollSamples(samples, {
    confirmPhrase: options.confirm,
    replaceExisting: options.replaceExisting,
  });

  process.stdout.write(JSON.stringify({
    ok: true,
    speakerId: 'carlos',
    modelId: enrollment.modelId,
    enrolledAt: enrollment.enrolledAt,
    evaluated: enrollment.evaluated,
    voiceprintPath: options.voiceprintPath,
    modelPath: options.modelPath,
    note: 'Raw WAV bytes were not retained. Voiceprint is encrypted outside Git.',
  }, null, 2));
  process.stdout.write('\n');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'speaker_enrollment_failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
