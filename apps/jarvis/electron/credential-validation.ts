export interface ValidBridgeSecrets { apiToken: string; masterKey: string }

export function validateApiToken(value: unknown, source: string): string {
  if (typeof value !== 'string') throw new Error(`${source} is missing or malformed`);
  const token = value.trim();
  if (!token || /[\u0000-\u0020\u007f]/u.test(token)) {
    throw new Error(`${source} must be a non-empty token without whitespace or control characters`);
  }
  return token;
}

export function validateMasterKey(value: unknown, source: string): string {
  if (typeof value !== 'string') throw new Error(`${source} is missing or malformed`);
  const encoded = value.trim();
  const decoded = Buffer.from(encoded, 'base64');
  if (decoded.length !== 32 || decoded.toString('base64') !== encoded) {
    throw new Error(`${source} must be valid base64 encoding exactly 32 bytes`);
  }
  return encoded;
}

export function validateBridgeSecrets(value: unknown, source: string): ValidBridgeSecrets {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source} is malformed`);
  }
  const record = value as Record<string, unknown>;
  return {
    apiToken: validateApiToken(record.apiToken, `${source} API token`),
    masterKey: validateMasterKey(record.masterKey, `${source} master key`),
  };
}
