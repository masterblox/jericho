import { describe, expect, it } from 'vitest';

import {
  GESTURE_DEBOUNCE_MS,
  GESTURE_HOLD_MS,
  HeldGestureInterpreter,
  NUCLEUS_DEPTH_HOLD_MS,
  NUCLEUS_DEPTH_STEP_PX,
  NucleusGestureInterpreter,
} from '../src/gesture-grammar';
import type { TrackedHandFrame } from '../src/hand-tracks';

describe('HeldGestureInterpreter', () => {
  const activeApproval = { missionId: 'mission-1', planHash: 'a'.repeat(64), version: 3 };

  it('emits one held thumb approval decision only while an approval is active', () => {
    const interpreter = new HeldGestureInterpreter();
    const right = hand('Right', 'Thumb_Up');

    expect(interpreter.update({ right, now: 0, activeApproval, cancelEnabled: false })).toEqual([]);
    expect(interpreter.update({ right, now: GESTURE_HOLD_MS - 1, activeApproval, cancelEnabled: false })).toEqual([]);
    expect(interpreter.update({ right, now: GESTURE_HOLD_MS, activeApproval, cancelEnabled: false }))
      .toEqual([{ type: 'approval-decision', outcome: 'approved', approval: activeApproval }]);
    expect(interpreter.update({ right, now: GESTURE_HOLD_MS + 400, activeApproval, cancelEnabled: false }))
      .toEqual([]);

    interpreter.update({ right: hand('Right', 'None'), now: GESTURE_HOLD_MS + 10, activeApproval, cancelEnabled: false });
    expect(interpreter.update({ right, now: GESTURE_HOLD_MS + 11, activeApproval, cancelEnabled: false })).toEqual([]);
    expect(interpreter.update({
      right, now: GESTURE_HOLD_MS * 2 + 11, activeApproval, cancelEnabled: false,
    })).toEqual([]);
    expect(interpreter.update({
      right, now: GESTURE_HOLD_MS + GESTURE_DEBOUNCE_MS, activeApproval, cancelEnabled: false,
    })).toEqual([{ type: 'approval-decision', outcome: 'approved', approval: activeApproval }]);
  });

  it('keeps thumb decisions inert without an active approval and maps thumb down to rejection', () => {
    const interpreter = new HeldGestureInterpreter();
    const down = hand('Left', 'Thumb_Down');

    interpreter.update({ left: down, now: 0, cancelEnabled: false });
    expect(interpreter.update({ left: down, now: GESTURE_HOLD_MS + 10, cancelEnabled: false }))
      .toEqual([]);
    expect(interpreter.update({ left: down, now: GESTURE_HOLD_MS + 20, activeApproval, cancelEnabled: false }))
      .toEqual([]);
    expect(interpreter.update({ left: down, now: GESTURE_HOLD_MS * 2 + 20, activeApproval, cancelEnabled: false }))
      .toEqual([{ type: 'approval-decision', outcome: 'rejected', approval: activeApproval }]);
  });

  it('emits one cancel only after both fresh Open_Palm hands are held', () => {
    const interpreter = new HeldGestureInterpreter();
    const left = hand('Left', 'Open_Palm');
    const right = hand('Right', 'Open_Palm');

    interpreter.update({ left, right, now: 0, cancelEnabled: true });
    expect(interpreter.update({ left, right, now: GESTURE_HOLD_MS, cancelEnabled: true }))
      .toEqual([{ type: 'cancel-pending' }]);
    expect(interpreter.update({ left, right, now: GESTURE_HOLD_MS + 100, cancelEnabled: true }))
      .toEqual([]);

    const staleRight = { ...right, fresh: false };
    interpreter.update({ left, right: staleRight, now: GESTURE_HOLD_MS + 200, cancelEnabled: true });
    expect(interpreter.update({ left, right: staleRight, now: GESTURE_HOLD_MS * 2 + 300, cancelEnabled: true }))
      .toEqual([]);
  });

  it('keeps Closed_Fist, unsupported, and contradictory thumb gestures inert', () => {
    const interpreter = new HeldGestureInterpreter();
    for (const [left, right] of [
      [hand('Left', 'Closed_Fist'), undefined],
      [hand('Left', 'Victory'), undefined],
      [hand('Left', 'Thumb_Up'), hand('Right', 'Thumb_Down')],
    ] as const) {
      interpreter.update({ left, right, now: 0, activeApproval, cancelEnabled: true });
      expect(interpreter.update({ left, right, now: GESTURE_HOLD_MS + 50, activeApproval, cancelEnabled: true }))
        .toEqual([]);
      interpreter.reset();
    }
  });

  it('restarts the hold when the active immutable plan scope changes', () => {
    const interpreter = new HeldGestureInterpreter();
    const right = hand('Right', 'Thumb_Up');
    const revised = { ...activeApproval, planHash: 'b'.repeat(64), version: 4 };

    interpreter.update({ right, now: 0, activeApproval, cancelEnabled: false });
    expect(interpreter.update({ right, now: GESTURE_HOLD_MS, activeApproval: revised, cancelEnabled: false }))
      .toEqual([]);
    expect(interpreter.update({ right, now: GESTURE_HOLD_MS * 2, activeApproval: revised, cancelEnabled: false }))
      .toEqual([{ type: 'approval-decision', outcome: 'approved', approval: revised }]);
  });
});

describe('NucleusGestureInterpreter', () => {
  it('clutches an empty Nucleus only on a fresh right-pinch edge and emits pan deltas', () => {
    const interpreter = new NucleusGestureInterpreter();
    const right = { ...hand('Right', 'None'), state: 'pinch' as const };

    expect(interpreter.update({
      right, rightPoint: { x: 300, y: 200 }, rightOnEmptyNucleus: true,
      bothHandsInsideNucleus: false, now: 0,
    })).toEqual([{ type: 'camera', phase: 'start', point: { x: 300, y: 200 } }]);
    expect(interpreter.update({
      right, rightPoint: { x: 330, y: 185 }, rightOnEmptyNucleus: true,
      bothHandsInsideNucleus: false, now: 20,
    })).toEqual([{
      type: 'camera', phase: 'move', point: { x: 330, y: 185 }, delta: { x: 30, y: -15 },
    }]);
    expect(interpreter.update({
      right: hand('Right', 'None'), rightPoint: { x: 330, y: 185 }, rightOnEmptyNucleus: true,
      bothHandsInsideNucleus: false, now: 40,
    })).toEqual([{ type: 'camera', phase: 'end', cancelled: false }]);
  });

  it('does not acquire the Nucleus after a pinch began outside it', () => {
    const interpreter = new NucleusGestureInterpreter();
    const right = { ...hand('Right', 'None'), state: 'pinch' as const };

    expect(interpreter.update({
      right, rightPoint: { x: 50, y: 50 }, rightOnEmptyNucleus: false,
      bothHandsInsideNucleus: false, now: 0,
    })).toEqual([]);
    expect(interpreter.update({
      right, rightPoint: { x: 300, y: 200 }, rightOnEmptyNucleus: true,
      bothHandsInsideNucleus: false, now: 20,
    })).toEqual([]);
    interpreter.update({
      right: hand('Right', 'None'), rightPoint: { x: 300, y: 200 }, rightOnEmptyNucleus: true,
      bothHandsInsideNucleus: false, now: 40,
    });
    expect(interpreter.update({
      right, rightPoint: { x: 300, y: 200 }, rightOnEmptyNucleus: true,
      bothHandsInsideNucleus: false, now: 60,
    })).toEqual([{ type: 'camera', phase: 'start', point: { x: 300, y: 200 } }]);
  });

  it('converts held two-palm span changes into debounced semantic depth steps', () => {
    const interpreter = new NucleusGestureInterpreter();
    const left = hand('Left', 'Open_Palm');
    const right = hand('Right', 'Open_Palm');

    expect(interpreter.update({
      left, right, leftPoint: { x: 300, y: 200 }, rightPoint: { x: 500, y: 200 },
      rightOnEmptyNucleus: false, bothHandsInsideNucleus: true, now: 0,
    })).toEqual([]);
    expect(interpreter.update({
      left, right, leftPoint: { x: 300, y: 200 }, rightPoint: { x: 500, y: 200 },
      rightOnEmptyNucleus: false, bothHandsInsideNucleus: true, now: NUCLEUS_DEPTH_HOLD_MS,
    })).toEqual([]);
    expect(interpreter.update({
      left, right, leftPoint: { x: 300, y: 200 }, rightPoint: { x: 500 + NUCLEUS_DEPTH_STEP_PX, y: 200 },
      rightOnEmptyNucleus: false, bothHandsInsideNucleus: true, now: NUCLEUS_DEPTH_HOLD_MS + 300,
    })).toEqual([{ type: 'depth', delta: 1 }]);
    expect(interpreter.update({
      left, right, leftPoint: { x: 300, y: 200 }, rightPoint: { x: 500 + NUCLEUS_DEPTH_STEP_PX, y: 200 },
      rightOnEmptyNucleus: false, bothHandsInsideNucleus: true, now: NUCLEUS_DEPTH_HOLD_MS + 600,
    })).toEqual([]);
    expect(interpreter.update({
      left, right, leftPoint: { x: 300, y: 200 }, rightPoint: { x: 400, y: 200 },
      rightOnEmptyNucleus: false, bothHandsInsideNucleus: true, now: NUCLEUS_DEPTH_HOLD_MS + 900,
    })).toEqual([{ type: 'depth', delta: -1 }]);
  });
});

function hand(handedness: 'Left' | 'Right', recognizedGesture: string): TrackedHandFrame {
  return {
    trackId: handedness === 'Left' ? 1 : 2,
    handedness,
    handednessConfidence: 1,
    rawHandedness: handedness,
    rawHandednessConfidence: 1,
    state: recognizedGesture === 'Open_Palm' ? 'palm' : 'idle',
    recognizedGesture,
    gestureConfidence: 1,
    confidence: 1,
    landmarks: [],
    palmAnchor: { x: 0.5, y: 0.5 },
    smoothedAnchor: { x: 0.5, y: 0.5 },
    pinchPoint: { x: 0.5, y: 0.5 },
    smoothedPinch: { x: 0.5, y: 0.5 },
    velocity: { x: 0, y: 0 },
    pinchRatio: 1,
    pinchPhase: 'open',
    pinchCandidateMs: 0,
    fresh: true,
    lastSeenAt: 0,
    lossAgeMs: 0,
    associationDistance: 0,
  };
}
