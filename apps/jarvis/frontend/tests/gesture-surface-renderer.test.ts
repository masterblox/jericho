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
    expect(action?.tabIndex).toBe(0);
    expect(action?.dataset.gestureTarget).toBe('runtime-action:approve');
    expect(action?.closest('[aria-hidden="true"]')).toBeNull();
    action?.click();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('.jericho-action-ring')).toBeNull();
  });

  it('renders keyboard-accessible local controls and calibration UI outside React ownership', () => {
    const root = document.createElement('div');
    root.id = 'app';
    root.textContent = 'React command center';
    document.body.append(root);
    const calibrate = vi.fn();
    const reset = vi.fn();
    const swap = vi.fn();
    const diagnostics = vi.fn();
    const exportDiagnostics = vi.fn();
    const renderer = new GestureSurfaceRenderer(document);

    renderer.configureControls({ calibrate, reset, swap, diagnostics, exportDiagnostics });
    renderer.updateControlState({
      calibratedHands: ['Right'], swapped: true, diagnosticsEnabled: true,
    });
    renderer.showCalibration({
      handedness: 'Left', target: 'center', point: { x: 0.5, y: 0.5 },
      message: 'Hold left palm at center, then pinch',
    });
    renderer.showDiagnostics('fps 60 · inference 5ms');

    const left = document.body.querySelector<HTMLButtonElement>('[data-runtime-control="calibrate-left"]')!;
    const resetButton = document.body.querySelector<HTMLButtonElement>('[data-runtime-control="reset"]')!;
    const swapButton = document.body.querySelector<HTMLButtonElement>('[data-runtime-control="swap"]')!;
    expect(left.tagName).toBe('BUTTON');
    expect(left.tabIndex).toBe(0);
    expect(left.closest('#app')).toBeNull();
    expect(left.closest('[aria-hidden="true"]')).toBeNull();
    expect(left.dataset.gestureTarget).toBe('runtime-control:calibrate-left');
    expect(swapButton.getAttribute('aria-pressed')).toBe('true');
    expect(document.body.querySelector('[data-runtime-control="calibrate-right"]')?.classList.contains('ready')).toBe(true);
    expect(document.body.querySelector('[data-calibration-target="center"]')).toBeTruthy();
    expect(document.body.querySelector('.jericho-runtime-diagnostics')?.textContent).toContain('fps 60');

    left.click();
    resetButton.click();
    swapButton.click();
    document.body.querySelector<HTMLButtonElement>('[data-runtime-control="diagnostics"]')!.click();
    document.body.querySelector<HTMLButtonElement>('[data-runtime-control="export"]')!.click();
    expect(calibrate).toHaveBeenCalledWith('Left');
    expect(reset).toHaveBeenCalledTimes(1);
    expect(swap).toHaveBeenCalledTimes(1);
    expect(diagnostics).toHaveBeenCalledTimes(1);
    expect(exportDiagnostics).toHaveBeenCalledTimes(1);
    expect(root.textContent).toBe('React command center');
  });
});
