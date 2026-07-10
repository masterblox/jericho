import { describe, expect, it } from 'vitest';
import {
  PinchLatch,
  normalizedPinchRatio,
  palmAnchor,
  type Landmark,
} from '../src/tracking';

function hand(): Landmark[] {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  landmarks[0] = { x: 0.5, y: 0.72, z: 0 };
  landmarks[5] = { x: 0.42, y: 0.5, z: 0 };
  landmarks[9] = { x: 0.48, y: 0.46, z: 0 };
  landmarks[13] = { x: 0.54, y: 0.48, z: 0 };
  landmarks[17] = { x: 0.62, y: 0.54, z: 0 };
  landmarks[4] = { x: 0.35, y: 0.38, z: 0 };
  landmarks[8] = { x: 0.45, y: 0.25, z: 0 };
  return landmarks;
}

describe('palm-anchored tracking', () => {
  it('does not move the coordinate when fingertips form a pinch', () => {
    const open = hand();
    const pinched = hand();
    pinched[4] = { x: 0.46, y: 0.31, z: 0 };
    pinched[8] = { x: 0.462, y: 0.312, z: 0 };
    expect(palmAnchor(pinched)).toEqual(palmAnchor(open));
    const a = palmAnchor(open);
    const b = palmAnchor(pinched);
    expect(Math.hypot(a.x - b.x, a.y - b.y) * 1080).toBeLessThan(8);
    expect(normalizedPinchRatio(pinched)).toBeLessThan(0.35);
  });

  it('debounces pinch engage/release and rejects frame-edge pinches', () => {
    const latch = new PinchLatch();
    expect(latch.update(0.2, false, 0)).toBe(false);
    expect(latch.update(0.2, false, 79)).toBe(false);
    expect(latch.update(0.2, false, 80)).toBe(true);
    expect(latch.update(0.42, false, 100)).toBe(true);
    expect(latch.update(0.55, false, 110)).toBe(true);
    expect(latch.update(0.55, false, 170)).toBe(false);
    expect(latch.update(0.1, true, 300)).toBe(false);
    expect(latch.update(0.1, true, 500)).toBe(false);
  });

  it('does not release an active pinch merely because it reaches a frame edge', () => {
    const latch = new PinchLatch();
    latch.update(0.2, false, 0);
    expect(latch.update(0.2, false, 80)).toBe(true);
    expect(latch.update(0.2, true, 100)).toBe(true);
    expect(latch.update(0.2, true, 300)).toBe(true);
    expect(latch.update(0.6, true, 310)).toBe(true);
    expect(latch.update(0.6, true, 370)).toBe(false);
  });
});
