import { fal } from '@fal-ai/client'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'

const [output, promptPath, ...referencePaths] = process.argv.slice(2)
if (!output || !promptPath || referencePaths.length === 0) {
  throw new Error('Usage: node scripts/fal-design.mjs <output> <prompt.txt> <reference...>')
}
if (!process.env.FAL_KEY) throw new Error('FAL_KEY is not set')

const urls = []
for (const path of referencePaths) {
  const bytes = await readFile(path)
  const type = path.endsWith('.png') ? 'image/png' : 'image/jpeg'
  const file = new File([bytes], basename(path), { type })
  urls.push(await fal.storage.upload(file))
}

const prompt = await readFile(promptPath, 'utf8')
const result = await fal.subscribe('fal-ai/nano-banana-pro/edit', {
  input: {
    prompt,
    image_urls: urls,
    aspect_ratio: '16:9',
    resolution: '2K',
    output_format: 'png',
    num_images: 1,
  },
  logs: true,
  onQueueUpdate(update) {
    if (update.status === 'IN_PROGRESS') process.stdout.write('.')
  },
})

const image = result.data.images?.[0]
if (!image?.url) throw new Error('FAL returned no image')
const response = await fetch(image.url)
if (!response.ok) throw new Error(`Could not fetch result: ${response.status}`)
await writeFile(output, Buffer.from(await response.arrayBuffer()))
console.log(`\nSAVED ${output}`)
