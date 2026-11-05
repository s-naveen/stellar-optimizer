// Build-time PNG -> WebP conversion for imported image assets.
//
// The game art in libs/gi/assets is shipped as large PNGs (a character name card is ~600 kB, an
// artifact icon ~150 kB). Lossy WebP (q80, lossless alpha) is 75-90% smaller and looks the same at
// the sizes the UI shows. Every browser the site supports can display WebP.
//
// - Uses the `cwebp` binary (`brew install webp`). If it is missing, the build keeps the PNGs.
// - Results are cached in node_modules/.cache/go-webp, keyed by file content, so only new or
//   changed images are converted on later builds.
// - A PNG is replaced only when the WebP is at least 20% smaller.
import { execFile, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
} from 'node:fs'
import { availableParallelism } from 'node:os'
import { basename, join } from 'node:path'
import type { Plugin } from 'vite'

const CWEBP_ARGS = ['-quiet', '-q', '80', '-alpha_q', '100', '-m', '4']

export function webpAssets({
  cacheDir,
  minBytes = 20 * 1024,
}: {
  cacheDir: string
  minBytes?: number
}): Plugin {
  let available = true
  // Limit concurrent cwebp processes (each is small, but avoid saturating the machine).
  const maxJobs = Math.max(1, Math.min(6, availableParallelism() - 2))
  let running = 0
  const waiting: (() => void)[] = []
  const pending = new Map<string, Promise<string | null>>()
  let converted = 0
  let reused = 0

  async function convert(src: string, out: string) {
    if (running >= maxJobs) await new Promise<void>((r) => waiting.push(r))
    running++
    try {
      mkdirSync(join(out, '..'), { recursive: true })
      const tmp = `${out}.${process.pid}.tmp`
      await new Promise<void>((resolve, reject) =>
        execFile('cwebp', [...CWEBP_ARGS, src, '-o', tmp], (err) =>
          err ? reject(err) : resolve()
        )
      )
      renameSync(tmp, out) // atomic: never leave a half-written file in the cache
      converted++
    } finally {
      running--
      waiting.shift()?.()
    }
  }

  async function toWebp(file: string): Promise<string | null> {
    const size = statSync(file).size
    if (size < minBytes) return null
    const hash = createHash('sha1')
      .update(readFileSync(file))
      .update(CWEBP_ARGS.join(' '))
      .digest('hex')
      .slice(0, 16)
    const out = join(cacheDir, hash, `${basename(file, '.png')}.webp`)
    if (existsSync(out)) reused++
    else await convert(file, out)
    return statSync(out).size <= size * 0.8 ? out : null
  }

  return {
    name: 'go-webp-assets',
    apply: 'build',
    enforce: 'pre',
    buildStart() {
      try {
        execFileSync('cwebp', ['-version'], { stdio: 'ignore' })
      } catch {
        available = false
        this.warn(
          'cwebp not found (brew install webp): shipping PNG images unconverted'
        )
      }
    },
    async resolveId(source, importer, options) {
      if (!available || !importer || !source.endsWith('.png')) return null
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      })
      if (!resolved || resolved.external || !resolved.id.endsWith('.png'))
        return resolved
      const file = resolved.id
      let job = pending.get(file)
      if (!job) {
        job = toWebp(file).catch((e) => {
          this.warn(`cwebp failed for ${file}: ${e}`)
          return null
        })
        pending.set(file, job)
      }
      return (await job) ?? resolved
    },
    buildEnd() {
      if (available)
        this.info?.(`webp: ${converted} converted, ${reused} from cache`)
    },
  }
}
