#!/usr/bin/env node
/**
 * Downloads the pinned WeSpeaker ResNet34-LM ONNX model into Application Support.
 * The model is never committed to Git.
 */
import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  SPEAKER_MODEL_ONNX_URL,
  SPEAKER_MODEL_SHA256,
  defaultSpeakerModelPath,
  sha256File,
  writeModelBytes,
} from './speaker-model.js';

async function main(): Promise<void> {
  const modelPath = process.argv[2] ? process.argv[2]! : defaultSpeakerModelPath();
  const tempPath = join(tmpdir(), `jericho-speaker-${randomBytes(8).toString('hex')}.onnx`);
  mkdirSync(dirname(modelPath), { recursive: true, mode: 0o700 });

  process.stdout.write(`Downloading ${SPEAKER_MODEL_ONNX_URL}\n`);
  const response = await fetch(SPEAKER_MODEL_ONNX_URL);
  if (!response.ok || !response.body) {
    throw new Error(`speaker_model_download_failed:${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(tempPath, { mode: 0o600 }));
  const digest = sha256File(tempPath);
  if (digest !== SPEAKER_MODEL_SHA256) {
    unlinkSync(tempPath);
    throw new Error(`speaker_model_checksum_mismatch:${digest}`);
  }
  const bytes = readFileSync(tempPath);
  writeModelBytes(modelPath, bytes);
  unlinkSync(tempPath);
  process.stdout.write(JSON.stringify({
    ok: true,
    modelPath,
    sha256: digest,
    bytes: bytes.length,
  }, null, 2));
  process.stdout.write('\n');
  process.stdout.write('Next: pnpm --filter bridge enroll-carlos-voice -- --i-am-carlos --confirm \'ENROLL CARLOS VOICEPRINT\' --wav s1.wav --wav s2.wav --wav s3.wav\n');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'speaker_model_download_failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
