import {
  assertCalibrationFixProposalRequest,
  type CalibrationFixProposalRequest,
  type CalibrationFixProposalResponse,
} from '@jericho/shared';

export type { CalibrationFixProposalRequest, CalibrationFixProposalResponse } from '@jericho/shared';

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
  assertCalibrationFixProposalRequest(request);
  if (idempotencyKey.length !== 64 || !/^[a-f0-9]{64}$/.test(idempotencyKey)) {
    throw new Error('Invalid idempotency key');
  }
}

function validResponse(body: unknown): body is CalibrationFixProposalResponse {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const b = body as Record<string, unknown>;
  const keys = Object.keys(b).sort();
  if (keys.join(',') !== ['createdAt', 'proposalId', 'replayed', 'status'].sort().join(',')) return false;
  return (
    typeof b.proposalId === 'string' && Boolean(b.proposalId.trim()) && b.proposalId.length <= 1024 &&
    b.status === 'pending_review' &&
    typeof b.createdAt === 'string' && Number.isFinite(Date.parse(b.createdAt)) &&
    typeof b.replayed === 'boolean'
  );
}
