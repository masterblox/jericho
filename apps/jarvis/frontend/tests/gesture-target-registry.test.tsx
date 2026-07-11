// @vitest-environment jsdom

import { StrictMode, useState } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GestureTargetRegistry,
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
