import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface KeychainAccessOptions {
  username?: string;
  runSecurity?: (args: readonly string[]) => string;
  runHelper?: (args: readonly string[], input: string) => string;
}

export function readKeychainSecret(service: string, options: KeychainAccessOptions = {}): string {
  const username = options.username ?? userInfo().username;
  const run = options.runSecurity ?? ((args) => execFileSync('/usr/bin/security', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }));
  return run(['find-generic-password', '-s', service, '-a', username, '-w']);
}

/** Persist a secret through Security.framework. Secret material is stdin only. */
export function writeKeychainSecret(
  service: string,
  secret: string,
  options: KeychainAccessOptions = {},
  replace = false,
): void {
  if (!secret || secret.includes('\0')) throw new Error('Keychain secret must be non-empty text');
  const username = options.username ?? userInfo().username;
  const run = options.runHelper ?? ((args, input) => execFileSync(keychainHelperPath(), args, {
    input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  }));
  run([replace ? 'replace' : 'add', service, username], secret);
}

export function keychainHelperPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../../electron/dist/jericho-keychain-helper');
}
