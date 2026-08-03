export interface DragLayoutOrigin {
  left: string;
  top: string;
  transformOffsetX: number;
  transformOffsetY: number;
}

export function captureDragLayout(
  inlineLeft: string,
  inlineTop: string,
  visualLeft: number,
  visualTop: number,
): DragLayoutOrigin {
  const layoutLeft = Number.parseFloat(inlineLeft);
  const layoutTop = Number.parseFloat(inlineTop);
  return {
    left: inlineLeft,
    top: inlineTop,
    transformOffsetX: visualLeft - (Number.isFinite(layoutLeft) ? layoutLeft : visualLeft),
    transformOffsetY: visualTop - (Number.isFinite(layoutTop) ? layoutTop : visualTop),
  };
}

export function finishDragLayout(
  origin: DragLayoutOrigin,
  currentLeft: string,
  currentTop: string,
  cancelled: boolean,
): { left: string; top: string } {
  if (cancelled) return { left: origin.left, top: origin.top };
  const left = Number.parseFloat(currentLeft);
  const top = Number.parseFloat(currentTop);
  return {
    left: Number.isFinite(left) ? `${left - origin.transformOffsetX}px` : currentLeft,
    top: Number.isFinite(top) ? `${top - origin.transformOffsetY}px` : currentTop,
  };
}
