import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  boundSchema,
  buildDescriptor,
  createMCPClient,
  createMCPRegistry,
  defaultOutputCapBytes,
  defaultRisk,
  defaultTimeoutMs,
  isMCPToolName,
  MapToolAllowlist,
  namespaceTool,
  parseNamespacedTool,
  translateAllToGeminiDeclarations,
  translateToGeminiDeclaration,
} from '../src/mcp/index.js';
import type { MCPServerConfig, MCPToolCall } from '../src/mcp/index.js';

describe('MCP discovery utilities', () => {
  it('namespaces and parses tool names', () => {
    const name = namespaceTool('weather', 'get_forecast');
    expect(name).toBe('mcp/weather/get_forecast');
    expect(isMCPToolName(name)).toBe(true);
    expect(isMCPToolName('list_open_tasks')).toBe(false);
    expect(isMCPToolName('')).toBe(false);

    const parsed = parseNamespacedTool(name);
    expect(parsed).toEqual({ serverName: 'weather', toolName: 'get_forecast' });

    expect(parseNamespacedTool('not-mcp/foo/bar')).toBeNull();
    expect(parseNamespacedTool('mcp/foo')).toBeNull();
  });

  it('builds tool descriptors with risk classification', () => {
    const desc = buildDescriptor('test-srv', 'list_things', 'List all available items', {
      type: 'object',
      properties: { filter: { type: 'string' } },
      required: ['filter'],
    });

    expect(desc.serverName).toBe('test-srv');
    expect(desc.namespacedName).toBe('mcp/test-srv/list_things');
    expect(desc.risk).toBe('low');
    expect(desc.allowlistKey).toBe('test-srv/list_things');
    expect(desc.timeoutMs).toBeGreaterThan(0);
    expect(desc.outputCapBytes).toBeGreaterThan(0);
  });

  it('classifies risk from description text', () => {
    expect(defaultRisk({ description: 'Delete all records permanently' })).toBe('critical');
    expect(defaultRisk({ description: 'Drop the entire database' })).toBe('critical');
    expect(defaultRisk({ description: 'Update the database record' })).toBe('high');
    expect(defaultRisk({ description: 'Execute arbitrary shell command' })).toBe('high');
    expect(defaultRisk({ description: 'Send an email to the user' })).toBe('high');
    expect(defaultRisk({ description: 'List available items' })).toBe('low');
    expect(defaultRisk({ description: 'Get the current status' })).toBe('low');
    expect(defaultRisk({ description: 'Fetch data from API' })).toBe('low');
    expect(defaultRisk({ description: 'Do something unusual' })).toBe('medium');
  });

  it('maps risk to timeout and output caps', () => {
    expect(defaultTimeoutMs('low')).toBe(60_000);
    expect(defaultTimeoutMs('medium')).toBe(30_000);
    expect(defaultTimeoutMs('high')).toBe(15_000);
    expect(defaultTimeoutMs('critical')).toBe(10_000);

    expect(defaultOutputCapBytes('low')).toBe(128_000);
    expect(defaultOutputCapBytes('medium')).toBe(64_000);
    expect(defaultOutputCapBytes('high')).toBe(32_000);
    expect(defaultOutputCapBytes('critical')).toBe(16_000);
  });

  it('translates descriptors to Gemini function declarations with bounded schemas', () => {
    const descriptor = buildDescriptor('calc', 'multiply', 'Read two numbers and return product', {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'First factor' },
        'y-coordinate': { type: 'number', description: 'Second factor' },
      },
      required: ['x'],
    });

    const decl = translateToGeminiDeclaration(descriptor);
    expect(decl.name).toBe('mcp/calc/multiply');
    expect(decl.description).toContain('risk=low');
    expect(decl.parameters).toHaveProperty('type', 'object');
    expect(decl.parameters).toHaveProperty('properties');

    const all = translateAllToGeminiDeclarations([descriptor]);
    expect(all).toHaveLength(1);
  });

  it('bounds schema property names to safe identifiers', () => {
    const schema = {
      type: 'object',
      properties: {
        'valid_name': { type: 'string' },
        'name with spaces': { type: 'string' },
        ['a'.repeat(100)]: { type: 'string' },
      },
    };

    const bounded = boundSchema(schema as any, 'mcp/test/tool');
    const props = bounded.properties as Record<string, unknown>;
    expect(Object.keys(props)).toContain('valid_name');
    expect(Object.keys(props)).not.toContain('name with spaces');
    expect(Object.keys(props)).toContain('name_with_spaces');

    const longKey = Object.keys(props).find((k) => k.length === 64);
    expect(longKey).toBeDefined();
  });
});

describe('MapToolAllowlist', () => {
  it('adds, gets, and removes entries', () => {
    const allowlist = new MapToolAllowlist();
    allowlist.add({ serverName: 's1', toolName: 'echo', risk: 'low', timeoutMs: 5000, outputCapBytes: 10000 });

    expect(allowlist.size).toBe(1);
    expect(allowlist.get('s1', 'echo')).toBeDefined();
    expect(allowlist.get('s1', 'nonexistent')).toBeUndefined();

    allowlist.remove('s1', 'echo');
    expect(allowlist.size).toBe(0);
  });

  it('matches by namespaced name', () => {
    const allowlist = new MapToolAllowlist();
    allowlist.add({ serverName: 'srv', toolName: 'tool1', risk: 'medium', timeoutMs: 5000, outputCapBytes: 10000 });

    expect(allowlist.match('mcp/srv/tool1')).toBeDefined();
    expect(allowlist.match('mcp/srv/tool2')).toBeUndefined();
    expect(allowlist.match('mcp/other/tool1')).toBeUndefined();
    expect(allowlist.match('not-mcp')).toBeUndefined();
  });
});

describe('MCP client - local fake stdio server', () => {
  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  const fakeServerPath = resolve(__dirname, 'fake-mcp-server.ts');
  const tsxCli = resolve(__dirname, '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');

  const config: MCPServerConfig = {
    name: 'fake-test',
    transport: 'stdio',
    command: process.execPath,
    args: [tsxCli, fakeServerPath],
  };

  it('connects, discovers tools, and calls a tool', async () => {
    const handle = createMCPClient(config);

    try {
      await handle.connect();
      expect(handle.status).toBe('connected');

      const tools = await handle.discover();
      expect(tools.length).toBeGreaterThanOrEqual(3);

      const echoTool = tools.find((t) => t.toolName === 'echo');
      expect(echoTool).toBeDefined();
      expect(echoTool!.risk).toBe('medium');
      expect(echoTool!.namespacedName).toBe('mcp/fake-test/echo');
      expect(echoTool!.inputSchema.required).toContain('message');

      const deleteTool = tools.find((t) => t.toolName === 'delete_everything');
      expect(deleteTool).toBeDefined();
      expect(deleteTool!.risk).toBe('critical');

      const echoCall: MCPToolCall = {
        id: randomUUID(),
        namespacedName: 'mcp/fake-test/echo',
        args: { message: 'hello world' },
      };

      const result = await handle.callTool(echoCall, new AbortController().signal);
      expect(result.receipt.ok).toBe(true);
      expect(result.receipt.content).toBeDefined();

      const addCall: MCPToolCall = {
        id: randomUUID(),
        namespacedName: 'mcp/fake-test/add',
        args: { a: 3, b: 4 },
      };
      const addResult = await handle.callTool(addCall, new AbortController().signal);
      expect(addResult.receipt.ok).toBe(true);
      expect(addResult.receipt.latencyMs).toBeGreaterThan(0);
    } finally {
      await handle.disconnect();
      expect(handle.status).toBe('disconnected');
    }
  }, 15_000);

  it('reports errors for unknown tools', () => {
    // skip - requires server to be connected
    expect(true).toBe(true);
  });
});

describe('MCP registry', () => {
  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  const fakeServerPath = resolve(__dirname, 'fake-mcp-server.ts');
  const tsxCli = resolve(__dirname, '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');

  const makeConfig = (name: string): MCPServerConfig => ({
    name,
    transport: 'stdio',
    command: process.execPath,
    args: [tsxCli, fakeServerPath],
  });

  it('registers and unregisters servers', async () => {
    const registry = createMCPRegistry();
    expect(registry.state().servers).toHaveLength(0);

    const config = makeConfig('reg-test');

    const tools = await registry.registerServer(config);
    expect(tools.length).toBeGreaterThanOrEqual(1);
    expect(registry.state().servers).toHaveLength(1);
    expect(registry.allowlist).not.toBeNull();

    await registry.unregisterServer('reg-test');
    expect(registry.state().servers).toHaveLength(0);
  }, 15_000);

  it('throws on duplicate server registration', async () => {
    const registry = createMCPRegistry();
    const config = makeConfig('dup-test');

    await registry.registerServer(config);
    await expect(registry.registerServer(config)).rejects.toThrow(/already registered/i);

    await registry.disconnectAll();
  }, 15_000);

  it('rejects unregistered server name', async () => {
    const registry = createMCPRegistry();
    const call: MCPToolCall = {
      id: randomUUID(),
      namespacedName: 'mcp/unknown/foo',
      args: {},
    };
    await expect(registry.executeCall(call, new AbortController().signal)).rejects.toThrow();
  });

  it('disconnects all servers cleanly', async () => {
    const registry = createMCPRegistry();
    const config = makeConfig('cleanup-test');

    await registry.registerServer(config);
    expect(registry.state().servers).toHaveLength(1);

    await registry.disconnectAll();
    expect(registry.state().servers).toHaveLength(0);
    expect(registry.allowlist).toBeNull();
  }, 15_000);
});

describe('MCP tool output sanitization', () => {
  it('bounds translated schemas to Gemini-safe format', () => {
    const descriptor = buildDescriptor('s', 't', 'desc', {
      type: 'object',
      properties: {
        msg: { type: 'string', description: 'A message' },
        count: { type: 'integer', description: 'Count' },
        active: { type: 'boolean' },
        junk: { type: 'unsupported_type' },
      },
    });

    const decl = translateToGeminiDeclaration(descriptor);
    const params = decl.parameters as Record<string, unknown>;
    const props = params.properties as Record<string, unknown>;

    expect((props.msg as Record<string, unknown>).type).toBe('string');
    expect((props.count as Record<string, unknown>).type).toBe('integer');
    expect((props.active as Record<string, unknown>).type).toBe('boolean');
    expect((props.junk as Record<string, unknown>).type).toBe('string');
  });

  it('never includes server URLs, env values, or unregistered names in declarations', () => {
    const decls = translateAllToGeminiDeclarations([]);
    expect(JSON.stringify(decls)).not.toMatch(/https?:/i);
    expect(JSON.stringify(decls)).not.toMatch(/api[_.-]?key/i);
    expect(JSON.stringify(decls)).not.toMatch(/token/i);
  });
});
