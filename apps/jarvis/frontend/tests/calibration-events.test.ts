import { describe, expect, it } from 'vitest';
import {
  isCalibrationCommand,
  parseCalibrationCommandDetail,
  sanitizeCalibrationSnapshot,
  type CalibrationSnapshot,
  type CalibrationCommand,
} from '../src/calibration-events';

describe('isCalibrationCommand', () => {
  it('accepts all valid commands', () => {
    const commands: CalibrationCommand[] = ['start', 'retry_phase', 'exit', 'apply', 'discard', 'create_fix_proposal'];
    for (const cmd of commands) {
      expect(isCalibrationCommand(cmd)).toBe(true);
    }
  });

  it('rejects unknown strings', () => {
    expect(isCalibrationCommand('unknown')).toBe(false);
    expect(isCalibrationCommand('')).toBe(false);
    expect(isCalibrationCommand(null)).toBe(false);
    expect(isCalibrationCommand(123)).toBe(false);
    expect(isCalibrationCommand(undefined)).toBe(false);
  });
});

describe('parseCalibrationCommandDetail', () => {
  it('parses commands from action and command fields', () => {
    expect(parseCalibrationCommandDetail({ action: 'start' })).toBe('start');
    expect(parseCalibrationCommandDetail({ command: 'exit' })).toBe('exit');
  });

  it('returns null for malformed detail', () => {
    expect(parseCalibrationCommandDetail(null)).toBeNull();
    expect(parseCalibrationCommandDetail('string')).toBeNull();
    expect(parseCalibrationCommandDetail({})).toBeNull();
    expect(parseCalibrationCommandDetail({ action: 'unknown' })).toBeNull();
  });
});

describe('sanitizeCalibrationSnapshot', () => {
  it('returns a shallow copy', () => {
    const snapshot: CalibrationSnapshot = {
      sessionId: 'test-1',
      phase: 'idle',
      completedPhases: [],
      speechChecks: [],
      clapCount: 0,
    };
    const sanitized = sanitizeCalibrationSnapshot(snapshot);
    expect(sanitized).toEqual(snapshot);
    expect(sanitized).not.toBe(snapshot);
  });
});
