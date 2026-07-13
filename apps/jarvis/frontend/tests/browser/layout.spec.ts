import { test, expect, type Page } from '@playwright/test'

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

async function passConsentGate(page: Page) {
  const btn = page.getByRole('button', { name: /Continue with keyboard/i })
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) { await btn.click(); await page.waitForTimeout(500) }
}
async function dispatchV2(page: Page, d: Record<string, unknown>) {
  await page.evaluate((v) => { document.dispatchEvent(new CustomEvent('jericho:grounded-result', { detail: v })) }, d)
}

test.describe('knowledge projection geometry', () => {
  test('sphere visible, 3 cards, correct content', async ({ page }) => {
    await page.goto('/'); await passConsentGate(page)
    await page.waitForSelector('.stage', { timeout: 10000 })
    await page.waitForSelector('.core-sphere', { timeout: 10000 })
    await dispatchV2(page, V2_FIXTURE)
    await page.waitForSelector('.k-card--primary', { timeout: 5000 })
    await page.waitForTimeout(2000)
    await expect(page.locator('.core-sphere')).toBeVisible()
    await expect(page.locator('.k-card')).toHaveCount(3)
    await expect(page.locator('.k-card--primary')).toContainText('Isabella Handel')
    await expect(page.locator('.k-card--primary')).not.toContainText('Francisco')
    await expect(page.locator('.k-card--provenance')).toContainText('People/Isabella Handel.md')
    await expect(page.locator('.k-card--provenance')).toContainText('Francisco-wife claim')
    await expect(page.locator('.sphere-command')).toHaveAttribute('hidden', '')
  })

  test('cards within viewport, sphere stays visible', async ({ page }) => {
    await page.goto('/'); await passConsentGate(page)
    await page.waitForSelector('.stage', { timeout: 10000 })
    await page.waitForSelector('.core-sphere', { timeout: 10000 })
    await dispatchV2(page, V2_FIXTURE)
    await page.waitForSelector('.k-card--primary', { timeout: 5000 })
    await page.waitForTimeout(2500)
    await expect(page.locator('.core-sphere')).toBeVisible()
    const vp = page.viewportSize()!
    const cards = page.locator('.k-card')
    expect(await cards.count()).toBe(3)
    for (let i = 0; i < await cards.count(); i++) {
      const card = cards.nth(i); await card.scrollIntoViewIfNeeded()
      const box = await card.boundingBox(); expect(box).not.toBeNull()
      expect(box!.x, `c${i} x>=0`).toBeGreaterThanOrEqual(-1)
      expect(box!.y, `c${i} y>=0`).toBeGreaterThanOrEqual(-1)
      expect(box!.x + box!.width, `c${i} r<=vp`).toBeLessThanOrEqual(vp.width + 1)
      expect(box!.y + box!.height, `c${i} b<=vp`).toBeLessThanOrEqual(vp.height + 1)
    }
  })

  test('screenshot', async ({ page }) => {
    await page.goto('/'); await passConsentGate(page)
    await page.waitForSelector('.stage', { timeout: 10000 })
    await dispatchV2(page, V2_FIXTURE)
    await page.waitForSelector('.k-card--primary', { timeout: 5000 })
    await page.waitForTimeout(2000)
    const vp = page.viewportSize()!
    await page.screenshot({ path: `tests/browser/screenshots/wide-${vp.width}x${vp.height}.png`, fullPage: false })
  })

  test('reduced motion: sphere, cards', async ({ page }) => {
    await page.goto('/'); await passConsentGate(page)
    await page.waitForSelector('.stage', { timeout: 10000 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await dispatchV2(page, V2_FIXTURE)
    await page.waitForSelector('.k-card--primary', { timeout: 5000 })
    await page.waitForTimeout(2500)
    await expect(page.locator('.core-sphere')).toBeVisible()
    const vp = page.viewportSize()!
    const cards = page.locator('.k-card'); expect(await cards.count()).toBe(3)
    for (let i = 0; i < await cards.count(); i++) {
      const card = cards.nth(i); await card.scrollIntoViewIfNeeded()
      const box = await card.boundingBox(); expect(box).not.toBeNull()
      expect(box!.x, `rm${i} x`).toBeGreaterThanOrEqual(-1)
      expect(box!.y, `rm${i} y`).toBeGreaterThanOrEqual(-1)
      expect(box!.x + box!.width, `rm${i} r`).toBeLessThanOrEqual(vp.width + 1)
      expect(box!.y + box!.height, `rm${i} b`).toBeLessThanOrEqual(vp.height + 1)
    }
    await page.screenshot({ path: `tests/browser/screenshots/reduced-motion-${vp.width}x${vp.height}.png`, fullPage: false })
  })
})
