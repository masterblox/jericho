import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const EXPERIENCE_VERSION = '2026.08.04';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 39004;
const READY_PATH = '/observatory.html';
const READY_MARKER = 'data-experience-id="wifi-mapping"';
const ASSETS_ROOT = fileURLToPath(new URL('./assets', import.meta.url));
const CONTROL_SCRIPT = fileURLToPath(new URL('./macos-window-control.jxa', import.meta.url));
const COMMAND_TIMEOUT_MS = 10_000;
const MAX_COMMAND_OUTPUT = 128 * 1024;

export interface RuViewProvenance {
  image: string;
  imageDigest: string;
  manifestDigest: string;
  source: string;
  revision: string;
  license: string;
  pinnedUiSource?: string;
}

export interface JerichoExperienceDescriptor {
  id: 'wifi-mapping';
  version: string;
  title: string;
  route: string;
  stableUrl: string;
  simulation: {
    demoLabelRequired: true;
    scenario: 'gesture_control';
    people: 1;
    peopleAreSynthetic: true;
    props: readonly ['TV'];
    autoCycle: false;
    truthBoundary: string;
  };
  provenance: RuViewProvenance;
}

export interface StaticSiteServer {
  baseUrl: string;
  readyUrl: string;
  close?: () => Promise<void>;
}

export interface ExperienceProcessPort {
  ensureStaticSite(input: {
    host: string;
    preferredPort: number;
    rootDirectory: string;
    readinessPath: string;
    readinessMarker: string;
  }): Promise<StaticSiteServer>;
}

export interface DisplayInventory {
  id: string;
  index?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  primary?: boolean;
}

export interface BrowserPort {
  openFreshChromeWindow(url: string): Promise<{ application: 'Google Chrome'; windowCountAfter?: number }>;
}

export interface WindowPort {
  listDisplays(): Promise<DisplayInventory[]>;
  moveChromeWindowToDisplay(input: { displayId: string }): Promise<{
    application: 'Google Chrome';
    displayId: string;
    bounds: { x: number; y: number; width: number; height: number };
  }>;
}

export interface WifiMappingLauncherOptions {
  processPort?: ExperienceProcessPort;
  browserPort?: BrowserPort;
  windowPort?: WindowPort;
}

export interface ExperienceStartReceipt {
  descriptor: JerichoExperienceDescriptor;
  url: string;
  ready: true;
  server: StaticSiteServer;
}

export interface WifiMappingActionPlan {
  experienceId: 'wifi-mapping';
  url: string;
  targetDisplay: DisplayInventory;
  actions: readonly [
    { type: 'open_chrome_window'; browser: 'Google Chrome'; url: string; freshWindow: true },
    { type: 'move_chrome_window'; displayId: string; position: 'full'; reason: 'secondary_display' },
  ];
}

export interface WifiMappingLaunchReceipt {
  start: ExperienceStartReceipt;
  plan: WifiMappingActionPlan;
  browser: { application: 'Google Chrome'; windowCountAfter?: number };
  placement: {
    application: 'Google Chrome';
    displayId: string;
    bounds: { x: number; y: number; width: number; height: number };
  };
}

export const wifiMappingExperienceDescriptor = {
  id: 'wifi-mapping',
  version: EXPERIENCE_VERSION,
  title: 'Jericho WiFi Mapping Observatory',
  route: READY_PATH,
  stableUrl: `http://${DEFAULT_HOST}:${DEFAULT_PORT}${READY_PATH}`,
  simulation: {
    demoLabelRequired: true,
    scenario: 'gesture_control',
    people: 1,
    peopleAreSynthetic: true,
    props: ['TV'],
    autoCycle: false,
    truthBoundary: [
      'DEMO/SIMULATED only. Does not see Carlos, Carlos\'s wife, TV, posture, heartbeat, walls,',
      'or home without explicit CSI hardware integration.',
    ].join(' '),
  },
  provenance: {
    image: 'ghcr.io/ruvnet/wifi-densepose@sha256:c94b541fe6269e5ce28ebfc297e34cf240997427c8f9bfb97f6775b32d50ceab',
    imageDigest: 'sha256:c94b541fe6269e5ce28ebfc297e34cf240997427c8f9bfb97f6775b32d50ceab',
    manifestDigest: 'sha256:dfa81709ff7889dd394eb5f1f069618d4bff90e306789a9f4ca94821e450720c',
    source: 'https://github.com/ruvnet/RuView',
    revision: '5780c239e4cdcd4389eed37a96d19a98154ebe03',
    license: 'MIT',
    pinnedUiSource: '/tmp/ruview-security-audit.rzQ8MR/repo/ui bind-mounted into ruview-party-demo:/app/ui',
  },
} as const satisfies JerichoExperienceDescriptor;

export class WifiMappingExperienceLauncher {
  readonly #processPort: ExperienceProcessPort;
  readonly #browserPort: BrowserPort;
  readonly #windowPort: WindowPort;
  #started?: Promise<ExperienceStartReceipt>;

  constructor(options: WifiMappingLauncherOptions = {}) {
    this.#processPort = options.processPort ?? new NodeStaticSiteProcessPort();
    this.#browserPort = options.browserPort ?? new MacChromeBrowserPort();
    this.#windowPort = options.windowPort ?? new MacWindowPort();
  }

  start(): Promise<ExperienceStartReceipt> {
    this.#started ??= this.#start();
    return this.#started;
  }

  async buildActionPlan(): Promise<WifiMappingActionPlan> {
    const start = await this.start();
    const displays = await this.#windowPort.listDisplays();
    return buildWifiMappingActionPlan(start.url, displays);
  }

  async openOnSecondaryDisplay(): Promise<WifiMappingLaunchReceipt> {
    const start = await this.start();
    const plan = await this.buildActionPlan();
    const browser = await this.#browserPort.openFreshChromeWindow(start.url);
    const placement = await this.#windowPort.moveChromeWindowToDisplay({
      displayId: plan.targetDisplay.id,
    });
    return { start, plan, browser, placement };
  }

  async #start(): Promise<ExperienceStartReceipt> {
    const server = await this.#processPort.ensureStaticSite({
      host: DEFAULT_HOST,
      preferredPort: DEFAULT_PORT,
      rootDirectory: ASSETS_ROOT,
      readinessPath: READY_PATH,
      readinessMarker: READY_MARKER,
    });
    const descriptor = {
      ...wifiMappingExperienceDescriptor,
      stableUrl: server.readyUrl,
    };
    return { descriptor, url: server.readyUrl, ready: true, server };
  }
}

export function buildWifiMappingActionPlan(
  url: string,
  displays: readonly DisplayInventory[],
): WifiMappingActionPlan {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/observatory\.html$/u.test(url)) {
    throw new Error('experience_url_must_be_stable_local_observatory');
  }
  const targetDisplay = selectSecondaryDisplay(displays);
  return {
    experienceId: 'wifi-mapping',
    url,
    targetDisplay,
    actions: [
      { type: 'open_chrome_window', browser: 'Google Chrome', url, freshWindow: true },
      {
        type: 'move_chrome_window',
        displayId: targetDisplay.id,
        position: 'full',
        reason: 'secondary_display',
      },
    ],
  };
}

export function selectSecondaryDisplay(displays: readonly DisplayInventory[]): DisplayInventory {
  const valid = displays.map(sanitizeDisplay);
  if (valid.length < 2) throw new Error('secondary_display_required');
  return valid.find(display => display.primary === false)
    ?? valid.find(display => display.index !== undefined && display.index !== 0)
    ?? valid.find(display => display.x !== 0 || display.y !== 0)
    ?? valid[1];
}

export class NodeStaticSiteProcessPort implements ExperienceProcessPort {
  readonly #servers = new Map<string, StaticSiteServer>();

  async ensureStaticSite(input: {
    host: string;
    preferredPort: number;
    rootDirectory: string;
    readinessPath: string;
    readinessMarker: string;
  }): Promise<StaticSiteServer> {
    const rootDirectory = resolve(input.rootDirectory);
    const key = `${input.host}:${input.preferredPort}:${rootDirectory}:${input.readinessPath}`;
    const existing = this.#servers.get(key);
    if (existing && await hasReadinessMarker(existing.readyUrl, input.readinessMarker)) return existing;

    const preferredReadyUrl = `http://${input.host}:${input.preferredPort}${input.readinessPath}`;
    if (await hasReadinessMarker(preferredReadyUrl, input.readinessMarker)) {
      const server = { baseUrl: `http://${input.host}:${input.preferredPort}`, readyUrl: preferredReadyUrl };
      this.#servers.set(key, server);
      return server;
    }

    const server = createServer(async (request, response) => {
      try {
        const pathname = new URL(request.url ?? '/', `http://${input.host}`).pathname;
        const filePath = safeAssetPath(rootDirectory, pathname === '/' ? input.readinessPath : pathname);
        const file = await readFile(filePath);
        response.writeHead(200, {
          'content-type': contentType(filePath),
          'cache-control': 'no-store',
        });
        response.end(file);
      } catch (error) {
        const code = error instanceof Error && error.message === 'asset_not_found' ? 404 : 500;
        response.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(code === 404 ? 'not found' : 'server error');
      }
    });

    const bound = await listen(server, input.host, input.preferredPort);
    const result = {
      baseUrl: `http://${input.host}:${bound.port}`,
      readyUrl: `http://${input.host}:${bound.port}${input.readinessPath}`,
      close: () => closeServer(server),
    };
    if (!await hasReadinessMarker(result.readyUrl, input.readinessMarker)) {
      await result.close();
      throw new Error('experience_readiness_failed');
    }
    this.#servers.set(key, result);
    return result;
  }
}

export class MacChromeBrowserPort implements BrowserPort {
  async openFreshChromeWindow(url: string): Promise<{ application: 'Google Chrome'; windowCountAfter?: number }> {
    const result = await runMacControl({ action: 'open_chrome_window', url });
    return {
      application: 'Google Chrome',
      windowCountAfter: optionalInteger(result.windowCountAfter),
    };
  }
}

export class MacWindowPort implements WindowPort {
  async listDisplays(): Promise<DisplayInventory[]> {
    const result = await runMacControl({ action: 'list_displays' });
    if (!Array.isArray(result.displays)) throw new Error('invalid_display_inventory');
    return result.displays.map(sanitizeDisplay);
  }

  async moveChromeWindowToDisplay(input: { displayId: string }): Promise<{
    application: 'Google Chrome';
    displayId: string;
    bounds: { x: number; y: number; width: number; height: number };
  }> {
    const result = await runMacControl({ action: 'move_chrome_window', displayId: input.displayId });
    if (result.application !== 'Google Chrome') throw new Error('invalid_window_placement');
    return {
      application: 'Google Chrome',
      displayId: boundedText(result.displayId, 'display_id', 40),
      bounds: sanitizeBounds(result.bounds),
    };
  }
}

async function runMacControl(request: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    const result = await execFileAsync('/usr/bin/osascript', [
      '-l', 'JavaScript',
      CONTROL_SCRIPT,
      JSON.stringify(request),
    ], {
      encoding: 'utf8',
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_COMMAND_OUTPUT,
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
    });
    const parsed = JSON.parse(String(result.stdout)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_control_response');
    return parsed as Record<string, unknown>;
  } catch (error) {
    const message = String(error);
    if (/not authorized to send apple events|1743/iu.test(message)) throw new Error('automation_permission_required');
    if (/assistive access|accessibility|1002/iu.test(message)) throw new Error('accessibility_permission_required');
    if (/secondary_display_required|display_not_found|chrome_window_not_created|window_move_failed/iu.test(message)) {
      throw error;
    }
    throw new Error('wifi_mapping_window_control_failed');
  }
}

async function listen(server: Server, host: string, preferredPort: number): Promise<{ port: number }> {
  try {
    return await listenOn(server, host, preferredPort);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EADDRINUSE') throw error;
    return listenOn(server, host, 0);
  }
}

function listenOn(server: Server, host: string, port: number): Promise<{ port: number }> {
  return new Promise((resolvePromise, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('experience_server_address_invalid'));
        return;
      }
      resolvePromise({ port: address.port });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close(error => error ? reject(error) : resolvePromise());
    server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections(), 50).unref();
  });
}

async function hasReadinessMarker(url: string, marker: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    if (!response.ok) return false;
    const text = await response.text();
    return text.includes(marker);
  } catch {
    return false;
  }
}

function safeAssetPath(rootDirectory: string, pathname: string): string {
  const normalizedPathname = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const relativePath = normalizedPathname.split(/[\\/]/u).filter(Boolean).join(sep);
  const filePath = resolve(rootDirectory, relativePath);
  const relativeToRoot = relative(rootDirectory, filePath);
  if (relativeToRoot.startsWith('..') || relativeToRoot === '' || relativeToRoot.includes(`..${sep}`)) {
    throw new Error('asset_not_found');
  }
  return filePath;
}

function contentType(filePath: string): string {
  if (extname(filePath) === '.html') return 'text/html; charset=utf-8';
  if (extname(filePath) === '.css') return 'text/css; charset=utf-8';
  if (extname(filePath) === '.js') return 'text/javascript; charset=utf-8';
  return 'application/octet-stream';
}

function sanitizeDisplay(value: unknown): DisplayInventory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_display_inventory');
  const row = value as Record<string, unknown>;
  return {
    id: boundedText(row.id ?? row.index, 'display_id', 40),
    ...(row.index === undefined ? {} : { index: boundedInteger(row.index, 'display_index', 0, 15) }),
    x: finiteNumber(row.x, 'display_x'),
    y: finiteNumber(row.y, 'display_y'),
    width: positiveNumber(row.width, 'display_width'),
    height: positiveNumber(row.height, 'display_height'),
    ...(row.primary === undefined ? {} : { primary: booleanValue(row.primary, 'display_primary') }),
  };
}

function sanitizeBounds(value: unknown): { x: number; y: number; width: number; height: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_window_bounds');
  const row = value as Record<string, unknown>;
  return {
    x: finiteNumber(row.x, 'bounds_x'),
    y: finiteNumber(row.y, 'bounds_y'),
    width: positiveNumber(row.width, 'bounds_width'),
    height: positiveNumber(row.height, 'bounds_height'),
  };
}

function optionalInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  return boundedInteger(value, 'window_count_after', 1, 1_000);
}

function boundedText(value: unknown, field: string, maximum: number): string {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string') throw new Error(`${field}_required`);
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > maximum || /[\u0000-\u001f\u007f]/u.test(trimmed)) {
    throw new Error(`${field}_invalid`);
  }
  return trimmed;
}

function boundedInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${field}_invalid`);
  }
  return value as number;
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field}_invalid`);
  return value;
}

function positiveNumber(value: unknown, field: string): number {
  const number = finiteNumber(value, field);
  if (number <= 0) throw new Error(`${field}_invalid`);
  return number;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${field}_invalid`);
  return value;
}
