import {
  CodingAgentLifecycleError,
  type CodingAgentLifecycleOptions,
  type CodingAgentPort,
  type CodingAgentReceipt,
  type CodingAgentTask,
  type ConductorMessage,
  type GitVerificationPort,
} from './contracts.js';

const FULL_SHA = /^[0-9a-f]{40}$/i;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 15_000;

export class CodingAgentLifecycle {
  readonly #conductor: CodingAgentPort;
  readonly #git: GitVerificationPort;
  readonly #options: Required<CodingAgentLifecycleOptions>;

  constructor(conductor: CodingAgentPort, git: GitVerificationPort, options: CodingAgentLifecycleOptions = {}) {
    this.#conductor = conductor;
    this.#git = git;
    this.#options = {
      agent: options.agent ?? 'codex',
      defaultTimeoutMs: options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      defaultPollIntervalMs: options.defaultPollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      now: options.now ?? Date.now,
      sleep: options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
    };
  }

  async run(task: CodingAgentTask): Promise<CodingAgentReceipt> {
    if (!task.model.trim()) return this.#failed(task.taskId, 'invalid_model');
    const auth = await this.#conductor.authProbe();
    if (!auth.authenticated) return { taskId: task.taskId, lifecycleStatus: 'conductor_auth_required', errorCode: 'conductor_auth_required' };

    const project = await this.#selectProject(task);
    const workspace = await this.#conductor.createWorkspace({ projectId: project.id, name: task.workspaceName, agent: this.#options.agent, model: task.model });
    const receipt = { taskId: task.taskId, workspaceId: workspace.id, workspaceName: workspace.name, sessionId: workspace.sessionId, deepLink: workspace.deepLink, lifecycleStatus: 'created' as const };
    await this.#conductor.sendMessage(workspace.sessionId, workerPrompt(task.prompt));

    const deadline = this.#options.now() + (task.timeoutMs ?? this.#options.defaultTimeoutMs);
    let seenWorking = false;
    let steered = false;
    let lastMessageId: string | undefined;
    let messages: ConductorMessage[] = [];
    while (this.#options.now() <= deadline) {
      const status = await this.#conductor.getStatus(workspace.sessionId);
      if (status === 'working') seenWorking = true;
      const newMessages = await this.#conductor.readTranscript(workspace.sessionId, lastMessageId);
      if (newMessages.length) {
        messages = messages.concat(newMessages);
        lastMessageId = newMessages.at(-1)?.id;
      }
      const evidence = completionEvidence(messages);
      if (evidence?.commitSha && FULL_SHA.test(evidence.commitSha)) {
        const verified = await this.#git.verifyCommit({ repositoryPath: task.repositoryPath, commitSha: evidence.commitSha });
        if (verified) return { ...receipt, lifecycleStatus: 'succeeded', commitSha: evidence.commitSha, prUrl: evidence.prUrl };
        return { ...receipt, lifecycleStatus: 'failed', errorCode: 'commit_not_verified' };
      }
      if (evidence?.commitSha && !FULL_SHA.test(evidence.commitSha)) return { ...receipt, lifecycleStatus: 'failed', errorCode: 'invalid_commit_sha' };
      if (status === 'errored') return { ...receipt, lifecycleStatus: 'failed', errorCode: 'conductor_session_errored' };
      if (status === 'idle' && seenWorking) return { ...receipt, lifecycleStatus: 'failed', errorCode: 'missing_commit_sha' };
      if (status === 'idle' && !seenWorking && task.steeringMessage && !steered) {
        await this.#conductor.sendMessage(workspace.sessionId, task.steeringMessage);
        steered = true;
      }
      await this.#options.sleep(task.pollIntervalMs ?? this.#options.defaultPollIntervalMs);
    }
    return { ...receipt, lifecycleStatus: 'timed_out', errorCode: 'conductor_timeout' };
  }

  async steer(sessionId: string, message: string): Promise<void> {
    await this.#conductor.sendMessage(sessionId, message);
  }

  async cancel(receipt: CodingAgentReceipt): Promise<CodingAgentReceipt> {
    if (receipt.sessionId) await this.#conductor.cancel(receipt.sessionId);
    return { ...receipt, lifecycleStatus: 'cancelled' };
  }

  async #selectProject(task: CodingAgentTask) {
    const projects = await this.#conductor.listProjects();
    const project = projects.find((candidate) =>
      (task.project.id && candidate.id === task.project.id) ||
      (task.project.name && candidate.name === task.project.name) ||
      (task.project.repoUrl && candidate.repoUrl === task.project.repoUrl));
    if (!project) throw new CodingAgentLifecycleError('project_not_found');
    return project;
  }

  #failed(taskId: string, errorCode: string): CodingAgentReceipt {
    return { taskId, lifecycleStatus: 'failed', errorCode };
  }
}

export function workerPrompt(prompt: string): string {
  return `${prompt}\n\nRequired delivery contract: implement the task, run the relevant tests, commit all work, and reply with exactly this evidence when complete: COMMIT_SHA: <full 40-character commit SHA>. Include PR_URL: <url> when a pull request exists. Do not claim completion without the commit.`;
}

function completionEvidence(messages: readonly ConductorMessage[]): { commitSha?: string; prUrl?: string } | undefined {
  let commitSha: string | undefined;
  let prUrl: string | undefined;
  for (const message of messages) {
    const text = message.text ?? '';
    const match = /(?:^|\s)COMMIT_SHA:\s*([^\s`]+)/i.exec(text);
    if (match) commitSha = match[1];
    if (message.commitSha) commitSha = message.commitSha;
    const url = /(?:^|\s)PR_URL:\s*(https?:\/\/[^\s`]+)/i.exec(text)?.[1] ?? message.prUrl;
    if (url) prUrl = url;
  }
  return commitSha || prUrl ? { commitSha, prUrl } : undefined;
}
