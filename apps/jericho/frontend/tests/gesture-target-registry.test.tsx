// @vitest-environment jsdom

import { StrictMode, useState } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GestureTargetRegistry,
  observeDomGestureTargets,
  useGestureTarget,
} from '../src/gesture-target-registry';

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('GestureTargetRegistry', () => {
  it('ignores stale StrictMode-style cleanup and keeps the newest generation registered', () => {
    const registry = new GestureTargetRegistry(document);
    const first = document.createElement('button');
    const second = document.createElement('button');
    document.body.append(first, second);
    rect(first, 0, 0, 100, 100);
    rect(second, 0, 0, 100, 100);

    const unregisterFirst = registry.register({ id: 'same', element: first });
    const unregisterSecond = registry.register({ id: 'same', element: second });
    unregisterFirst();
    elementsFromPoint([second]);

    expect(registry.resolveAt({ x: 20, y: 20 })?.element).toBe(second);
    unregisterSecond();
    expect(registry.resolveAt({ x: 20, y: 20 })).toBeNull();
  });

  it('resolves the browser topmost target and explicitly clears sticky acquisition', () => {
    const registry = new GestureTargetRegistry(document);
    const lower = document.createElement('button');
    const upper = document.createElement('button');
    document.body.append(lower, upper);
    rect(lower, 0, 0, 100, 100);
    rect(upper, 0, 0, 100, 100);
    registry.register({ id: 'lower', element: lower });
    registry.register({ id: 'upper', element: upper });
    const elements = elementsFromPoint([upper, lower]);

    expect(registry.resolveAt({ x: 30, y: 30 })?.id).toBe('upper');
    registry.lock('upper');
    elements.mockReturnValue([lower]);
    expect(registry.resolveAt({ x: 110, y: 50 })?.id).toBe('upper');
    registry.releaseSticky();
    expect(registry.resolveAt({ x: 30, y: 30 })?.id).toBe('lower');
  });

  it('automatically keeps a pre-pinch draggable target through release-boundary jitter', () => {
    const registry = new GestureTargetRegistry(document);
    const card = document.createElement('article');
    const other = document.createElement('article');
    document.body.append(card, other);
    rect(card, 100, 80, 270, 160);
    rect(other, 390, 80, 270, 160);
    registry.register({ id: 'card', element: card, draggable: true });
    registry.register({ id: 'other', element: other, draggable: true });
    const elements = elementsFromPoint([card]);

    expect(registry.resolveAt({ x: 375, y: 150 })?.id).toBe('card');
    elements.mockReturnValue([other]);
    expect(registry.resolveAt({ x: 420, y: 150 })?.id).toBe('card');
    registry.releaseSticky();
    expect(registry.resolveAt({ x: 420, y: 150 })?.id).toBe('other');
  });

  it('chooses the nearest registered ancestor for nested topmost content', () => {
    const registry = new GestureTargetRegistry(document);
    const parent = document.createElement('article');
    const child = document.createElement('button');
    const label = document.createElement('span');
    child.append(label);
    parent.append(child);
    document.body.append(parent);
    rect(parent, 0, 0, 200, 100);
    rect(child, 20, 20, 120, 50);
    rect(label, 30, 30, 80, 20);
    registry.register({ id: 'parent', element: parent });
    registry.register({ id: 'child', element: child });
    elementsFromPoint([label, child, parent]);

    expect(registry.resolveAt({ x: 40, y: 40 })?.id).toBe('child');
  });

  it('survives React StrictMode ref replay and invokes the current semantic target', () => {
    const registry = new GestureTargetRegistry(document);
    const invoked = vi.fn();

    function Target() {
      const [label, setLabel] = useState('first');
      const targetRef = useGestureTarget(registry, {
        id: 'react-target',
        onTap: invoked,
      });
      return <button ref={targetRef} onClick={() => setLabel('second')}>{label}</button>;
    }

    const view = render(<StrictMode><Target /></StrictMode>);
    const button = view.getByRole('button');
    rect(button, 0, 0, 120, 60);
    elementsFromPoint([button]);
    fireEvent.click(button);

    registry.resolveAt({ x: 10, y: 10 })?.invokeTap();
    expect(invoked).toHaveBeenCalledTimes(1);
    expect(view.getByRole('button').textContent).toBe('second');
  });

  it('emits semantic drag events for declarative draggable targets without mutating layout', () => {
    const registry = new GestureTargetRegistry(document);
    const root = document.createElement('main');
    const card = document.createElement('article');
    card.dataset.gestureTarget = 'relationship-card';
    card.dataset.gestureDraggable = 'true';
    card.style.left = '40px';
    card.style.top = '50px';
    root.append(card);
    document.body.append(root);
    rect(card, 40, 50, 200, 100);
    const start = vi.fn();
    const move = vi.fn();
    const end = vi.fn();
    card.addEventListener('jericho:drag-start', start);
    card.addEventListener('jericho:drag-move', move);
    card.addEventListener('jericho:drag-end', end);
    const stop = observeDomGestureTargets(root, registry);

    const target = registry.get('relationship-card')!;
    target.dragStart({ x: 60, y: 70 });
    target.dragMove({ x: 90, y: 100 }, { x: 30, y: 30 });
    target.dragEnd({ x: 90, y: 100 }, false);

    expect((start.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      targetId: 'relationship-card', point: { x: 60, y: 70 },
    });
    expect((move.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      targetId: 'relationship-card', point: { x: 90, y: 100 }, delta: { x: 30, y: 30 },
    });
    expect((end.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      targetId: 'relationship-card', point: { x: 90, y: 100 }, cancelled: false,
    });
    expect(card.style.left).toBe('40px');
    expect(card.style.top).toBe('50px');
    stop();
  });
});

function rect(element: Element, left: number, top: number, width: number, height: number) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    left, top, width, height, right: left + width, bottom: top + height,
    x: left, y: top, toJSON: () => ({}),
  });
}

function elementsFromPoint(elements: Element[]) {
  const implementation = vi.fn().mockReturnValue(elements);
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: implementation,
  });
  return implementation;
}
