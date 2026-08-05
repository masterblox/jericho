import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * WeSpeaker ResNet34-LM (VoxCeleb2 Dev, large-margin finetune).
 * Official ONNX: https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34-LM
 * Paper: https://arxiv.org/pdf/2210.17016.pdf
 * License: cc-by-4.0
 *
 * VoxCeleb1-O-clean EER ≈ 0.80% (LM, no AS-Norm) per the model card.
 * Jericho uses a fail-closed cosine accept threshold well above the
 * open-set diarization default (0.45) so unknown speakers are rejected.
 */
export const SPEAKER_MODEL_ID = 'wespeaker-voxceleb-resnet34-LM';
export const SPEAKER_MODEL_VERSION = 1;
export const SPEAKER_EMBEDDING_DIM = 256;
export const SPEAKER_SAMPLE_RATE = 16_000;
export const SPEAKER_OWNER_ID = 'carlos';

/** Cosine accept threshold — see SPEAKER-VERIFICATION.md for rationale. */
export const SPEAKER_ACCEPT_THRESHOLD = 0.7;
/** Scores in [reject, accept) are ambiguous and fail closed. */
export const SPEAKER_REJECT_THRESHOLD = 0.55;
/** Enrollment samples must agree with each other at least this strongly. */
export const SPEAKER_ENROLLMENT_CONSISTENCY = 0.75;
export const SPEAKER_ENROLLMENT_MIN_SAMPLES = 3;
export const SPEAKER_ENROLLMENT_MIN_SECONDS = 1;
export const SPEAKER_VOICEPRINT_VERSION = 1;

export const SPEAKER_MODEL_ONNX_URL =
  'https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34-LM/resolve/main/voxceleb_resnet34_LM.onnx';

/** SHA-256 of the official ONNX blob (verified at download time). */
export const SPEAKER_MODEL_SHA256 =
  '7bb2f06e9df17cdf1ef14ee8a15ab08ed28e8d0ef5054ee135741560df2ec068';

export const SPEAKER_KEYCHAIN_SERVICE = 'jericho-speaker-voiceprint';

export function defaultSpeakerDataRoot(home = homedir()): string {
  return join(home, 'Library', 'Application Support', 'Jericho', 'speaker');
}

export function defaultSpeakerModelPath(home = homedir()): string {
  return join(defaultSpeakerDataRoot(home), 'models', `${SPEAKER_MODEL_ID}.onnx`);
}

export function defaultVoiceprintPath(home = homedir()): string {
  return join(defaultSpeakerDataRoot(home), 'voiceprints', `${SPEAKER_OWNER_ID}.voiceprint.enc`);
}

export function assertModelPresent(modelPath: string): void {
  if (!existsSync(modelPath)) {
    throw new Error(`speaker_model_missing:${modelPath}`);
  }
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function writeModelBytes(modelPath: string, bytes: Buffer): void {
  mkdirSync(dirname(modelPath), { recursive: true, mode: 0o700 });
  writeFileSync(modelPath, bytes, { mode: 0o600 });
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || a.length !== b.length) return Number.NaN;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA <= 0 || normB <= 0) return Number.NaN;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function l2Normalize(vector: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vector.length; i += 1) norm += vector[i]! * vector[i]!;
  const scale = Math.sqrt(norm);
  const out = new Float32Array(vector.length);
  if (scale <= 0) return out;
  for (let i = 0; i < vector.length; i += 1) out[i] = vector[i]! / scale;
  return out;
}

export function zeroFill(buffer: Float32Array | Float64Array | Int16Array): void {
  buffer.fill(0);
}
