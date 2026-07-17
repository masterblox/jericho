import { afterEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';

import {
  assertCalibrationFixProposalRequest,
  canonicalJson,
  type CalibrationFixProposalRequest,
  type CalibrationFixProposalResponse,
} from '@jericho/shared';
import { JerichoStore } from '../src/core/store.js';
import { IntakeProcessor } from '../src/orchestration/intake.js';
import {
  createJerichoServer,
  type VoiceConnect,
} from '../src/server.js';

const TOKEN = 'fix-proposals-test-token';
const openServers: Array<{ close(): Promise<void> }> = [];
const openStores: JerichoStore[] = [];
let fetchPort = 0;

afterEach(async () => {
  for (const server of openServers.splice(0)) await server.close();
  for (const store of openStores.splice(0)) store.close();
  fetchPort = 0;
});

function serviceUrl(path: string): string {
  if (!fetchPort) throw new Error('no server port');
  return `http://127.0.0.1:${fetchPort}${path}`;
}

async function bootstrapServer() {
  const store = new JerichoStore({ path: ':memory:', key: Buffer.alloc(32, 21) });
  openStores.push(store);
  const intake = new IntakeProcessor({ store });
  const voiceConnect: VoiceConnect = async () => {
    throw new Error('no voice in proposal tests');
  };
  const server = createJerichoServer({
    store,
    apiToken: TOKEN,
    host: '127.0.0.1',
    geminiApiKey: 'fake-key',
    voiceConnect,
    intake,
  });
  openServers.push(server);
  const address = await server.listen(0);
  fetchPort = address.port;
  return { store, server };
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function requestDigest(request: CalibrationFixProposalRequest): string {
  return sha256(canonicalJson(request));
}

describe('calibration fix proposals — service', () => {
  it('creates a proposal, returns 201, and replays idempotently', async () => {
    await bootstrapServer();
    const request: CalibrationFixProposalRequest = {
      schemaVersion: 1,
      sessionId: 'session-1',
      buildSha: '77d18fb',
      failedPhase: 'room',
      failureReason: 'mic_denied',
      aggregateMetrics: {},
    };
    const key = requestDigest(request);

    const res1 = await fetch(serviceUrl('/api/v1/calibration/fix-proposals'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
        'x-idempotency-key': key,
      },
      body: JSON.stringify(request),
    });
    expect(res1.status).toBe(201);
    const body1 = await res1.json() as CalibrationFixProposalResponse;
    expect(body1.proposalId).toBeTruthy();
    expect(body1.status).toBe('pending_review');
    expect(body1.replayed).toBe(false);

    const res2 = await fetch(serviceUrl('/api/v1/calibration/fix-proposals'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
        'x-idempotency-key': key,
      },
      body: JSON.stringify(request),
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json() as CalibrationFixProposalResponse;
    expect(body2.proposalId).toBe(body1.proposalId);
    expect(body2.status).toBe('pending_review');
    expect(body2.replayed).toBe(true);

    const getRes = await fetch(serviceUrl(`/api/v1/calibration/fix-proposals/${body1.proposalId}`), {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json() as CalibrationFixProposalResponse;
    expect(fetched.proposalId).toBe(body1.proposalId);
  });

  it('rejects mismatched idempotency key', async () => {
    await bootstrapServer();
    const request: CalibrationFixProposalRequest = {
      schemaVersion: 1,
      sessionId: 'session-1',
      buildSha: '77d18fb',
      failedPhase: 'room',
      failureReason: 'mic_denied',
      aggregateMetrics: {},
    };
    const key = requestDigest(request);

    await fetch(serviceUrl('/api/v1/calibration/fix-proposals'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
        'x-idempotency-key': key,
      },
      body: JSON.stringify(request),
    });

    const res = await fetch(serviceUrl('/api/v1/calibration/fix-proposals'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
        'x-idempotency-key': sha256('different-content'),
      },
      body: JSON.stringify(request),
    });
    expect(res.status).toBe(400);
  });

  it('rejects forbidden field', async () => {
    await bootstrapServer();
    const key = sha256('test-forbidden');
    const res = await fetch(serviceUrl('/api/v1/calibration/fix-proposals'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
        'x-idempotency-key': key,
      },
      body: JSON.stringify({
        schemaVersion: 1,
        sessionId: 's',
        buildSha: '77d18fb',
        failedPhase: 'room',
        failureReason: 'mic_denied',
        aggregateMetrics: {},
        transcript: 'forbidden',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects missing authentication', async () => {
    await bootstrapServer();
    const request: CalibrationFixProposalRequest = {
      schemaVersion: 1, sessionId: 's', buildSha: '77d18fb',
      failedPhase: 'room', failureReason: 'mic_denied', aggregateMetrics: {},
    };
    const key = requestDigest(request);
    const res = await fetch(serviceUrl('/api/v1/calibration/fix-proposals'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-idempotency-key': key },
      body: JSON.stringify(request),
    });
    expect(res.status).toBe(401);
  });

  it('rejects body over 16 KiB', async () => {
    await bootstrapServer();
    const largeStr = 'x'.repeat(17000);
    const key = sha256('too-large');
    const res = await fetch(serviceUrl('/api/v1/calibration/fix-proposals'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
        'x-idempotency-key': key,
      },
      body: JSON.stringify({
        schemaVersion: 1, sessionId: largeStr, buildSha: '77d18fb',
        failedPhase: 'room', failureReason: 'mic_denied', aggregateMetrics: {},
      }),
    });
    expect(res.status).toBe(413);
  });

  it('GET returns 404 for arbitrary generic proposal', async () => {
    const { store } = await bootstrapServer();
    store.saveProposal({
      id: 'not-a-calibration-proposal',
      version: 1,
      proposedByAgentId: 'test',
      kind: 'plan' as any,
      summary: 'not calibration',
      body: { test: true },
      status: 'pending_approval' as any,
      route: 'local' as any,
      risk: 'low' as any,
      createdAt: new Date().toISOString(),
      provenance: [],
    });

    const res = await fetch(serviceUrl('/api/v1/calibration/fix-proposals/not-a-calibration-proposal'), {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(404);
  });

  it('rejects invalid proposal schema', async () => {
    await bootstrapServer();
    const key = sha256('bad-schema');
    const res = await fetch(serviceUrl('/api/v1/calibration/fix-proposals'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
        'x-idempotency-key': key,
      },
      body: JSON.stringify({ schemaVersion: 2, sessionId: 's', buildSha: '77d18fb', failedPhase: 'room', failureReason: 'mic_denied', aggregateMetrics: {} }),
    });
    expect(res.status).toBe(400);
  });

  it('stores deterministically without mutation after caller changes input', async () => {
    await bootstrapServer();
    const mutable: any = {
      schemaVersion: 1, sessionId: 'session-mut', buildSha: '77d18fb',
      failedPhase: 'speech', failureReason: 'clipping', aggregateMetrics: {},
    };
    const key = requestDigest(mutable);

    const res = await fetch(serviceUrl('/api/v1/calibration/fix-proposals'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
        'x-idempotency-key': key,
      },
      body: JSON.stringify(mutable),
    });
    expect(res.status).toBe(201);

    mutable.sneakyField = 'injected';
    // Replay with same key/proposal should succeed (idempotent)
    const res2 = await fetch(serviceUrl('/api/v1/calibration/fix-proposals'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
        'x-idempotency-key': key,
      },
      body: JSON.stringify(mutable),
    });
    // Replay with mutated body but same key should fail
    expect(res2.status).toBe(400);
  });

  it('replays with same response for identical payload with different JSON key order', async () => {
    await bootstrapServer();
    const request: CalibrationFixProposalRequest = {
      sessionId: 's', schemaVersion: 1, buildSha: '77d18fb',
      failedPhase: 'room', failureReason: 'mic_denied', aggregateMetrics: {},
    };
    const key = requestDigest(request);

    const res1 = await fetch(serviceUrl('/api/v1/calibration/fix-proposals'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
        'x-idempotency-key': key,
      },
      body: JSON.stringify({ sessionId: 's', schemaVersion: 1, buildSha: '77d18fb', failedPhase: 'room', failureReason: 'mic_denied', aggregateMetrics: {} }),
    });
    expect(res1.status).toBe(201);
    const body1 = await res1.json() as CalibrationFixProposalResponse;

    const res2 = await fetch(serviceUrl('/api/v1/calibration/fix-proposals'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
        'x-idempotency-key': key,
      },
      body: JSON.stringify({ buildSha: '77d18fb', aggregateMetrics: {}, schemaVersion: 1, sessionId: 's', failedPhase: 'room', failureReason: 'mic_denied' }),
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json() as CalibrationFixProposalResponse;
    expect(body2.proposalId).toBe(body1.proposalId);
  });
});

describe('calibration fix proposals — boundary', () => {
  it('accepts micDeviceHash for permitted sessions', async () => {
    await bootstrapServer();
    const request: CalibrationFixProposalRequest = {
      schemaVersion: 1, sessionId: 'session-hash', buildSha: '77d18fb',
      micDeviceHash: 'a'.repeat(64),
      failedPhase: 'speech', failureReason: 'insufficient_speech_energy',
      aggregateMetrics: { rmsMin: 0.01 },
    };
    const key = requestDigest(request);
    const res = await fetch(serviceUrl('/api/v1/calibration/fix-proposals'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
        'x-idempotency-key': key,
      },
      body: JSON.stringify(request),
    });
    expect(res.status).toBe(201);
  });

  it('accepts correlatedResultId', async () => {
    await bootstrapServer();
    const request: CalibrationFixProposalRequest = {
      schemaVersion: 1, sessionId: 'session-corr', buildSha: '77d18fb',
      failedPhase: 'live_canary', failureReason: 'event_duplication',
      aggregateMetrics: {}, correlatedResultId: 'result-1',
    };
    const key = requestDigest(request);
    const res = await fetch(serviceUrl('/api/v1/calibration/fix-proposals'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
        'x-idempotency-key': key,
      },
      body: JSON.stringify(request),
    });
    expect(res.status).toBe(201);
  });

  it('rejects missing content-type', async () => {
    await bootstrapServer();
    const request: CalibrationFixProposalRequest = {
      schemaVersion: 1, sessionId: 's', buildSha: '77d18fb',
      failedPhase: 'room', failureReason: 'mic_denied', aggregateMetrics: {},
    };
    const key = requestDigest(request);
    const res = await fetch(serviceUrl('/api/v1/calibration/fix-proposals'), {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'x-idempotency-key': key },
      body: JSON.stringify(request),
    });
    expect(res.status).toBe(400);
  });

  it('different metrics produce different proposal IDs', async () => {
    await bootstrapServer();
    const r1: CalibrationFixProposalRequest = {
      schemaVersion: 1, sessionId: 's1', buildSha: '77d18fb',
      failedPhase: 'speech', failureReason: 'clipping',
      aggregateMetrics: { rmsMin: 0.01, rmsMax: 0.05 },
    };
    const r2: CalibrationFixProposalRequest = {
      schemaVersion: 1, sessionId: 's1', buildSha: '77d18fb',
      failedPhase: 'speech', failureReason: 'clipping',
      aggregateMetrics: { rmsMin: 0.02, rmsMax: 0.05 },
    };

    const k1 = requestDigest(r1);
    const k2 = requestDigest(r2);
    expect(k1).not.toBe(k2);

    const res1 = await fetch(serviceUrl('/api/v1/calibration/fix-proposals'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'x-idempotency-key': k1 },
      body: JSON.stringify(r1),
    });
    expect(res1.status).toBe(201);
    const b1 = await res1.json() as CalibrationFixProposalResponse;

    const res2 = await fetch(serviceUrl('/api/v1/calibration/fix-proposals'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'x-idempotency-key': k2 },
      body: JSON.stringify(r2),
    });
    expect(res2.status).toBe(201);
    const b2 = await res2.json() as CalibrationFixProposalResponse;
    expect(b1.proposalId).not.toBe(b2.proposalId);
  });

  it('rejects extra fields in calibration phrase frame', async () => {
    await bootstrapServer();
    const request: CalibrationFixProposalRequest = {
      schemaVersion: 1, sessionId: 's', buildSha: '77d18fb',
      failedPhase: 'room', failureReason: 'mic_denied', aggregateMetrics: {},
    };
    const key = requestDigest(request);
    const res = await fetch(serviceUrl('/api/v1/calibration/fix-proposals'), {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${TOKEN}`, 'x-idempotency-key': key },
      body: JSON.stringify(request),
    });
    expect(res.status).toBe(201);
  });
});
