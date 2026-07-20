import { describe, expect, it } from 'vitest';
import { GrabSelectionState } from '../src/grab-selection';

describe('grab selection preview', () => {
  it('moves the active visual from the previous card to the grabbed card immediately', () => {
    const state = new GrabSelectionState();
    state.select(1);
    state.beginGrab(0);
    expect(state.selected).toBe(-1);
    expect(state.previewed).toBe(0);
  });

  it('restores the prior selection when a grab is cancelled', () => {
    const state = new GrabSelectionState();
    state.select(1);
    state.beginGrab(0);
    state.endGrab(0, true);
    expect(state.selected).toBe(1);
    expect(state.previewed).toBe(-1);
  });

  it('commits the grabbed selection after a drop or quick-click sequence', () => {
    const dropped = new GrabSelectionState();
    dropped.select(1);
    dropped.beginGrab(0);
    dropped.endGrab(0, false);
    expect(dropped.selected).toBe(0);

    const clicked = new GrabSelectionState();
    clicked.select(1);
    clicked.beginGrab(0);
    clicked.endGrab(0, true);
    clicked.select(0);
    expect(clicked.selected).toBe(0);
  });
});
