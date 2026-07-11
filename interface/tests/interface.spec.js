import { test, expect } from '@playwright/test'

const URL = 'http://127.0.0.1:4173'

test.describe('Jericho Fleet Command', () => {
  test('gesture-first surface: no text input, fleet selection and summoning work', async ({ page }) => {
    await page.goto(URL)
    await expect(page.locator('main')).toHaveAttribute('data-variant', 'workshop')
    await expect(page.getByText('JERICHO', { exact: true })).toBeVisible()

    // texting affordances are gone
    await expect(page.locator('input, textarea')).toHaveCount(0)

    // fleet node selection on the ring
    const analyst = page.getByRole('option', { name: /ANALYST/ })
    await analyst.click()
    await expect(analyst).toHaveAttribute('aria-selected', 'true')

    // summon signal projection and return
    await page.getByRole('tab', { name: /SIGNALS/ }).click()
    await expect(page.getByRole('tab', { name: /SIGNALS/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('Authenticated endpoints timed out').first()).toBeVisible()
    await page.getByRole('button', { name: 'RETURN' }).click()
    await expect(page.getByRole('tab', { name: /CORE/ })).toHaveAttribute('aria-selected', 'true')
  })

  test('core answer states react end to end via window.jericho', async ({ page }) => {
    await page.goto(URL)
    const stage = page.locator('.stage')
    await expect(stage).toHaveAttribute('data-core-state', 'idle')

    // ring speed baseline (ring-b spins at 90s when idle)
    const ringB = page.locator('.rings .ring-b')
    await expect(ringB).toHaveCSS('animation-duration', '90s')

    await page.evaluate(() => window.jericho.setCoreState('listening'))
    await expect(stage).toHaveAttribute('data-core-state', 'listening')

    await page.evaluate(() => window.jericho.setCoreState('thinking'))
    await expect(stage).toHaveAttribute('data-core-state', 'thinking')
    await expect(ringB).toHaveCSS('animation-duration', '9s')
    // procedural rotor physically spins up while thinking
    await expect(page.locator('.reactor .rotor')).toHaveCSS('animation-duration', '2.4s')

    await page.evaluate(() => {
      window.jericho.setCoreState('speaking')
      window.jericho.setLevel(0.8)
    })
    await expect(stage).toHaveAttribute('data-core-state', 'speaking')
    const level = await stage.evaluate(el => el.style.getPropertyValue('--core-level'))
    expect(Number(level)).toBeCloseTo(0.8, 2)

    // coil ring is a circular VU meter: segment 7 (threshold .5) ignites at .8, dies at .1
    const coilSeg = page.locator('.reactor .coil path').nth(6)
    await expect(coilSeg).toHaveCSS('opacity', '1')
    await page.evaluate(() => window.jericho.setLevel(0.1))
    await expect(coilSeg).toHaveCSS('opacity', '0.12')
    await page.evaluate(() => window.jericho.setLevel(0.8))

    await page.evaluate(() => window.jericho.setCoreState('alert'))
    await expect(stage).toHaveAttribute('data-core-state', 'alert')

    await page.evaluate(() => window.jericho.setCoreState('idle'))
    await expect(stage).toHaveAttribute('data-core-state', 'idle')

    // particle field is live: canvas mounted, engine initialized with a real population
    await expect(page.locator('.layer-particles canvas')).toHaveCount(1)
    const particles = await page.evaluate(() => window.__jerichoParticles?.count || 0)
    expect(particles).toBeGreaterThanOrEqual(2500)

    // the gate engine (3D core sphere) is mounted and populated
    await expect(page.locator('.core-sphere canvas')).toHaveCount(1)
    const sphere = await page.evaluate(() => window.__jerichoSphere?.count || 0)
    expect(sphere).toBeGreaterThanOrEqual(5000)

    // summoned missions render as a card field
    await page.evaluate(() => window.jericho.summon('MISSIONS'))
    await expect(page.locator('.projection .jcard')).toHaveCount(5)
    await page.evaluate(() => window.jericho.summon('CORE'))
  })

  test('programmatic selection, persona mode and dispatch flow', async ({ page }) => {
    await page.goto(URL)

    await page.evaluate(() => window.jericho.select('ANALYST'))
    await expect(page.getByRole('option', { name: /ANALYST/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.callout')).toContainText('Business intel')

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

  test('mobile: no text input, node selection and dispatch remain usable', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const page = await context.newPage()
    await page.goto(URL)
    await expect(page.locator('input, textarea')).toHaveCount(0)
    await page.getByRole('option', { name: /IRIS/ }).click()
    await expect(page.getByRole('option', { name: /IRIS/ })).toHaveAttribute('aria-selected', 'true')
    await page.evaluate(() => window.jericho.dispatch('Run fleet health scan'))
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('button', { name: 'CONFIRM DISPATCH' })).toBeVisible()
    await context.close()
  })
})
