import { chromium } from 'playwright'

const output = process.argv[2]
if (!output) throw new Error('Usage: node scripts/capture-qa.mjs <output-directory>')

const browser = await chromium.launch()
for (const target of [
  { name: 'workshop', url: 'http://127.0.0.1:4173' },
  { name: 'hadal', url: 'http://127.0.0.1:4174' },
]) {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await desktop.newPage()
  await page.goto(target.url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${output}/${target.name}-desktop.png` })

  await page.getByLabel('Issue a directive').fill('Recover Paperclip and verify all 71 closures')
  await page.getByRole('button', { name: 'DECOMPOSE' }).click()
  await page.screenshot({ path: `${output}/${target.name}-dispatch.png` })
  await desktop.close()

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const mobilePage = await mobile.newPage()
  await mobilePage.goto(target.url, { waitUntil: 'networkidle' })
  await mobilePage.waitForTimeout(500)
  await mobilePage.screenshot({ path: `${output}/${target.name}-mobile.png` })
  await mobile.close()
}
await browser.close()
