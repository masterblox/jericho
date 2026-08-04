import type { MCPToolDescriptor, MCPToolRisk } from './types.js';

export interface ToolAllowlistEntry {
  serverName: string;
  toolName: string;
  risk: MCPToolRisk;
  timeoutMs: number;
  outputCapBytes: number;
}

export interface ToolAllowlist {
  get(serverName: string, toolName: string): ToolAllowlistEntry | undefined;
  entries(): Iterable<ToolAllowlistEntry>;
  match(namespacedName: string): ToolAllowlistEntry | undefined;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_OUTPUT_CAP_BYTES = 64_000;

const RISK_TIMEOUT_MAP: Record<MCPToolRisk, number> = {
  low: 60_000,
  medium: 30_000,
  high: 15_000,
  critical: 10_000,
};

const RISK_OUTPUT_CAP_MAP: Record<MCPToolRisk, number> = {
  low: 128_000,
  medium: 64_000,
  high: 32_000,
  critical: 16_000,
};

export function allowlistKey(serverName: string, toolName: string): string {
  return `${serverName}/${toolName}`;
}

export function entryFromDescriptor(descriptor: MCPToolDescriptor): ToolAllowlistEntry {
  return {
    serverName: descriptor.serverName,
    toolName: descriptor.toolName,
    risk: descriptor.risk,
    timeoutMs: descriptor.timeoutMs,
    outputCapBytes: descriptor.outputCapBytes,
  };
}

export function defaultRisk(descriptor: { description?: string; inputSchema?: { type?: string } }): MCPToolRisk {
  const text = (descriptor.description ?? '').toLowerCase();
  if (/\b(?:delete|drop|destroy|wipe|purge|truncate|rm|unlink|format)\b/iu.test(text)) return 'critical';
  if (/\b(?:write|create|insert|update|patch|put|post|upload|send|execute|run|eval|exec|open|close|navigate|click|type|fill|press|select|submit)\b/iu.test(text)) return 'high';
  if (/\b(?:read|get|fetch|list|query|search|find|describe|status|check|ping|health)\b/iu.test(text)) return 'low';
  return 'medium';
}

export function defaultTimeoutMs(risk: MCPToolRisk): number {
  return RISK_TIMEOUT_MAP[risk] ?? DEFAULT_TIMEOUT_MS;
}

export function defaultOutputCapBytes(risk: MCPToolRisk): number {
  return RISK_OUTPUT_CAP_MAP[risk] ?? DEFAULT_OUTPUT_CAP_BYTES;
}

export class MapToolAllowlist implements ToolAllowlist {
  private readonly entries_ = new Map<string, ToolAllowlistEntry>();

  constructor(entries?: Iterable<ToolAllowlistEntry>) {
    if (entries) {
      for (const entry of entries) {
        this.entries_.set(allowlistKey(entry.serverName, entry.toolName), entry);
      }
    }
  }

  get(serverName: string, toolName: string): ToolAllowlistEntry | undefined {
    return this.entries_.get(allowlistKey(serverName, toolName));
  }

  entries(): Iterable<ToolAllowlistEntry> {
    return this.entries_.values();
  }

  match(namespacedName: string): ToolAllowlistEntry | undefined {
    return [...this.entries_.values()].find(
      (entry) => `mcp/${entry.serverName}/${entry.toolName}` === namespacedName,
    );
  }

  add(entry: ToolAllowlistEntry): void {
    this.entries_.set(allowlistKey(entry.serverName, entry.toolName), entry);
  }

  remove(serverName: string, toolName: string): boolean {
    return this.entries_.delete(allowlistKey(serverName, toolName));
  }

  get size(): number {
    return this.entries_.size;
  }
}

export function buildAllowlistFromDescriptors(descriptors: Iterable<MCPToolDescriptor>): MapToolAllowlist {
  return new MapToolAllowlist([...descriptors].map(entryFromDescriptor));
}
