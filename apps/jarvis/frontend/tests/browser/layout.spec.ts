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

async function waitForCardEntryAnimations(page: Page) {
  await page.waitForFunction(() => {
    const cards = [...document.querySelectorAll<HTMLElement>('.k-card')]
    if (cards.length < 3) return false
    return cards.every((el) => {
      const opacity = Number(getComputedStyle(el).opacity)
      if (opacity < 0.99) return false
      const anims = typeof el.getAnimations === 'function' ? el.getAnimations() : []
      return anims.every((a) => a.playState === 'finished' || a.playState === 'idle')
    })
  }, undefined, { timeout: 8_000 })
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
  await waitForCardEntryAnimations(page)
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

/** Initial projection evidence — never call scrollIntoViewIfNeeded before this. */
async function assertInitialProjectionEvidence(page: Page) {
  const vp = page.viewportSize()!
  const sphere = page.locator('.core-sphere')
  const primary = page.locator('.k-card--primary')
  const evidence = page.locator('.k-card--provenance')
  const actions = page.locator('.k-card--actions')
  await expect(sphere).toBeVisible()
  await expect(primary).toBeVisible()
  await expect(evidence).toBeVisible()
  await expect(actions).toBeVisible()

  await expect(primary).toContainText('Isabella Handel')
  await expect(primary).toContainText(/CONFIDENCE\s*·\s*STRONG/i)
  await expect(primary).toContainText('Isabella Handel works at MasterBlox')
  await expect(primary).not.toContainText('Francisco')

  const flow = page.locator('.k-column-flow')
  const isColumn = (await flow.count()) > 0

  if (isColumn) {
    const scrollTop = await flow.evaluate((el) => (el as HTMLElement).scrollTop)
    expect(scrollTop, 'narrow/column initial scroll must be at top').toBe(0)
    const sphereBox = await boxOf(sphere)
    const primaryBox = await boxOf(primary)
    expect(sphereBox.y + sphereBox.height / 2, 'sphere above primary column').toBeLessThan(primaryBox.y)
    // Primary is first in the scrollable column (Sphere remains above the flow).
    const order = await page.evaluate(() => {
      const cards = [...document.querySelectorAll<HTMLElement>('.k-column-flow .k-card')]
      return cards.map((el) => el.getAttribute('data-knowledge-card'))
    })
    expect(order[0], 'primary leads column').toBe('primary')
    expect(primaryBox.y, 'primary visible in initial column view').toBeLessThan(vp.height)
    await assertFullCardInViewport(page, primary, 'initial-primary')
  } else {
    await assertFullCardInViewport(page, primary, 'initial-primary')
    await assertFullCardInViewport(page, evidence, 'initial-evidence')
    await assertFullCardInViewport(page, actions, 'initial-actions')
    // Primary content must not require internal scroll.
    const primaryScroll = await primary.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollTop: el.scrollTop,
    }))
    expect(primaryScroll.scrollTop).toBe(0)
    expect(primaryScroll.scrollHeight, 'primary content fits without scroll').toBeLessThanOrEqual(primaryScroll.clientHeight + 2)
    // Evidence may scroll internally but must keep a complete frame.
    const evidenceBox = await boxOf(evidence)
    expect(evidenceBox.width).toBeGreaterThan(100)
    expect(evidenceBox.height).toBeGreaterThan(80)
  }
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
    await assertInitialProjectionEvidence(page)
    await assertGeometryInvariants(page)
  })

  test('screenshot', async ({ page }) => {
    await prepareProjection(page)
    await assertInitialProjectionEvidence(page)
    const vp = page.viewportSize()!
    // Capture the initial state before any scrollIntoViewIfNeeded.
    await page.screenshot({ path: `tests/browser/screenshots/wide-${vp.width}x${vp.height}.png`, fullPage: false })
    await assertGeometryInvariants(page)
  })

  test('reduced motion: hard geometry + screenshot', async ({ page }) => {
    await prepareProjection(page, true)
    await assertInitialProjectionEvidence(page)
    const vp = page.viewportSize()!
    await page.screenshot({ path: `tests/browser/screenshots/reduced-motion-${vp.width}x${vp.height}.png`, fullPage: false })
    await assertGeometryInvariants(page)
  })
})

test.describe('action terminal states', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await passConsentGate(page)
    await page.waitForSelector('.stage', { timeout: 10000 })
    await page.waitForSelector('.core-sphere', { timeout: 10000 })
  })

  test('open succeeds via pointer and renders NOTE OPENED', async ({ page }) => {
    let openCount = 0
    await page.route('**/api/v1/grounded-results/**/actions/open', async (route) => {
      openCount += 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await dispatchV2(page, V2_FIXTURE)
    await page.waitForSelector('.k-card--actions', { timeout: 5000 })
    await page.waitForTimeout(600)

    await page.locator('.k-actions button', { hasText: 'OPEN NOTE' }).first().click()
    await expect(page.locator('.k-status')).toContainText('NOTE OPENED')
    await expect(page.locator('.k-status')).not.toContainText('WORKING')
    expect(openCount).toBe(1)
  })

  test('open fails via intercepted endpoint and renders ACTION FAILED', async ({ page }) => {
    await page.route('**/api/v1/grounded-results/**/actions/open', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'ACTION FAILED' }) })
    })
    await dispatchV2(page, V2_FIXTURE)
    await page.waitForSelector('.k-card--actions', { timeout: 5000 })
    await page.waitForTimeout(600)

    await page.locator('.k-actions button', { hasText: 'OPEN NOTE' }).first().click()
    await expect(page.locator('.k-status')).toContainText('ACTION FAILED')
    await expect(page.locator('.k-status')).not.toContainText('WORKING')
  })

  test('keyboard Enter invokes same action as pointer click exactly once', async ({ page }) => {
    let openCount = 0
    await page.route('**/api/v1/grounded-results/**/actions/open', async (route) => {
      openCount += 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await dispatchV2(page, V2_FIXTURE)
    await page.waitForSelector('.k-card--actions', { timeout: 5000 })
    await page.waitForTimeout(600)

    const button = page.locator('.k-actions button', { hasText: 'OPEN NOTE' }).first()
    await button.focus()
    await button.press('Enter')
    await expect(page.locator('.k-status')).toContainText('NOTE OPENED')
    expect(openCount).toBe(1)
  })

  test('registry invokeTap invokes same action as pointer exactly once', async ({ page }) => {
    let openCount = 0
    await page.route('**/api/v1/grounded-results/**/actions/open', async (route) => {
      openCount += 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await dispatchV2(page, V2_FIXTURE)
    await page.waitForSelector('.k-card--actions', { timeout: 5000 })
    await page.waitForTimeout(600)

    await page.evaluate(async () => {
      const mod = await import('/src/gesture-target-registry.ts')
      const registry = new mod.GestureTargetRegistry(document)
      const stop = mod.observeDomGestureTargets(document, registry)
      try {
        const id = document
          .querySelector('[data-gesture-target^="knowledge:open-note"]')
          ?.getAttribute('data-gesture-target')
        if (!id) throw new Error('missing open-note gesture target')
        const target = registry.get(id)
        if (!target) throw new Error(`registry missing ${id}`)
        target.invokeTap()
      } finally {
        stop()
      }
    })
    await expect(page.locator('.k-status')).toContainText('NOTE OPENED')
    expect(openCount).toBe(1)
  })

  test('correct preview succeeds and confirm button appears', async ({ page }) => {
    await page.route('**/api/v1/grounded-results/**/actions/correct/preview', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ preview: { id: 'prev-1', version: 1, disputedClaim: 'Test claim' } }) })
    })
    await page.route('**/api/v1/grounded-results/**/actions/correct/confirm', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await dispatchV2(page, V2_FIXTURE)
    await page.waitForSelector('.k-card--actions', { timeout: 5000 })
    await page.waitForTimeout(600)

    await page.locator('.k-actions button', { hasText: 'CORRECT' }).first().click()
    await expect(page.locator('.k-status')).toContainText('CORRECTION PREVIEW READY')
    await expect(page.locator('button', { hasText: 'CONFIRM CORRECTION' })).toBeVisible()

    await page.locator('button', { hasText: 'CONFIRM CORRECTION' }).click()
    await expect(page.locator('.k-status')).toContainText('CORRECTION CONFIRMED')
  })

  test('reorganize succeeds and proposal shows approve/reject', async ({ page }) => {
    await page.route('**/api/v1/grounded-results/**/actions/reorganize', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ proposal: { id: 'prop-1', version: 2, integrityHash: 'abc', summary: 'Group notes' } }),
      })
    })
    await dispatchV2(page, V2_FIXTURE)
    await page.waitForSelector('.k-card--actions', { timeout: 5000 })
    await page.waitForTimeout(600)

    await page.locator('.k-actions button', { hasText: 'REORGANIZE' }).first().click()
    await expect(page.locator('.k-status')).toContainText('REORGANIZATION PROPOSED')
    await expect(page.locator('button', { hasText: 'APPROVE REORGANIZATION' })).toBeVisible()
    await expect(page.locator('button', { hasText: 'REJECT REORGANIZATION' })).toBeVisible()
  })

  test('terminal failure renders error without leaving WORKING state', async ({ page }) => {
    await page.route('**/api/v1/grounded-results/**/actions/reorganize', async (route) => {
      await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'FORBIDDEN' }) })
    })
    await dispatchV2(page, V2_FIXTURE)
    await page.waitForSelector('.k-card--actions', { timeout: 5000 })
    await page.waitForTimeout(600)

    await page.locator('.k-actions button', { hasText: 'REORGANIZE' }).first().click()
    await expect(page.locator('.k-status')).not.toContainText('WORKING')
    await expect(page.locator('.k-status')).toContainText('FORBIDDEN')
  })
})

const PROFILE_SUMMARY = {
  schemaVersion: 1,
  createdAt: '2026-07-19T00:00:00.000Z',
  ambientNoiseFloor: 0.012,
  speechActivationFloor: 0.041,
  clapPeak: 0.82,
  clapRms: 0.31,
  clapCrest: 2.64,
  clapSustainedEnergyLimit: 0.16,
  inputSampleRate: 48_000,
  liveResultId: 'grounded-isabella-2026-07-19',
}

const CALIBRATION_REVIEW = {
  sessionId: 'calibration-browser-session',
  phase: 'review',
  microphoneLabel: 'MacBook Pro Microphone',
  previousProfile: { ...PROFILE_SUMMARY, clapPeak: 0.74 },
  candidateProfile: PROFILE_SUMMARY,
  completedPhases: ['room', 'speech', 'clap', 'live_canary'],
  speechChecks: [
    { phraseId: 'voice_range_1', passed: true },
    { phraseId: 'voice_range_2', passed: true },
    { phraseId: 'voice_range_3', passed: true },
  ],
  clapCount: 3,
  liveResultId: PROFILE_SUMMARY.liveResultId,
  actionState: 'idle',
}

async function dispatchCalibration(page: Page, detail: Record<string, unknown>) {
  await page.evaluate((snapshot) => {
    document.dispatchEvent(new CustomEvent('jericho:audio-calibration-state', { detail: snapshot }))
  }, detail)
}

async function prepareCalibration(page: Page, reducedMotion = false) {
  await page.goto('/')
  await passConsentGate(page)
  await page.waitForSelector('.stage', { timeout: 10_000 })
  await page.waitForSelector('.core-sphere', { timeout: 10_000 })
  if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' })
  await dispatchCalibration(page, CALIBRATION_REVIEW)
  await page.waitForSelector('.native-calibration[data-placement]', { timeout: 5_000 })
  await page.waitForTimeout(reducedMotion ? 100 : 500)
}

async function assertCalibrationGeometry(page: Page) {
  const viewport = page.viewportSize()!
  const sphere = page.locator('.core-sphere')
  const core = page.locator('.core-wrap')
  const card = page.locator('.native-calibration')
  await expect(sphere).toBeVisible()
  await expect(card).toBeVisible()
  await expect(card).toContainText('Calibration is ready. Confirm to apply.')
  await expect(card).toContainText('VOICE CANNOT APPLY')
  await expect(card).toContainText('grounded-isa')
  await expect(card.locator('button')).toHaveCount(2)
  await expect(card.getByRole('progressbar')).toBeVisible()
  await expect(card.getByRole('button', { name: 'CONFIRM' })).toBeVisible()
  await expect(card.getByRole('button', { name: 'DISCARD' })).toBeVisible()
  await expect(page.locator('[data-jericho-active-calibration-decision="true"]')).toHaveCount(1)
  await expect(page.locator('.startup-health')).toBeHidden()
  await expect(page.locator('.fleet-lifecycle')).toBeHidden()

  const cardBox = await boxOf(card)
  const coreBox = await boxOf(core)
  const expandedCore: Box = {
    x: coreBox.x - CORE_EXPAND,
    y: coreBox.y - CORE_EXPAND,
    width: coreBox.width + CORE_EXPAND * 2,
    height: coreBox.height + CORE_EXPAND * 2,
  }
  expect(cardBox.x, 'calibration left').toBeGreaterThanOrEqual(23)
  expect(cardBox.y, 'calibration top').toBeGreaterThanOrEqual(23)
  expect(cardBox.x + cardBox.width, 'calibration right').toBeLessThanOrEqual(viewport.width - 23)
  expect(cardBox.y + cardBox.height, 'calibration bottom').toBeLessThanOrEqual(viewport.height - 23)
  expect(intersects(cardBox, expandedCore), 'calibration vs expanded Sphere').toBe(false)
  await assertFullCardInViewport(page, card.getByRole('progressbar'), 'calibration-hold-progress')
  await assertFullCardInViewport(page, card.getByRole('button', { name: 'CONFIRM' }), 'calibration-confirm')
  await assertFullCardInViewport(page, card.getByRole('button', { name: 'DISCARD' }), 'calibration-discard')
}

test.describe('native calibration geometry', () => {
  test('review remains native, measurable, and hand-confirmable', async ({ page }) => {
    await prepareCalibration(page)
    await assertCalibrationGeometry(page)
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('jericho:calibration-hold-progress', {
        detail: { outcome: 'apply', ratio: 0.75 },
      }))
    })
    await expect(page.getByRole('progressbar', { name: /apply hold progress/i })).toHaveAttribute('aria-valuenow', '75')
    const viewport = page.viewportSize()!
    await page.screenshot({
      path: `tests/browser/screenshots/native-calibration-${viewport.width}x${viewport.height}.png`,
      fullPage: false,
    })
  })

  test('owns the Sphere during live-result projection and restores knowledge after exit', async ({ page }) => {
    await prepareCalibration(page, true)
    await dispatchV2(page, V2_FIXTURE)
    await page.waitForTimeout(400)
    await assertCalibrationGeometry(page)
    await expect(page.locator('.knowledge-projection')).toBeHidden()

    const viewport = page.viewportSize()!
    await page.screenshot({
      path: `tests/browser/screenshots/native-calibration-reduced-motion-${viewport.width}x${viewport.height}.png`,
      fullPage: false,
    })

    await dispatchCalibration(page, { ...CALIBRATION_REVIEW, phase: 'saved' })
    await expect(page.locator('.native-calibration')).toHaveCount(0)
    await expect(page.locator('.knowledge-projection')).toBeVisible()
    await expect(page.locator('.core-sphere')).toBeVisible()
  })
})
