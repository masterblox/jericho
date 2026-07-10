import { describe, expect, it } from 'vitest';
import { PointerController, type PointerTarget } from '../src/pointer-controller';

const card: PointerTarget = {
  id: 'card:0', draggable: true, left: 100, top: 80, right: 370, bottom: 240, boundaryDistance: 0,
};

describe('immediate pinch attachment', () => {
  it('attaches and emits the zero-jump position on the first pinch frame', () => {
    const pointer = new PointerController();
    pointer.update({ x: 130, y: 110 }, 'palm', 0, card);
    const actions = pointer.update({ x: 130, y: 110 }, 'pinch', 10, card);
    expect(actions).toContainEqual({ type: 'drag-start', targetId: 'card:0', offsetX: 30, offsetY: 30 });
    expect(actions).toContainEqual({ type: 'drag-move', targetId: 'card:0', left: 100, top: 80 });
  });

  it('preserves the exact grabbed point while attached', () => {
    const pointer = new PointerController();
    pointer.update({ x: 130, y: 110 }, 'palm', 0, card);
    pointer.update({ x: 130, y: 110 }, 'pinch', 10, card);
    const moved = pointer.update({ x: 180, y: 160 }, 'pinch', 40, card);
    expect(moved).toContainEqual({ type: 'drag-move', targetId: 'card:0', left: 150, top: 130 });
    const position = moved.find((action) => action.type === 'drag-move')!;
    if (position.type !== 'drag-move') throw new Error('expected drag move');
    expect(position.left + 30).toBe(180);
    expect(position.top + 30).toBe(160);
  });

  it('restores attachment then clicks exactly once on quick release', () => {
    const pointer = new PointerController();
    pointer.update({ x: 120, y: 100 }, 'palm', 0, card);
    pointer.update({ x: 120, y: 100 }, 'pinch', 10, card);
    pointer.update({ x: 122, y: 101 }, 'pinch', 50, card);
    const actions = pointer.update({ x: 122, y: 101 }, 'palm', 90, card);
    expect(actions).toEqual([
      { type: 'drag-end', targetId: 'card:0', cancelled: true },
      { type: 'click', targetId: 'card:0' },
    ]);
  });

  it('commits on either movement or hold threshold and keeps the drop', () => {
    const moved = new PointerController();
    moved.update({ x: 120, y: 100 }, 'palm', 0, card);
    moved.update({ x: 120, y: 100 }, 'pinch', 10, card);
    moved.update({ x: 127, y: 100 }, 'pinch', 20, card);
    expect(moved.update({ x: 127, y: 100 }, 'palm', 30, card)).toContainEqual({
      type: 'drag-end', targetId: 'card:0', cancelled: false,
    });

    const held = new PointerController();
    held.update({ x: 120, y: 100 }, 'palm', 0, card);
    held.update({ x: 120, y: 100 }, 'pinch', 10, card);
    expect(held.update({ x: 120, y: 100 }, 'palm', 130, card)).toContainEqual({
      type: 'drag-end', targetId: 'card:0', cancelled: false,
    });
  });

  it('restores without clicking when tracking cancellation ends attachment', () => {
    const pointer = new PointerController();
    pointer.update({ x: 120, y: 100 }, 'palm', 0, card);
    pointer.update({ x: 120, y: 100 }, 'pinch', 10, card);
    const cancelled = pointer.cancel();
    expect(cancelled).toContainEqual({ type: 'drag-end', targetId: 'card:0', cancelled: true });
    expect(cancelled.some((action) => action.type === 'click')).toBe(false);
    expect(pointer.update({ x: 120, y: 100 }, 'idle', 30, null).some((action) => action.type === 'click')).toBe(false);
  });

  it('supports repeated quick grabs without accumulating controller state', () => {
    const pointer = new PointerController();
    for (let cycle = 0; cycle < 3; cycle++) {
      const start = cycle * 100;
      pointer.update({ x: 120, y: 100 }, 'palm', start, card);
      expect(pointer.update({ x: 120, y: 100 }, 'pinch', start + 10, card).some((action) => action.type === 'drag-start')).toBe(true);
      const released = pointer.update({ x: 120, y: 100 }, 'palm', start + 50, card);
      expect(released.filter((action) => action.type === 'click')).toHaveLength(1);
    }
  });

  it('does not acquire a card entered after the pinch already started', () => {
    const pointer = new PointerController();
    pointer.update({ x: 20, y: 20 }, 'palm', 0, null);
    expect(pointer.update({ x: 20, y: 20 }, 'pinch', 10, null).some((action) => action.type === 'drag-start')).toBe(false);
    expect(pointer.update({ x: 120, y: 100 }, 'pinch', 40, card).some((action) => action.type === 'drag-start')).toBe(false);
  });

  it('moves the card minimally so an edge pinch is 14px inside', () => {
    const pointer = new PointerController();
    const edge = { x: card.right - 7, y: 150 };
    pointer.update(edge, 'palm', 0, card);
    const actions = pointer.update(edge, 'pinch', 10, card);
    expect(actions).toContainEqual({
      type: 'drag-start', targetId: 'card:0', offsetX: 256, offsetY: 70,
    });
    expect(actions).toContainEqual({
      type: 'drag-move', targetId: 'card:0', left: 107, top: 80,
    });
  });
});
