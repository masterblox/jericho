import { describe, expect, it, vi } from 'vitest';

import { ConductorCliPort } from '../src/coding-agent/conductor-cli.js';
import { CodingAgentLifecycle } from '../src/coding-agent/lifecycle.js';
import { CodingAgentManager } from '../src/coding-agent/manager.js';
import type { CodingAgentPort, CodingAgentTask, ConductorMessage, GitVerificationPort } from '../src/coding-agent/contracts.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';

describe('bounded coding-agent lifecycle', () => {
  it('fails closed before project or workspace access when Conductor is not authenticated', async () => {
    const conductor = fakeConductor({ authenticated: false });
    const result = await lifecycle(conductor).run(task());
    expect(result).toEqual({ taskId: 'task-1', lifecycleStatus: 'conductor_auth_required', errorCode: 'conductor_auth_required' });
    expect(conductor.calls).toEqual(['authProbe']);
  });

  it('selects a project, creates an economical explicit-model session, and verifies a committed SHA', async () => {
    const conductor = fakeConductor({ messages: [{ id: 'm1', role: 'assistant', text: `done\nCOMMIT_SHA: ${SHA}\nPR_URL: https://github.com/acme/repo/pull/7` }], statuses: ['working', 'idle'] });
    const git: GitVerificationPort = { verifyCommit: vi.fn(async (input) => input.commitSha === SHA) };
    const result = await lifecycle(conductor, git).run(task());
    expect(result).toMatchObject({ taskId: 'task-1', workspaceId: 'ws-1', workspaceName: 'bounded-task', sessionId: 'session-1', deepLink: 'conductor://workspace/ws-1', lifecycleStatus: 'succeeded', commitSha: SHA, prUrl: 'https://github.com/acme/repo/pull/7' });
    expect(conductor.createInput).toMatchObject({ projectId: 'project-1', agent: 'codex', model: 'gpt-5.3-codex-spark' });
    expect(conductor.sent[0]).toContain('COMMIT_SHA: <full 40-character commit SHA>');
    expect(git.verifyCommit).toHaveBeenCalledWith({ repositoryPath: '/repo', commitSha: SHA });
  });

  it('steers an idle queued session and accepts fast completion proven by transcript and Git', async () => {
    const conductor = fakeConductor({ messagesByRead: [[], [{ id: 'm1', text: `COMMIT_SHA: ${SHA}` }]], statuses: ['idle', 'working'] });
    const result = await lifecycle(conductor).run(task({ steeringMessage: 'Start the queued task now and continue until committed.' }));
    expect(result.lifecycleStatus).toBe('succeeded');
    expect(conductor.sent).toHaveLength(2);
    expect(conductor.sent[1]).toContain('Start the queued task');
  });

  it('does not treat idle or prose success as completion, then times out', async () => {
    const conductor = fakeConductor({ messages: [{ id: 'm1', text: 'All done and tests pass.' }], statuses: ['working', 'idle'] });
    const missing = await lifecycle(conductor).run(task({ timeoutMs: 20, pollIntervalMs: 10 }));
    expect(missing).toMatchObject({ lifecycleStatus: 'failed', errorCode: 'missing_commit_sha' });

    const queued = fakeConductor({ messages: [{ id: 'm1', text: 'Still queued.' }], statuses: ['idle', 'idle', 'idle', 'idle'] });
    const result = await lifecycle(queued).run(task({ timeoutMs: 20, pollIntervalMs: 10 }));
    expect(result).toMatchObject({ lifecycleStatus: 'timed_out', errorCode: 'conductor_timeout' });
  });

  it('rejects missing, malformed, and unverified commit evidence', async () => {
    const missing = await lifecycle(fakeConductor({ messages: [{ id: 'm1', text: 'COMMIT_SHA: ' }], statuses: ['idle'] })).run(task({ timeoutMs: 0 }));
    expect(missing.lifecycleStatus).toBe('timed_out');
    const malformed = await lifecycle(fakeConductor({ messages: [{ id: 'm1', text: 'COMMIT_SHA: abc123' }], statuses: ['idle'] })).run(task());
    expect(malformed).toMatchObject({ lifecycleStatus: 'failed', errorCode: 'invalid_commit_sha' });
    const unverified = await lifecycle(fakeConductor({ messages: [{ id: 'm1', text: `COMMIT_SHA: ${SHA}` }], statuses: ['idle'] }), { verifyCommit: async () => false }).run(task());
    expect(unverified).toMatchObject({ lifecycleStatus: 'failed', errorCode: 'commit_not_verified' });
  });

  it('cancels a live session and exposes explicit steering', async () => {
    const conductor = fakeConductor();
    const service = lifecycle(conductor);
    await service.steer('session-1', 'Please re-check the tests.');
    const cancelled = await service.cancel({ taskId: 'task-1', workspaceId: 'ws-1', workspaceName: 'bounded-task', sessionId: 'session-1', lifecycleStatus: 'working' });
    expect(cancelled.lifecycleStatus).toBe('cancelled');
    expect(conductor.sent).toContain('Please re-check the tests.');
    expect(conductor.calls).toContain('cancel:session-1');
  });
});

describe('coding-agent manager', () => {
  it('returns immediately, monitors in the background, and exposes only Git-verified completion', async () => {
    const conductor = fakeConductor({
      messages: [{ id: 'm1', text: `COMMIT_SHA: ${SHA}` }],
      statuses: ['working'],
    });
    const manager = new CodingAgentManager(
      lifecycle(conductor),
      { originUrl: async () => 'https://github.com/acme/repo.git' },
      [{ id: 'jericho', path: '/repo' }],
      { idFactory: () => 'coding-task-1' },
    );

    await expect(manager.start({ repository: 'jericho', task: 'Fix the startup flow.' }))
      .resolves.toMatchObject({
        taskId: 'coding-task-1', lifecycleStatus: 'queued',
        workspaceName: 'jericho: Fix the startup flow.',
      });
    await vi.waitFor(async () => {
      await expect(manager.status('coding-task-1')).resolves.toMatchObject({
        lifecycleStatus: 'succeeded', commitSha: SHA,
        workspaceId: 'ws-1', sessionId: 'session-1',
      });
    });
    expect(conductor.createInput).toMatchObject({ model: 'gpt-5.3-codex-spark' });
  });

  it('surfaces missing Conductor auth without creating a workspace', async () => {
    const conductor = fakeConductor({ authenticated: false });
    const manager = new CodingAgentManager(
      lifecycle(conductor),
      { originUrl: async () => undefined },
      [{ id: 'jericho', path: '/repo' }],
      { idFactory: () => 'coding-task-auth' },
    );
    await manager.start({ repository: 'jericho', task: 'Fix it.' });
    await vi.waitFor(async () => {
      await expect(manager.status('coding-task-auth')).resolves.toMatchObject({
        lifecycleStatus: 'conductor_auth_required', errorCode: 'conductor_auth_required',
      });
    });
    expect(conductor.calls).toEqual(['authProbe']);
  });
});

describe('Conductor CLI adapter', () => {
  it('uses the supported JSON CLI shapes, SQL transcript view, and never places a token in argv', async () => {
    const calls: string[][] = [];
    const runner = vi.fn(async (_executable: string, args: readonly string[]) => {
      calls.push([...args]);
      const command = args.slice(1).join(' ');
      if (command === 'auth status') return { stdout: JSON.stringify({ hasKey: true }), stderr: '', exitCode: 0 };
      if (command === 'auth whoami') return { stdout: JSON.stringify({ account: 'carlos' }), stderr: '', exitCode: 0 };
      if (command === 'projects list --limit 100 --offset 0') return { stdout: JSON.stringify({ data: [{ id: 'project-1', name: 'Jericho', gitRemote: 'git@github.com:acme/jericho.git' }], offset: 0, hasMore: false }), stderr: '', exitCode: 0 };
      if (command.startsWith('workspaces create ')) return { stdout: JSON.stringify({ workspaceId: 'ws-1', sessionId: 's-1', deepLink: 'conductor://workspace/ws-1' }), stderr: '', exitCode: 0 };
      if (command === 'sessions status s-1') return { stdout: JSON.stringify({ workspaceId: 'ws-1', sessionId: 's-1', status: 'working', updatedAt: '2026-08-04T00:00:00Z' }), stderr: '', exitCode: 0 };
      if (args[1] === 'sql') return { stdout: JSON.stringify({ rows: [{ session_id: 's-1', transcript: `done\nCOMMIT_SHA: ${SHA}`, transcript_updated_at: '2026-08-04T00:00:01Z' }], rowCount: 1, truncated: false }), stderr: '', exitCode: 0 };
      return { stdout: '{}', stderr: '', exitCode: 0 };
    });
    const cli = new ConductorCliPort({ runner });
    await expect(cli.authProbe()).resolves.toEqual({ authenticated: true });
    await expect(cli.listProjects()).resolves.toEqual([{ id: 'project-1', name: 'Jericho', repoUrl: 'git@github.com:acme/jericho.git' }]);
    await expect(cli.createWorkspace({ projectId: 'project-1', name: 'task', agent: 'codex', model: 'gpt-5.5' })).resolves.toEqual({ id: 'ws-1', name: 'task', sessionId: 's-1', deepLink: 'conductor://workspace/ws-1' });
    await expect(cli.getStatus('s-1')).resolves.toBe('working');
    const transcript = await cli.readTranscript('s-1');
    expect(transcript).toHaveLength(1);
    expect(transcript[0]?.text).toContain(`COMMIT_SHA: ${SHA}`);
    await expect(cli.readTranscript('s-1', transcript[0]?.id)).resolves.toEqual([]);
    expect(calls.every((args) => args[0] === '--json')).toBe(true);
    expect(calls.some((args) => args[1] === 'sql' && args[2]?.includes('session_transcripts_view'))).toBe(true);
    expect(calls.flat()).not.toContain('--after');
    expect(calls.flat()).not.toContain('--token');
    expect(calls.flat().join(' ')).not.toContain('secret');
  });
});

function task(overrides: Partial<CodingAgentTask> = {}): CodingAgentTask {
  return { ...taskBase(), ...overrides };
}

function taskBase(): CodingAgentTask {
  return {
    taskId: 'task-1', repositoryPath: '/repo', project: { id: 'project-1' }, workspaceName: 'bounded-task', model: 'gpt-5.3-codex-spark', prompt: 'Fix the bug.', timeoutMs: 100, pollIntervalMs: 1,
  };
}

function lifecycle(conductor: CodingAgentPort, git: GitVerificationPort = { verifyCommit: async () => true }) {
  let now = 0;
  return new CodingAgentLifecycle(conductor, git, { now: () => now, sleep: async (ms) => { now += ms; } });
}

function fakeConductor(options: { authenticated?: boolean; statuses?: string[]; messages?: ConductorMessage[]; messagesByRead?: ConductorMessage[][] } = {}): CodingAgentPort & { calls: string[]; sent: string[]; createInput?: Parameters<CodingAgentPort['createWorkspace']>[0] } {
  const calls: string[] = [];
  const sent: string[] = [];
  const statuses = [...(options.statuses ?? ['idle'])];
  const messagesByRead = [...(options.messagesByRead ?? [])];
  return {
    calls, sent,
    async authProbe() { calls.push('authProbe'); return { authenticated: options.authenticated ?? true }; },
    async listProjects() { calls.push('listProjects'); return [{ id: 'project-1', name: 'Jericho' }]; },
    async createWorkspace(input) { calls.push('createWorkspace'); this.createInput = input; return { id: 'ws-1', name: input.name, sessionId: 'session-1', deepLink: 'conductor://workspace/ws-1' }; },
    async sendMessage(_sessionId, message) { sent.push(message); },
    async getStatus() { return statuses.shift() ?? 'idle'; },
    async readTranscript() { return messagesByRead.length ? messagesByRead.shift() ?? [] : options.messages ?? []; },
    async cancel(sessionId) { calls.push(`cancel:${sessionId}`); },
  };
}
