import { describe, expect, it } from 'vitest';

import { DiagnosticRecorder } from '../src/diagnostics';
import type { GestureFrame } from '../src/gestures';
import type { TrackedHandFrame } from '../src/hand-tracks';

describe('sanitized local gesture diagnostics', () => {
  it('retains useful derived health without raw landmarks or private payloads', () => {
    const recorder = new DiagnosticRecorder();
    recorder.record({
      timestamp: 100,
      frame: {
        hands: [hand()], right: hand(), timestamp: 100, fps: 59.94, inferenceMs: 11.7,
        transcript: 'reply to private customer',
        audio: 'raw-audio-bytes',
        payload: { secret: 'private-message' },
      } as GestureFrame,
      actions: [{ channel: 'right', action: { type: 'drag-start', targetId: 'customer:private' } } as never],
      scrollTop: 31.7,
      leftTarget: null,
      rightTarget: 'customer:private',
    });

    const exported = recorder.export();
    expect(exported).not.toMatch(/landmarks|palmAnchor|smoothedAnchor|transcript|audio|payload|secret|private-message|customer:private/);
    expect(JSON.parse(exported)).toEqual({
      version: 2,
      durationMs: 30_000,
      snapshots: [{
        timestamp: 100,
        performance: { fps: 59.9, inferenceMs: 11.7 },
        hands: [{
          handedness: 'Right', state: 'pinch', fresh: true, lossAgeMs: 0,
          pinchPhase: 'pinched', pinchRatio: 0.21,
        }],
        actions: [{ channel: 'right', type: 'drag-start' }],
        scrollTop: 32,
        targets: { leftAcquired: false, rightAcquired: true },
      }],
    });
  });

  it('keeps only the configured rolling local window', () => {
    const recorder = new DiagnosticRecorder(50);
    recorder.record(inputAt(0));
    recorder.record(inputAt(40));
    recorder.record(inputAt(60));

    expect(JSON.parse(recorder.export()).snapshots.map((snapshot: { timestamp: number }) => snapshot.timestamp))
      .toEqual([40, 60]);
  });
});

function inputAt(timestamp: number) {
  return {
    timestamp,
    frame: { hands: [], timestamp, fps: 60, inferenceMs: 5 } as GestureFrame,
    actions: [],
    scrollTop: 0,
    leftTarget: null,
    rightTarget: null,
  };
}

function hand(): TrackedHandFrame {
  return {
    trackId: 9,
    handedness: 'Right', handednessConfidence: 0.9,
    rawHandedness: 'Right', rawHandednessConfidence: 0.9,
    state: 'pinch', recognizedGesture: 'None', gestureConfidence: 0.8, confidence: 0.9,
    landmarks: Array.from({ length: 21 }, () => ({ x: 0.12345, y: 0.6789, z: -0.01 })),
    palmAnchor: { x: 0.12345, y: 0.6789 }, smoothedAnchor: { x: 0.13, y: 0.67 },
    velocity: { x: 1, y: 2 }, pinchRatio: 0.2134, pinchPhase: 'pinched', pinchCandidateMs: 20,
    fresh: true, lastSeenAt: 100, lossAgeMs: 0, associationDistance: 0.1,
  };
}
