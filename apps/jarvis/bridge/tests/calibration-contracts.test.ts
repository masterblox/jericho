import { describe, expect, it } from 'vitest';

import {
  assertCalibrationFixProposalRequest,
  assertGroundedTurnProgressEvent,
  CALIBRATION_FAILURE_REASONS,
  CALIBRATION_PHRASES,
  type CalibrationFixProposalRequest,
  type CalibrationFailureReason,
  type CalibrationPhraseId,
  type CalibrationPhase,
  type GroundedTurnMilestone,
  type GroundedTurnProgressEvent,
} from '@jericho/shared';

describe('CALIBRATION_PHRASES', () => {
  it('accepts only known phrase IDs', () => {
    expect(Object.keys(CALIBRATION_PHRASES)).toEqual([
      'voice_range_1', 'voice_range_2', 'voice_range_3',
    ]);
  });

  it('maps each phrase ID to a non-empty text', () => {
    for (const [id, text] of Object.entries(CALIBRATION_PHRASES)) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      expect(typeof text).toBe('string');
      expect((text as string).trim().length).toBeGreaterThan(0);
    }
  });
});

describe('CalibrationFailureReason', () => {
  it('contains exactly the 14 specified reasons', () => {
    expect(CALIBRATION_FAILURE_REASONS).toEqual([
      'mic_denied',
      'device_lost',
      'speaker_unavailable',
      'excessive_ambient_noise',
      'clipping',
      'insufficient_speech_energy',
      'invalid_clap',
      'gemini_connection_failed',
      'memory_unavailable',
      'event_duplication',
      'event_mismatch',
      'phase_timeout',
      'decision_scope_conflict',
      'profile_write_failed',
    ]);
  });

  it('exports a union type for each reason', () => {
    const valid: CalibrationFailureReason[] = [
      'mic_denied', 'device_lost', 'speaker_unavailable',
      'excessive_ambient_noise', 'clipping', 'insufficient_speech_energy',
      'invalid_clap', 'gemini_connection_failed', 'memory_unavailable',
      'event_duplication', 'event_mismatch', 'phase_timeout',
      'decision_scope_conflict', 'profile_write_failed',
    ];
    expect(valid).toHaveLength(14);
  });
});

describe('CalibrationPhase', () => {
  it('accepts idle, active phases, review, saved, failed', () => {
    const phases: CalibrationPhase[] = [
      'idle', 'room', 'speech', 'clap', 'live_canary', 'review', 'saved', 'failed',
    ];
    expect(phases).toHaveLength(8);
  });
});

describe('GroundedTurnMilestone', () => {
  it('has exactly three milestones', () => {
    const milestones: GroundedTurnMilestone[] = [
      'capture_committed', 'retrieval_started', 'terminal_result_sent',
    ];
    expect(milestones).toHaveLength(3);
  });
});

describe('assertGroundedTurnProgressEvent', () => {
  it('accepts a valid progress event', () => {
    expect(() => assertGroundedTurnProgressEvent({
      turnId: 'turn-1',
      milestone: 'capture_committed',
      captureId: 'cap-1',
    })).not.toThrow();
  });

  it('accepts terminal_result_sent with resultId', () => {
    expect(() => assertGroundedTurnProgressEvent({
      turnId: 'turn-1',
      milestone: 'terminal_result_sent',
      resultId: 'result-1',
    })).not.toThrow();
  });

  it('rejects missing turnId', () => {
    expect(() => assertGroundedTurnProgressEvent({
      milestone: 'capture_committed',
    })).toThrow();
  });

  it('rejects unknown milestone', () => {
    expect(() => assertGroundedTurnProgressEvent({
      turnId: 'turn-1',
      milestone: 'greeting_started',
    })).toThrow();
  });

  it('rejects unknown field', () => {
    expect(() => assertGroundedTurnProgressEvent({
      turnId: 'turn-1',
      milestone: 'capture_committed',
      transcript: 'sensitive',
    })).toThrow();
  });

  it('rejects whitespace-only turnId', () => {
    expect(() => assertGroundedTurnProgressEvent({
      turnId: '   ',
      milestone: 'capture_committed',
    })).toThrow();
  });

  it('rejects empty milestone', () => {
    expect(() => assertGroundedTurnProgressEvent({
      turnId: 'turn-1',
      milestone: '',
    })).toThrow();
  });
});

describe('assertCalibrationFixProposalRequest', () => {
  const validRequest: CalibrationFixProposalRequest = {
    schemaVersion: 1,
    sessionId: 'session-1',
    buildSha: '77d18fb',
    failedPhase: 'room',
    failureReason: 'mic_denied',
    aggregateMetrics: {},
  };

  it('accepts the bounded mic-denied request without a device hash', () => {
    expect(() => assertCalibrationFixProposalRequest(validRequest)).not.toThrow();
  });

  it('accepts request with micDeviceHash and correlatedResultId', () => {
    expect(() => assertCalibrationFixProposalRequest({
      ...validRequest,
      micDeviceHash: 'a'.repeat(64),
      correlatedResultId: 'result-1',
    })).not.toThrow();
  });

  it('accepts review failedPhase', () => {
    expect(() => assertCalibrationFixProposalRequest({
      ...validRequest,
      failedPhase: 'review',
      failureReason: 'decision_scope_conflict',
    })).not.toThrow();
  });

  it.each(['rawAudio', 'transcript', 'excerpt', 'path', 'command', 'claim', 'entityId', 'repositoryGrant', 'writableScope', 'gitInstruction'])(
    'rejects forbidden field %s',
    (field) => {
      expect(() => assertCalibrationFixProposalRequest({
        ...validRequest,
        [field]: 'forbidden',
      })).toThrow();
    },
  );

  it('rejects unknown keys', () => {
    expect(() => assertCalibrationFixProposalRequest({
      ...validRequest,
      arbitraryNested: 'value',
    })).toThrow();
  });

  it('rejects non-numeric aggregateMetrics values', () => {
    expect(() => assertCalibrationFixProposalRequest({
      ...validRequest,
      aggregateMetrics: { rmsMin: 'not-a-number' },
    })).toThrow();
  });

  it('rejects non-finite aggregateMetrics values', () => {
    expect(() => assertCalibrationFixProposalRequest({
      ...validRequest,
      aggregateMetrics: { rmsMin: Number.NaN },
    })).toThrow();
  });

  it('rejects out-of-range aggregateMetrics values', () => {
    expect(() => assertCalibrationFixProposalRequest({
      ...validRequest,
      aggregateMetrics: { rmsMin: -1 },
    })).toThrow();
  });

  it('rejects oversized sessionId', () => {
    expect(() => assertCalibrationFixProposalRequest({
      ...validRequest,
      sessionId: 'x'.repeat(129),
    })).toThrow();
  });

  it('rejects empty sessionId', () => {
    expect(() => assertCalibrationFixProposalRequest({
      ...validRequest,
      sessionId: '',
    })).toThrow();
  });

  it('rejects whitespace-only sessionId', () => {
    expect(() => assertCalibrationFixProposalRequest({
      ...validRequest,
      sessionId: '   ',
    })).toThrow();
  });

  it('rejects buildSha that is not lowercase hex', () => {
    expect(() => assertCalibrationFixProposalRequest({
      ...validRequest,
      buildSha: 'NOT-HEX',
    })).toThrow();
  });

  it('rejects buildSha that is too short', () => {
    expect(() => assertCalibrationFixProposalRequest({
      ...validRequest,
      buildSha: 'abc',
    })).toThrow();
  });

  it('rejects buildSha that is too long', () => {
    expect(() => assertCalibrationFixProposalRequest({
      ...validRequest,
      buildSha: 'a'.repeat(41),
    })).toThrow();
  });

  it('rejects micDeviceHash that is not 64-char lowercase hex', () => {
    expect(() => assertCalibrationFixProposalRequest({
      ...validRequest,
      micDeviceHash: 'short',
    })).toThrow();
  });

  it('rejects invalid failedPhase', () => {
    expect(() => assertCalibrationFixProposalRequest({
      ...validRequest,
      failedPhase: 'unknown',
    })).toThrow();
  });

  it('rejects invalid failureReason', () => {
    expect(() => assertCalibrationFixProposalRequest({
      ...validRequest,
      failureReason: 'unknown',
    })).toThrow();
  });

  it('rejects failureReason not valid for the failedPhase (e.g. clipping in room)', () => {
    expect(() => assertCalibrationFixProposalRequest({
      ...validRequest,
      failedPhase: 'room',
      failureReason: 'clipping',
    })).toThrow();
  });

  it('rejects failureReason not valid for speech phase (mic_denied in speech)', () => {
    expect(() => assertCalibrationFixProposalRequest({
      ...validRequest,
      failedPhase: 'speech',
      failureReason: 'mic_denied',
    })).not.toThrow();
  });

  it('rejects correlatedResultId that is empty', () => {
    expect(() => assertCalibrationFixProposalRequest({
      ...validRequest,
      correlatedResultId: '',
    })).toThrow();
  });

  it('rejects correlatedResultId that is oversized', () => {
    expect(() => assertCalibrationFixProposalRequest({
      ...validRequest,
      correlatedResultId: 'x'.repeat(1025),
    })).toThrow();
  });

  it('rejects missing required field sessionId', () => {
    const { sessionId, ...rest } = validRequest;
    expect(() => assertCalibrationFixProposalRequest(rest)).toThrow();
  });

  it('rejects missing required field failedPhase', () => {
    const { failedPhase, ...rest } = validRequest;
    expect(() => assertCalibrationFixProposalRequest(rest)).toThrow();
  });

  it('rejects non-object input', () => {
    expect(() => assertCalibrationFixProposalRequest(null)).toThrow();
    expect(() => assertCalibrationFixProposalRequest('string')).toThrow();
    expect(() => assertCalibrationFixProposalRequest([])).toThrow();
  });

  it('rejects nested arbitrary objects in aggregateMetrics', () => {
    expect(() => assertCalibrationFixProposalRequest({
      ...validRequest,
      aggregateMetrics: { nested: { x: 1 } },
    })).toThrow();
  });
});
