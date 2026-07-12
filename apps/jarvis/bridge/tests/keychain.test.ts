import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { writeKeychainSecret } from '../src/platform/keychain.js';

describe('native Keychain helper contract', () => {
  it('passes only operation, service, and account in argv and sends the secret on stdin', () => {
    let capturedArgs: readonly string[] = [];
    let capturedInput = '';
    const runHelper = vi.fn((args: readonly string[], input: string) => {
      capturedArgs = args; capturedInput = input; return '';
    });
    writeKeychainSecret('jericho-core', 'private-secret', { username: 'carlos', runHelper });
    expect(runHelper).toHaveBeenCalledWith(['add', 'jericho-core', 'carlos'], 'private-secret');
    expect(JSON.stringify(capturedArgs)).not.toContain('private-secret');
    expect(capturedInput).toBe('private-secret');
  });

  it('rejects empty and NUL-containing values before invoking the helper', () => {
    const runHelper = vi.fn(() => '');
    expect(() => writeKeychainSecret('jericho-core', '', { runHelper })).toThrow('non-empty');
    expect(() => writeKeychainSecret('jericho-core', 'bad\0secret', { runHelper })).toThrow('non-empty');
    expect(runHelper).not.toHaveBeenCalled();
  });
});

describe('Electron packaging contract', () => {
  it('builds a Security.framework helper and unpacks the executable from asar', () => {
    const root = resolve(import.meta.dirname, '../..');
    const build = readFileSync(resolve(root, 'electron/build.mjs'), 'utf8');
    const packaging = readFileSync(resolve(root, 'electron/electron-builder.yml'), 'utf8');
    const helper = readFileSync(resolve(root, 'electron/keychain-helper.m'), 'utf8');
    expect(build).toContain("'-framework', 'Security'");
    expect(packaging).toContain('electron/dist/jericho-keychain-helper');
    expect(helper).toContain('SecItemAdd');
    expect(helper).toContain('readDataToEndOfFile');
    expect(helper).not.toContain('kSecValueData: service');
  });
});
