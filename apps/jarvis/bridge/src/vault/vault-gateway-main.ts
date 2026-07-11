import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';

import { createVaultGatewayServer, VaultGatewayService } from './vault-gateway.js';

export interface VaultGatewayConfig {
  host: string;
  port: number;
  token: string;
  vaultPath: string;
  ragScriptPath: string;
  cachePath: string;
  indexPath: string;
  cacheTtlMs: number;
  staleAfterMs: number;
  timeoutMs: number;
  maxOutputBytes: number;
}

export function loadVaultGatewayConfig(
  environment: Record<string, string | undefined> = process.env,
): VaultGatewayConfig {
  const token = environment.JERICHO_VAULT_GATEWAY_TOKEN?.trim();
  if (!token) throw new Error('JERICHO_VAULT_GATEWAY_TOKEN is required');
  const host = environment.JERICHO_VAULT_GATEWAY_HOST?.trim() || '127.0.0.1';
  assertPrivateHost(host);
  return {
    host,
    port: boundedInteger(environment.JERICHO_VAULT_GATEWAY_PORT ?? '8790', 0, 65_535, 'port'),
    token,
    vaultPath: environment.JERICHO_VAULT_PATH?.trim() || '/opt/brain',
    ragScriptPath: environment.JERICHO_VAULT_RAG_SCRIPT?.trim() || '/opt/data/scripts/vault-rag.py',
    cachePath: environment.JERICHO_VAULT_RAG_CACHE?.trim() || '/opt/data/jericho/intel/rag-cache.json',
    indexPath: environment.JERICHO_VAULT_RAG_INDEX?.trim() || '/opt/data/vault-rag-index/bm25_index.json',
    cacheTtlMs: boundedInteger(environment.JERICHO_VAULT_CACHE_TTL_MS ?? '86400000', 1, Number.MAX_SAFE_INTEGER, 'cache TTL'),
    staleAfterMs: boundedInteger(environment.JERICHO_VAULT_SYNC_STALE_MS ?? '3600000', 1, Number.MAX_SAFE_INTEGER, 'sync stale threshold'),
    timeoutMs: boundedInteger(environment.JERICHO_VAULT_COMMAND_TIMEOUT_MS ?? '45000', 1, 15 * 60_000, 'command timeout'),
    maxOutputBytes: boundedInteger(environment.JERICHO_VAULT_MAX_OUTPUT_BYTES ?? '262144', 1, 4 * 1024 * 1024, 'output bound'),
  };
}

export async function main(): Promise<void> {
  const config = loadVaultGatewayConfig();
  const service = new VaultGatewayService(config);
  const server = createVaultGatewayServer({ service, token: config.token, host: config.host });
  const address = await server.listen(config.port);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await server.close();
  };
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
  console.log(`[jericho-vault] listening on http://${address.host}:${address.port}`);
}

function boundedInteger(value: string, minimum: number, maximum: number, label: string): number {
  if (!/^\d+$/u.test(value)) throw new Error(`Vault gateway ${label} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Vault gateway ${label} is invalid`);
  }
  return parsed;
}

function assertPrivateHost(host: string): void {
  if (host === 'localhost' || host === '::1') return;
  if (isIP(host) === 6 && /^(?:fc|fd)/iu.test(host)) return;
  if (isIP(host) !== 4) throw new Error('Vault gateway host must be private');
  const [a, b] = host.split('.').map(Number);
  if (a === 127 || a === 10 || (a === 192 && b === 168)
    || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127)) return;
  throw new Error('Vault gateway host must be private');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
