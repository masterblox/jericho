import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { acquireCoreProcessLock } from '../src/core/process-lock.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Core process single-writer lock', () => {
  it('rejects a second live Core and releases only its own lock', () => {
    const root = temporaryRoot();
    const alive = (pid: number) => pid === 101;
    const first = acquireCoreProcessLock({ root, pid: 101, token: 'first', processAlive: alive });

    expect(() => acquireCoreProcessLock({ root, pid: 202, token: 'second', processAlive: alive }))
      .toThrow(/already running.*101/i);
    expect(existsSync(first.path)).toBe(true);

    first.release();
    expect(existsSync(first.path)).toBe(false);
    first.release();
  });

  it('reclaims a dead owner without allowing the old owner to remove the successor', () => {
    const root = temporaryRoot();
    const first = acquireCoreProcessLock({ root, pid: 101, token: 'first', processAlive: () => false });
    const second = acquireCoreProcessLock({ root, pid: 202, token: 'second', processAlive: () => false });

    first.release();
    expect(existsSync(second.path)).toBe(true);
    second.release();
    expect(existsSync(second.path)).toBe(false);
  });
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'jericho-core-lock-'));
  roots.push(root);
  return root;
}
