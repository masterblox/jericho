import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AgentLane,
  LifecycleStatus,
  MissionTaskKind,
  MutationClass,
  RiskLevel,
  RouteType,
  SourceType,
  type Assignment,
  type MissionPermissions,
  type MissionPlan,
  type MissionTask,
} from '@jericho/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { JerichoStore } from '../src/core/store.js';
import {
  HermesFilesystemExecutor,
  HermesResultVerifier,
  inspectHermesProtocol,
} from '../src/orchestration/hermes-filesystem-executor.js';
import type { AssignmentExecutionContext } from '../src/orchestration/runner.js';

const KEY = Buffer.alloc(32, 47);
const T0 = '2026-07-11T00:00:00.000Z';
const roots: string[] = [];
const stores: JerichoStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Hermes filesystem execution adapter', () => {
  it('fails closed when the operator has no fresh v1 capability manifest', () => {
    const { busRoot, store } = setupBus({ manifest: false });

    expect(inspectHermesProtocol(busRoot, T0)).toMatchObject({
      compatible: false,
      reason: 'missing_manifest',
    });
    expect(() => executorFor(busRoot, store)).toThrow(/capability manifest|protocol.*unavailable/i);
  });

  it('rejects a stale operator capability handshake', () => {
    const { busRoot, store } = setupBus({ manifest: false });
    writeProtocolManifest(busRoot, {
      generated_at: '2026-07-10T23:00:00.000Z',
      expires_at: '2026-07-10T23:30:00.000Z',
    });

    expect(inspectHermesProtocol(busRoot, T0)).toMatchObject({
      compatible: false,
      reason: 'stale_manifest',
      protocolVersion: 1,
    });
    expect(() => executorFor(busRoot, store)).toThrow(/stale|protocol.*unavailable/i);
  });

  it('accepts only a fresh manifest declaring every bounded v1 capability', () => {
    const { busRoot } = setupBus();

    expect(inspectHermesProtocol(busRoot, T0)).toEqual({
      compatible: true,
      reason: 'compatible',
      protocolVersion: 1,
      operatorId: 'hermes-jericho-operator',
      operatorVersion: '1.0.0',
      capabilities: [
        'bounded_stop',
        'idempotent_dispatch',
        'independent_verification_evidence',
        'metered_cost_evidence',
        'structured_artifacts',
      ],
      generatedAt: T0,
      expiresAt: '2026-07-11T00:10:00.000Z',
    });
  });

  it('emits one bounded task and retains the matching successful result', async () => {
    const { busRoot, store } = setupBus();
    const context = executionContext();
    const executor = new HermesFilesystemExecutor({
      busRoot,
      store,
      workspace: { repo: 'jericho', branch: 'masterblox/approved' },
      pollIntervalMs: 5,
      maxWaitMs: 1_000,
      now: () => T0,
    });
    const execution = executor.execute(context);

    const taskFile = await waitForTask(busRoot);
    const task = JSON.parse(readFileSync(taskFile, 'utf8'));
    expect(task).toMatchObject({
      source: 'jericho',
      action: 'prompt',
      message: expect.stringContaining('Execute approved mission task "Execute approved work".'),
      created_at: T0,
      workspace: { repo: 'jericho', branch: 'masterblox/approved' },
      priority: 'normal',
      on_blocked: 'write_inbox',
      jericho: {
        protocol_version: 1,
        mission_id: 'mission-1',
        mission_task_id: 'task-1',
        assignment_id: 'assignment-1',
        idempotency_key: 'assignment-key-1',
        evidence_event_ids: ['evidence-approved'],
        approved: {
          actions: ['work.execute'],
          tools: ['conductor.workspace'],
          writable_scope: permissions(),
          expected_artifact: context.assignment.expectedArtifact,
        },
      },
    });
    expect(task.id).toMatch(/^jericho-[a-f0-9]{32}$/);

    writeResult(busRoot, task.id, {
      task_id: task.id,
      completed_at: T0,
      status: 'success',
      summary: 'Verified work completed.',
      error: null,
      artifact: { type: 'report', data: { complete: true } },
      verification: {
        checks: ['hermes-result-valid'],
        evidence: ['hermes-result'],
      },
      costs: [{
        category: 'other', estimated_micro_usd: 100, actual_micro_usd: 0,
        evidence: ['operator-meter:no-charge'],
      }],
    });

    await expect(execution).resolves.toEqual({
      artifact: { type: 'report', data: { complete: true } },
      costs: [{
        id: expect.stringMatching(/^hermes-cost-[a-f0-9]{32}$/),
        category: 'other',
        estimatedMicroUsd: 100,
        actualMicroUsd: 0,
        idempotencyKey: expect.stringMatching(/^hermes-cost-key-[a-f0-9]{32}$/),
      }],
    });
    expect(store.listEvents({ source: 'hermes-filesystem' })).toMatchObject([
      {
        sourceType: SourceType.Agent,
        sourceEventId: task.id,
        type: 'hermes.assignment_result',
        payload: {
          assignmentId: 'assignment-1',
          missionId: 'mission-1',
          missionTaskId: 'task-1',
          taskId: task.id,
          status: 'success',
          summary: 'Verified work completed.',
          error: null,
          artifact: { type: 'report', data: { complete: true } },
          verification: {
            checks: ['hermes-result-valid'],
            evidence: ['hermes-result'],
          },
        },
      },
    ]);
  });

  it('independently verifies the stored task result and cites its event', async () => {
    const { busRoot, store } = setupBus();
    const context = executionContext();
    const executor = executorFor(busRoot, store);
    const execution = executor.execute(context);
    const taskFile = await waitForTask(busRoot);
    const task = JSON.parse(readFileSync(taskFile, 'utf8'));
    writeResult(busRoot, task.id, successfulResult(task.id));
    const executed = await execution;
    const [event] = store.listEvents({ source: 'hermes-filesystem' });

    const verification = await new HermesResultVerifier(store).verify({
      ...context,
      artifact: executed.artifact,
      requirement: context.assignment.expectedArtifact,
    });

    expect(verification).toEqual({
      verified: true,
      checks: ['hermes-result-valid'],
      evidence: [{ eventId: event!.id, selector: 'hermes-result' }],
    });
  });

  it('returns assignment-bound metered model cost evidence for runner budget enforcement', async () => {
    const { busRoot, store } = setupBus();
    const context = executionContext();
    const execution = executorFor(busRoot, store).execute(context);
    const taskFile = await waitForTask(busRoot);
    const task = JSON.parse(readFileSync(taskFile, 'utf8'));
    writeResult(busRoot, task.id, successfulResult(task.id, {
      costs: [{
        category: 'model',
        estimated_micro_usd: context.assignment.estimatedCostMicroUsd,
        actual_micro_usd: 83,
        provider: 'local-runtime',
        model: context.task.model,
        evidence: ['operator-meter:usage-1'],
      }],
    }));

    await expect(execution).resolves.toMatchObject({
      costs: [{
        id: expect.stringMatching(/^hermes-cost-[a-f0-9]{32}$/),
        idempotencyKey: expect.stringMatching(/^hermes-cost-key-[a-f0-9]{32}$/),
        category: 'model',
        estimatedMicroUsd: context.assignment.estimatedCostMicroUsd,
        actualMicroUsd: 83,
        provider: 'local-runtime',
        model: 'local',
      }],
    });
    expect(store.listEvents({ source: 'hermes-filesystem' })[0]?.payload).toMatchObject({
      costs: [expect.objectContaining({
        actual_micro_usd: 83,
        evidence: ['operator-meter:usage-1'],
      })],
    });
  });

  it('reuses the identical outbox task and retained event on assignment retry', async () => {
    const { busRoot, store } = setupBus();
    const executor = executorFor(busRoot, store);
    const context = executionContext();
    const firstExecution = executor.execute(context);
    const taskFile = await waitForTask(busRoot);
    const task = JSON.parse(readFileSync(taskFile, 'utf8'));
    writeResult(busRoot, task.id, successfulResult(task.id));
    await firstExecution;

    await expect(executor.execute(context)).resolves.toMatchObject({
      artifact: { type: 'report', data: { complete: true } },
    });
    expect(readdirSync(join(busRoot, 'outbox')).filter((name) => name.endsWith('.json'))).toEqual([
      `${task.id}.json`,
    ]);
    expect(store.listEvents({ source: 'hermes-filesystem' })).toHaveLength(1);
  });

  it('rejects reuse of an idempotency key for a different approved descriptor', async () => {
    const { busRoot, store } = setupBus();
    const executor = executorFor(busRoot, store);
    const firstExecution = executor.execute(executionContext());
    const taskFile = await waitForTask(busRoot);
    const task = JSON.parse(readFileSync(taskFile, 'utf8'));
    writeResult(busRoot, task.id, successfulResult(task.id));
    await firstExecution;

    const changed = executionContext({
      task: { requiredActions: ['work.execute', 'review.execute'] },
    });

    await expect(executor.execute(changed)).rejects.toThrow(/idempotency conflict/i);
  });

  it('refuses an outbox directory swapped to a symlink after construction', async () => {
    const { busRoot, store } = setupBus();
    const executor = executorFor(busRoot, store);
    const outside = join(roots[0]!, 'outside');
    mkdirSync(outside);
    rmSync(join(busRoot, 'outbox'), { recursive: true });
    symlinkSync(outside, join(busRoot, 'outbox'), 'dir');
    const controller = new AbortController();
    controller.abort();

    await expect(executor.execute(executionContext({ signal: controller.signal }))).rejects.toThrow(
      /symlink|real directory|escape/i,
    );
    expect(readdirSync(outside)).toEqual([]);
  });

  it.each([
    ['mismatched task', (result: ReturnType<typeof successfulResult>) => ({ ...result, task_id: 'wrong-task' })],
    ['mismatched artifact', (result: ReturnType<typeof successfulResult>) => ({
      ...result,
      artifact: { type: 'private-dump', data: { complete: true } },
    })],
    ['missing verification', (result: ReturnType<typeof successfulResult>) => ({
      ...result,
      verification: { checks: [], evidence: [] },
    })],
  ])('rejects a %s result before retaining it', async (_case, mutate) => {
    const { busRoot, store } = setupBus();
    const executor = executorFor(busRoot, store);
    const execution = executor.execute(executionContext());
    const taskFile = await waitForTask(busRoot);
    const task = JSON.parse(readFileSync(taskFile, 'utf8'));
    writeResult(busRoot, task.id, mutate(successfulResult(task.id)));

    await expect(execution).rejects.toThrow(/Hermes result|artifact|verification/i);
    expect(store.listEvents({ source: 'hermes-filesystem' })).toEqual([]);
  });

  it.each([
    ['blocked', null],
    ['error', 'Operator failed safely.'],
  ] as const)('retains a terminal %s result before surfacing it', async (status, error) => {
    const { busRoot, store } = setupBus();
    const executor = executorFor(busRoot, store);
    const execution = executor.execute(executionContext());
    const taskFile = await waitForTask(busRoot);
    const task = JSON.parse(readFileSync(taskFile, 'utf8'));
    writeResult(busRoot, task.id, {
      task_id: task.id,
      completed_at: T0,
      status,
      summary: `Task ${status}.`,
      error,
    });

    await expect(execution).rejects.toThrow(new RegExp(status, 'i'));
    expect(store.listEvents({ source: 'hermes-filesystem' })).toMatchObject([
      {
        sourceEventId: task.id,
        payload: { taskId: task.id, status, error },
      },
    ]);
  });

  it('keeps polling an in-progress result until the same task becomes terminal', async () => {
    const { busRoot, store } = setupBus();
    const executor = executorFor(busRoot, store);
    const execution = executor.execute(executionContext());
    const observed = execution.then(
      (result) => ({ kind: 'success' as const, result }),
      (error: unknown) => ({ kind: 'error' as const, error }),
    );
    const taskFile = await waitForTask(busRoot);
    const task = JSON.parse(readFileSync(taskFile, 'utf8'));
    writeResult(busRoot, task.id, {
      task_id: task.id,
      completed_at: T0,
      status: 'in_progress',
      summary: 'Operator is still working.',
      error: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.listEvents({ source: 'hermes-filesystem' })).toMatchObject([{
      type: 'hermes.legacy_result_checkpoint',
      status: LifecycleStatus.PendingApproval,
      route: RouteType.HumanApproval,
      payload: {
        taskId: task.id,
        status: 'in_progress',
        summary: 'Operator is still working.',
        verified: false,
      },
    }]);

    writeResult(busRoot, task.id, successfulResult(task.id));

    await expect(observed).resolves.toMatchObject({
      kind: 'success',
      result: { artifact: { type: 'report', data: { complete: true } } },
    });
  });

  it('retains a legacy success as an unverified checkpoint and never returns it as success', async () => {
    const { busRoot, store } = setupBus();
    const execution = executorFor(busRoot, store).execute(executionContext());
    const taskFile = await waitForTask(busRoot);
    const task = JSON.parse(readFileSync(taskFile, 'utf8'));
    writeResult(busRoot, task.id, {
      task_id: task.id,
      completed_at: T0,
      status: 'success',
      summary: 'Legacy operator says the task completed.',
      error: null,
    });

    await expect(execution).rejects.toThrow(/legacy.*unverified|unverified.*checkpoint/i);
    expect(store.listEvents({ source: 'hermes-filesystem' })).toMatchObject([{
      type: 'hermes.legacy_result_checkpoint',
      status: LifecycleStatus.PendingApproval,
      route: RouteType.HumanApproval,
      payload: {
        taskId: task.id,
        status: 'success',
        summary: 'Legacy operator says the task completed.',
        verified: false,
        artifact: null,
        verification: null,
      },
    }]);
    expect(store.listEvents({ source: 'hermes-filesystem' }))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ status: LifecycleStatus.Succeeded })]));
  });

  it('emits one deterministic bounded stop task when execution is aborted', async () => {
    const { busRoot, store } = setupBus();
    const controller = new AbortController();
    const context = executionContext({ signal: controller.signal });
    const executor = executorFor(busRoot, store);
    const execution = executor.execute(context);
    const promptFile = await waitForTask(busRoot);
    const prompt = JSON.parse(readFileSync(promptFile, 'utf8'));

    controller.abort(new DOMException('Carlos cancelled', 'AbortError'));

    await expect(execution).rejects.toMatchObject({ name: 'AbortError' });
    const tasks = readdirSync(join(busRoot, 'outbox'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(join(busRoot, 'outbox', name), 'utf8')));
    expect(tasks).toHaveLength(2);
    expect(tasks).toContainEqual(expect.objectContaining({
      id: `${prompt.id}-stop`,
      action: 'stop',
      source: 'jericho',
      workspace: { repo: 'jericho', branch: 'masterblox/approved' },
      priority: 'high',
      on_blocked: 'skip',
      jericho: {
        protocol_version: 1,
        parent_task_id: prompt.id,
        assignment_id: 'assignment-1',
        mission_id: 'mission-1',
        mission_task_id: 'task-1',
      },
    }));
  });

  it('rejects recursive worker expansion before emitting a task', async () => {
    const { busRoot, store } = setupBus();
    const controller = new AbortController();
    controller.abort();
    const context = executionContext({
      signal: controller.signal,
      task: { requiredActions: ['work.execute', 'spawn.unrestricted'] },
    });

    await expect(executorFor(busRoot, store).execute(context)).rejects.toThrow(/spawn|recursive/i);
    expect(readdirSync(join(busRoot, 'outbox'))).toEqual([]);
  });

  it('rejects external actions before dispatch because v1 has no destination receipt contract', async () => {
    const { busRoot, store } = setupBus();
    const externalAction = {
      connectorId: 'telegram',
      action: 'send',
      destination: 'chat-1',
      idempotencyKey: 'send-1',
      mutationClass: MutationClass.Reversible,
    };
    const context = executionContext({
      assignment: { externalAction },
      task: { externalAction },
    });

    await expect(executorFor(busRoot, store).execute(context)).rejects.toThrow(
      /external action.*receipt|receipt.*unsupported/i,
    );
    expect(readdirSync(join(busRoot, 'outbox'))).toEqual([]);
  });

  it('never serializes nested private inputs, raw payloads, or secrets', async () => {
    const { busRoot, store } = setupBus();
    const controller = new AbortController();
    const secret = 'PRIVATE-SENTINEL-DO-NOT-EMIT';
    const context = executionContext({
      signal: controller.signal,
      assignment: {
        instructions: { rawPayload: { authorization: secret }, transcript: secret },
      },
      task: {
        description: secret,
        input: { private: { nested: [{ secret }] } },
      },
      mission: {
        title: secret,
        objective: secret,
      },
    });
    const execution = executorFor(busRoot, store).execute(context);
    const promptFile = await waitForTask(busRoot);
    const serialized = readFileSync(promptFile, 'utf8');

    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('rawPayload');
    expect(serialized).not.toContain('transcript');
    expect(serialized).not.toContain('"input"');
    expect(serialized).not.toContain('"instructions"');

    controller.abort();
    await expect(execution).rejects.toMatchObject({ name: 'AbortError' });
  });
});

function setupBus(options: { manifest?: boolean } = {}): { busRoot: string; store: JerichoStore } {
  const root = mkdtempSync(join(tmpdir(), 'jericho-hermes-'));
  roots.push(root);
  const busRoot = join(root, 'bus');
  mkdirSync(join(busRoot, 'outbox'), { recursive: true });
  mkdirSync(join(busRoot, 'inbox'));
  if (options.manifest !== false) writeProtocolManifest(busRoot);
  const store = new JerichoStore({ path: ':memory:', key: KEY });
  stores.push(store);
  return { busRoot, store };
}

function executorFor(busRoot: string, store: JerichoStore): HermesFilesystemExecutor {
  return new HermesFilesystemExecutor({
    busRoot,
    store,
    workspace: { repo: 'jericho', branch: 'masterblox/approved' },
    pollIntervalMs: 5,
    maxWaitMs: 1_000,
    now: () => T0,
  });
}

function writeProtocolManifest(
  busRoot: string,
  overrides: Record<string, unknown> = {},
): void {
  writeFileSync(join(busRoot, 'jericho-operator-capabilities.json'), JSON.stringify({
    protocol_version: 1,
    operator_id: 'hermes-jericho-operator',
    operator_version: '1.0.0',
    generated_at: T0,
    expires_at: '2026-07-11T00:10:00.000Z',
    capabilities: [
      'structured_artifacts',
      'independent_verification_evidence',
      'metered_cost_evidence',
      'bounded_stop',
      'idempotent_dispatch',
    ],
    ...overrides,
  }));
}

function executionContext(overrides: {
  assignment?: Partial<Assignment>;
  task?: Partial<MissionTask>;
  mission?: Partial<MissionPlan>;
  signal?: AbortSignal;
} = {}): AssignmentExecutionContext {
  const writableScope = permissions();
  const expectedArtifact = {
    type: 'report',
    description: 'Verified report',
    verification: ['hermes-result-valid'],
    requiredEvidence: ['hermes-result'],
  };
  const task: MissionTask = {
    id: 'task-1', missionId: 'mission-1', kind: MissionTaskKind.Execute,
    title: 'Execute approved work', status: LifecycleStatus.Queued,
    route: RouteType.Agent, risk: RiskLevel.Low, sequence: 0,
    lane: AgentLane.Dev, selectedAgentId: 'dev-agent', capabilityIds: ['cap-dev'],
    requiredActions: ['work.execute'], requiredTools: ['conductor.workspace'],
    model: 'local', maxTokens: 2_000, writableScope,
    requiredCapabilities: ['cap-dev'], dependsOn: [],
    evidenceEventIds: ['evidence-approved'], expectedArtifact,
    estimatedCostMicroUsd: 100, input: {}, provenance: provenance(),
    createdAt: T0, updatedAt: T0,
    ...overrides.task,
  };
  const assignment: Assignment = {
    id: 'assignment-1', missionId: 'mission-1', missionTaskId: task.id,
    agentId: 'dev-agent', capabilityIds: ['cap-dev'], status: LifecycleStatus.Active,
    route: RouteType.Agent, risk: RiskLevel.Low, instructions: {},
    evidenceEventIds: ['evidence-approved'], expectedArtifact,
    idempotencyKey: 'assignment-key-1', attempt: 1, maxAttempts: 2,
    availableAt: T0, estimatedCostMicroUsd: 100, assignedAt: T0,
    provenance: provenance(), ...overrides.assignment,
  };
  const mission: MissionPlan = {
    id: 'mission-1', seriesId: 'series-1', version: 1, intentId: 'intent-1',
    title: 'Approved mission', objective: 'Complete approved work',
    status: LifecycleStatus.Active, route: RouteType.Agent, risk: RiskLevel.Low,
    deliverables: [], acceptanceTests: [], evidenceEventIds: ['mission-evidence'],
    contextSnapshotHash: 'a'.repeat(64), taskGraph: [], selectedAgents: [],
    budget: { maxCostMicroUsd: 1_000, maxRuntimeMs: 60_000, maxConcurrency: 1, maxRetriesPerAssignment: 1 },
    permissions: writableScope,
    rollback: { strategy: 'revert', steps: ['Revert'], verification: 'Verify' },
    escalationConditions: [], planHash: 'b'.repeat(64), approvedAt: T0,
    provenance: provenance(), createdAt: T0, updatedAt: T0,
    ...overrides.mission,
  };
  return {
    assignment,
    task,
    mission,
    signal: overrides.signal ?? new AbortController().signal,
  };
}

function permissions(): MissionPermissions {
  return {
    allowedTools: ['conductor.workspace'],
    allowedSystems: ['conductor'],
    allowedRepositories: [{
      repository: 'jericho',
      writablePaths: ['apps/jericho'],
      mutationClasses: [MutationClass.Reversible],
    }],
    allowedChannels: [], allowedRecipients: [], allowedCredentialRefs: [],
    allowedDataScopes: ['mission:selected'],
    allowedMutationClasses: [MutationClass.ReadOnly, MutationClass.Reversible],
  };
}

function provenance() {
  return [{ source: 'test', sourceType: SourceType.System, observedAt: T0 }];
}

async function waitForTask(busRoot: string): Promise<string> {
  const outbox = join(busRoot, 'outbox');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [name] = readdirSync(outbox).filter((item) => item.endsWith('.json'));
    if (name) return join(outbox, name);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for Hermes task');
}

function writeResult(busRoot: string, taskId: string, result: unknown): void {
  writeFileSync(join(busRoot, 'inbox', `${taskId}.json`), JSON.stringify(result));
}

function successfulResult(taskId: string, overrides: Record<string, unknown> = {}) {
  return {
    task_id: taskId,
    completed_at: T0,
    status: 'success',
    summary: 'Verified work completed.',
    error: null,
    artifact: { type: 'report', data: { complete: true } },
    verification: {
      checks: ['hermes-result-valid'],
      evidence: ['hermes-result'],
    },
    costs: [{
      category: 'other', estimated_micro_usd: 100, actual_micro_usd: 0,
      evidence: ['operator-meter:no-charge'],
    }],
    ...overrides,
  };
}
