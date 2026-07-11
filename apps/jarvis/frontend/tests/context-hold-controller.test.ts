import { describe, expect, it } from 'vitest';

import {
  CONTEXT_HOLD_MS,
  ContextHoldController,
  type ContextTarget,
} from '../src/context-hold-controller';

const fixed: ContextTarget = { id: 'entity:1', draggable: false };
const draggable: ContextTarget = { id: 'card:1', draggable: true };

describe('ContextHoldController', () => {
  it('turns a short stationary pinch into exactly one tap', () => {
    const controller = new ContextHoldController();
    expect(controller.update({ point: { x: 10, y: 10 }, pinching: true, now: 0, target: fixed }))
      .toContainEqual({ type: 'press-start', targetId: fixed.id });
    expect(controller.update({ point: { x: 11, y: 10 }, pinching: false, now: 120, target: fixed }))
      .toEqual([{ type: 'tap', targetId: fixed.id }, { type: 'release', targetId: fixed.id, held: false }]);
  });

  it('reveals context once after a stationary hold and suppresses tap', () => {
    const controller = new ContextHoldController();
    controller.update({ point: { x: 10, y: 10 }, pinching: true, now: 0, target: fixed });
    expect(controller.update({ point: { x: 11, y: 10 }, pinching: true, now: CONTEXT_HOLD_MS, target: fixed }))
      .toEqual([{ type: 'hold', targetId: fixed.id, point: { x: 11, y: 10 } }]);
    expect(controller.update({ point: { x: 11, y: 10 }, pinching: true, now: CONTEXT_HOLD_MS + 100, target: fixed }))
      .toEqual([]);
    expect(controller.update({ point: { x: 11, y: 10 }, pinching: false, now: CONTEXT_HOLD_MS + 120, target: fixed }))
      .toEqual([{ type: 'release', targetId: fixed.id, held: true }]);
  });

  it('starts drag only when movement wins before the hold threshold', () => {
    const controller = new ContextHoldController();
    controller.update({ point: { x: 10, y: 10 }, pinching: true, now: 0, target: draggable });
    expect(controller.update({ point: { x: 19, y: 10 }, pinching: true, now: 80, target: draggable }))
      .toEqual([
        { type: 'drag-start', targetId: draggable.id, point: { x: 10, y: 10 } },
        { type: 'drag-move', targetId: draggable.id, point: { x: 19, y: 10 }, delta: { x: 9, y: 0 } },
      ]);
    expect(controller.update({ point: { x: 30, y: 14 }, pinching: true, now: 120, target: draggable }))
      .toEqual([{ type: 'drag-move', targetId: draggable.id, point: { x: 30, y: 14 }, delta: { x: 20, y: 4 } }]);
    expect(controller.update({ point: { x: 30, y: 14 }, pinching: false, now: 140, target: draggable }))
      .toEqual([
        { type: 'drag-end', targetId: draggable.id, point: { x: 30, y: 14 }, cancelled: false },
        { type: 'release', targetId: draggable.id, held: false },
      ]);
  });

  it('cancels active work without a tap or committed drop', () => {
    const controller = new ContextHoldController();
    controller.update({ point: { x: 10, y: 10 }, pinching: true, now: 0, target: draggable });
    controller.update({ point: { x: 20, y: 10 }, pinching: true, now: 40, target: draggable });
    expect(controller.cancel()).toEqual([
      { type: 'drag-end', targetId: draggable.id, point: { x: 20, y: 10 }, cancelled: true },
      { type: 'cancel', targetId: draggable.id },
    ]);
  });
});
