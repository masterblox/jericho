/**
 * Tool declarations + dispatcher.
 * Phase 1/2: local mock executor. Phase 3 swaps `execute` to hit Paperclip :3100.
 */

export interface ToolDecl {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const FUNCTION_DECLARATIONS: ToolDecl[] = [
  {
    name: 'list_open_tasks',
    description: 'List the user\'s currently open tasks / issues.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'draft_email',
    description: 'Draft a short email on a given topic.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient name' },
        topic: { type: 'string', description: 'What the email is about' },
        tone: { type: 'string', description: 'warm | formal | direct' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'fleet_status',
    description: 'Report the current status of the agent fleet.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'switch_voice_mode',
    description:
      'Switch between voice personas based on the gravity of the task. ' +
      'mode "megatron" = heavy, deep, commanding voice for intense operations ' +
      '(deployments, critical fixes, security incidents, urgent blockers, system rebuilds). ' +
      'mode "jarvis" = calm, refined butler for normal operations. ' +
      'Always announce the transition naturally before calling this tool — the swap happens ' +
      'seamlessly after you finish speaking.',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['jarvis', 'megatron'],
          description: 'The voice persona to switch to',
        },
        reason: {
          type: 'string',
          description: 'One-line reason for the switch (e.g. "deploying critical infrastructure")',
        },
      },
      required: ['mode'],
    },
  },
];

/** Local mock executor. Returns a JSON-serializable result object. */
export async function execute(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  switch (name) {
    case 'list_open_tasks':
      return {
        count: 3,
        tasks: [
          { id: 'P1-2', title: 'Provision Paperclip API key', status: 'blocked', priority: 'high' },
          { id: 'P1-1', title: 'Wire Telethon for Jericho', status: 'queued', priority: 'high' },
          { id: 'P0-5', title: 'Rebuild 2 dead crons', status: 'queued', priority: 'urgent' },
        ],
      };
    case 'draft_email': {
      const to = (args.to as string) ?? 'there';
      const topic = (args.topic as string) ?? 'following up';
      const tone = (args.tone as string) ?? 'warm';
      return {
        to,
        subject: topic,
        body: `Hi ${to},\n\nFollowing up on ${topic}. Wanted to keep this short — let me know what works. (tone: ${tone})\n\n— sent via Jarvis`,
      };
    }
    case 'fleet_status':
      return {
        agents: [
          { name: 'DEV', status: 'online', model: 'deepseek-v4-pro' },
          { name: 'PA', status: 'online', model: 'deepseek-v4-pro' },
          { name: 'Iris', status: 'online', model: 'glm-5.2' },
          { name: 'Jericho', status: 'online', model: 'deepseek-v4-pro' },
        ],
        paperclip: 'healthy, no auth',
        disk: '76%',
      };
    case 'switch_voice_mode':
      return {
        acknowledged: true,
        mode: args.mode,
        note: 'Voice mode switch queued — takes effect seamlessly at the end of this turn.',
      };
    default:
      return { error: `unknown tool: ${name}` };
  }
}
