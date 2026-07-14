import { test, expect, type Page, type Locator } from '@playwright/test'

const CARD_GAP = 20
const CORE_EXPAND = 28

const V2_FIXTURE = {
  schemaVersion: 2, resultId: 'browser-1', phase: 'resolved', route: 'private_knowledge',
  summary: 'Isabella Handel is at MasterBlox', subject: 'Isabella', confidence: 'strong',
  canonicalIdentity: 'Isabella Handel', fullName: 'Isabella Handel', employment: ['MasterBlox'],
  claims: [{ id: 'cl-1', text: 'Isabella Handel works at MasterBlox', supportSourceIds: ['src-1'] }],
  conflicts: [{ id: 'conf-1', claim: 'Francisco-wife claim conflicts with canonical MasterBlox identity', reason: 'No canonical spouse in trusted sources', sourceIds: ['src-2'] }],
  provenance: [
    { sourceId: 'src-1', rootId: 'People', authority: 'canonical', relativePath: 'People/Isabella Handel.md', title: 'Isabella Handel', excerpt: 'Family and MasterBlox context.', score: 0.97 },
    { sourceId: 'src-2', rootId: 'Sessions', authority: 'supplemental', relativePath: 'Sessions/Francisco.md', title: 'Francisco', excerpt: 'Isabella is his wife.', score: 0.42 },
  ],
  actions: { openSourceIds: ['src-1'], reorganizeSourceIds: ['src-1'], correctConflictIds: ['conf-1'] },
  indexRevision: 'r7', retrievalCount: 2,
}

type Box = { x: number; y: number; width: number; height: number }

async function passConsentGate(page: Page) {
  const btn = page.getByRole('button', { name: /Continue with keyboard/i })
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) { await btn.click(); await page.waitForTimeout(500) }
}

async function dispatchV2(page: Page, d: Record<string, unknown>) {
  await page.evaluate((v) => { document.dispatchEvent(new CustomEvent('jericho:grounded-result', { detail: v })) }, d)
}

async function prepareProjection(page: Page, reducedMotion = false) {
  await page.goto('/')
  await passConsentGate(page)
  await page.waitForSelector('.stage', { timeout: 10000 })
  await page.waitForSelector('.core-sphere', { timeout: 10000 })
  if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' })
  await dispatchV2(page, V2_FIXTURE)
  await page.waitForSelector('.k-card--primary', { timeout: 5000 })
  await page.waitForSelector('.k-card--provenance', { timeout: 5000 })
  await page.waitForSelector('.k-card--actions', { timeout: 5000 })
  // Allow measured placement + optional column fallback to settle.
  await page.waitForTimeout(2500)
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox()
  expect(box, 'bounding box present').not.toBeNull()
  return box!
}

function separation(a: Box, b: Box): number {
  const ax2 = a.x + a.width
  const ay2 = a.y + a.height
  const bx2 = b.x + b.width
  const by2 = b.y + b.height
  const dx = a.x < b.x ? b.x - ax2 : a.x - bx2
  const dy = a.y < b.y ? b.y - ay2 : a.y - by2
  if (dx >= 0 && dy >= 0) return Math.hypot(dx, dy)
  if (dx >= 0) return dx
  if (dy >= 0) return dy
  return -Math.min(-dx, -dy) // overlap depth as negative
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

async function assertFullCardInViewport(page: Page, card: Locator, label: string) {
  const vp = page.viewportSize()!
  const box = await boxOf(card)
  expect(box.x, `${label} left`).toBeGreaterThanOrEqual(-1)
  expect(box.y, `${label} top`).toBeGreaterThanOrEqual(-1)
  expect(box.x + box.width, `${label} right`).toBeLessThanOrEqual(vp.width + 1)
  expect(box.y + box.height, `${label} bottom`).toBeLessThanOrEqual(vp.height + 1)
}

async function assertGeometryInvariants(page: Page) {
  const vp = page.viewportSize()!
  const sphere = page.locator('.core-sphere')
  await expect(sphere).toBeVisible()

  const primary = page.locator('.k-card--primary')
  const evidence = page.locator('.k-card--provenance')
  const actions = page.locator('.k-card--actions')
  await expect(primary).toBeVisible()
  await expect(evidence).toBeVisible()
  await expect(actions).toBeVisible()

  const flow = page.locator('.k-column-flow')
  const isColumn = (await flow.count()) > 0

  const core = page.locator('.core-wrap')
  const coreBox = await boxOf(core)
  const expandedCore: Box = {
    x: coreBox.x - CORE_EXPAND,
    y: coreBox.y - CORE_EXPAND,
    width: coreBox.width + CORE_EXPAND * 2,
    height: coreBox.height + CORE_EXPAND * 2,
  }

  const labels = ['primary', 'evidence', 'actions'] as const
  const cardLocators = [primary, evidence, actions]

  // Separation + Core clearance use one consistent geometry snapshot.
  const layout = await page.evaluate(() => {
    const pick = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height, top: el.offsetTop, heightOffset: el.offsetHeight }
    }
    const flowEl = document.querySelector('.k-column-flow') as HTMLElement | null
    return {
      isColumn: !!flowEl,
      flow: flowEl ? (() => {
        const r = flowEl.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height, scrollHeight: flowEl.scrollHeight }
      })() : null,
      primary: pick('.k-card--primary'),
      evidence: pick('.k-card--provenance'),
      actions: pick('.k-card--actions'),
      gap: flowEl ? getComputedStyle(flowEl).gap : null,
    }
  })

  expect(layout.primary).not.toBeNull()
  expect(layout.evidence).not.toBeNull()
  expect(layout.actions).not.toBeNull()
  const snapshot = [layout.primary!, layout.evidence!, layout.actions!]

  if (isColumn) {
    expect(layout.flow).not.toBeNull()
    // Pairwise separation in document/flow order (offsetTop), independent of scroll.
    const tops = [layout.primary!.top, layout.evidence!.top, layout.actions!.top]
    const heights = [layout.primary!.heightOffset, layout.evidence!.heightOffset, layout.actions!.heightOffset]
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const aBottom = tops[i] + heights[i]
        const bBottom = tops[j] + heights[j]
        const sep = tops[i] < tops[j] ? tops[j] - aBottom : tops[i] - bBottom
        expect(sep, `column ${labels[i]}↔${labels[j]} separation`).toBeGreaterThanOrEqual(CARD_GAP - 0.5)
      }
    }
    // Each card can be scrolled fully into the flow viewport; Sphere remains visible.
    for (let i = 0; i < cardLocators.length; i++) {
      const card = cardLocators[i]
      await card.scrollIntoViewIfNeeded()
      await expect(sphere, `sphere visible after scroll ${labels[i]}`).toBeVisible()
      const box = await boxOf(card)
      const flowBox = await boxOf(flow)
      expect(box.x, `${labels[i]} in flow x`).toBeGreaterThanOrEqual(flowBox.x - 1)
      expect(box.y, `${labels[i]} in flow y`).toBeGreaterThanOrEqual(flowBox.y - 1)
      expect(box.x + box.width, `${labels[i]} in flow right`).toBeLessThanOrEqual(flowBox.x + flowBox.width + 1)
      expect(box.y + box.height, `${labels[i]} in flow bottom`).toBeLessThanOrEqual(flowBox.y + flowBox.height + 1)
      await assertFullCardInViewport(page, card, labels[i])
      // Scrolled card must still clear expanded Core.
      expect(intersects(box, expandedCore), `${labels[i]} vs expanded Core`).toBe(false)
    }
  } else {
    for (let i = 0; i < snapshot.length; i++) {
      const box = snapshot[i]
      expect(box.x, `${labels[i]} left`).toBeGreaterThanOrEqual(-1)
      expect(box.y, `${labels[i]} top`).toBeGreaterThanOrEqual(-1)
      expect(box.x + box.width, `${labels[i]} right`).toBeLessThanOrEqual(vp.width + 1)
      expect(box.y + box.height, `${labels[i]} bottom`).toBeLessThanOrEqual(vp.height + 1)
      expect(intersects(box, expandedCore), `${labels[i]} vs expanded Core`).toBe(false)
    }
    for (let i = 0; i < snapshot.length; i++) {
      for (let j = i + 1; j < snapshot.length; j++) {
        const sep = separation(snapshot[i], snapshot[j])
        expect(sep, `${labels[i]}↔${labels[j]} separation`).toBeGreaterThanOrEqual(CARD_GAP - 0.5)
      }
    }
    if (vp.width === 1440 || vp.width === 1024) {
      const [p, e, a] = snapshot
      expect(p.x, 'primary-left').toBeLessThan(e.x)
      expect(e.x, 'evidence-right').toBeGreaterThan(p.x + p.width)
      expect(a.y, 'actions-below').toBeGreaterThanOrEqual(Math.max(p.y + p.height, e.y + e.height) + CARD_GAP - 0.5)
    }
  }

  if (vp.width === 390) {
    expect(isColumn, '390×844 uses column fallback').toBe(true)
  }
}

test.describe('knowledge projection geometry', () => {
  test('sphere visible, 3 cards, correct content', async ({ page }) => {
    await prepareProjection(page)
    await expect(page.locator('.core-sphere')).toBeVisible()
    await expect(page.locator('.k-card')).toHaveCount(3)
    await expect(page.locator('.k-card--primary')).toContainText('Isabella Handel')
    await expect(page.locator('.k-card--primary')).not.toContainText('Francisco')
    await expect(page.locator('.k-card--provenance')).toContainText('People/Isabella Handel.md')
    await expect(page.locator('.k-card--provenance')).toContainText('Francisco-wife claim')
    await expect(page.locator('.sphere-command')).toHaveAttribute('hidden', '')
  })

  test('hard geometry: viewport, sphere, separation, slots', async ({ page }) => {
    await prepareProjection(page)
    await assertGeometryInvariants(page)
  })

  test('screenshot', async ({ page }) => {
    await prepareProjection(page)
    await assertGeometryInvariants(page)
    const vp = page.viewportSize()!
    await page.screenshot({ path: `tests/browser/screenshots/wide-${vp.width}x${vp.height}.png`, fullPage: false })
  })

  test('reduced motion: hard geometry + screenshot', async ({ page }) => {
    await prepareProjection(page, true)
    await assertGeometryInvariants(page)
    const vp = page.viewportSize()!
    await page.screenshot({ path: `tests/browser/screenshots/reduced-motion-${vp.width}x${vp.height}.png`, fullPage: false })
  })
})
