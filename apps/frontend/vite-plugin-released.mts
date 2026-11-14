// The released-only build (GO_RELEASED=1, published at stellaroptimizer.com): the beta site
// (gi-beta73.github.io) also shows unreleased characters, weapons and artifact sets from beta data;
// this build leaves them out entirely: their code, data, text and images. The list is
// beta-content.json. tools/site/beta-leak-scan.mjs checks the output.
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { Plugin } from 'vite'
import { normalizePath } from 'vite'

export type BetaContent = {
  characters: string[]
  weapons: string[]
  artifactSets: string[]
  /** the beta characters' page slugs ("danica" for /danica-optimizer/, and aliases) */
  pageSlugs: string[]
  /** names the leak scan looks for, besides the keys */
  leakNames: string[]
  /** names released content can use too (so not scanned for), kept out of the changelog */
  otherNames?: string[]
}

export function readBetaContent(file: string): BetaContent {
  return JSON.parse(readFileSync(file, 'utf8'))
}

export const betaKeys = (b: BetaContent) => [
  ...b.characters,
  ...b.weapons,
  ...b.artifactSets,
]

/**
 * A test for property names that belong to beta content: a beta key ("Danica") or a name that
 * contains one ("anastasyaA4", "char_Danica_gen")
 */
export function betaKeyTest(b: BetaContent) {
  const keys = new Set(betaKeys(b))
  const lower = betaKeys(b).map((k) => k.toLowerCase())
  return (name: string) =>
    keys.has(name) || lower.some((k) => name.toLowerCase().includes(k))
}

/** Deletes, at any depth, the properties `isBeta` names. Returns whether anything changed. */
export function stripBetaKeys(
  value: unknown,
  isBeta: (name: string) => boolean
): boolean {
  if (!value || typeof value !== 'object') return false
  let changed = false
  if (Array.isArray(value)) {
    for (const v of value) changed = stripBetaKeys(v, isBeta) || changed
    return changed
  }
  const obj = value as Record<string, unknown>
  for (const k of Object.keys(obj)) {
    if (isBeta(k)) {
      delete obj[k]
      changed = true
    } else changed = stripBetaKeys(obj[k], isBeta) || changed
  }
  return changed
}

/** The changelog's lines that name beta content are left out (the beta site keeps them) */
function dropLinesNaming(entries: unknown, words: string[]): boolean {
  if (!Array.isArray(entries)) return false
  let changed = false
  for (const entry of entries)
    for (const [k, v] of Object.entries(entry as Record<string, unknown>))
      if (Array.isArray(v)) {
        const kept = v.filter(
          (line) => !words.some((w) => String(line).includes(w))
        )
        if (kept.length !== v.length) {
          ;(entry as Record<string, unknown>)[k] = kept
          changed = true
        }
      }
  return changed
}

/**
 * `locales: false` for the web workers' bundles: they get the same code changes, while the locale
 * folders are cleaned once, by the main build
 */
export function releasedOnlyPlugin(
  beta: BetaContent,
  { locales = true }: { locales?: boolean } = {}
): Plugin {
  const keys = new Set(betaKeys(beta))
  const isBeta = betaKeyTest(beta)
  // the registries list every item the same way: `import Danica from './Danica'`, then `Danica,`
  // (or `'Danica',` in the key lists)
  const importLine = /^import\s+(\w+)\s+from\s+['"][^'"]+['"];?\s*$/
  const entryLine = /^\s*['"]?(\w+)['"]?,\s*$/
  // data tables keyed by item, one complete entry per line: `  Danica: [24, 18],`,
  // `  AnastasyaSkill: { reset: 96, apply: [1, 0] },` (a key naming beta content)
  const keyedLine = /^\s*['"]?(\w+)['"]?\s*:\s*(.+),\s*$/
  const balanced = (s: string) => {
    let depth = 0
    for (const ch of s.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '')) {
      if ('([{'.includes(ch)) depth++
      else if (')]}'.includes(ch) && --depth < 0) return false
    }
    return depth === 0
  }
  const pageLink = new RegExp(
    `<a href="(?:${beta.pageSlugs.join('|')})-optimizer/">[^<]*</a>\\s*·\\s*`,
    'g'
  )
  let outDir = ''
  return {
    name: 'go-released-only',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    transform(code, id) {
      const path = normalizePath(id).split('?')[0]
      if (!path.includes('/libs/')) return null
      if (path.endsWith('.json')) {
        const data = JSON.parse(code)
        let changed = stripBetaKeys(data, isBeta)
        if (path.endsWith('/changelog/changelog.json'))
          changed =
            dropLinesNaming(data, [
              ...beta.characters,
              ...beta.leakNames,
              ...(beta.otherNames ?? []),
            ]) || changed
        return changed ? { code: JSON.stringify(data), map: null } : null
      }
      if (!/\.(ts|tsx)$/.test(path)) return null
      let out = code
        .split('\n')
        .filter((line) => {
          const m = importLine.exec(line) ?? entryLine.exec(line)
          if (m && keys.has(m[1])) return false
          const k = keyedLine.exec(line)
          return !(k && isBeta(k[1]) && balanced(k[2]))
        })
        .join('\n')
      // the char-cards art globs: without the beta characters' files
      out = out.replace(
        /import\.meta\.glob<string>\(\s*'\.\/(splash|art)\/\*\.webp'/g,
        (_, dir: string) =>
          `import.meta.glob<string>(${JSON.stringify([
            `./${dir}/*.webp`,
            ...beta.characters.map((k) => `!./${dir}/${k}.webp`),
          ])}`
      )
      return out === code ? null : { code: out, map: null }
    },
    transformIndexHtml(html) {
      return html.replace(pageLink, '')
    },
    // after the locale folders are copied (vite-plugin-static-copy writes them in writeBundle):
    // delete the beta items' text files, strip the beta entries from the others
    closeBundle() {
      const dir = join(outDir, 'assets/locales')
      if (!locales || !existsSync(dir)) return
      const files = readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .filter((rel) => rel.endsWith('.json'))
        .sort()
      // entries keyed by id, not by name (the game's glossary tooltips): those whose English text
      // names beta content go, in every language
      const words = [...keys, ...beta.leakNames]
      const byId = new Map<string, Set<string>>()
      for (const rel of files.filter((r) => /^en[/\\]/.test(r))) {
        const data = JSON.parse(readFileSync(join(dir, rel), 'utf8'))
        const ids = Object.keys(data).filter((id) => {
          const text = JSON.stringify(data[id])
          return words.some((w) => text.includes(w))
        })
        if (ids.length) byId.set(basename(rel), new Set(ids))
      }
      for (const rel of files) {
        const file = join(dir, rel)
        if (isBeta(basename(rel, '.json'))) {
          rmSync(file)
          continue
        }
        const data = JSON.parse(readFileSync(file, 'utf8'))
        let changed = stripBetaKeys(data, isBeta)
        for (const id of byId.get(basename(rel)) ?? [])
          if (id in data) {
            delete data[id]
            changed = true
          }
        if (changed) writeFileSync(file, JSON.stringify(data))
      }
    },
  }
}
