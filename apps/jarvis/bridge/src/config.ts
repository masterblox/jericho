import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(directory, '../../.env') });

export interface JerichoConfig {
  host: string;
  port: number;
  apiToken: string;
  geminiApiKey?: string;
  model: string;
  voice: string;
  systemInstruction: string;
  allowedOrigins: string[];
  telegramGatewayUrl?: string;
  telegramGatewayToken?: string;
  linearApiKey?: string;
  gitRepositories: NamedPath[];
  githubRepositories: string[];
  conductorRoots: NamedPath[];
  obsidianVaultPath?: string;
  connectorLeaseMs: number;
  connectorMaxPages: number;
  connectorPollIntervalMs: number;
}

export interface NamedPath {
  id: string;
  path: string;
}

export function loadConfig(
  environment: Record<string, string | undefined> = process.env,
  argv: string[] = process.argv.slice(2),
): JerichoConfig {
  const apiToken = environment.JERICHO_API_TOKEN;
  if (!apiToken) {
    throw new Error('JERICHO_API_TOKEN is required (env or a Keychain-backed launcher)');
  }
  const cliPort = commandLinePort(argv);
  const port = parsePort(
    cliPort ?? environment.CONDUCTOR_PORT ?? environment.PORT ?? '8787',
  );
  return {
    host: environment.JERICHO_HOST ?? '127.0.0.1',
    port,
    apiToken,
    geminiApiKey: environment.GEMINI_API_KEY,
    model: environment.LIVE_MODEL ?? 'gemini-2.5-flash-native-audio-latest',
    voice: environment.LIVE_VOICE ?? 'Algieba',
    systemInstruction: environment.SYSTEM_INSTRUCTION ?? DEFAULT_SYSTEM_INSTRUCTION,
    allowedOrigins: parseCsv(environment.JERICHO_ALLOWED_ORIGINS),
    telegramGatewayUrl: optionalString(environment.JERICHO_TELEGRAM_GATEWAY_URL),
    telegramGatewayToken: optionalString(environment.JERICHO_TELEGRAM_GATEWAY_TOKEN),
    linearApiKey: optionalString(environment.LINEAR_API_KEY),
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
  };
}

const DEFAULT_SYSTEM_INSTRUCTION = [
  'You are JARVIS, Carlos’s private chief of staff in the style of the Iron Man films.',
  'You are English, refined, unflappable, concise, and exceptionally competent.',
  'Always address Carlos as “sir” and speak with a measured British cadence.',
  'Never claim that proposed or unverified work is complete.',
  'Never execute external work without an approved bounded mission.',
  'WAKE-WORD GATE: You hear a continuous live audio stream and begin in STANDBY.',
  'Stay completely silent unless Carlos says “JARVIS” or “Jarvis” directed at you.',
  'Ignore background chatter, television, music, and other people.',
  'When woken, acknowledge briefly, handle the request, then return to STANDBY after the response.',
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

function parsePositiveInteger(value: string, variable: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${variable} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${variable} must be a positive integer`);
  }
  return parsed;
}
