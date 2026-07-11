import { chromium } from 'playwright'

const output = process.argv[2]
if (!output) throw new Error('Usage: node scripts/capture-qa.mjs <output-directory>')

const url = 'http://127.0.0.1:4173'
const browser = await chromium.launch()

const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const page = await desktop.newPage()
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)
await page.screenshot({ path: `${output}/state-idle.png` })

for (const state of ['listening', 'thinking', 'speaking', 'alert']) {
  await page.evaluate(s => {
    window.jericho.setCoreState(s)
    if (s === 'speaking') window.jericho.setLevel(0.8)
  }, state)
  await page.waitForTimeout(450)
  await page.screenshot({ path: `${output}/state-${state}.png` })
}
await page.evaluate(() => { window.jericho.setCoreState('idle'); window.jericho.setMode('megatron') })
await page.waitForTimeout(450)
await page.screenshot({ path: `${output}/mode-megatron.png` })
await page.evaluate(() => window.jericho.setMode('jarvis'))

await page.getByRole('tab', { name: /MISSIONS/ }).click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${output}/view-missions.png` })
await page.getByRole('tab', { name: /CORE/ }).click()

await page.evaluate(() => window.jericho.dispatch('Recover Paperclip and verify all 71 closures'))
await page.waitForTimeout(300)
await page.screenshot({ path: `${output}/dispatch.png` })
await desktop.close()

const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const mobile = await mobileCtx.newPage()
await mobile.goto(url, { waitUntil: 'networkidle' })
await mobile.waitForTimeout(1500)
await mobile.screenshot({ path: `${output}/mobile.png`, fullPage: true })
await mobileCtx.close()

await browser.close()
console.log(`SAVED screenshots to ${output}`)
