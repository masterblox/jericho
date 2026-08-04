import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type MCPTransport = 'stdio' | 'streamable-http';

export interface MCPServerConfig {
  name: string;
  transport: MCPTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface MCPToolDescriptor {
  serverName: string;
  namespacedName: string;
  toolName: string;
  description: string;
  inputSchema: MCPJsonSchema;
  risk: MCPToolRisk;
  timeoutMs: number;
  outputCapBytes: number;
  allowlistKey: string;
}

export interface MCPJsonSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

export type MCPToolRisk = 'low' | 'medium' | 'high' | 'critical';

export interface MCPToolCall {
  id: string;
  namespacedName: string;
  args: Record<string, unknown>;
}

export interface MCPToolResult {
  callId: string;
  namespacedName: string;
  receipt: MCPToolReceipt;
}

export interface MCPToolReceipt {
  ok: boolean;
  content?: unknown;
  error?: string;
  serverName: string;
  toolName: string;
  latencyMs: number;
  outputBytes: number;
  truncated: boolean;
}

export interface MCPServerHandle {
  config: MCPServerConfig;
  status: MCPServerStatus;
  tools: MCPToolDescriptor[];
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  callTool(call: MCPToolCall, signal: AbortSignal): Promise<MCPToolResult>;
  discover(): Promise<MCPToolDescriptor[]>;
}

export type MCPServerStatus = 'disconnected' | 'connecting' | 'connected' | 'failed';

export interface MCPRegistryState {
  servers: Array<{ name: string; status: MCPServerStatus; toolCount: number }>;
}

export function sanitizeResult(value: CallToolResult): MCPToolReceipt['content'] {
  if (value.content && Array.isArray(value.content)) {
    return value.content.map((item) => {
      if (item.type === 'text') return item;
      if (item.type === 'image') {
        return { type: 'image', mimeType: item.mimeType, dataLength: typeof item.data === 'string' ? item.data.length : 0 };
      }
      if (item.type === 'resource') {
        return { type: 'resource', uri: (item as { resource?: { uri?: string } }).resource?.uri ?? 'unknown' };
      }
      return { type: (item as Record<string, unknown>).type as string ?? 'unknown' };
    });
  }
  return undefined;
}
