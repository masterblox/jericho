import type { CalibrationFailureReason, ActiveCalibrationPhase } from './calibration-events';

export interface CalibrationFixProposalRequest {
  schemaVersion: 1;
  sessionId: string;
  buildSha: string;
  micDeviceHash?: string;
  failedPhase: ActiveCalibrationPhase | 'review';
  failureReason: CalibrationFailureReason;
  aggregateMetrics: Partial<{
    durationMs: number;
    sampleCount: number;
    blockCount: number;
    rmsMin: number;
    rmsMax: number;
    rmsMean: number;
    rmsP95: number;
    peakMax: number;
    clipCount: number;
    clippedSampleFraction: number;
    sustainedEnergyFraction: number;
  }>;
  correlatedResultId?: string;
}

export interface CalibrationFixProposalResponse {
  proposalId: string;
  status: 'pending_review';
  createdAt: string;
  replayed: boolean;
}

/**
 * Single-endpoint proposal port with no CoreClient dependency.
 * Only exposes calibration fix-proposal submission.
 */
export class CalibrationProposalClient {
  constructor(
    private readonly baseUrl: string = '/api/v1/calibration/fix-proposals',
    private readonly fetch = globalThis.fetch.bind(globalThis),
  ) {}

  async submitCalibrationFixProposal(
    request: CalibrationFixProposalRequest,
    idempotencyKey: string,
  ): Promise<CalibrationFixProposalResponse> {
    validateRequest(request, idempotencyKey);

    const response = await this.fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencyKey,
      },
      credentials: 'same-origin',
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      if (response.status === 409) {
        throw new Error('Idempotency conflict: different content for same key');
      }
      if (response.status === 413) {
        throw new Error('Request body exceeds 16 KiB limit');
      }
      if (response.status === 401) {
        throw new Error('Authentication required');
      }
      if (response.status === 503) {
        throw new Error('Core persistence unavailable');
      }
      throw new Error(`Proposal submission failed: ${response.status}`);
    }

    const body = (await response.json()) as CalibrationFixProposalResponse;
    if (!validResponse(body)) {
      throw new Error('Invalid proposal response');
    }

    return body;
  }
}

function validateRequest(request: CalibrationFixProposalRequest, idempotencyKey: string): void {
  if (request.schemaVersion !== 1) throw new Error('Invalid schema version');
  if (typeof request.sessionId !== 'string' || request.sessionId.length === 0 || request.sessionId.length > 128) {
    throw new Error('Invalid session ID');
  }
  if (typeof request.buildSha !== 'string' || request.buildSha.length < 7 || request.buildSha.length > 40) {
    throw new Error('Invalid build SHA');
  }
  if (typeof request.failedPhase !== 'string') throw new Error('Invalid failed phase');
  if (typeof request.failureReason !== 'string') throw new Error('Invalid failure reason');
  if (request.micDeviceHash !== undefined && (typeof request.micDeviceHash !== 'string' || request.micDeviceHash.length !== 64)) {
    throw new Error('Invalid microphone device hash');
  }
  if (request.correlatedResultId !== undefined && (typeof request.correlatedResultId !== 'string' || request.correlatedResultId.length > 1024)) {
    throw new Error('Invalid correlated result ID');
  }
  if (idempotencyKey.length !== 64 || !/^[a-f0-9]{64}$/.test(idempotencyKey)) {
    throw new Error('Invalid idempotency key');
  }
}

function validResponse(body: unknown): body is CalibrationFixProposalResponse {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.proposalId === 'string' &&
    b.status === 'pending_review' &&
    typeof b.createdAt === 'string' &&
    typeof b.replayed === 'boolean'
  );
}
