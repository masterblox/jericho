import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import {
  CaptureFailureKind,
  ConnectorCapability,
  ConnectorHealthStatus,
  EntityType,
  LifecycleStatus,
  RelationType,
  RiskLevel,
  RouteType,
  SourceType,
  type CaptureFailure,
  type NormalizedCapture,
} from '@jericho/shared';

import {
  ConnectorUnavailableError,
  type CaptureConnector,
  type ConnectorCapturePage,
  type ConnectorCaptureRequest,
  type ConnectorProbe,
} from '../contracts.js';
import { stableConnectorEvent } from '../normalization.js';

const execFileAsync = promisify(execFile);

export type GitCommandRunner = (
  file: string,
  args: string[],
  options?: { cwd?: string },
) => Promise<{ stdout: string; stderr: string }>;

export interface GitConnectorOptions {
  repositories: Array<{ id: string; path: string }>;
  maxCommits: number;
  runner?: GitCommandRunner;
}

export class GitConnector implements CaptureConnector {
  readonly descriptor;
  readonly #runner: GitCommandRunner;

  constructor(private readonly options: GitConnectorOptions) {
    if (!Number.isInteger(options.maxCommits) || options.maxCommits < 1 || options.maxCommits > 500) {
      throw new Error('Git commit bound is invalid');
    }
    this.descriptor = {
      id: 'git', adapterVersion: 1, cursorSchemaVersion: 1,
      partitions: options.repositories.map((item) => item.id),
      maxBatchSize: options.maxCommits + 1,
    };
    this.#runner = options.runner ?? defaultGitRunner;
  }

  async probe(_signal: AbortSignal): Promise<ConnectorProbe> {
    return this.options.repositories.length > 0
      ? { status: ConnectorHealthStatus.Healthy, details: { mode: 'local_read_only' } }
      : { status: ConnectorHealthStatus.Unavailable, details: { reason: 'no_repositories' } };
  }

  async capture(request: ConnectorCaptureRequest): Promise<ConnectorCapturePage> {
    const repository = this.options.repositories.find((item) => item.id === request.partition);
    if (!repository) throw new ConnectorUnavailableError(`Git repository ${request.partition} is unavailable`);
    const status = await this.#runner('git', [
      '-C', repository.path, 'status', '--porcelain=v2', '--branch',
    ]);
    const branch = parseBranchStatus(status.stdout);
    const head = branch.headSha || (await this.#runner('git', [
      '-C', repository.path, 'rev-parse', 'HEAD',
    ])).stdout.trim();
    const failures: CaptureFailure[] = [];
    if (request.cursor?.pageToken && request.cursor.pageToken !== head) {
      try {
        await this.#runner('git', [
          '-C', repository.path, 'merge-base', '--is-ancestor', request.cursor.pageToken, head,
        ]);
      } catch {
        failures.push(historyRewriteFailure(repository.id, request.cursor.pageToken, head, request.observedAt));
      }
    }
    const log = await this.#runner('git', [
      '-C', repository.path, 'log', `-n${this.options.maxCommits}`,
      '--format=%H%x1f%aI%x1f%an%x1f%s%x1e',
    ]);
    const commits = parseCommits(log.stdout);
    const occurredAt = commits[0]?.authoredAt ?? request.observedAt;
    const statusDigest = createHash('sha256').update(status.stdout).digest('hex').slice(0, 16);
    const captures: NormalizedCapture[] = [{
      event: stableConnectorEvent({
        source: 'git',
        sourceEventId: `${repository.id}:snapshot:${head}:${statusDigest}`,
        type: 'git.repository.snapshot',
        occurredAt,
        payload: {
          repositoryId: repository.id,
          branch: branch.branch,
          head,
          upstream: branch.upstream ?? null,
          dirty: status.stdout.split('\n').some((line) => line && !line.startsWith('# ')),
        },
      }),
      identities: [{
        connectorId: 'git', namespace: 'repository', externalId: repository.id,
        entityType: EntityType.Repository, displayName: repository.id,
        attributes: { path: repository.path }, observedAt: occurredAt,
        confidence: 1, evidenceEventId: `git:${head}`,
      }],
      relations: [],
    }];
    for (const commit of commits) captures.push(commitCapture(repository.id, commit));
    return {
      captures,
      failures,
      progress: {
        epoch: request.cursor?.epoch ?? 1,
        sequence: (request.cursor?.sequence ?? 0) + captures.length,
        pageToken: head,
      },
      hasMore: false,
    };
  }
}

async function defaultGitRunner(
  file: string,
  args: string[],
  options?: { cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(file, args, {
    ...(options?.cwd ? { cwd: options.cwd } : {}),
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
}

function parseBranchStatus(output: string) {
  const value = (prefix: string) => output.split('\n').find((line) => line.startsWith(prefix))?.slice(prefix.length);
  return {
    headSha: value('# branch.oid ') ?? '',
    branch: value('# branch.head ') ?? 'detached',
    upstream: value('# branch.upstream '),
  };
}

function parseCommits(output: string) {
  return output.split('\x1e').map((record) => record.trim()).filter(Boolean).map((record) => {
    const [sha, authoredAt, author, subject] = record.split('\x1f');
    return { sha, authoredAt, author, subject };
  });
}

function commitCapture(
  repositoryId: string,
  commit: { sha: string; authoredAt: string; author: string; subject: string },
): NormalizedCapture {
  const event = stableConnectorEvent({
    source: 'git', sourceEventId: `${repositoryId}:commit:${commit.sha}`,
    type: 'git.commit', occurredAt: commit.authoredAt,
    payload: { repositoryId, sha: commit.sha, author: commit.author, subject: commit.subject },
  });
  return {
    event,
    identities: [
      {
        connectorId: 'git', namespace: 'repository', externalId: repositoryId,
        entityType: EntityType.Repository, displayName: repositoryId, attributes: {},
        observedAt: commit.authoredAt, confidence: 1, evidenceEventId: event.id,
      },
      {
        connectorId: 'git', namespace: 'commit', externalId: commit.sha,
        entityType: EntityType.Artifact, displayName: commit.subject, attributes: {},
        observedAt: commit.authoredAt, confidence: 1, evidenceEventId: event.id,
      },
    ],
    relations: [{
      from: { connectorId: 'git', namespace: 'commit', externalId: commit.sha },
      to: { connectorId: 'git', namespace: 'repository', externalId: repositoryId },
      type: RelationType.MemberOf, attributes: {}, observedAt: commit.authoredAt,
      evidenceEventId: event.id,
    }],
  };
}

function historyRewriteFailure(
  repositoryId: string,
  previousHead: string,
  currentHead: string,
  occurredAt: string,
): CaptureFailure {
  return {
    id: `git-history-review-${randomUUID()}`,
    connectorId: 'git', capability: ConnectorCapability.Capture,
    kind: CaptureFailureKind.ContradictoryHistory,
    message: `Repository ${repositoryId} HEAD is not a descendant of the recorded cursor`,
    retryable: false, status: LifecycleStatus.PendingApproval,
    route: RouteType.HumanApproval, risk: RiskLevel.High,
    details: { repositoryId, previousHead, currentHead }, occurredAt,
    provenance: [{ source: 'git', sourceType: SourceType.Connector, observedAt: occurredAt }],
  };
}
