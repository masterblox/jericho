import { describe, expect, it } from 'vitest';
import { LeftNavigationController } from '../src/left-navigation';

describe('left anchored-joystick navigation', () => {
  it('arms without jumping, respects the dead zone, and scrolls both directions', () => {
    const controller = new LeftNavigationController();
    expect(controller.update({ x: 0, y: 0.5 }, 'palm', 0, null).some((action) => action.type === 'left-scroll')).toBe(false);
    expect(controller.update({ x: 0, y: 0.505 }, 'palm', 33, null).some((action) => action.type === 'left-scroll')).toBe(false);
    const down = controller.update({ x: 0, y: 0.58 }, 'palm', 66, null);
    expect(down.find((action) => action.type === 'left-scroll' && action.delta > 0)).toBeTruthy();
    controller.cancel();
    controller.update({ x: 0, y: 0.5 }, 'palm', 100, null);
    const up = controller.update({ x: 0, y: 0.42 }, 'palm', 133, null);
    expect(up.find((action) => action.type === 'left-scroll' && action.delta < 0)).toBeTruthy();
  });

  it('re-anchors after dropout instead of emitting a resume jump', () => {
    const controller = new LeftNavigationController();
    controller.update({ x: 0, y: 0.5 }, 'palm', 0, null);
    controller.update({ x: 0, y: 0.58 }, 'palm', 33, null);
    controller.pause();
    expect(controller.update({ x: 0, y: 0.7 }, 'palm', 200, null).some((action) => action.type === 'left-scroll')).toBe(false);
  });
});
