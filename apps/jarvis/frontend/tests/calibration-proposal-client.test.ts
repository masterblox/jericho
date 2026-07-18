import { describe, expect, it, vi } from 'vitest';
import { CalibrationProposalClient } from '../src/calibration-proposal-client';

describe('CalibrationProposalClient', () => {
  it('submits a valid request with correct headers and credentials', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        proposalId: 'prop-abc-123',
        status: 'pending_review',
        createdAt: '2026-07-18T00:00:00Z',
        replayed: false,
      }),
    });

    const client = new CalibrationProposalClient('/api/v1/calibration/fix-proposals', mockFetch);
    const response = await client.submitCalibrationFixProposal(
      {
        schemaVersion: 1,
        sessionId: 'cal-1-12345',
        buildSha: 'a1b2c3d',
        failedPhase: 'room',
        failureReason: 'excessive_ambient_noise',
        aggregateMetrics: {},
      },
      'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    );

    expect(response.proposalId).toBe('prop-abc-123');
    expect(response.status).toBe('pending_review');
    expect(response.replayed).toBe(false);

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/calibration/fix-proposals',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Idempotency-Key': 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        }),
      }),
    );
  });

  it('rejects invalid schema version', async () => {
    const client = new CalibrationProposalClient('/api', vi.fn());
    await expect(client.submitCalibrationFixProposal(
      { schemaVersion: 2 as any, sessionId: 'x', buildSha: 'a1b2c3d', failedPhase: 'room', failureReason: 'mic_denied', aggregateMetrics: {} },
      'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    )).rejects.toThrow('Invalid schema version');
  });

  it('rejects invalid idempotency key', async () => {
    const client = new CalibrationProposalClient('/api', vi.fn());
    await expect(client.submitCalibrationFixProposal(
      { schemaVersion: 1, sessionId: 'x', buildSha: 'a1b2c3d', failedPhase: 'room', failureReason: 'mic_denied', aggregateMetrics: {} },
      'short',
    )).rejects.toThrow('Invalid idempotency key');
  });

  it('handles 409 conflict', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 409 });
    const client = new CalibrationProposalClient('/api', mockFetch);
    await expect(client.submitCalibrationFixProposal(
      { schemaVersion: 1, sessionId: 'x', buildSha: 'a1b2c3d', failedPhase: 'room', failureReason: 'mic_denied', aggregateMetrics: {} },
      'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    )).rejects.toThrow('Idempotency conflict');
  });

  it('handles 503 unavailable', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const client = new CalibrationProposalClient('/api', mockFetch);
    await expect(client.submitCalibrationFixProposal(
      { schemaVersion: 1, sessionId: 'x', buildSha: 'a1b2c3d', failedPhase: 'room', failureReason: 'mic_denied', aggregateMetrics: {} },
      'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    )).rejects.toThrow('Core persistence unavailable');
  });
});
