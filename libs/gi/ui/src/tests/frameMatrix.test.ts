/**
 * Frame matrix (a tool, skipped unless FRAME_MATRIX=<dir>): replays each `<name>.spec.json`
 * sequence (written by the frame-matrix generator, with the reference's results in
 * `<name>.ref.json`) through the app's simulator and writes `<name>.ours.json` with the executed
 * actions, written waits and the character's hits, for comparison with the reference.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const dir = process.env['FRAME_MATRIX']
const only = (process.env['FRAME_ONLY'] ?? '').split(',').filter(Boolean)

interface Spec {
  key: CharacterKey
  cons: number
  filler: CharacterKey
  groups: { kind: 'solo' | 'pair'; A: string; B?: string }[]
}

describe.skipIf(!dir)('frame matrix', () => {
  const specs = dir
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.spec.json'))
        .map((f) => f.replace(/\.spec\.json$/, ''))
        .filter((n) => !only.length || only.includes(n.split('_c')[0]))
    : []
  for (const name of specs)
    it(name, () => {
      const spec: Spec = JSON.parse(
        readFileSync(join(dir!, `${name}.spec.json`), 'utf8')
      )
      let invalid = new Set<number>()
      let perGroup = false
      try {
        const ref = JSON.parse(
          readFileSync(join(dir!, `${name}.ref.json`), 'utf8')
        )
        invalid = new Set(ref.invalid.map((x: { group: number }) => x.group))
        perGroup = !!ref.perGroup
      } catch {
        return
      }
      const { key, filler } = spec
      const members = [key, filler]
      const groupSteps = (g: Spec['groups'][number]) =>
        g.kind === 'solo'
          ? [`${key} ${g.A} W25`]
          : g.B === 'swap'
            ? [`${key} ${g.A}`, `${filler} E W25`]
            : [`${key} ${g.A} ${g.B} W25`]
      const play = (text: string) =>
        simulateRotation({
          rotation: parseRotation(
            text,
            members.map((characterKey) => ({
              characterKey,
              name: characterKey,
            }))
          ),
          members,
          constellations: { [key]: spec.cons, [filler]: 0 },
          elements: Object.fromEntries(
            members.map((m) => [m, getCharEle(m)])
          ) as never,
          repeats: 1,
          keep: 'all',
        })
      const out = {
        actions: [] as { f: number; c: string; a: string; frames: number }[],
        waits: [] as { f: number; c: string }[],
        hits: [] as { f: number; label?: string; path: string }[],
        warnings: [] as string[],
        notes: [] as string[],
      }
      const collect = (
        sim: ReturnType<typeof simulateRotation>,
        offset: number
      ) => {
        out.actions.push(
          ...sim.actions.map((a) => ({
            f: a.start + offset,
            c: a.characterKey,
            a: a.text,
            frames: a.frames,
          }))
        )
        out.waits.push(
          ...(sim.waits ?? []).map((w) => ({
            f: w.start + offset,
            c: w.characterKey,
          }))
        )
        out.hits.push(
          ...sim.hits
            .filter(
              (h) =>
                h.characterKey === key &&
                // markers too when they apply an element (the reference logs those 0-damage hits)
                (!h.path[0].startsWith('_') ||
                  (h.applies && h.element !== 'physical'))
            )
            .map((h) => ({
              f: h.t + offset,
              label: h.label,
              path: h.path.join('.'),
            }))
        )
        out.warnings.push(...sim.warnings)
        out.notes.push(...sim.notes)
      }
      if (perGroup)
        // each group from a fresh state (as the reference ran them)
        spec.groups.forEach((g, i) => {
          if (invalid.has(i)) out.waits.push({ f: i * 100000, c: key })
          else collect(play(groupSteps(g).join(' -> ')), i * 100000)
        })
      else {
        // the same sequence as the reference, invalid groups replaced by the wait alone
        let last: CharacterKey = key
        const steps: string[] = []
        spec.groups.forEach((g, i) => {
          if (invalid.has(i)) {
            steps.push(`${last} W25`)
            return
          }
          steps.push(...groupSteps(g))
          last = g.B === 'swap' ? filler : key
        })
        collect(play(steps.join(' -> ')), 0)
      }
      writeFileSync(join(dir!, `${name}.ours.json`), JSON.stringify(out))
      expect(true).toBe(true)
    })
})
