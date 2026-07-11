// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { GestureSurfaceRenderer } from '../src/gesture-surface-renderer';

afterEach(() => {
  document.body.replaceChildren();
});

describe('GestureSurfaceRenderer', () => {
  it('owns only a body overlay and never replaces the React root', () => {
    const root = document.createElement('div');
    root.id = 'app';
    const reactMarker = document.createElement('article');
    reactMarker.textContent = 'React-owned mission';
    root.append(reactMarker);
    document.body.append(root);
    const before = root.innerHTML;

    const renderer = new GestureSurfaceRenderer(document);
    renderer.render({
      right: { visible: true, x: 120, y: 80, mode: 'pinch' },
      left: { visible: false, x: 0, y: 0, mode: 'idle' },
      status: 'gestures online',
    });

    expect(root.innerHTML).toBe(before);
    expect(root.querySelector('.jericho-gesture-surface')).toBeNull();
    expect(document.body.querySelector('.jericho-gesture-surface')).toBeTruthy();
    expect(document.body.querySelector('.jericho-gesture-cursor--pinch')).toBeTruthy();

    renderer.dispose();
    expect(root.innerHTML).toBe(before);
    expect(document.body.querySelector('.jericho-gesture-surface')).toBeNull();
  });

  it('shows only supplied contextual actions and invokes the selected callback', () => {
    const invoke = vi.fn();
    const renderer = new GestureSurfaceRenderer(document);
    renderer.showActionRing({ x: 200, y: 160 }, [
      { id: 'approve', label: 'Approve bounded mission', invoke },
    ]);

    const action = document.body.querySelector<HTMLButtonElement>('[data-gesture-action="approve"]');
    expect(action?.textContent).toBe('Approve bounded mission');
    action?.click();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('.jericho-action-ring')).toBeNull();
  });
});
