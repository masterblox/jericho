import type { GestureState, Point } from './tracking';
import { boundedGrabOffset, type RectTarget } from './hit-testing';

export const DRAG_HOLD_MS = 120;
export const DRAG_MOVE_PX = 6;

export interface PointerTarget extends RectTarget {
  id: string;
  draggable: boolean;
  boundaryDistance: number;
}

export type PointerAction =
  | { type: 'hover'; targetId: string | null }
  | { type: 'click'; targetId: string }
  | { type: 'drag-start'; targetId: string; offsetX: number; offsetY: number }
  | { type: 'drag-move'; targetId: string; left: number; top: number }
  | { type: 'drag-end'; targetId: string; cancelled: boolean };

interface PressState {
  target: PointerTarget | null;
  start: Point;
  startedAt: number;
  dragging: boolean;
  committed: boolean;
  offsetX: number;
  offsetY: number;
}

export class PointerController {
  private previousState: GestureState = 'idle';
  private press: PressState | null = null;
  private hoverId: string | null = null;

  update(point: Point, state: GestureState, now: number, target: PointerTarget | null): PointerAction[] {
    const actions: PointerAction[] = [];
    if (target?.id !== this.hoverId && !this.press?.dragging) {
      this.hoverId = target?.id ?? null;
      actions.push({ type: 'hover', targetId: this.hoverId });
    }

    const pinchStarted = state === 'pinch' && this.previousState !== 'pinch';
    const pinchReleased = state !== 'pinch' && this.previousState === 'pinch';

    if (pinchStarted) {
      const grabOffset = target?.draggable
        ? boundedGrabOffset(point, target)
        : { x: target ? point.x - target.left : 0, y: target ? point.y - target.top : 0 };
      this.press = {
        target,
        start: { ...point },
        startedAt: now,
        dragging: false,
        committed: false,
        offsetX: grabOffset.x,
        offsetY: grabOffset.y,
      };
      if (target?.draggable) {
        this.press.dragging = true;
        actions.push({
          type: 'drag-start',
          targetId: target.id,
          offsetX: this.press.offsetX,
          offsetY: this.press.offsetY,
        });
        actions.push({
          type: 'drag-move',
          targetId: target.id,
          left: point.x - this.press.offsetX,
          top: point.y - this.press.offsetY,
        });
      }
    }

    if (state === 'pinch' && this.press?.target?.draggable) {
      const distance = Math.hypot(point.x - this.press.start.x, point.y - this.press.start.y);
      if (distance >= DRAG_MOVE_PX || now - this.press.startedAt >= DRAG_HOLD_MS) {
        this.press.committed = true;
      }
      // The first position is emitted with drag-start above. Avoid duplicating it.
      if (this.press.dragging && !pinchStarted) {
        actions.push({
          type: 'drag-move',
          targetId: this.press.target.id,
          left: point.x - this.press.offsetX,
          top: point.y - this.press.offsetY,
        });
      }
    }

    if (pinchReleased && this.press) {
      const releaseDistance = Math.hypot(point.x - this.press.start.x, point.y - this.press.start.y);
      if (releaseDistance >= DRAG_MOVE_PX || now - this.press.startedAt >= DRAG_HOLD_MS) {
        this.press.committed = true;
      }
      if (this.press.dragging && this.press.target) {
        actions.push({ type: 'drag-end', targetId: this.press.target.id, cancelled: !this.press.committed });
        if (!this.press.committed) actions.push({ type: 'click', targetId: this.press.target.id });
      } else if (this.press.target && target?.id === this.press.target.id) {
        actions.push({ type: 'click', targetId: this.press.target.id });
      }
      this.press = null;
    }

    this.previousState = state;
    return actions;
  }

  cancel(): PointerAction[] {
    const actions: PointerAction[] = [];
    if (this.press?.dragging && this.press.target) {
      actions.push({ type: 'drag-end', targetId: this.press.target.id, cancelled: true });
    }
    if (this.hoverId !== null) actions.push({ type: 'hover', targetId: null });
    this.press = null;
    this.previousState = 'idle';
    this.hoverId = null;
    return actions;
  }
}
