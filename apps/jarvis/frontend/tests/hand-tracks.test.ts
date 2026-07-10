import { describe, expect, it } from 'vitest';
import { HandTrackManager, type RawHandObservation } from '../src/hand-tracks';
import type { Handedness, Landmark } from '../src/tracking';

const landmarks: Landmark[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));

function observation(
  rawHandedness: Handedness,
  x: number,
  options: Partial<RawHandObservation> = {},
): RawHandObservation {
  return {
    rawHandedness,
    handednessConfidence: 0.9,
    recognizedGesture: 'Open_Palm',
    gestureConfidence: 0.9,
    confidence: 0.9,
    landmarks,
    palmAnchor: { x, y: 0.5 },
    pinchPoint: { x, y: 0.5 },
    pinchRatio: 0.8,
    atFrameEdge: false,
    openPalm: true,
    ...options,
  };
}

describe('persistent dual-hand tracks', () => {
  it('keeps two tracks when MediaPipe gives duplicate handedness labels', () => {
    const manager = new HandTrackManager();
    const hands = manager.update([observation('Left', 0.2), observation('Left', 0.8)], 0);
    expect(hands).toHaveLength(2);
    expect(new Set(hands.map((hand) => hand.trackId)).size).toBe(2);
    expect(new Set(hands.map((hand) => hand.handedness))).toEqual(new Set(['Left', 'Right']));
  });

  it('survives result-order changes, label flicker, and crossing without swapping roles', () => {
    const manager = new HandTrackManager();
    const first = manager.update([observation('Left', 0.2), observation('Right', 0.8)], 0);
    const leftId = first.find((hand) => hand.handedness === 'Left')!.trackId;
    const rightId = first.find((hand) => hand.handedness === 'Right')!.trackId;
    manager.update([observation('Right', 0.65), observation('Left', 0.35)], 33);
    manager.update([observation('Right', 0.52), observation('Left', 0.48)], 66);
    const crossed = manager.update(
      [observation('Right', 0.38), observation('Left', 0.62)],
      99,
    );
    expect(crossed.find((hand) => hand.handedness === 'Left')!.trackId).toBe(leftId);
    expect(crossed.find((hand) => hand.handedness === 'Right')!.trackId).toBe(rightId);

    const flickered = manager.update(
      [observation('Left', 0.36), observation('Right', 0.64)],
      132,
    );
    expect(flickered.find((hand) => hand.trackId === leftId)!.handedness).toBe('Left');
    expect(flickered.find((hand) => hand.trackId === rightId)!.handedness).toBe('Right');
  });

  it('retains frozen tracks for 350ms and expires them independently afterward', () => {
    const manager = new HandTrackManager();
    manager.update([observation('Left', 0.2), observation('Right', 0.8)], 0);
    const grace = manager.update([], 349);
    expect(grace).toHaveLength(2);
    expect(grace.every((hand) => !hand.fresh && hand.lossAgeMs === 349)).toBe(true);
    expect(manager.update([], 351)).toHaveLength(0);
  });

  it('uses geometry for pinch even when the generic classifier says Closed_Fist', () => {
    const manager = new HandTrackManager();
    const pinch = { recognizedGesture: 'Closed_Fist', pinchRatio: 0.2, openPalm: false };
    manager.update([observation('Right', 0.7, pinch)], 0);
    const engaged = manager.update([observation('Right', 0.7, { ...pinch, atFrameEdge: false })], 80)[0];
    expect(engaged.state).toBe('pinch');
    const atEdge = manager.update([observation('Right', 0.7, { ...pinch, atFrameEdge: true })], 100)[0];
    expect(atEdge.state).toBe('pinch');
  });

  it('applies the persisted role swap without changing track identity', () => {
    const manager = new HandTrackManager();
    const normal = manager.update([observation('Left', 0.2), observation('Right', 0.8)], 0);
    const leftId = normal.find((hand) => hand.handedness === 'Left')!.trackId;
    const swapped = manager.update([observation('Left', 0.21), observation('Right', 0.79)], 33, true);
    expect(swapped.find((hand) => hand.trackId === leftId)!.handedness).toBe('Right');
  });
});
