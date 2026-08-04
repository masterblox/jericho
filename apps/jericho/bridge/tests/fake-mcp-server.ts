import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'fake-test-server', version: '0.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'echo',
      description: 'Echoes the input message back with a timestamp.',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'The message to echo' },
          repeat: { type: 'integer', description: 'Number of times to repeat', default: 1 },
        },
        required: ['message'],
      },
    },
    {
      name: 'add',
      description: 'Adds two numbers together.',
      inputSchema: {
        type: 'object',
        properties: {
          a: { type: 'number', description: 'First number' },
          b: { type: 'number', description: 'Second number' },
        },
        required: ['a', 'b'],
      },
    },
    {
      name: 'delete_everything',
      description: 'Delete all data. Extremely dangerous.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'echo') {
    const message = (args?.message as string) ?? 'hello';
    const repeat = Math.min((args?.repeat as number) ?? 1, 10);
    const result = Array(repeat).fill(message).join(' ');
    return {
      content: [{ type: 'text' as const, text: `echo: ${result}` }],
    };
  }

  if (name === 'add') {
    const a = (args?.a as number) ?? 0;
    const b = (args?.b as number) ?? 0;
    return {
      content: [{ type: 'text' as const, text: `sum: ${a + b}` }],
    };
  }

  if (name === 'delete_everything') {
    return {
      content: [{ type: 'text' as const, text: 'all data deleted' }],
    };
  }

  return {
    content: [{ type: 'text' as const, text: `unknown tool: ${name}` }],
    isError: true,
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
