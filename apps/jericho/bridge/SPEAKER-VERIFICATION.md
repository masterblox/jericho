# Carlos speaker verification

Local, fail-closed owner verification for Jericho voice tool authority.

## Model

| Field | Value |
| --- | --- |
| Model | **WeSpeaker ResNet34-LM** (`wespeaker-voxceleb-resnet34-LM`) |
| Source | Official Hugging Face card: https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34-LM |
| ONNX | `voxceleb_resnet34_LM.onnx` (SHA-256 `7bb2f06e9df17cdf1ef14ee8a15ab08ed28e8d0ef5054ee135741560df2ec068`) |
| Paper | Wang et al., WeSpeaker (ICASSP 2023); https://arxiv.org/pdf/2210.17016.pdf |
| Training data | VoxCeleb2 Dev (5994 speakers), large-margin finetune |
| Embedding | 256-d r-vector, L2-normalized |
| Frontend | 80-dim log-mel filterbank, 16 kHz, 25 ms Hamming / 10 ms shift |
| Runtime | `onnxruntime-node` on Apple Silicon (CoreML EP when available, else CPU) |
| License | cc-by-4.0 |

Published model-card EER on VoxCeleb1-O-clean is about **0.80%** (LM, no AS-Norm). That figure is provenance for model quality, not Jericho’s operating point.

## Threshold rationale

Jericho is a **single-owner, fail-closed** gate (not open-set diarization):

| Score (cosine) | Decision |
| --- | --- |
| `≥ 0.70` | Accept (`verified`) |
| `0.55 … 0.70` | Ambiguous → **reject** (`speaker_ambiguous`) |
| `< 0.55` | Reject (`speaker_mismatch`) |

Defaults (`JERICHO_SPEAKER_ACCEPT_THRESHOLD=0.70`, `JERICHO_SPEAKER_REJECT_THRESHOLD=0.55`) sit well above the common WeSpeaker / speakeronnx open-set starting point of **0.45**, trading some false rejects for fewer false accepts. Enrollment marks `evaluated: true` only after pairwise sample consistency (≥ 0.75 cosine) succeeds. Active-turn matches expire after **15 s** (`SPEAKER_MATCH_MAX_AGE_MS`); stale matches do not mint authority. CommandAuthority still rejects replayed nonces.

## States

`enrollment_required` · `verifying` · `verified` · `rejected` · `unavailable`

## Storage (outside Git)

| Artifact | Location |
| --- | --- |
| ONNX model | `~/Library/Application Support/Jericho/speaker/models/wespeaker-voxceleb-resnet34-LM.onnx` |
| Encrypted voiceprint | `~/Library/Application Support/Jericho/speaker/voiceprints/carlos.voiceprint.enc` |
| Voiceprint AES key | macOS Keychain service `jericho-speaker-voiceprint` |

Raw enrollment WAV and turn PCM are zero-filled after embedding. Biometrics are never committed.

## Resource requirements

- Apple Silicon Mac (CoreML/CPU ONNX Runtime)
- ~26 MB model download
- ~1–2 s of 16 kHz mono speech per verification window
- Node.js ≥ 22.13 with `onnxruntime-node`

## One-time Carlos enrollment (exact)

```bash
# 1) Download and pin the official ONNX model (Application Support; not Git)
pnpm --filter bridge download-speaker-model

# 2) Record three ≥1s 16 kHz mono PCM WAV clips of your voice (separate utterances)

# 3) Enroll (both flags are required anti-accident guards)
pnpm --filter bridge enroll-carlos-voice -- \
  --i-am-carlos \
  --confirm 'ENROLL CARLOS VOICEPRINT' \
  --wav ~/jericho-enrollment/sample1.wav \
  --wav ~/jericho-enrollment/sample2.wav \
  --wav ~/jericho-enrollment/sample3.wav
```

Overwrite an existing voiceprint only with `--replace-existing`.

## Tests

Deterministic verifier coverage (no Carlos biometrics, no model download):

```bash
pnpm --filter bridge typecheck
pnpm --filter bridge exec vitest run tests/speaker-verifier.test.ts tests/command-authority.test.ts tests/voice-gate.test.ts
```
