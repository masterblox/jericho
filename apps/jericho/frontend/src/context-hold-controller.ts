import type { Point } from './tracking';

export const CONTEXT_HOLD_MS = 620;
export const CONTEXT_DRAG_PX = 7;

export interface ContextTarget {
  id: string;
  draggable: boolean;
}

export interface ContextHoldInput {
  point: Point;
  pinching: boolean;
  now: number;
  target: ContextTarget | null;
}

export type ContextHoldAction =
  | { type: 'press-start'; targetId: string }
  | { type: 'tap'; targetId: string }
  | { type: 'hold'; targetId: string; point: Point }
  | { type: 'drag-start'; targetId: string; point: Point }
  | { type: 'drag-move'; targetId: string; point: Point; delta: Point }
  | { type: 'drag-end'; targetId: string; point: Point; cancelled: boolean }
  | { type: 'release'; targetId: string; held: boolean }
  | { type: 'cancel'; targetId: string };

interface ActivePress {
  target: ContextTarget;
  start: Point;
  latest: Point;
  startedAt: number;
  dragged: boolean;
  held: boolean;
  moved: boolean;
}

/** Resolves the mutually-exclusive pinch outcomes: tap, hold, drag, cancel. */
export class ContextHoldController {
  private press: ActivePress | null = null;
  private previousPinching = false;

  update(input: ContextHoldInput): ContextHoldAction[] {
    const pinchStarted = input.pinching && !this.previousPinching;
    this.previousPinching = input.pinching;

    if (pinchStarted && !this.press) {
      if (!input.target) return [];
      this.press = {
        target: input.target,
        start: { ...input.point },
        latest: { ...input.point },
        startedAt: input.now,
        dragged: false,
        held: false,
        moved: false,
      };
      return [{ type: 'press-start', targetId: input.target.id }];
    }

    // A pinch that began off-target is intentionally inert until release.
    if (input.pinching && !this.press) return [];

    if (input.pinching && this.press) {
      this.press.latest = { ...input.point };
      const delta = subtract(input.point, this.press.start);
      const distance = Math.hypot(delta.x, delta.y);
      if (distance >= CONTEXT_DRAG_PX) this.press.moved = true;

      if (!this.press.held && !this.press.dragged && this.press.target.draggable && this.press.moved) {
        this.press.dragged = true;
        return [
          { type: 'drag-start', targetId: this.press.target.id, point: { ...this.press.start } },
          { type: 'drag-move', targetId: this.press.target.id, point: { ...input.point }, delta },
        ];
      }
      if (this.press.dragged) {
        return [{ type: 'drag-move', targetId: this.press.target.id, point: { ...input.point }, delta }];
      }
      if (!this.press.held && !this.press.moved && input.now - this.press.startedAt >= CONTEXT_HOLD_MS) {
        this.press.held = true;
        return [{ type: 'hold', targetId: this.press.target.id, point: { ...input.point } }];
      }
      return [];
    }

    if (!input.pinching && this.press) {
      const press = this.press;
      this.press = null;
      const actions: ContextHoldAction[] = [];
      if (press.dragged) {
        actions.push({ type: 'drag-end', targetId: press.target.id, point: { ...input.point }, cancelled: false });
      } else if (!press.held && !press.moved && input.target?.id === press.target.id) {
        actions.push({ type: 'tap', targetId: press.target.id });
      }
      actions.push({ type: 'release', targetId: press.target.id, held: press.held });
      return actions;
    }

    return [];
  }

  cancel(): ContextHoldAction[] {
    if (!this.press) return [];
    const press = this.press;
    this.press = null;
    const actions: ContextHoldAction[] = [];
    if (press.dragged) {
      actions.push({ type: 'drag-end', targetId: press.target.id, point: { ...press.latest }, cancelled: true });
    }
    actions.push({ type: 'cancel', targetId: press.target.id });
    return actions;
  }
}

function subtract(point: Point, origin: Point): Point {
  return { x: point.x - origin.x, y: point.y - origin.y };
}
