import { describe, expect, it } from 'vitest';
import { GestureCoordinator } from '../src/gesture-coordinator';
import type { TrackedHandFrame } from '../src/hand-tracks';
import type { GestureState, Handedness, Landmark } from '../src/tracking';

const landmarks: Landmark[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));

function hand(handedness: Handedness, state: GestureState, fresh = true): TrackedHandFrame {
  return {
    trackId: handedness === 'Left' ? 1 : 2,
    handedness,
    handednessConfidence: 0.9,
    rawHandedness: handedness,
    rawHandednessConfidence: 0.9,
    state,
    recognizedGesture: state === 'palm' ? 'Open_Palm' : 'None',
    gestureConfidence: 0.9,
    confidence: 0.9,
    landmarks,
    palmAnchor: { x: 0.5, y: 0.5 },
    smoothedAnchor: { x: 0.5, y: 0.5 },
    pinchPoint: { x: 0.5, y: 0.5 },
    smoothedPinch: { x: 0.5, y: 0.5 },
    velocity: { x: 0, y: 0 },
    pinchRatio: state === 'pinch' ? 0.2 : 0.8,
    pinchPhase: state === 'pinch' ? 'pinched' : 'open',
    pinchCandidateMs: 0,
    fresh,
    lastSeenAt: 0,
    lossAgeMs: fresh ? 0 : 100,
    associationDistance: 0,
  };
}

const card = {
  id: 'card:0', draggable: true, left: 100, top: 80, right: 370, bottom: 240, boundaryDistance: 0,
};

describe('independent dual-hand coordinator', () => {
  it('scrolls left while starting and moving a right-hand drag', () => {
    const coordinator = new GestureCoordinator();
    coordinator.update(
      { hand: hand('Left', 'palm'), point: { x: 100, y: 0.5 }, targetId: 'nav:0' },
      { hand: hand('Right', 'palm'), point: { x: 130, y: 110 }, target: card },
      0,
    );
    const engaged = coordinator.update(
      { hand: hand('Left', 'palm'), point: { x: 100, y: 0.58 }, targetId: 'nav:1' },
      { hand: hand('Right', 'pinch'), point: { x: 130, y: 110 }, target: card },
      33,
    );
    expect(engaged.some((event) => event.channel === 'left' && event.action.type === 'left-scroll')).toBe(true);
    expect(engaged.some((event) => event.channel === 'right' && event.action.type === 'drag-start')).toBe(true);
    expect(engaged.some((event) => event.channel === 'right' && event.action.type === 'drag-move')).toBe(true);

    const dragging = coordinator.update(
      { hand: hand('Left', 'palm'), point: { x: 100, y: 0.6 }, targetId: 'nav:1' },
      { hand: hand('Right', 'pinch'), point: { x: 150, y: 125 }, target: card },
      160,
    );
    expect(dragging.some((event) => event.channel === 'left' && event.action.type === 'left-scroll')).toBe(true);
    expect(dragging.some((event) => event.channel === 'right' && event.action.type === 'drag-start')).toBe(false);
    expect(dragging.some((event) => event.channel === 'right' && event.action.type === 'drag-move')).toBe(true);
  });

  it('left pinch selects once and never emits right pointer actions', () => {
    const coordinator = new GestureCoordinator();
    coordinator.update(
      { hand: hand('Left', 'palm'), point: { x: 100, y: 0.5 }, targetId: 'nav:3' },
      {},
      0,
    );
    const selected = coordinator.update(
      { hand: hand('Left', 'pinch'), point: { x: 100, y: 0.5 }, targetId: 'nav:3' },
      {},
      100,
    );
    expect(selected.filter((event) => event.action.type === 'left-select')).toHaveLength(1);
    expect(selected.some((event) => event.channel === 'right' && event.action.type !== 'hover')).toBe(false);
    const held = coordinator.update(
      { hand: hand('Left', 'pinch'), point: { x: 100, y: 0.5 }, targetId: 'nav:3' },
      {},
      200,
    );
    expect(held.some((event) => event.action.type === 'left-select')).toBe(false);
  });

  it('pauses a drag through short dropout and cancels only after track expiry', () => {
    const coordinator = new GestureCoordinator();
    coordinator.update({}, { hand: hand('Right', 'palm'), point: { x: 130, y: 110 }, target: card }, 0);
    coordinator.update({}, { hand: hand('Right', 'pinch'), point: { x: 130, y: 110 }, target: card }, 10);
    coordinator.update({}, { hand: hand('Right', 'pinch'), point: { x: 130, y: 110 }, target: card }, 140);
    const paused = coordinator.update({}, { hand: hand('Right', 'pinch', false), point: { x: 130, y: 110 }, target: card }, 200);
    expect(paused.some((event) => event.channel === 'right')).toBe(false);
    const cancelled = coordinator.update({}, {}, 500);
    expect(cancelled).toContainEqual({
      channel: 'right',
      action: { type: 'drag-end', targetId: 'card:0', cancelled: true },
    });
    expect(cancelled.some((event) => event.action.type === 'click')).toBe(false);
  });
});
