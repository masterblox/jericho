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
    fireEvent.click(screen.getByRole('button', { name: 'Engage local runtime' }));
    fireEvent.click(screen.getByRole('button', { name: 'Engaging…' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Engage local runtime' }));

    expect(await screen.findByText('Camera permission denied')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue with keyboard' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
  });
});
