import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

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

  it('authenticates caller-provided record identity as AEAD associated data', () => {
    const crypto = new CoreCrypto(Buffer.alloc(32, 17));
    const encrypted = crypto.encryptJson({ id: 'event-1' }, 'events:event-1');

    expect(crypto.decryptJson(encrypted, 'events:event-1')).toEqual({
      id: 'event-1',
    });
    expect(() => crypto.decryptJson(encrypted, 'events:event-2')).toThrow(
      'Encrypted payload authentication failed',
    );
  });

  it('derives a separate key for deterministic HMAC integrity digests', () => {
    const payload = '{"id":"event-1","secret":"value"}';
    const first = new CoreCrypto(Buffer.alloc(32, 19));
    const second = new CoreCrypto(Buffer.alloc(32, 20));

    const digest = first.integrityDigest(payload);

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.integrityDigest(payload)).toBe(digest);
    expect(second.integrityDigest(payload)).not.toBe(digest);
    expect(digest).not.toBe(createHash('sha256').update(payload).digest('hex'));
  });

  it('derives isolated encryption and integrity keys for a store scope', () => {
    const master = new CoreCrypto(Buffer.alloc(32, 21));
    const firstStore = master.deriveScoped('store:11111111');
    const secondStore = master.deriveScoped('store:22222222');
    const payload = '{"id":"event-1"}';
    const encrypted = firstStore.encryptJson({ id: 'event-1' }, 'events:event-1');

    expect(firstStore.integrityDigest(payload)).not.toBe(
      secondStore.integrityDigest(payload),
    );
    expect(() =>
      secondStore.decryptJson(encrypted, 'events:event-1'),
    ).toThrow('Encrypted payload authentication failed');
  });

  it('derives deterministic domain-separated keyed lookup tokens', () => {
    const firstStore = new CoreCrypto(Buffer.alloc(32, 21))
      .deriveScoped('store:11111111');
    const secondStore = new CoreCrypto(Buffer.alloc(32, 21))
      .deriveScoped('store:22222222');
    const value = 'carlos@example.test';

    const token = firstStore.lookupToken('external-identity', value);

    expect(token).toMatch(/^hmac-sha256-v1:[a-f0-9]{64}$/);
    expect(firstStore.lookupToken('external-identity', value)).toBe(token);
    expect(firstStore.lookupToken('receipt-destination', value)).not.toBe(token);
    expect(secondStore.lookupToken('external-identity', value)).not.toBe(token);
    expect(token).not.toContain(value);
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
    const calls: string[] = [];

    const loaded = loadMasterKey({
      environment: {},
      platform: 'darwin',
      username: 'test-user',
      readSecret: (service) => {
        calls.push(service);
        return `${expected.toString('base64')}\n`;
      },
    });

    expect(loaded).toEqual(expected);
    expect(calls).toEqual(['jericho-core']);
  });

  it('generates and persists a missing macOS Keychain key without putting it in argv', () => {
    const generated = Buffer.alloc(32, 31);
    const writes: Array<{ service: string; secret: string }> = [];
    let persisted: string | undefined;
    let findCalls = 0;

    const loaded = loadMasterKey({
      environment: {},
      platform: 'darwin',
      username: 'test-user',
      generateKey: () => Buffer.from(generated),
      readSecret: () => {
        findCalls += 1;
        if (!persisted) throw Object.assign(new Error('item not found'), { status: 44 });
        return `${persisted}\n`;
      },
      writeSecret: (service, secret) => {
        writes.push({ service, secret });
        persisted = secret;
      },
    });

    expect(loaded).toEqual(generated);
    expect(writes).toEqual([{ service: 'jericho-core', secret: generated.toString('base64') }]);
    expect(findCalls).toBe(2);
  });

  it('returns the persisted winner when another process wins key initialization', () => {
    const generated = Buffer.alloc(32, 37);
    const winner = Buffer.alloc(32, 43);
    let findCalls = 0;

    const loaded = loadMasterKey({
      environment: {},
      platform: 'darwin',
      username: 'test-user',
      generateKey: () => Buffer.from(generated),
      readSecret: () => {
        findCalls += 1;
        if (findCalls === 1) throw Object.assign(new Error('item not found'), { status: 44 });
        return `${winner.toString('base64')}\n`;
      },
      writeSecret: () => {
        throw Object.assign(new Error('duplicate item'), { status: 45 });
      },
    });

    expect(loaded).toEqual(winner);
    expect(findCalls).toBe(2);
  });

  it('fails closed with an actionable error off macOS when no key is configured', () => {
    expect(() =>
      loadMasterKey({ environment: {}, platform: 'linux' }),
    ).toThrow('Set JERICHO_MASTER_KEY to a base64-encoded 32-byte key');
  });
});
