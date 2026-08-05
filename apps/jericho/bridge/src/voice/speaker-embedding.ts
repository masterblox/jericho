import { existsSync } from 'node:fs';

import { computeLogMelFbank, fbankFrameCount } from './speaker-fbank.js';
import {
  SPEAKER_EMBEDDING_DIM,
  SPEAKER_MODEL_SHA256,
  SPEAKER_SAMPLE_RATE,
  assertModelPresent,
  l2Normalize,
  sha256File,
  zeroFill,
} from './speaker-model.js';

type OrtModule = typeof import('onnxruntime-node');
type InferenceSession = import('onnxruntime-node').InferenceSession;

export interface SpeakerEmbedder {
  readonly modelPath: string;
  embed(pcm16kMono: Float32Array): Promise<Float32Array>;
  dispose(): void;
}

export interface OnnxSpeakerEmbedderOptions {
  modelPath: string;
  /** Skip SHA-256 pin when injecting fixtures in tests. */
  verifyChecksum?: boolean;
  createSession?: (modelPath: string) => Promise<InferenceSession>;
}

let ortModule: OrtModule | undefined;

async function loadOrt(): Promise<OrtModule> {
  if (!ortModule) {
    ortModule = await import('onnxruntime-node');
  }
  return ortModule;
}

export class OnnxSpeakerEmbedder implements SpeakerEmbedder {
  readonly modelPath: string;
  #session: InferenceSession | undefined;
  #loading: Promise<InferenceSession> | undefined;
  #createSession: (modelPath: string) => Promise<InferenceSession>;

  constructor(options: OnnxSpeakerEmbedderOptions) {
    if (!options.modelPath.trim()) throw new Error('speaker_model_path_invalid');
    this.modelPath = options.modelPath;
    if (options.verifyChecksum !== false) {
      assertModelPresent(this.modelPath);
      const digest = sha256File(this.modelPath);
      if (digest !== SPEAKER_MODEL_SHA256) {
        throw new Error(`speaker_model_checksum_mismatch:${digest}`);
      }
    } else if (!existsSync(this.modelPath)) {
      throw new Error(`speaker_model_missing:${this.modelPath}`);
    }
    this.#createSession = options.createSession ?? defaultCreateSession;
  }

  async embed(pcm16kMono: Float32Array): Promise<Float32Array> {
    if (pcm16kMono.length === 0) throw new Error('speaker_audio_empty');
    if (fbankFrameCount(pcm16kMono.length) < 10) throw new Error('speaker_audio_too_short');
    const feats = computeLogMelFbank(pcm16kMono);
    const frames = feats.length / 80;
    try {
      const session = await this.#sessionReady();
      const ort = await loadOrt();
      const input = new ort.Tensor('float32', feats, [1, frames, 80]);
      const outputs = await session.run({ feats: input });
      const emb = outputs.embs ?? outputs[Object.keys(outputs)[0]!]!;
      const data = emb.data as Float32Array;
      if (data.length < SPEAKER_EMBEDDING_DIM) {
        throw new Error('speaker_embedding_dim_invalid');
      }
      const vector = l2Normalize(Float32Array.from(data.subarray(0, SPEAKER_EMBEDDING_DIM)));
      zeroFill(data instanceof Float32Array ? data : Float32Array.from(data));
      return vector;
    } finally {
      zeroFill(feats);
    }
  }

  dispose(): void {
    this.#session = undefined;
    this.#loading = undefined;
  }

  async #sessionReady(): Promise<InferenceSession> {
    if (this.#session) return this.#session;
    if (!this.#loading) {
      this.#loading = this.#createSession(this.modelPath).then((session) => {
        this.#session = session;
        return session;
      });
    }
    return this.#loading;
  }
}

async function defaultCreateSession(modelPath: string): Promise<InferenceSession> {
  const ort = await loadOrt();
  const providers = speakerExecutionProviders();
  try {
    return await ort.InferenceSession.create(modelPath, { executionProviders: providers });
  } catch {
    return ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
    });
  }
}

/** Provider identifiers accepted by onnxruntime-node (not native ORT class names). */
export function speakerExecutionProviders(
  platform: NodeJS.Platform = process.platform,
): Array<'coreml' | 'cpu'> {
  return platform === 'darwin' ? ['coreml', 'cpu'] : ['cpu'];
}

/** Deterministic, model-free embedder for tests — not a biometric of any person. */
export class DeterministicEmbedder implements SpeakerEmbedder {
  readonly modelPath = 'deterministic://test-embedder';

  async embed(pcm16kMono: Float32Array): Promise<Float32Array> {
    const out = new Float32Array(SPEAKER_EMBEDDING_DIM);
    if (pcm16kMono.length === 0) return out;
    // Coarse DFT magnitudes so same tones match and different tones diverge.
    const bands = 64;
    for (let band = 0; band < bands; band += 1) {
      const freq = 40 + band * 40;
      let re = 0;
      let im = 0;
      const limit = Math.min(pcm16kMono.length, 4_000);
      for (let i = 0; i < limit; i += 1) {
        const angle = (2 * Math.PI * freq * i) / SPEAKER_SAMPLE_RATE;
        re += pcm16kMono[i]! * Math.cos(angle);
        im += pcm16kMono[i]! * Math.sin(angle);
      }
      out[band] = Math.hypot(re, im) / limit;
      out[band + 64] = Math.atan2(im, re) / Math.PI;
    }
    let energy = 0;
    for (let i = 0; i < pcm16kMono.length; i += 1) energy += Math.abs(pcm16kMono[i]!);
    out[200] = pcm16kMono.length / SPEAKER_SAMPLE_RATE;
    out[201] = energy / pcm16kMono.length;
    return l2Normalize(out);
  }

  dispose(): void {
    // no-op
  }
}
