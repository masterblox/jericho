import { fal } from '@fal-ai/client'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'

if (!process.env.FAL_KEY) throw new Error('FAL_KEY not set')

const ROOT = '/Users/carlosprada/conductor/workspaces/jericho/jackson/interface'
const SEED = '/tmp/core-seed.png'

const prompt = `Isolate ONLY the central mechanical arc-reactor / fleet-core device from this image and render it as a clean product hero on a PURE SOLID BLACK background (#000000). A luminous machined core: concentric metal rings, fine engraved topology and calibration ticks, a warm amber-white glowing center, cool cyan emitted rim light, subtle spectral particles. Centered, symmetrical, floating. Absolutely NO text, NO labels, NO UI panels, NO desk, NO workshop, NO people, NO reflections of an environment — just the isolated glowing core on black, edge-lit so it reads on a dark interface. Photoreal, crisp, 1:1 square.`

async function upload(path) {
  const bytes = await readFile(path)
  return fal.storage.upload(new File([bytes], basename(path), { type: 'image/png' }))
}

const url = await upload(SEED)
for (let v = 1; v <= 2; v++) {
  process.stdout.write(`\n[core] variant ${v} `)
  const result = await fal.subscribe('fal-ai/nano-banana-pro/edit', {
    input: { prompt, image_urls: [url], aspect_ratio: '1:1', resolution: '2K', output_format: 'png', num_images: 1 },
    logs: false,
    onQueueUpdate(u) { if (u.status === 'IN_PROGRESS') process.stdout.write('.') },
  })
  const img = result.data.images?.[0]
  if (!img?.url) throw new Error(`no image v${v}`)
  const res = await fetch(img.url)
  if (!res.ok) throw new Error(`fetch ${res.status}`)
  await writeFile(`${ROOT}/public/plates/regen/core-v${v}.png`, Buffer.from(await res.arrayBuffer()))
  process.stdout.write(` SAVED core-v${v}.png`)
}
console.log('\nDONE')
