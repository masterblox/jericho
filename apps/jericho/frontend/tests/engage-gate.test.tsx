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
    const runtime = { engage: vi.fn().mockResolvedValue(undefined), dispose: vi.fn().mockResolvedValue(undefined) };
    const createRuntime = vi.fn(() => runtime);
    const view = render(<StrictMode><EngageGate createRuntime={createRuntime} /></StrictMode>);

    expect(createRuntime).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Wake Jericho' }));
    fireEvent.click(screen.getByRole('button', { name: 'Waking…' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(runtime.engage).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps keyboard mode available after permission failure', async () => {
    const runtime = {
      engage: vi.fn().mockRejectedValue(new Error('Camera permission denied')),
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
    const runtime = { engage: vi.fn().mockResolvedValue(undefined), dispose: vi.fn().mockResolvedValue(undefined) };
    const createRuntime = vi.fn(() => runtime);
    render(<EngageGate createRuntime={createRuntime} />);
    fireEvent.click(screen.getByRole('button', { name: 'Wake Jericho' }));
    expect(createRuntime).toHaveBeenCalledWith(expect.any(Function));
  });
});
