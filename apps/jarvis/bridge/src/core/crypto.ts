import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';

const FORMAT_VERSION = 2;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export interface MasterKeyOptions {
  environment?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  username?: string;
  runSecurityCommand?: (args: readonly string[], input?: string) => string;
  generateKey?: () => Buffer;
}

export function loadMasterKey(options: MasterKeyOptions = {}): Buffer {
  const environment = options.environment ?? process.env;
  const configuredKey = environment.JERICHO_MASTER_KEY;
  if (configuredKey) {
    return decodeMasterKey(configuredKey, 'JERICHO_MASTER_KEY');
  }
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin') {
    throw new Error(
      'No Jericho master key is available. Set JERICHO_MASTER_KEY to a base64-encoded 32-byte key.',
    );
  }
  const username = options.username ?? userInfo().username;
  const runSecurityCommand = options.runSecurityCommand ?? defaultSecurityCommand;
  const readPersistedKey = () => {
    const encoded = runSecurityCommand([
      'find-generic-password',
      '-s',
      'jericho-core',
      '-a',
      username,
      '-w',
    ]);
    return decodeMasterKey(encoded, 'macOS Keychain item jericho-core');
  };
  try {
    return readPersistedKey();
  } catch (cause) {
    if (!isMissingKeychainItem(cause)) {
      throw new Error('Unable to read Jericho master key from macOS Keychain', {
        cause,
      });
    }
  }

  const key = (options.generateKey ?? (() => randomBytes(32)))();
  if (key.length !== 32) {
    throw new Error('Generated Jericho master key must be exactly 32 bytes');
  }
  const encoded = key.toString('base64');
  try {
    runSecurityCommand(
      [
        'add-generic-password',
        '-s',
        'jericho-core',
        '-a',
        username,
        '-w',
      ],
      `${encoded}\n`,
    );
  } catch (cause) {
    if (!isDuplicateKeychainItem(cause)) {
      throw new Error('Unable to persist Jericho master key in macOS Keychain', {
        cause,
      });
    }
    try {
      return readPersistedKey();
    } catch (readCause) {
      throw new Error(
        'Unable to read Jericho master key after concurrent Keychain initialization',
        { cause: readCause },
      );
    }
  }
  try {
    return readPersistedKey();
  } catch (cause) {
    throw new Error(
      'Unable to read Jericho master key after Keychain initialization',
      { cause },
    );
  }
}

function isMissingKeychainItem(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'status' in cause &&
    cause.status === 44
  );
}

function isDuplicateKeychainItem(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'status' in cause &&
    cause.status === 45
  );
}

function decodeMasterKey(value: string, source: string): Buffer {
  const encoded = value.trim();
  const decoded = Buffer.from(encoded, 'base64');
  if (decoded.length !== 32 || decoded.toString('base64') !== encoded) {
    throw new Error(`${source} must be valid base64 encoding exactly 32 bytes`);
  }
  return decoded;
}

function defaultSecurityCommand(args: readonly string[], input?: string): string {
  return execFileSync('security', [...args], {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export class CoreCrypto {
  readonly #key: Buffer;
  readonly #integrityKey: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) {
      throw new Error('Jericho master key must be exactly 32 bytes');
    }
    this.#key = Buffer.from(key);
    this.#integrityKey = Buffer.from(
      hkdfSync(
        'sha256',
        key,
        Buffer.from('jericho-core:v1', 'utf8'),
        Buffer.from('record-integrity-hmac', 'utf8'),
        32,
      ),
    );
  }

  integrityDigest(canonicalPayload: string): string {
    return createHmac('sha256', this.#integrityKey)
      .update(canonicalPayload, 'utf8')
      .digest('hex');
  }

  encryptJson(value: unknown, associatedData: string | Buffer = ''): Buffer {
    const header = Buffer.from([FORMAT_VERSION]);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    cipher.setAAD(authenticatedData(header, associatedData));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([
      header,
      iv,
      authTag,
      ciphertext,
    ]);
  }

  decryptJson<T>(payload: Buffer, associatedData: string | Buffer = ''): T {
    try {
      if (
        payload.length < 1 + IV_BYTES + AUTH_TAG_BYTES ||
        payload[0] !== FORMAT_VERSION
      ) {
        throw new Error('Unsupported encrypted payload format');
      }
      const header = payload.subarray(0, 1);
      const iv = payload.subarray(1, 1 + IV_BYTES);
      const authTag = payload.subarray(1 + IV_BYTES, 1 + IV_BYTES + AUTH_TAG_BYTES);
      const ciphertext = payload.subarray(1 + IV_BYTES + AUTH_TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', this.#key, iv);
      decipher.setAAD(authenticatedData(header, associatedData));
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      return JSON.parse(plaintext.toString('utf8')) as T;
    } catch (cause) {
      throw new Error('Encrypted payload authentication failed', { cause });
    }
  }
}

function authenticatedData(
  header: Buffer,
  associatedData: string | Buffer,
): Buffer {
  const context =
    typeof associatedData === 'string'
      ? Buffer.from(associatedData, 'utf8')
      : associatedData;
  const contextLength = Buffer.allocUnsafe(4);
  contextLength.writeUInt32BE(context.length);
  return Buffer.concat([header, contextLength, context]);
}
