import { randomUUID } from 'node:crypto';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { defaultOutputCapBytes, defaultRisk, defaultTimeoutMs } from './allowlist.js';
import { modelToolName } from './discovery.js';
import type {
  MCPJsonSchema,
  MCPServerConfig,
  MCPServerHandle,
  MCPServerStatus,
  MCPToolCall,
  MCPToolDescriptor,
  MCPToolReceipt,
  MCPToolResult,
} from './types.js';
import { sanitizeResult } from './types.js';

const CONNECT_TIMEOUT_MS = 10_000;
const DISCOVERY_TIMEOUT_MS = 15_000;

export function createMCPClient(config: MCPServerConfig): MCPServerHandle {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(config.name)) {
    throw new Error('MCP server name is invalid');
  }
  let client: Client | null = null;
  let transport: StdioClientTransport | StreamableHTTPClientTransport | null = null;
  let status: MCPServerStatus = 'disconnected';
  let cachedTools: MCPToolDescriptor[] = [];

  const handle: MCPServerHandle = {
    config,
    get status() { return status; },
    get tools() { return cachedTools; },

    async connect() {
      if (status === 'connected') return;
      status = 'connecting';
      try {
        client = new Client(
          { name: 'jericho-bridge', version: '1.0.4' },
          { capabilities: {} },
        );

        if (config.transport === 'stdio') {
          if (!config.command) throw new Error('stdio transport requires a command');
          transport = new StdioClientTransport({
            command: config.command,
            args: config.args,
            env: config.env,
            stderr: 'pipe',
          });
        } else {
          if (!config.url) throw new Error('streamable-http transport requires a URL');
          transport = new StreamableHTTPClientTransport(new URL(config.url));
        }

        await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, 'MCP connect timeout');
        status = 'connected';
      } catch (error) {
        status = 'failed';
        await handle.disconnect();
        throw error;
      }
    },

    async disconnect() {
      status = 'disconnected';
      try {
        if (client) {
          await client.close();
        }
      } catch {
        // best-effort close
      }
      client = null;
      transport = null;
      cachedTools = [];
    },

    async callTool(call: MCPToolCall, signal: AbortSignal): Promise<MCPToolResult> {
      if (status !== 'connected' || !client) {
        throw new Error(`MCP server ${config.name} is not connected`);
      }

      const descriptor = cachedTools.find((tool) => tool.namespacedName === call.namespacedName);
      if (!descriptor) {
        throw new Error(`Tool not found: ${call.namespacedName} on server ${config.name}`);
      }
      const toolName = descriptor.toolName;

      const startTime = performance.now();
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), descriptor.timeoutMs);
      const onAbort = () => abortController.abort();
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        const result = (await client.callTool(
          { name: toolName, arguments: call.args },
          undefined,
          { signal: abortController.signal },
        )) as CallToolResult;

        const latencyMs = Math.round(performance.now() - startTime);
        const rawContent = sanitizeResult(result as unknown as Parameters<typeof sanitizeResult>[0]);
        const serialized = JSON.stringify(rawContent ?? result);
        const outputBytes = Buffer.byteLength(serialized, 'utf-8');
        const truncated = outputBytes > descriptor.outputCapBytes;

        return {
          callId: call.id,
          namespacedName: call.namespacedName,
          receipt: {
            ok: !result.isError,
            content: truncated
              ? { truncated: true, preview: truncateUtf8(serialized, descriptor.outputCapBytes) }
              : (rawContent ?? result),
            error: result.isError ? extractErrorText(result) : undefined,
            serverName: config.name,
            toolName,
            latencyMs,
            outputBytes,
            truncated,
          },
        };
      } catch (error) {
        const latencyMs = Math.round(performance.now() - startTime);
        const message = error instanceof Error ? error.message : 'unknown error';
        if (abortController.signal.aborted || message.includes('aborted') || message.includes('AbortError')) {
          return {
            callId: call.id,
            namespacedName: call.namespacedName,
            receipt: {
              ok: false,
              error: signal.aborted ? 'cancelled' : `timeout after ${descriptor.timeoutMs}ms`,
              serverName: config.name,
              toolName,
              latencyMs,
              outputBytes: 0,
              truncated: false,
            },
          };
        }
        return {
          callId: call.id,
          namespacedName: call.namespacedName,
          receipt: {
            ok: false,
            error: message,
            serverName: config.name,
            toolName,
            latencyMs,
            outputBytes: 0,
            truncated: false,
          },
        };
      } finally {
        clearTimeout(timeoutId);
        signal.removeEventListener('abort', onAbort);
      }
    },

    async discover() {
      if (status !== 'connected' || !client) {
        throw new Error(`MCP server ${config.name} is not connected`);
      }
      const result = await withTimeout(client.listTools(), DISCOVERY_TIMEOUT_MS, 'MCP discovery timeout');
      cachedTools = (result.tools ?? []).map((tool) => {
        const risk = defaultRisk({
          description: `${tool.name} ${tool.description ?? ''}`,
          inputSchema: tool.inputSchema,
        });
        return {
          serverName: config.name,
          namespacedName: `mcp/${config.name}/${tool.name}`,
          modelName: modelToolName(config.name, tool.name),
          toolName: tool.name,
          description: tool.description ?? `${tool.name} tool on ${config.name}`,
          inputSchema: (tool.inputSchema ?? { type: 'object', properties: {} }) as MCPJsonSchema,
          risk,
          timeoutMs: defaultTimeoutMs(risk),
          outputCapBytes: defaultOutputCapBytes(risk),
          allowlistKey: `${config.name}/${tool.name}`,
        };
      });
      return cachedTools;
    },
  };

  return handle;
}

function extractErrorText(result: CallToolResult): string {
  if (result.content && Array.isArray(result.content)) {
    for (const item of result.content) {
      if (item.type === 'text' && typeof item.text === 'string') return item.text.slice(0, 2_000);
    }
  }
  return 'tool execution failed';
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function truncateUtf8(value: string, maximumBytes: number): string {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.length <= maximumBytes) return value;
  return buffer.subarray(0, maximumBytes).toString('utf8');
}
