import { describe, expect, it } from 'vitest';
import { captureDragLayout, finishDragLayout } from '../src/drag-layout';

describe('transformed card drag layout', () => {
  it('restores the exact inline position when a quick attachment becomes a click', () => {
    const origin = captureDragLayout('250px', '300px', 250, 290);
    expect(finishDragLayout(origin, '252px', '291px', true)).toEqual({ left: '250px', top: '300px' });
  });

  it('compensates selected-card transform when a drag commits', () => {
    const origin = captureDragLayout('250px', '300px', 250, 290);
    const finished = finishDragLayout(origin, '400px', '500px', false);
    expect(finished).toEqual({ left: '400px', top: '510px' });
    // Reapplying the original -10px selected transform keeps the visible top at 500.
    expect(Number.parseFloat(finished.top) + origin.transformOffsetY).toBe(500);
  });

  it('does not accumulate drift over repeated committed grabs', () => {
    let inlineTop = '300px';
    let visualTop = 290;
    for (let cycle = 0; cycle < 3; cycle++) {
      const origin = captureDragLayout('250px', inlineTop, 250, visualTop);
      visualTop += 50;
      inlineTop = finishDragLayout(origin, '250px', `${visualTop}px`, false).top;
      expect(Number.parseFloat(inlineTop) + origin.transformOffsetY).toBe(visualTop);
    }
  });
});
