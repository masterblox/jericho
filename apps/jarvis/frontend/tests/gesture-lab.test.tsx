// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { JERICHO_CANCEL_PENDING_EVENT, JERICHO_NUCLEUS_CAMERA_EVENT } from '../src/gesture-events';
import { GestureLab } from '../src/gesture-lab';

afterEach(() => document.body.replaceChildren());

describe('GestureLab', () => {
  it('is a focused test surface with production gesture targets and no raw sensor output', () => {
    const root = document.createElement('div');
    document.body.append(root);
    render(<GestureLab root={root} />, { container: root });

    expect(screen.getByRole('heading', { name: 'Gesture Lab' })).toBeTruthy();
    expect(document.querySelector('[data-gesture-target="lab-target"]')).toBeTruthy();
    expect(document.querySelector('[data-gesture-draggable="true"]')).toBeTruthy();
    expect(document.querySelector('[data-jericho-nucleus-space="true"]')).toBeTruthy();
    expect(document.querySelector('[data-jericho-active-approval="true"]')).toBeTruthy();
    expect(root.textContent).not.toMatch(/landmark|raw frame|audio payload/i);
  });

  it('shows immediate pass feedback from the semantic events production emits', () => {
    const root = document.createElement('div');
    document.body.append(root);
    render(<GestureLab root={root} />, { container: root });

    fireEvent.click(screen.getByRole('button', { name: /TARGET/ }));
    fireEvent(document, new CustomEvent(JERICHO_NUCLEUS_CAMERA_EVENT));
    fireEvent(document, new CustomEvent(JERICHO_CANCEL_PENDING_EVENT));

    expect(screen.getByText('Pinch tap').closest('li')?.className).toContain('is-pass');
    expect(screen.getByText('Nucleus clutch').closest('li')?.className).toContain('is-pass');
    expect(screen.getByText('Cancel').closest('li')?.className).toContain('is-pass');
  });
});
