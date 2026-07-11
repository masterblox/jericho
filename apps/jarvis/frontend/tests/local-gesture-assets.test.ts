import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const frontend = fileURLToPath(new URL('../', import.meta.url));

describe('production-local gesture assets', () => {
  it('uses same-origin pinned WASM and model paths', () => {
    const source = readFileSync(new URL('../src/gestures.ts', import.meta.url), 'utf8');
    expect(source).toContain("const WASM_URL = '/mediapipe/wasm'");
    expect(source).toContain("const MODEL_URL = '/mediapipe/models/gesture_recognizer.task'");
    expect(source).not.toMatch(/https?:\/\//u);
    expect(statSync(`${frontend}public/mediapipe/wasm/vision_wasm_internal.wasm`).size)
      .toBeGreaterThan(1_000_000);
  });

  it('pins the reviewed gesture recognizer model bytes', () => {
    const model = readFileSync(`${frontend}public/mediapipe/models/gesture_recognizer.task`);
    expect(createHash('sha256').update(model).digest('hex'))
      .toBe('97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482');
  });
});
