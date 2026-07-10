import type { GestureState, Point } from './tracking';

export const LEFT_SCROLL_DEAD_ZONE = 0.01;
export const LEFT_SCROLL_SPEED = 1020;

export type LeftNavigationAction =
  | { type: 'left-hover'; targetId: string | null }
  | { type: 'left-scroll'; delta: number }
  | { type: 'left-select'; targetId: string };

export class LeftNavigationController {
  private anchorY: number | null = null;
  private previousState: GestureState = 'idle';
  private previousTarget: string | null = null;
  private lastAt = 0;
  private paused = false;

  update(point: Point, state: GestureState, now: number, targetId: string | null): LeftNavigationAction[] {
    const actions: LeftNavigationAction[] = [];
    if (targetId !== this.previousTarget) {
      this.previousTarget = targetId;
      actions.push({ type: 'left-hover', targetId });
    }

    if (state === 'palm') {
      if (this.previousState !== 'palm' || this.anchorY === null || this.paused) {
        this.anchorY = point.y;
        this.lastAt = now;
        this.paused = false;
      } else {
        const dt = Math.min(0.05, Math.max(0, (now - this.lastAt) / 1000));
        const displacement = point.y - this.anchorY;
        const magnitude = Math.max(0, Math.abs(displacement) - LEFT_SCROLL_DEAD_ZONE);
        if (magnitude > 0 && dt > 0) {
          const delta = Math.sign(displacement) * Math.min(20, magnitude * LEFT_SCROLL_SPEED * dt);
          actions.push({ type: 'left-scroll', delta });
        }
        this.lastAt = now;
      }
    } else {
      this.anchorY = null;
      this.lastAt = now;
    }

    if (state === 'pinch' && this.previousState !== 'pinch' && targetId) {
      actions.push({ type: 'left-select', targetId });
    }
    this.previousState = state;
    return actions;
  }

  pause() {
    this.paused = true;
  }

  cancel(): LeftNavigationAction[] {
    const actions: LeftNavigationAction[] = [];
    if (this.previousTarget !== null) actions.push({ type: 'left-hover', targetId: null });
    this.anchorY = null;
    this.previousState = 'idle';
    this.previousTarget = null;
    this.lastAt = 0;
    this.paused = false;
    return actions;
  }
}
