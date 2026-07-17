import { describe, expect, it } from 'vitest';

import {
  assertCalibrationFixProposalRequest,
  assertGroundedTurnProgressEvent,
  CALIBRATION_FAILURE_REASONS,
  CALIBRATION_PHRASES,
  canonicalJson,
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

  describe('field-specific metric bounds', () => {
    it('rejects clippedSampleFraction above 1', () => {
      expect(() => assertCalibrationFixProposalRequest({
        ...validRequest,
        aggregateMetrics: { clippedSampleFraction: 99 },
      })).toThrow();
    });

    it('rejects sampleCount that is not a safe integer', () => {
      expect(() => assertCalibrationFixProposalRequest({
        ...validRequest,
        aggregateMetrics: { sampleCount: 1.5 },
      })).toThrow();
    });

    it('rejects rmsMin above 1', () => {
      expect(() => assertCalibrationFixProposalRequest({
        ...validRequest,
        aggregateMetrics: { rmsMin: 1.5 },
      })).toThrow();
    });

    it('rejects rmsMin exceeding rmsMax', () => {
      expect(() => assertCalibrationFixProposalRequest({
        ...validRequest,
        aggregateMetrics: { rmsMin: 0.5, rmsMax: 0.3 },
      })).toThrow();
    });

    it('rejects rmsMean exceeding rmsMax', () => {
      expect(() => assertCalibrationFixProposalRequest({
        ...validRequest,
        aggregateMetrics: { rmsMean: 0.5, rmsMax: 0.3 },
      })).toThrow();
    });

    it('rejects rmsP95 exceeding rmsMax', () => {
      expect(() => assertCalibrationFixProposalRequest({
        ...validRequest,
        aggregateMetrics: { rmsP95: 0.9, rmsMax: 0.3 },
      })).toThrow();
    });

    it('rejects peakMax below rmsMax', () => {
      expect(() => assertCalibrationFixProposalRequest({
        ...validRequest,
        aggregateMetrics: { rmsMax: 0.8, peakMax: 0.3 },
      })).toThrow();
    });

    it('accepts valid coherent metrics', () => {
      expect(() => assertCalibrationFixProposalRequest({
        ...validRequest,
        aggregateMetrics: {
          durationMs: 5000, sampleCount: 80000, blockCount: 20, clipCount: 0,
          rmsMin: 0.005, rmsMean: 0.012, rmsP95: 0.020, rmsMax: 0.030, peakMax: 0.85,
          clippedSampleFraction: 0, sustainedEnergyFraction: 0.05,
        },
      })).not.toThrow();
    });
  });

  describe('GroundedTurnProgressEvent milestone-specific IDs', () => {
    it('rejects capture_committed without captureId', () => {
      expect(() => assertGroundedTurnProgressEvent({
        turnId: 'turn-1',
        milestone: 'capture_committed',
      })).toThrow();
    });

    it('rejects retrieval_started without resultId', () => {
      expect(() => assertGroundedTurnProgressEvent({
        turnId: 'turn-1',
        milestone: 'retrieval_started',
      })).toThrow();
    });

    it('rejects terminal_result_sent without resultId', () => {
      expect(() => assertGroundedTurnProgressEvent({
        turnId: 'turn-1',
        milestone: 'terminal_result_sent',
      })).toThrow();
    });
  });

  describe('canonicalJson', () => {
    it('produces different strings for different nested metric values', () => {
      const a = canonicalJson({ aggregateMetrics: { rmsMin: 0.1, rmsMax: 0.3 } });
      const b = canonicalJson({ aggregateMetrics: { rmsMin: 0.2, rmsMax: 0.3 } });
      expect(a).not.toBe(b);
    });

    it('produces same string regardless of key order', () => {
      const a = canonicalJson({ b: 1, a: 2, nested: { d: 4, c: 3 } });
      const b = canonicalJson({ a: 2, b: 1, nested: { c: 3, d: 4 } });
      expect(a).toBe(b);
    });

    it('produces different strings for different proposal requests', () => {
      const r1 = canonicalJson({ ...validRequest, aggregateMetrics: {} });
      const r2 = canonicalJson({ ...validRequest, aggregateMetrics: { rmsMin: 0.1 } });
      expect(r1).not.toBe(r2);
    });

    it('rejects non-finite numbers', () => {
      expect(() => canonicalJson({ x: Number.NaN })).toThrow();
    });
  });
});
