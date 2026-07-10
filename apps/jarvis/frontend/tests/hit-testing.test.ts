import { describe, expect, it } from 'vitest';
import {
  CARD_HIT_SLOP_PX,
  GRAB_INSET_PX,
  boundedGrabOffset,
  distanceToRect,
  nearestCardHit,
} from '../src/hit-testing';

const card = { id: 'card:0', left: 100, top: 80, right: 370, bottom: 240 };

describe('fresh-pinch card footprint geometry', () => {
  it('reproduces the screenshot edge grab and puts the full cursor inside', () => {
    const cursor = { x: card.right - 7, y: 150 };
    const hit = nearestCardHit(cursor, [card]);
    expect(hit?.target.id).toBe('card:0');
    const offset = boundedGrabOffset(cursor, card);
    const movedLeft = cursor.x - offset.x;
    expect(cursor.x - movedLeft).toBe(card.right - card.left - GRAB_INSET_PX);
    expect(movedLeft).toBe(card.left + 7);
  });

  it('acquires an overlapping cursor footprint but rejects beyond 18px', () => {
    expect(nearestCardHit({ x: card.right + CARD_HIT_SLOP_PX, y: 150 }, [card])?.target.id).toBe('card:0');
    expect(nearestCardHit({ x: card.right + CARD_HIT_SLOP_PX + 0.1, y: 150 }, [card])).toBeNull();
  });

  it('chooses the nearest card and uses visual order for exact ties', () => {
    const farther = { ...card, id: 'card:1', left: 390, right: 660 };
    expect(nearestCardHit({ x: 380, y: 150 }, [card, farther])?.target.id).toBe('card:1');
    const overlapping = { ...card, id: 'card:2' };
    expect(nearestCardHit({ x: 200, y: 150 }, [card, overlapping])?.target.id).toBe('card:2');
  });

  it('reports Euclidean corner distance and clamps all grab edges', () => {
    expect(distanceToRect({ x: 90, y: 70 }, card)).toBeCloseTo(Math.hypot(10, 10));
    expect(boundedGrabOffset({ x: 90, y: 70 }, card)).toEqual({ x: 14, y: 14 });
    expect(boundedGrabOffset({ x: 400, y: 260 }, card)).toEqual({ x: 256, y: 146 });
  });
});
