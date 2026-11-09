#!/usr/bin/env node
// Checks the released-only build (stellaroptimizer.com) for beta content: any file naming a beta
// key or name from apps/frontend/beta-content.json. Exits 1 and lists them if it finds any.
//   node tools/site/beta-leak-scan.mjs dist/apps/frontend-released
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: beta-leak-scan.mjs <built site dir>')
  process.exit(2)
}
const beta = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../apps/frontend/beta-content.json'),
    'utf8'
  )
)
const words = [
  ...beta.characters,
  ...beta.weapons,
  ...beta.artifactSets,
  ...beta.leakNames,
]
// keys as whole words (a key inside a longer identifier counts too: "char_Danica_gen")
const pattern = new RegExp(
  words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
)
const hits = []
for (const rel of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
  if (!/\.(js|mjs|css|html|json|txt|xml|md|webmanifest)$/.test(rel)) continue
  const text = readFileSync(join(dir, rel), 'utf8')
  const m = pattern.exec(text)
  if (m) {
    const at = Math.max(0, m.index - 60)
    hits.push(
      `${rel}: …${text.slice(at, m.index + m[0].length + 60).replace(/\s+/g, ' ')}…`
    )
  }
  // file names too (images, per-item text files)
  if (pattern.test(rel)) hits.push(`${rel}: (file name)`)
}
// images are matched by name only: their hashed names keep the source name ("Danica-xxxx.webp")
for (const rel of readdirSync(dir, { recursive: true, encoding: 'utf8' }))
  if (
    !/\.(js|mjs|css|html|json|txt|xml|md|webmanifest)$/.test(rel) &&
    pattern.test(rel)
  )
    hits.push(`${rel}: (file name)`)

if (hits.length) {
  console.error(
    `beta content found in ${dir}:\n${hits.slice(0, 40).join('\n')}`
  )
  if (hits.length > 40) console.error(`… and ${hits.length - 40} more`)
  process.exit(1)
}
console.log(`no beta content in ${dir}`)
