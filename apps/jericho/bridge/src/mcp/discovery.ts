import type { ToolDecl } from '../tools.js';
import { allowlistKey, defaultOutputCapBytes, defaultRisk, defaultTimeoutMs } from './allowlist.js';
import type { MCPJsonSchema, MCPToolDescriptor, MCPToolRisk } from './types.js';

export function namespaceTool(serverName: string, toolName: string): string {
  return `mcp/${serverName}/${toolName}`;
}

export function parseNamespacedTool(namespaced: string): { serverName: string; toolName: string } | null {
  const match = /^mcp\/([^/]+)\/(.+)$/u.exec(namespaced);
  if (!match) return null;
  return { serverName: match[1], toolName: match[2] };
}

export function isMCPToolName(name: string): boolean {
  return /^mcp\//u.test(name);
}

export function translateToGeminiDeclaration(
  descriptor: MCPToolDescriptor,
): ToolDecl {
  const bounded = boundSchema(descriptor.inputSchema, descriptor.namespacedName);
  return {
    name: descriptor.namespacedName,
    description: `${descriptor.description} [risk=${descriptor.risk}]`,
    parameters: bounded,
  };
}

export function translateAllToGeminiDeclarations(
  descriptors: MCPToolDescriptor[],
): ToolDecl[] {
  return descriptors.map(translateToGeminiDeclaration);
}

export function boundSchema(schema: MCPJsonSchema, toolName: string): Record<string, unknown> {
  const result: Record<string, unknown> = { type: schema.type ?? 'object' };

  if (schema.properties && typeof schema.properties === 'object') {
    const bounded: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
      bounded[boundedPropertyName(key)] = boundedProperty(prop as Record<string, unknown>, toolName);
    }
    result.properties = bounded;
  }

  if (Array.isArray(schema.required)) {
    result.required = schema.required.map(boundedPropertyName);
  }

  if (schema.additionalProperties !== undefined) {
    result.additionalProperties = schema.additionalProperties;
  }

  return result;
}

function boundedPropertyName(key: string): string {
  const cleaned = key.replace(/[^a-zA-Z0-9_]/gu, '_');
  if (cleaned.length > 64) return cleaned.slice(0, 64);
  return cleaned || 'param';
}

function boundedProperty(prop: Record<string, unknown>, toolName: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const type = prop.type;
  const allowed = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object']);

  if (typeof type === 'string' && allowed.has(type)) {
    result.type = type;
  } else {
    result.type = 'string';
  }

  if (typeof prop.description === 'string') {
    result.description = prop.description.slice(0, 500);
  }

  if (typeof prop.enum === 'object' && Array.isArray(prop.enum)) {
    result.enum = prop.enum.slice(0, 100);
  }

  if (type === 'object' && prop.properties && typeof prop.properties === 'object') {
    const nested: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(prop.properties as Record<string, unknown>)) {
      nested[boundedPropertyName(key)] = boundedProperty(value as Record<string, unknown>, toolName);
    }
    result.properties = nested;
  }

  if (type === 'array' && prop.items && typeof prop.items === 'object') {
    result.items = boundedProperty(prop.items as Record<string, unknown>, toolName);
  }

  return result;
}

export function buildDescriptor(
  serverName: string,
  toolName: string,
  description: string,
  inputSchema: MCPJsonSchema,
  risk?: MCPToolRisk,
  timeoutMs?: number,
  outputCapBytes?: number,
): MCPToolDescriptor {
  const resolvedRisk = risk ?? defaultRisk({ description, inputSchema });
  return {
    serverName,
    namespacedName: namespaceTool(serverName, toolName),
    toolName,
    description,
    inputSchema,
    risk: resolvedRisk,
    timeoutMs: timeoutMs ?? defaultTimeoutMs(resolvedRisk),
    outputCapBytes: outputCapBytes ?? defaultOutputCapBytes(resolvedRisk),
    allowlistKey: allowlistKey(serverName, toolName),
  };
}
