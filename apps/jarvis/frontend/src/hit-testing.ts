import type { Point } from './tracking';

export const CARD_HIT_SLOP_PX = 28;
export const CARD_RELEASE_SLOP_PX = 64;
export const GRAB_INSET_PX = 14;

export interface RectTarget {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CardHit<T extends RectTarget> {
  target: T;
  boundaryDistance: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function distanceToRect(point: Point, rect: RectTarget): number {
  const closestX = clamp(point.x, rect.left, rect.right);
  const closestY = clamp(point.y, rect.top, rect.bottom);
  return Math.hypot(point.x - closestX, point.y - closestY);
}

export function nearestCardHit<T extends RectTarget>(point: Point, cards: T[]): CardHit<T> | null {
  let best: CardHit<T> | null = null;
  // Walk topmost-to-bottommost so visual order wins equal-distance overlaps.
  for (let index = cards.length - 1; index >= 0; index--) {
    const boundaryDistance = distanceToRect(point, cards[index]);
    if (boundaryDistance > CARD_HIT_SLOP_PX) continue;
    if (!best || boundaryDistance < best.boundaryDistance) {
      best = { target: cards[index], boundaryDistance };
    }
  }
  return best;
}

export function boundedGrabOffset(point: Point, target: RectTarget): Point {
  const width = target.right - target.left;
  const height = target.bottom - target.top;
  const minX = Math.min(width / 2, GRAB_INSET_PX);
  const maxX = Math.max(width / 2, width - GRAB_INSET_PX);
  const minY = Math.min(height / 2, GRAB_INSET_PX);
  const maxY = Math.max(height / 2, height - GRAB_INSET_PX);
  return {
    x: clamp(point.x - target.left, minX, maxX),
    y: clamp(point.y - target.top, minY, maxY),
  };
}

export function pointInsideTarget(point: Point, target: RectTarget, inset = GRAB_INSET_PX): Point {
  const halfWidth = (target.right - target.left) / 2;
  const halfHeight = (target.bottom - target.top) / 2;
  const xInset = Math.min(inset, halfWidth);
  const yInset = Math.min(inset, halfHeight);
  return {
    x: clamp(point.x, target.left + xInset, target.right - xInset),
    y: clamp(point.y, target.top + yInset, target.bottom - yInset),
  };
}

export class StickyCardTarget<T extends RectTarget & { id: string }> {
  private lockedId: string | null = null;

  update(point: Point, cards: T[]): CardHit<T> | null {
    if (this.lockedId) {
      const locked = cards.find((card) => card.id === this.lockedId);
      if (locked) {
        const boundaryDistance = distanceToRect(point, locked);
        if (boundaryDistance <= CARD_RELEASE_SLOP_PX) return { target: locked, boundaryDistance };
      }
      this.lockedId = null;
    }

    const acquired = nearestCardHit(point, cards);
    this.lockedId = acquired?.target.id ?? null;
    return acquired;
  }

  clear(): void {
    this.lockedId = null;
  }
}
