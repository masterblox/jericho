export type ConductorSessionStatus = 'idle' | 'working' | 'errored' | string;

export interface ConductorProject {
  id: string;
  name?: string;
  repoUrl?: string;
}

export interface ConductorWorkspace {
  id: string;
  name: string;
  deepLink?: string;
  sessionId: string;
}

export interface ConductorMessage {
  id: string;
  role?: 'user' | 'assistant' | 'system' | string;
  text?: string;
  commitSha?: string;
  prUrl?: string;
}

export interface ConductorAuthProbe {
  authenticated: boolean;
}

export interface CodingAgentPort {
  authProbe(): Promise<ConductorAuthProbe>;
  listProjects(): Promise<readonly ConductorProject[]>;
  createWorkspace(input: {
    projectId: string;
    name: string;
    agent: string;
    model: string;
  }): Promise<ConductorWorkspace>;
  sendMessage(sessionId: string, message: string): Promise<void>;
  getStatus(sessionId: string): Promise<ConductorSessionStatus>;
  readTranscript(sessionId: string, afterMessageId?: string): Promise<readonly ConductorMessage[]>;
  cancel(sessionId: string): Promise<void>;
}

export interface GitVerificationPort {
  verifyCommit(input: { repositoryPath: string; commitSha: string }): Promise<boolean>;
}

export type CodingAgentLifecycleStatus =
  | 'conductor_auth_required'
  | 'created'
  | 'working'
  | 'queued'
  | 'idle'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'cancelled'
  | 'incomplete';

export interface CodingAgentReceipt {
  taskId: string;
  workspaceId?: string;
  workspaceName?: string;
  sessionId?: string;
  deepLink?: string;
  lifecycleStatus: CodingAgentLifecycleStatus;
  commitSha?: string;
  prUrl?: string;
  errorCode?: string;
}

export interface CodingAgentTask {
  taskId: string;
  repositoryPath: string;
  project: { id?: string; name?: string; repoUrl?: string };
  workspaceName: string;
  model: string;
  prompt: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  steeringMessage?: string;
}

export interface CodingAgentLifecycleOptions {
  agent?: string;
  defaultTimeoutMs?: number;
  defaultPollIntervalMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class CodingAgentLifecycleError extends Error {
  constructor(public readonly code: string, message = code) {
    super(message);
    this.name = 'CodingAgentLifecycleError';
  }
}
