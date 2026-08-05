// @vitest-environment jsdom

import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngageGate } from '../src/engage-gate';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('EngageGate', () => {
  it('constructs hardware runtime only inside the user gesture and disposes it on unmount', async () => {
    const runtime = {
      engage: vi.fn().mockResolvedValue(undefined),
      wake: vi.fn(),
      recalibrate: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const createRuntime = vi.fn(() => runtime);
    const view = render(<StrictMode><EngageGate createRuntime={createRuntime} /></StrictMode>);

    expect(createRuntime).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Wake Jericho' }));
    fireEvent.click(screen.getByRole('button', { name: 'Waking…' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(runtime.engage).toHaveBeenCalledTimes(1);
    expect(runtime.wake).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps keyboard mode available after permission failure', async () => {
    const runtime = {
      engage: vi.fn().mockRejectedValue(new Error('Camera permission denied')),
      wake: vi.fn(),
      recalibrate: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    render(<EngageGate createRuntime={() => runtime} />);
    fireEvent.click(screen.getByRole('button', { name: 'Wake Jericho' }));

    expect(await screen.findByText('Camera permission denied')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
  });

  it('enters keyboard mode without constructing hardware and can cancel a pending permission request', async () => {
    const directCreateRuntime = vi.fn();
    const direct = render(<EngageGate createRuntime={directCreateRuntime} />);

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(directCreateRuntime).not.toHaveBeenCalled();
    direct.unmount();

    let finishEngagement!: () => void;
    const runtime = {
      engage: vi.fn(() => new Promise<void>((resolve) => { finishEngagement = resolve; })),
      wake: vi.fn(),
      recalibrate: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    render(<EngageGate createRuntime={() => runtime} />);
    fireEvent.click(screen.getByRole('button', { name: 'Wake Jericho' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
    finishEngagement();
    await Promise.resolve();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('calls createRuntime with the engagement state callback', async () => {
    const runtime = {
      engage: vi.fn().mockResolvedValue(undefined),
      wake: vi.fn(),
      recalibrate: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const createRuntime = vi.fn(() => runtime);
    render(<EngageGate createRuntime={createRuntime} />);
    fireEvent.click(screen.getByRole('button', { name: 'Wake Jericho' }));
    expect(createRuntime).toHaveBeenCalledWith(expect.any(Function));
  });

  it('can leave an in-progress hand calibration for keyboard mode', async () => {
    let reportState!: (state: import('../src/jericho-runtime').EngagementState) => void;
    const runtime = {
      engage: vi.fn(() => new Promise<void>(() => {})),
      wake: vi.fn(),
      recalibrate: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    render(<EngageGate createRuntime={(onState) => {
      reportState = onState;
      return runtime;
    }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Wake Jericho' }));
    reportState('calibrating_left');
    expect(await screen.findByRole('button', { name: 'Use keyboard' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use keyboard' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
  });

  it('releases a failed runtime so Retry Wake constructs a fresh one', async () => {
    const first = {
      engage: vi.fn().mockRejectedValue(new Error('Camera unavailable')),
      wake: vi.fn(),
      recalibrate: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const second = {
      engage: vi.fn().mockResolvedValue(undefined),
      wake: vi.fn(),
      recalibrate: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const onRuntimeChange = vi.fn();
    const createRuntime = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    render(<EngageGate createRuntime={createRuntime} onRuntimeChange={onRuntimeChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Wake Jericho' }));
    expect(await screen.findByRole('button', { name: 'Retry Wake' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Wake' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(createRuntime).toHaveBeenCalledTimes(2);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.engage).toHaveBeenCalledTimes(1);
    expect(second.wake).toHaveBeenCalledTimes(1);
    expect(onRuntimeChange).toHaveBeenCalledWith(null);
    expect(onRuntimeChange).toHaveBeenLastCalledWith(second);
  });
});
