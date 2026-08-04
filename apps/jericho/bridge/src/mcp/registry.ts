import { buildAllowlistFromDescriptors, type MapToolAllowlist, type ToolAllowlist } from './allowlist.js';
import { createMCPClient } from './client.js';
import type {
  MCPServerConfig,
  MCPServerHandle,
  MCPRegistryState,
  MCPToolCall,
  MCPToolDescriptor,
  MCPToolResult,
} from './types.js';

export interface MCPRegistryOptions {
  clock?: () => number;
}

export class MCPRegistry {
  private readonly handles = new Map<string, MCPServerHandle>();
  private readonly clock: () => number;
  private allowlist_: MapToolAllowlist | null = null;

  constructor(options: MCPRegistryOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
  }

  get allowlist(): ToolAllowlist | null {
    return this.allowlist_;
  }

  async registerServer(config: MCPServerConfig): Promise<MCPToolDescriptor[]> {
    if (this.handles.has(config.name)) {
      throw new Error(`MCP server already registered: ${config.name}`);
    }
    const handle = createMCPClient(config);
    await handle.connect();
    const tools = await handle.discover();
    this.handles.set(config.name, handle);
    this.rebuildAllowlist();
    return tools;
  }

  async unregisterServer(name: string): Promise<void> {
    const handle = this.handles.get(name);
    if (!handle) throw new Error(`MCP server not found: ${name}`);
    await handle.disconnect();
    this.handles.delete(name);
    this.rebuildAllowlist();
  }

  async executeCall(call: MCPToolCall, signal: AbortSignal): Promise<MCPToolResult> {
    const serverName = this.resolveServerForCall(call);
    if (!serverName) {
      throw new Error(`No registered server for tool: ${call.namespacedName}`);
    }
    const handle = this.handles.get(serverName);
    if (!handle) {
      throw new Error(`MCP server not connected: ${serverName}`);
    }

    if (this.allowlist_) {
      const entry = this.allowlist_.match(call.namespacedName);
      if (!entry) {
        throw new Error(`Tool not allowlisted: ${call.namespacedName}`);
      }
    }

    return handle.callTool(call, signal);
  }

  async discoverAll(): Promise<Map<string, MCPToolDescriptor[]>> {
    const result = new Map<string, MCPToolDescriptor[]>();
    for (const [name, handle] of this.handles) {
      if (handle.status === 'connected') {
        result.set(name, await handle.discover());
      }
    }
    return result;
  }

  state(): MCPRegistryState {
    return {
      servers: [...this.handles.entries()].map(([name, handle]) => ({
        name,
        status: handle.status,
        toolCount: handle.tools.length,
      })),
    };
  }

  getServer(name: string): MCPServerHandle | undefined {
    return this.handles.get(name);
  }

  async disconnectAll(): Promise<void> {
    const pending = [...this.handles.values()].map((h) => h.disconnect());
    await Promise.allSettled(pending);
    this.handles.clear();
    this.allowlist_ = null;
  }

  private resolveServerForCall(call: MCPToolCall): string | undefined {
    for (const handle of this.handles.values()) {
      if (handle.status === 'connected' && handle.tools.some((t) => t.namespacedName === call.namespacedName)) {
        return handle.config.name;
      }
    }
    if (this.allowlist_) {
      const entry = this.allowlist_.match(call.namespacedName);
      return entry?.serverName;
    }
    return undefined;
  }

  private rebuildAllowlist(): void {
    const descriptors: MCPToolDescriptor[] = [];
    for (const handle of this.handles.values()) {
      if (handle.status === 'connected') {
        descriptors.push(...handle.tools);
      }
    }
    this.allowlist_ = buildAllowlistFromDescriptors(descriptors);
  }
}

export function createMCPRegistry(options?: MCPRegistryOptions): MCPRegistry {
  return new MCPRegistry(options);
}
