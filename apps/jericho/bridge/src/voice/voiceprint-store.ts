import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { userInfo } from 'node:os';

import { readKeychainSecret, writeKeychainSecret } from '../platform/keychain.js';
import {
  SPEAKER_EMBEDDING_DIM,
  SPEAKER_KEYCHAIN_SERVICE,
  SPEAKER_MODEL_ID,
  SPEAKER_OWNER_ID,
  SPEAKER_VOICEPRINT_VERSION,
  defaultVoiceprintPath,
} from './speaker-model.js';

const FORMAT_VERSION = 1;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export interface StoredVoiceprint {
  speakerId: typeof SPEAKER_OWNER_ID;
  modelId: string;
  voiceprintVersion: number;
  enrolledAt: number;
  evaluated: boolean;
  embedding: number[];
  sampleCount: number;
  acceptThreshold: number;
  rejectThreshold: number;
}

export interface VoiceprintStoreOptions {
  path?: string;
  platform?: NodeJS.Platform;
  username?: string;
  readSecret?: (service: string) => string;
  writeSecret?: (service: string, secret: string) => void;
  generateKey?: () => Buffer;
}

export class VoiceprintStore {
  readonly path: string;
  #key: Buffer | undefined;
  readonly #options: VoiceprintStoreOptions;

  constructor(options: VoiceprintStoreOptions = {}) {
    this.path = options.path ?? defaultVoiceprintPath();
    this.#options = options;
  }

  exists(): boolean {
    return existsSync(this.path);
  }

  load(): StoredVoiceprint | undefined {
    if (!this.exists()) return undefined;
    const payload = readFileSync(this.path);
    const key = this.#loadOrCreateKey();
    const record = decryptVoiceprint(payload, key);
    assertVoiceprint(record);
    return record;
  }

  save(record: StoredVoiceprint): void {
    assertVoiceprint(record);
    const key = this.#loadOrCreateKey();
    const payload = encryptVoiceprint(record, key);
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(this.path, payload, { mode: 0o600 });
  }

  delete(): void {
    if (this.exists()) rmSync(this.path);
  }

  #loadOrCreateKey(): Buffer {
    if (this.#key) return this.#key;
    const platform = this.#options.platform ?? process.platform;
    if (platform !== 'darwin' && !this.#options.readSecret) {
      // Non-macOS / tests: ephemeral or injected secret only.
      if (this.#options.generateKey) {
        this.#key = this.#options.generateKey();
        return this.#key;
      }
      throw new Error('speaker_voiceprint_key_unavailable');
    }
    const username = this.#options.username ?? userInfo().username;
    const readSecret = this.#options.readSecret
      ?? ((service) => readKeychainSecret(service, { username }));
    const writeSecret = this.#options.writeSecret
      ?? ((service, secret) => writeKeychainSecret(service, secret, { username }));

    try {
      this.#key = decodeKey(readSecret(SPEAKER_KEYCHAIN_SERVICE));
      return this.#key;
    } catch (cause) {
      if (!isMissingKeychainItem(cause) && !this.#options.readSecret) {
        throw new Error('speaker_voiceprint_key_unreadable', { cause });
      }
    }

    const generated = (this.#options.generateKey ?? (() => randomBytes(32)))();
    if (generated.length !== 32) throw new Error('speaker_voiceprint_key_invalid');
    try {
      writeSecret(SPEAKER_KEYCHAIN_SERVICE, generated.toString('base64'));
    } catch (cause) {
      if (!isDuplicateKeychainItem(cause)) {
        throw new Error('speaker_voiceprint_key_unwritable', { cause });
      }
    }
    try {
      this.#key = decodeKey(readSecret(SPEAKER_KEYCHAIN_SERVICE));
      return this.#key;
    } catch (cause) {
      // Test injectors may only support write-once memory maps.
      this.#key = Buffer.from(generated);
      return this.#key;
    }
  }
}

export function meanEmbedding(embeddings: Float32Array[]): Float32Array {
  if (embeddings.length === 0) throw new Error('speaker_enrollment_empty');
  const dim = embeddings[0]!.length;
  const mean = new Float32Array(dim);
  for (const embedding of embeddings) {
    if (embedding.length !== dim) throw new Error('speaker_embedding_dim_invalid');
    for (let i = 0; i < dim; i += 1) mean[i]! += embedding[i]!;
  }
  for (let i = 0; i < dim; i += 1) mean[i]! /= embeddings.length;
  let norm = 0;
  for (let i = 0; i < dim; i += 1) norm += mean[i]! * mean[i]!;
  const scale = Math.sqrt(norm);
  if (scale > 0) {
    for (let i = 0; i < dim; i += 1) mean[i]! /= scale;
  }
  return mean;
}

function assertVoiceprint(record: StoredVoiceprint): void {
  if (record.speakerId !== SPEAKER_OWNER_ID) throw new Error('speaker_voiceprint_owner_invalid');
  if (record.modelId !== SPEAKER_MODEL_ID) throw new Error('speaker_voiceprint_model_invalid');
  if (record.voiceprintVersion !== SPEAKER_VOICEPRINT_VERSION) {
    throw new Error('speaker_voiceprint_version_invalid');
  }
  if (!record.evaluated) throw new Error('speaker_voiceprint_not_evaluated');
  if (!Array.isArray(record.embedding) || record.embedding.length !== SPEAKER_EMBEDDING_DIM) {
    throw new Error('speaker_voiceprint_embedding_invalid');
  }
  if (!Number.isFinite(record.enrolledAt) || record.enrolledAt <= 0) {
    throw new Error('speaker_voiceprint_enrolled_at_invalid');
  }
  if (!Number.isInteger(record.sampleCount) || record.sampleCount < 1) {
    throw new Error('speaker_voiceprint_sample_count_invalid');
  }
}

function encryptVoiceprint(record: StoredVoiceprint, key: Buffer): Buffer {
  const header = Buffer.from([FORMAT_VERSION]);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(record), 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([header, iv, authTag, ciphertext]);
}

function decryptVoiceprint(payload: Buffer, key: Buffer): StoredVoiceprint {
  if (payload.length < 1 + IV_BYTES + AUTH_TAG_BYTES || payload[0] !== FORMAT_VERSION) {
    throw new Error('speaker_voiceprint_corrupt');
  }
  const header = payload.subarray(0, 1);
  const iv = payload.subarray(1, 1 + IV_BYTES);
  const authTag = payload.subarray(1 + IV_BYTES, 1 + IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = payload.subarray(1 + IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(header);
  decipher.setAuthTag(authTag);
  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8')) as StoredVoiceprint;
  } catch (cause) {
    throw new Error('speaker_voiceprint_corrupt', { cause });
  }
}

function decodeKey(encoded: string): Buffer {
  const decoded = Buffer.from(encoded.trim(), 'base64');
  if (decoded.length !== 32) throw new Error('speaker_voiceprint_key_invalid');
  return decoded;
}

function isMissingKeychainItem(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'status' in cause && cause.status === 44;
}

function isDuplicateKeychainItem(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'status' in cause && cause.status === 45;
}
