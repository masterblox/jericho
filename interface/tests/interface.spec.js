import { test, expect } from '@playwright/test'

for (const target of [
  { name: 'Operator Bay', url: 'http://127.0.0.1:4173', variant: 'workshop' },
  { name: 'Spatial Field', url: 'http://127.0.0.1:4174', variant: 'hadal' },
]) {
  test.describe(target.name, () => {
    test('navigation and dispatch flow work end to end', async ({ page }) => {
      await page.goto(target.url)
      await expect(page.locator('main')).toHaveAttribute('data-variant', target.variant)
      await expect(page.getByText(/JERICHO \/ (OPERATOR BAY|SPATIAL FIELD)/)).toBeVisible()

      await page.getByRole('button', { name: /MISSIONS/ }).click()
      await expect(page.getByText('MAS-511')).toBeVisible()

      await page.getByRole('button', { name: /COMMAND/ }).click()
      await page.getByRole('button', { name: /ANALYST Business intel/ }).click()
      await expect(page.getByRole('button', { name: /ANALYST Business intel/ })).toHaveClass(/selected/)

      await page.getByRole('button', { name: /SIGNALS/ }).click()
      await expect(page.getByText('Authenticated endpoints timed out')).toBeVisible()
      await page.getByRole('button', { name: /COMMAND/ }).click()

      const directive = page.getByLabel('Issue a directive')
      await directive.fill('Recover Paperclip and verify the closure queue')
      await page.getByRole('button', { name: 'DECOMPOSE' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.getByRole('heading', { name: /Recover Paperclip/ })).toBeVisible()
      await page.getByRole('button', { name: 'CONFIRM DISPATCH' }).click()
      await expect(page.getByRole('status')).toContainText('DIRECTIVE DISPATCHED')
    })

    test('initial viewport has no horizontal overflow', async ({ page }) => {
      await page.goto(target.url)
      const fit = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(fit.scrollWidth).toBeLessThanOrEqual(fit.width)
      const commandBox = await page.getByLabel('Issue a directive').boundingBox()
      expect(commandBox.y).toBeGreaterThan(0)
      expect(commandBox.y + commandBox.height).toBeLessThanOrEqual(900)
    })

    test('mobile command surface and dispatch remain usable', async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
      const page = await context.newPage()
      await page.goto(target.url)
      await expect(page.getByLabel('Issue a directive')).toBeVisible()
      const commandBox = await page.getByLabel('Issue a directive').boundingBox()
      expect(commandBox.y + commandBox.height).toBeLessThanOrEqual(844)
      await page.getByLabel('Issue a directive').fill('Run fleet health scan')
      await page.getByRole('button', { name: 'DECOMPOSE' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.getByRole('button', { name: 'CONFIRM DISPATCH' })).toBeVisible()
      await context.close()
    })
  })
}
