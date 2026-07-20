export const SPHERE_PADDING = 28
export const STAGE_PADDING = 24
export const CARD_SEPARATION = 20
export const CARD_WIDTH_MIN = 300
export const CARD_WIDTH_MAX = 380

export function computeSphereExclusion(coreElement, stageElement) {
  if (!coreElement || !stageElement) return null
  const core = coreElement.getBoundingClientRect()
  const stage = stageElement.getBoundingClientRect()
  return {
    left: core.left - stage.left - SPHERE_PADDING,
    top: core.top - stage.top - SPHERE_PADDING,
    right: core.right - stage.left + SPHERE_PADDING,
    bottom: core.bottom - stage.top + SPHERE_PADDING,
    width: core.width + SPHERE_PADDING * 2,
    height: core.height + SPHERE_PADDING * 2,
  }
}

export function computeCardPlacement(exclusion, stage, card, occupied = []) {
  if (!exclusion || !positiveRect(stage)) return null
  const preferredWidth = Math.min(
    CARD_WIDTH_MAX,
    Math.max(Math.min(CARD_WIDTH_MIN, stage.width - STAGE_PADDING * 2), Math.min(card?.width || CARD_WIDTH_MIN, stage.width - STAGE_PADDING * 2)),
  )
  const minimumWidth = Math.min(CARD_WIDTH_MIN, stage.width - STAGE_PADDING * 2)
  const height = Math.max(120, Math.min(card?.height || 260, stage.height - STAGE_PADDING * 2))
  const centeredY = clamp((exclusion.top + exclusion.bottom - height) / 2, STAGE_PADDING, stage.height - STAGE_PADDING - height)
  const widths = [...new Set([preferredWidth, minimumWidth])]
  const sideCandidates = widths.flatMap(width => [
    { side: 'right', x: exclusion.right + CARD_SEPARATION, y: centeredY, width, height },
    { side: 'left', x: exclusion.left - CARD_SEPARATION - width, y: centeredY, width, height },
  ])
  const centeredX = clamp((stage.width - preferredWidth) / 2, STAGE_PADDING, stage.width - STAGE_PADDING - preferredWidth)
  const candidates = [
    ...sideCandidates,
    { side: 'above', x: centeredX, y: exclusion.top - CARD_SEPARATION - height, width: preferredWidth, height },
    { side: 'below', x: centeredX, y: exclusion.bottom + CARD_SEPARATION, width: preferredWidth, height },
  ]
  const fit = candidates.find(candidate => insideStage(candidate, stage) && occupied.every(rect => separated(candidate, rect, CARD_SEPARATION)))
  if (fit) return { ...fit, flow: false, maxHeight: height }

  const y = Math.max(STAGE_PADDING, exclusion.bottom + CARD_SEPARATION)
  const availableHeight = stage.height - STAGE_PADDING - y
  if (availableHeight >= 120) {
    return {
      side: 'below',
      x: centeredX,
      y,
      width: preferredWidth,
      height: Math.min(height, availableHeight),
      maxHeight: availableHeight,
      flow: true,
    }
  }

  const aboveHeight = Math.max(120, exclusion.top - CARD_SEPARATION - STAGE_PADDING)
  return {
    side: 'above',
    x: centeredX,
    y: STAGE_PADDING,
    width: preferredWidth,
    height: Math.min(height, aboveHeight),
    maxHeight: aboveHeight,
    flow: true,
  }
}

export function relativeRects(elements, stageElement) {
  if (!stageElement) return []
  const stage = stageElement.getBoundingClientRect()
  return [...elements].map(element => {
    const rect = element.getBoundingClientRect()
    return {
      x: rect.left - stage.left,
      y: rect.top - stage.top,
      width: rect.width,
      height: rect.height,
    }
  }).filter(positiveRect)
}

function insideStage(rect, stage) {
  return rect.x >= STAGE_PADDING
    && rect.y >= STAGE_PADDING
    && rect.x + rect.width <= stage.width - STAGE_PADDING
    && rect.y + rect.height <= stage.height - STAGE_PADDING
}

function separated(a, b, gap) {
  return a.x + a.width + gap <= b.x
    || b.x + b.width + gap <= a.x
    || a.y + a.height + gap <= b.y
    || b.y + b.height + gap <= a.y
}

function positiveRect(rect) {
  return rect && Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width > 0 && rect.height > 0
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value))
}
