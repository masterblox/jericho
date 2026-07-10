import { describe, expect, it } from 'vitest';

import { CoreCrypto, loadMasterKey } from '../src/core/crypto.js';

describe('CoreCrypto', () => {
  it('round-trips JSON with AES-256-GCM', () => {
    const crypto = new CoreCrypto(Buffer.alloc(32, 7));
    const value = { message: 'private truth', nested: { count: 3 } };

    const encrypted = crypto.encryptJson(value);

    expect(encrypted.equals(Buffer.from(JSON.stringify(value)))).toBe(false);
    expect(crypto.decryptJson(encrypted)).toEqual(value);
  });

  it('rejects tampered ciphertext with an authentication failure', () => {
    const crypto = new CoreCrypto(Buffer.alloc(32, 11));
    const encrypted = crypto.encryptJson({ secret: 'do not alter' });
    encrypted[encrypted.length - 1] ^= 0xff;

    expect(() => crypto.decryptJson(encrypted)).toThrow(
      'Encrypted payload authentication failed',
    );
  });

  it('authenticates the encrypted payload format header', () => {
    const crypto = new CoreCrypto(Buffer.alloc(32, 13));
    const encrypted = crypto.encryptJson({ secret: 'versioned payload' });
    encrypted[0] ^= 0xff;

    expect(() => crypto.decryptJson(encrypted)).toThrow(
      'Encrypted payload authentication failed',
    );
  });

  it('rejects injected keys that are not exactly 32 bytes', () => {
    expect(() => new CoreCrypto(Buffer.alloc(31))).toThrow(
      'Jericho master key must be exactly 32 bytes',
    );
  });
});

describe('loadMasterKey', () => {
  it('loads a base64-encoded key from JERICHO_MASTER_KEY', () => {
    const expected = Buffer.alloc(32, 23);

    const loaded = loadMasterKey({
      environment: { JERICHO_MASTER_KEY: expected.toString('base64') },
      platform: 'linux',
    });

    expect(loaded).toEqual(expected);
  });

  it('rejects malformed or incorrectly sized environment keys', () => {
    expect(() =>
      loadMasterKey({
        environment: { JERICHO_MASTER_KEY: 'not-valid-base64' },
        platform: 'linux',
      }),
    ).toThrow('JERICHO_MASTER_KEY must be valid base64 encoding exactly 32 bytes');
  });

  it('loads the current user key from the macOS Keychain', () => {
    const expected = Buffer.alloc(32, 29);
    const calls: Array<readonly string[]> = [];

    const loaded = loadMasterKey({
      environment: {},
      platform: 'darwin',
      username: 'test-user',
      runSecurityCommand: (args) => {
        calls.push(args);
        return `${expected.toString('base64')}\n`;
      },
    });

    expect(loaded).toEqual(expected);
    expect(calls).toEqual([
      ['find-generic-password', '-s', 'jericho-core', '-a', 'test-user', '-w'],
    ]);
  });

  it('generates and persists a missing macOS Keychain key without putting it in argv', () => {
    const generated = Buffer.alloc(32, 31);
    const calls: Array<{ args: readonly string[]; input?: string }> = [];

    const loaded = loadMasterKey({
      environment: {},
      platform: 'darwin',
      username: 'test-user',
      generateKey: () => Buffer.from(generated),
      runSecurityCommand: (args, input) => {
        calls.push({ args, input });
        if (args[0] === 'find-generic-password') {
          throw Object.assign(new Error('item not found'), { status: 44 });
        }
        return '';
      },
    });

    expect(loaded).toEqual(generated);
    expect(calls[1]).toEqual({
      args: [
        'add-generic-password',
        '-U',
        '-s',
        'jericho-core',
        '-a',
        'test-user',
        '-w',
      ],
      input: `${generated.toString('base64')}\n`,
    });
    expect(calls[1].args).not.toContain(generated.toString('base64'));
  });

  it('fails closed with an actionable error off macOS when no key is configured', () => {
    expect(() =>
      loadMasterKey({ environment: {}, platform: 'linux' }),
    ).toThrow('Set JERICHO_MASTER_KEY to a base64-encoded 32-byte key');
  });
});
