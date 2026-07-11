import { test, expect } from '@playwright/test'

const URL = 'http://127.0.0.1:4173'

test.describe('Jericho Fleet Command', () => {
  test('minimal gesture-first surface: no text input, summon and return', async ({ page }) => {
    await page.goto(URL)
    await expect(page.locator('main')).toHaveAttribute('data-variant', 'workshop')
    await expect(page.getByText('JERICHO', { exact: true })).toBeVisible()

    // texting affordances are gone
    await expect(page.locator('input, textarea')).toHaveCount(0)

    // summon signal projection and return via tabs
    await page.getByRole('tab', { name: /SIGNALS/ }).click()
    await expect(page.getByRole('tab', { name: /SIGNALS/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('Authenticated endpoints timed out').first()).toBeVisible()
    await page.getByRole('tab', { name: /CORE/ }).click()
    await expect(page.getByRole('tab', { name: /CORE/ })).toHaveAttribute('aria-selected', 'true')
  })

  test('core answer states react end to end via window.jericho', async ({ page }) => {
    await page.goto(URL)
    const stage = page.locator('.stage')
    await expect(stage).toHaveAttribute('data-core-state', 'idle')

    // motion budget: the frame ring is near-static and does NOT change with state
    const frameMain = page.locator('.frame-main')
    await expect(frameMain).toHaveCSS('animation-duration', '400s')

    await page.evaluate(() => window.jericho.setCoreState('listening'))
    await expect(stage).toHaveAttribute('data-core-state', 'listening')

    await page.evaluate(() => window.jericho.setCoreState('thinking'))
    await expect(stage).toHaveAttribute('data-core-state', 'thinking')
    await expect(frameMain).toHaveCSS('animation-duration', '400s') // still calm

    await page.evaluate(() => {
      window.jericho.setCoreState('speaking')
      window.jericho.setLevel(0.8)
    })
    await expect(stage).toHaveAttribute('data-core-state', 'speaking')
    const level = await stage.evaluate(el => el.style.getPropertyValue('--core-level'))
    expect(Number(level)).toBeCloseTo(0.8, 2)

    await page.evaluate(() => window.jericho.setCoreState('alert'))
    await expect(stage).toHaveAttribute('data-core-state', 'alert')

    await page.evaluate(() => window.jericho.setCoreState('idle'))
    await expect(stage).toHaveAttribute('data-core-state', 'idle')

    // ambient particle field is live
    await expect(page.locator('.layer-particles canvas')).toHaveCount(1)
    const particles = await page.evaluate(() => window.__jerichoParticles?.count || 0)
    expect(particles).toBeGreaterThanOrEqual(2200)

    // the gate engine (3D core sphere) is mounted and populated
    await expect(page.locator('.core-sphere canvas')).toHaveCount(1)
    const sphere = await page.evaluate(() => window.__jerichoSphere?.count || 0)
    expect(sphere).toBeGreaterThanOrEqual(5000)
  })

  test('missions pop out around the sphere without covering it', async ({ page }) => {
    await page.goto(URL)
    await page.evaluate(() => window.jericho.summon('MISSIONS'))
    const cards = page.locator('.projection-radial .jcard')
    await expect(cards).toHaveCount(5)
    await page.waitForTimeout(900) // let pop animation settle

    // no card intersects the sphere's home box
    const sphereBox = await page.locator('.core-sphere').boundingBox()
    const count = await cards.count()
    for (let i = 0; i < count; i++) {
      const box = await cards.nth(i).boundingBox()
      const overlaps = !(
        box.x + box.width < sphereBox.x ||
        box.x > sphereBox.x + sphereBox.width ||
        box.y + box.height < sphereBox.y ||
        box.y > sphereBox.y + sphereBox.height
      )
      expect(overlaps, `card ${i} overlaps the sphere`).toBe(false)
    }
    await page.evaluate(() => window.jericho.summon('CORE'))
  })

  test('programmatic selection, persona mode and dispatch flow', async ({ page }) => {
    await page.goto(URL)

    await page.evaluate(() => window.jericho.select('ANALYST'))
    await expect(page.locator('.stage')).toHaveAttribute('data-agent', 'ANALYST')

    await page.evaluate(() => window.jericho.setMode('megatron'))
    await expect(page.locator('.stage')).toHaveAttribute('data-mode', 'megatron')
    await page.evaluate(() => window.jericho.setMode('jarvis'))

    await page.evaluate(() => window.jericho.dispatch('Recover Paperclip and verify the closure queue'))
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('heading', { name: /Recover Paperclip/ })).toBeVisible()
    await page.getByRole('button', { name: 'CONFIRM DISPATCH' }).click()
    await expect(page.getByRole('status')).toContainText('DIRECTIVE DISPATCHED')
  })

  test('desktop layout has no horizontal overflow', async ({ page }) => {
    await page.goto(URL)
    const fit = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(fit.scrollWidth).toBeLessThanOrEqual(fit.width + 1)
  })

  test('mobile: no text input, summon and dispatch remain usable', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const page = await context.newPage()
    await page.goto(URL)
    await expect(page.locator('input, textarea')).toHaveCount(0)
    await page.getByRole('tab', { name: /MISSIONS/ }).click()
    await expect(page.locator('.projection-radial .jcard').first()).toBeVisible()
    await page.evaluate(() => window.jericho.dispatch('Run fleet health scan'))
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('button', { name: 'CONFIRM DISPATCH' })).toBeVisible()
    await context.close()
  })
})
