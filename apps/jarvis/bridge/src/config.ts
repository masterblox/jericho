import dotenv from 'dotenv';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MutationClass, type RepositoryGrant } from '@jericho/shared';

import type { PersonaMode } from './personas.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(directory, '../../.env') });

export interface JerichoConfig {
  host: string;
  port: number;
  apiToken: string;
  geminiApiKey?: string;
  model: string;
  voice: string;
  megatronVoice: string;
  defaultPersonaMode: PersonaMode;
  personaAutoRevertMs: number;
  systemInstruction: string;
  allowedOrigins: string[];
  telegramGatewayUrl?: string;
  telegramGatewayToken?: string;
  whatsappGatewayUrl?: string;
  whatsappGatewayToken?: string;
  linearApiKey?: string;
  paperclipUrl?: string;
  paperclipApiKey?: string;
  paperclipCompanyId?: string;
  notionToken?: string;
  notionDatabaseId?: string;
  notionProjectionFields: string[];
  gitRepositories: NamedPath[];
  githubRepositories: string[];
  conductorRoots: NamedPath[];
  obsidianVaultPath?: string;
  vaultGatewayUrl?: string;
  vaultGatewayToken?: string;
  vaultGatewayTimeoutMs: number;
  vaultCacheTtlMs: number;
  vaultMaintenanceIntervalMs: number;
  vaultSyncStaleMs: number;
  vaultRebuildWindowStartUtc: number;
  vaultRebuildWindowEndUtc: number;
  connectorLeaseMs: number;
  connectorMaxPages: number;
  connectorPollIntervalMs: number;
  hermesBusRoot?: string;
  hermesRepo?: string;
  hermesBranch?: string;
  hermesPollIntervalMs: number;
  hermesMaxWaitMs: number;
  missionRepositoryGrants: RepositoryGrant[];
  reflectionIntervalMs: number;
  voiceActiveTurnMs: number;
}

export interface NamedPath {
  id: string;
  path: string;
}

export interface ApiTokenOptions {
  environment?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  username?: string;
  runSecurityCommand?: (args: readonly string[], input?: string) => string;
  generateToken?: () => string;
}

/**
 * Resolve the loopback Core bearer token without ever putting a generated
 * credential in argv. On macOS the first boot creates one Keychain item and
 * every subsequent process reads the persisted winner.
 */
export function loadApiToken(options: ApiTokenOptions = {}): string {
  const environment = options.environment ?? process.env;
  const configured = optionalString(environment.JERICHO_API_TOKEN);
  if (configured) return configured;

  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin') {
    throw new Error('No Jericho API token is available. Set JERICHO_API_TOKEN.');
  }
  const username = options.username ?? userInfo().username;
  const runSecurityCommand = options.runSecurityCommand ?? defaultSecurityCommand;
  const readPersistedToken = () => validateApiToken(runSecurityCommand([
    'find-generic-password',
    '-s',
    'jericho-core-api',
    '-a',
    username,
    '-w',
  ]), 'macOS Keychain item jericho-core-api');

  try {
    return readPersistedToken();
  } catch (cause) {
    if (!isSecurityStatus(cause, 44)) {
      throw new Error('Unable to read Jericho API token from macOS Keychain', { cause });
    }
  }

  const generated = validateApiToken(
    (options.generateToken ?? (() => randomBytes(32).toString('base64url')))(),
    'Generated Jericho API token',
  );
  try {
    runSecurityCommand([
      'add-generic-password',
      '-s',
      'jericho-core-api',
      '-a',
      username,
      '-w',
    ], `${generated}\n`);
  } catch (cause) {
    if (!isSecurityStatus(cause, 45)) {
      throw new Error('Unable to persist Jericho API token in macOS Keychain', { cause });
    }
  }

  try {
    return readPersistedToken();
  } catch (cause) {
    throw new Error('Unable to read Jericho API token after Keychain initialization', { cause });
  }
}

export function loadConfig(
  environment: Record<string, string | undefined> = process.env,
  argv: string[] = process.argv.slice(2),
): JerichoConfig {
  const apiToken = loadApiToken({ environment });
  const cliPort = commandLinePort(argv);
  const port = parsePort(
    cliPort ?? environment.CONDUCTOR_PORT ?? environment.PORT ?? '8787',
  );
  const hermesBusRoot = optionalString(environment.JERICHO_HERMES_BUS_ROOT);
  const hermesRepo = optionalString(environment.JERICHO_HERMES_REPO);
  const hermesBranch = optionalString(environment.JERICHO_HERMES_BRANCH);
  assertCompleteHermesWorkspace({ hermesBusRoot, hermesRepo, hermesBranch });
  const hermesPollIntervalMs = parsePositiveInteger(
    environment.JERICHO_HERMES_POLL_INTERVAL_MS ?? '250',
    'JERICHO_HERMES_POLL_INTERVAL_MS',
  );
  const hermesMaxWaitMs = parsePositiveInteger(
    environment.JERICHO_HERMES_MAX_WAIT_MS ?? '900000',
    'JERICHO_HERMES_MAX_WAIT_MS',
  );
  if (hermesMaxWaitMs < hermesPollIntervalMs) {
    throw new Error('JERICHO_HERMES_MAX_WAIT_MS must be at least JERICHO_HERMES_POLL_INTERVAL_MS');
  }
  const defaultPersonaMode = parsePersonaMode(environment.DEFAULT_MODE);
  const vaultGatewayUrl = optionalString(environment.JERICHO_VAULT_GATEWAY_URL);
  const vaultGatewayToken = optionalString(environment.JERICHO_VAULT_GATEWAY_TOKEN);
  if (Boolean(vaultGatewayUrl) !== Boolean(vaultGatewayToken)) {
    throw new Error('JERICHO_VAULT_GATEWAY_URL and JERICHO_VAULT_GATEWAY_TOKEN must be configured together');
  }
  const paperclipUrl = optionalString(environment.JERICHO_PAPERCLIP_URL);
  const paperclipApiKey = optionalString(environment.JERICHO_PAPERCLIP_API_KEY);
  const paperclipCompanyId = optionalString(environment.JERICHO_PAPERCLIP_COMPANY_ID);
  if ([paperclipUrl, paperclipApiKey, paperclipCompanyId].some(Boolean)
    && ![paperclipUrl, paperclipApiKey, paperclipCompanyId].every(Boolean)) {
    throw new Error('Paperclip URL, API key, and company ID must be configured together');
  }
  const notionToken = optionalString(environment.JERICHO_NOTION_TOKEN);
  const notionDatabaseId = optionalString(environment.JERICHO_NOTION_DATABASE_ID);
  if (Boolean(notionToken) !== Boolean(notionDatabaseId)) {
    throw new Error('Notion token and database ID must be configured together');
  }
  const vaultRebuildWindowStartUtc = parseUtcHour(
    environment.JERICHO_VAULT_REBUILD_WINDOW_START_UTC ?? '1',
    'JERICHO_VAULT_REBUILD_WINDOW_START_UTC',
  );
  const vaultRebuildWindowEndUtc = parseUtcHour(
    environment.JERICHO_VAULT_REBUILD_WINDOW_END_UTC ?? '5',
    'JERICHO_VAULT_REBUILD_WINDOW_END_UTC',
  );
  if (vaultRebuildWindowStartUtc === vaultRebuildWindowEndUtc) {
    throw new Error('Vault rebuild window cannot be empty');
  }
  return {
    host: environment.JERICHO_HOST ?? '127.0.0.1',
    port,
    apiToken,
    geminiApiKey: environment.GEMINI_API_KEY,
    model: environment.LIVE_MODEL ?? 'gemini-2.5-flash-native-audio-latest',
    voice: environment.LIVE_VOICE ?? 'Algieba',
    megatronVoice: environment.MEGATRON_VOICE ?? 'Fenrir',
    defaultPersonaMode,
    personaAutoRevertMs: parsePositiveInteger(
      environment.AUTO_REVERT_MS ?? '120000',
      'AUTO_REVERT_MS',
    ),
    systemInstruction: environment.SYSTEM_INSTRUCTION ?? DEFAULT_SYSTEM_INSTRUCTION,
    allowedOrigins: parseCsv(environment.JERICHO_ALLOWED_ORIGINS),
    telegramGatewayUrl: optionalString(environment.JERICHO_TELEGRAM_GATEWAY_URL),
    telegramGatewayToken: optionalString(environment.JERICHO_TELEGRAM_GATEWAY_TOKEN),
    whatsappGatewayUrl: optionalString(environment.JERICHO_WHATSAPP_GATEWAY_URL),
    whatsappGatewayToken: optionalString(environment.JERICHO_WHATSAPP_GATEWAY_TOKEN),
    linearApiKey: optionalString(environment.LINEAR_API_KEY),
    ...(paperclipUrl ? { paperclipUrl } : {}),
    ...(paperclipApiKey ? { paperclipApiKey } : {}),
    ...(paperclipCompanyId ? { paperclipCompanyId } : {}),
    ...(notionToken ? { notionToken } : {}),
    ...(notionDatabaseId ? { notionDatabaseId } : {}),
    notionProjectionFields: parseCsv(environment.JERICHO_NOTION_PROJECTION_FIELDS),
    gitRepositories: parseNamedPaths(
      environment.JERICHO_GIT_REPOSITORIES,
      'JERICHO_GIT_REPOSITORIES',
    ),
    githubRepositories: parseCsv(environment.JERICHO_GITHUB_REPOSITORIES),
    conductorRoots: parseNamedPaths(
      environment.JERICHO_CONDUCTOR_ROOTS,
      'JERICHO_CONDUCTOR_ROOTS',
    ),
    obsidianVaultPath: optionalString(environment.JERICHO_OBSIDIAN_VAULT),
    ...(vaultGatewayUrl ? { vaultGatewayUrl } : {}),
    ...(vaultGatewayToken ? { vaultGatewayToken } : {}),
    vaultGatewayTimeoutMs: parsePositiveInteger(
      environment.JERICHO_VAULT_GATEWAY_TIMEOUT_MS ?? '45000',
      'JERICHO_VAULT_GATEWAY_TIMEOUT_MS',
    ),
    vaultCacheTtlMs: parsePositiveInteger(
      environment.JERICHO_VAULT_CACHE_TTL_MS ?? '86400000',
      'JERICHO_VAULT_CACHE_TTL_MS',
    ),
    vaultMaintenanceIntervalMs: parsePositiveInteger(
      environment.JERICHO_VAULT_MAINTENANCE_INTERVAL_MS ?? '600000',
      'JERICHO_VAULT_MAINTENANCE_INTERVAL_MS',
    ),
    vaultSyncStaleMs: parsePositiveInteger(
      environment.JERICHO_VAULT_SYNC_STALE_MS ?? '3600000',
      'JERICHO_VAULT_SYNC_STALE_MS',
    ),
    vaultRebuildWindowStartUtc,
    vaultRebuildWindowEndUtc,
    connectorLeaseMs: parsePositiveInteger(
      environment.JERICHO_CONNECTOR_LEASE_MS ?? '30000',
      'JERICHO_CONNECTOR_LEASE_MS',
    ),
    connectorMaxPages: parsePositiveInteger(
      environment.JERICHO_CONNECTOR_MAX_PAGES ?? '100',
      'JERICHO_CONNECTOR_MAX_PAGES',
    ),
    connectorPollIntervalMs: parsePositiveInteger(
      environment.JERICHO_CONNECTOR_POLL_INTERVAL_MS ?? '30000',
      'JERICHO_CONNECTOR_POLL_INTERVAL_MS',
    ),
    ...(hermesBusRoot ? { hermesBusRoot } : {}),
    ...(hermesRepo ? { hermesRepo } : {}),
    ...(hermesBranch ? { hermesBranch } : {}),
    hermesPollIntervalMs,
    hermesMaxWaitMs,
    missionRepositoryGrants: parseRepositoryGrants(
      environment.JERICHO_MISSION_REPOSITORY_GRANTS,
    ),
    reflectionIntervalMs: parsePositiveInteger(
      environment.JERICHO_REFLECTION_INTERVAL_MS ?? '21600000',
      'JERICHO_REFLECTION_INTERVAL_MS',
    ),
    voiceActiveTurnMs: parsePositiveInteger(
      environment.JERICHO_VOICE_ACTIVE_TURN_MS ?? '30000',
      'JERICHO_VOICE_ACTIVE_TURN_MS',
    ),
  };
}

function parsePersonaMode(value: string | undefined): PersonaMode {
  const mode = optionalString(value) ?? 'jarvis';
  if (mode !== 'jarvis' && mode !== 'megatron') {
    throw new Error('DEFAULT_MODE must be jarvis or megatron');
  }
  return mode;
}

function assertCompleteHermesWorkspace(input: {
  hermesBusRoot?: string;
  hermesRepo?: string;
  hermesBranch?: string;
}): void {
  const configured = [input.hermesBusRoot, input.hermesRepo, input.hermesBranch]
    .filter((value) => value !== undefined).length;
  if (configured !== 0 && configured !== 3) {
    throw new Error(
      'JERICHO_HERMES_BUS_ROOT, JERICHO_HERMES_REPO, and JERICHO_HERMES_BRANCH must be configured together',
    );
  }
}

function validateApiToken(value: string, source: string): string {
  const token = value.trim();
  if (!token || /[\u0000-\u001f\u007f\s]/u.test(token)) {
    throw new Error(`${source} must be a non-empty token without whitespace or control characters`);
  }
  return token;
}

function isSecurityStatus(cause: unknown, status: number): boolean {
  return typeof cause === 'object' && cause !== null && 'status' in cause && cause.status === status;
}

function defaultSecurityCommand(args: readonly string[], input?: string): string {
  return execFileSync('security', [...args], {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

const DEFAULT_SYSTEM_INSTRUCTION = [
  'You are JARVIS, Carlos’s private chief of staff in the style of the Iron Man films.',
  'You are English, refined, unflappable, concise, and exceptionally competent.',
  'Always address Carlos as “sir” and speak with a measured British cadence.',
  'Never claim that proposed or unverified work is complete.',
  'Never execute external work without an approved bounded mission.',
  'PRIVACY GATE: the client and server voice gates deliver audio only during an explicitly active turn.',
  'Do not demand or listen for a spoken wake word; any audio you receive has already passed the local gate.',
  'Handle the active request directly and finish each response cleanly so the gate can return to standby.',
  'GUIDED TEST: when Carlos says “Test Isabella”, tell him: “Guided test ready, sir. Ask me: Who is Isabella?”',
  'When he asks who Isabella is, call search_vault with query “Isabella” and briefly explain only the returned evidence.',
  'Then tell him to pinch the visible Isabella card, open its Obsidian source, and drag it to Reorganize Notes; the deterministic UI owns pass/fail state and you must not claim a step passed.',
].join(' ');

function commandLinePort(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--port') return argv[index + 1];
    if (argv[index].startsWith('--port=')) return argv[index].slice('--port='.length);
  }
  return undefined;
}

function parsePort(value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value)) throw new Error('Server port is invalid');
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error('Server port is invalid');
  return port;
}

function optionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function parseCsv(value: string | undefined): string[] {
  return [...new Set((value ?? '').split(',').map((item) => item.trim()).filter(Boolean))];
}

function parseNamedPaths(value: string | undefined, variable: string): NamedPath[] {
  if (!value?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${variable} must be a JSON array of {id,path} objects`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${variable} must be a JSON array of {id,path} objects`);
  }
  const paths = parsed.map((item) => {
    if (
      !item || typeof item !== 'object' || Array.isArray(item) ||
      typeof (item as Record<string, unknown>).id !== 'string' ||
      typeof (item as Record<string, unknown>).path !== 'string'
    ) {
      throw new Error(`${variable} must be a JSON array of {id,path} objects`);
    }
    const id = (item as Record<string, string>).id.trim();
    const configuredPath = (item as Record<string, string>).path.trim();
    if (!id || !configuredPath) {
      throw new Error(`${variable} entries require non-empty id and path`);
    }
    return { id, path: configuredPath };
  });
  if (new Set(paths.map((item) => item.id)).size !== paths.length) {
    throw new Error(`${variable} contains duplicate ids`);
  }
  return paths;
}

function parseRepositoryGrants(value: string | undefined): RepositoryGrant[] {
  const variable = 'JERICHO_MISSION_REPOSITORY_GRANTS';
  if (!value?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${variable} must be a JSON array of repository grants`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${variable} must be a JSON array of repository grants`);
  }
  const validMutations = new Set(Object.values(MutationClass));
  const grants = parsed.map((item): RepositoryGrant => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${variable} entries must be repository grant objects`);
    }
    const record = item as Record<string, unknown>;
    const repository = typeof record.repository === 'string' ? record.repository.trim() : '';
    const writablePaths = record.writablePaths;
    const mutationClasses = record.mutationClasses;
    if (
      !repository ||
      !Array.isArray(writablePaths) ||
      !writablePaths.every((entry) => typeof entry === 'string' && safeRepositoryPath(entry)) ||
      !Array.isArray(mutationClasses) ||
      !mutationClasses.every((entry) => typeof entry === 'string' && validMutations.has(entry as MutationClass))
    ) {
      throw new Error(
        `${variable} entries require repository, safe writablePaths, and valid mutationClasses`,
      );
    }
    return {
      repository,
      writablePaths: [...new Set(writablePaths as string[])],
      mutationClasses: [...new Set(mutationClasses as MutationClass[])],
    };
  });
  if (new Set(grants.map((grant) => grant.repository)).size !== grants.length) {
    throw new Error(`${variable} contains duplicate repositories`);
  }
  return grants;
}

function safeRepositoryPath(value: string): boolean {
  const normalized = value.trim();
  if (!normalized || normalized.startsWith('/') || normalized.includes('\\')) return false;
  if (normalized === '.') return true;
  return normalized.split('/').every((segment) => Boolean(segment) && segment !== '.' && segment !== '..');
}

function parsePositiveInteger(value: string, variable: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${variable} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${variable} must be a positive integer`);
  }
  return parsed;
}

function parseUtcHour(value: string, variable: string): number {
  if (!/^\d{1,2}$/u.test(value)) throw new Error(`${variable} must be a UTC hour from 0 to 23`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) {
    throw new Error(`${variable} must be a UTC hour from 0 to 23`);
  }
  return parsed;
}
