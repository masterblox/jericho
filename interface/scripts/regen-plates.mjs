import { fal } from '@fal-ai/client'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'

if (!process.env.FAL_KEY) throw new Error('FAL_KEY not set')

const OLD = 'The SECOND reference is an obsolete Jericho prototype: preserve its real operational content and labels only, but reject its visual design completely.'
const NEW = 'The SECOND reference is the APPROVED Jericho design plate: reproduce its exact visual language, layout, palette and real operational labels faithfully as a fresh clean variation — render all small text as crisp legible condensed type, never illegible noise.'

const ROOT = '/Users/carlosprada/conductor/workspaces/jericho/jackson/interface'
const IRONMAN = '/tmp/im-ref/suit_02.jpg'

const plates = [
  { name: 'operator-bay', prompt: `${ROOT}/design-prompts/operator-bay.txt`, plate: `${ROOT}/public/plates/operator-bay.jpg` },
  { name: 'spatial-field', prompt: `${ROOT}/design-prompts/spatial-field.txt`, plate: `${ROOT}/public/plates/spatial-field.jpg` },
]

async function upload(path) {
  const bytes = await readFile(path)
  const type = path.endsWith('.png') ? 'image/png' : 'image/jpeg'
  return fal.storage.upload(new File([bytes], basename(path), { type }))
}

const VARIANTS = 2
for (const { name, prompt, plate } of plates) {
  const raw = await readFile(prompt, 'utf8')
  if (!raw.includes(OLD)) throw new Error(`anchor sentence missing in ${name}`)
  const text = raw.replace(OLD, NEW)
  const urls = [await upload(IRONMAN), await upload(plate)]
  for (let v = 1; v <= VARIANTS; v++) {
    process.stdout.write(`\n[${name}] variant ${v} `)
    const result = await fal.subscribe('fal-ai/nano-banana-pro/edit', {
      input: { prompt: text, image_urls: urls, aspect_ratio: '16:9', resolution: '2K', output_format: 'png', num_images: 1 },
      logs: false,
      onQueueUpdate(u) { if (u.status === 'IN_PROGRESS') process.stdout.write('.') },
    })
    const img = result.data.images?.[0]
    if (!img?.url) throw new Error(`no image for ${name} v${v}`)
    const res = await fetch(img.url)
    if (!res.ok) throw new Error(`fetch failed ${res.status}`)
    const out = `${ROOT}/public/plates/regen/${name}-v${v}.png`
    await writeFile(out, Buffer.from(await res.arrayBuffer()))
    process.stdout.write(` SAVED ${out}`)
  }
}
console.log('\nDONE')
