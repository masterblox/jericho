const SPHERE_PADDING = 28;
const STAGE_PADDING = 24;
const CARD_SEPARATION = 20;
const CARD_WIDTH_MIN = 300;
const CARD_WIDTH_MAX = 380;

export function computeSphereExclusion(container) {
  if (!container) return null;
  const sphereEl = container.querySelector('[data-jericho-nucleus-space]');
  if (!sphereEl) return null;
  const rect = sphereEl.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    right: rect.right,
    bottom: rect.bottom,
  };
}

export function computeCardPlacement(sphereRect, viewport) {
  const exclusion = {
    left: sphereRect.left - SPHERE_PADDING,
    top: sphereRect.top - SPHERE_PADDING,
    right: sphereRect.right + SPHERE_PADDING,
    bottom: sphereRect.bottom + SPHERE_PADDING,
    width: sphereRect.width + SPHERE_PADDING * 2,
    height: sphereRect.height + SPHERE_PADDING * 2,
  };

  const cardWidth = Math.max(CARD_WIDTH_MIN, Math.min(CARD_WIDTH_MAX, viewport.width * 0.3));

  // Check if cards fit to the right of the sphere
  const rightSpace = viewport.width - exclusion.right - STAGE_PADDING;
  const leftSpace = exclusion.left - STAGE_PADDING;

  if (rightSpace >= cardWidth + CARD_SEPARATION) {
    return {
      side: 'right',
      x: exclusion.right + CARD_SEPARATION,
      y: exclusion.top,
      width: Math.min(cardWidth, rightSpace - CARD_SEPARATION),
    };
  }

  if (leftSpace >= cardWidth + CARD_SEPARATION) {
    return {
      side: 'left',
      x: STAGE_PADDING,
      y: exclusion.top,
      width: Math.min(cardWidth, leftSpace),
    };
  }

  // Narrow mode: cards go below the sphere
  const narrowWidth = Math.min(viewport.width - STAGE_PADDING * 2, 420);
  return {
    side: 'below',
    x: STAGE_PADDING,
    y: exclusion.bottom + CARD_SEPARATION,
    width: narrowWidth,
  };
}

export function isNarrowViewport(viewport) {
  return viewport.width < 768;
}

export const PHASE_LABELS = {
  idle: 'IDLE',
  room: 'ROOM',
  speech: 'SPEECH',
  clap: 'CLAP',
  live_canary: 'LIVE CANARY',
  review: 'REVIEW',
  saved: 'SAVED',
  failed: 'FAILED',
};
