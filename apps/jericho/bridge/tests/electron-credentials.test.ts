import { describe, expect, it } from 'vitest';
import {
  validateApiToken, validateBridgeSecrets, validateMasterKey,
} from '../../electron/credential-validation.js';

describe('Electron bridge credential validation', () => {
  const masterKey = Buffer.alloc(32, 7).toString('base64');

  it('accepts only a bounded token and canonical 32-byte base64 key', () => {
    expect(validateBridgeSecrets({ apiToken: 'token-123', masterKey }, 'fixture'))
      .toEqual({ apiToken: 'token-123', masterKey });
  });

  it.each(['', 'has whitespace', 'line\nbreak', '\0control'])(
    'rejects malformed API token %j', (value) => {
      expect(() => validateApiToken(value, 'Keychain API token')).toThrow(/token/i);
    },
  );

  it.each(['', 'not-base64', Buffer.alloc(31).toString('base64'), `${masterKey}\nextra`])(
    'rejects malformed master key %j', (value) => {
      expect(() => validateMasterKey(value, 'Keychain master key')).toThrow(/32 bytes/i);
    },
  );

  it('rejects malformed decrypted secure-storage shapes', () => {
    expect(() => validateBridgeSecrets(null, 'Electron secure storage')).toThrow('malformed');
    expect(() => validateBridgeSecrets({ apiToken: 'valid' }, 'Electron secure storage')).toThrow('master key');
  });
});
