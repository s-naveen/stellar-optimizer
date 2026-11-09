import type { ArtifactSetKey } from '@genshin-optimizer/gi/consts'
import { allArtifactSlotKeys } from '@genshin-optimizer/gi/consts'
import type { ArtSetExclusion } from '@genshin-optimizer/gi/db'
import type { ArtifactBuildData, ArtifactsBySlot } from '../common'
import { artSetPerm, filterArts } from '../common'
import { buildAllowed, exclusionMasks } from './exclusion'

/** Deterministic PRNG (mulberry32) */
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pool = [
  'GladiatorsFinale',
  'WanderersTroupe',
  'NoblesseOblige',
  'ViridescentVenerer',
  'EmblemOfSeveredFate',
  'CrimsonWitchOfFlames',
] as ArtifactSetKey[]

describe('buildAllowed matches the builds artSetPerm enumerates', () => {
  test('random inventories and exclusions', () => {
    const rand = rng(7)
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]
    let compared = 0
    for (let trial = 0; trial < 2000; trial++) {
      const nSets = 2 + Math.floor(rand() * (pool.length - 1))
      const sets = pool.slice(0, nSets)
      const partial = rand() < 0.3
      let id = 0
      const values = Object.fromEntries(
        allArtifactSlotKeys.map((slot) => {
          const list: ArtifactBuildData[] = []
          const n = 1 + Math.floor(rand() * 4)
          for (let i = 0; i < n; i++)
            list.push({ id: `${slot}${id++}`, set: pick(sets), values: {} })
          if (partial && rand() < 0.5) list.push({ id: '', values: {} })
          return [slot, list]
        })
      ) as ArtifactsBySlot['values']
      const arts: ArtifactsBySlot = { base: {}, values }
      const exclusion: ArtSetExclusion = {}
      for (const set of sets)
        if (rand() < 0.35)
          (exclusion as Record<string, (2 | 4)[]>)[set] = pick([
            [2],
            [4],
            [2, 4],
          ])
      if (rand() < 0.5)
        exclusion.rainbow = pick([[2], [4], [2, 4]]) as (2 | 4)[]

      // the builds artSetPerm's filters cover (they must be disjoint, so count duplicates)
      const key = (b: ArtifactBuildData[]) =>
        b.map((a) => a.id || '-').join('|')
      const enumerated = new Map<string, number>()
      // as `initialItems` calls it: every artifact's set (`undefined` for empty slots), and the
      // sets each slot has
      const artSets = new Set(
        Object.values(values).flatMap((list) => list.map((a) => a.set!))
      )
      const available = Object.fromEntries(
        Object.entries(values).map(([slot, list]) => [
          slot,
          new Set(list.map((a) => a.set)),
        ])
      )
      for (const filter of artSetPerm(exclusion, artSets, available)) {
        const f = filterArts(arts, filter).values
        for (const a0 of f.flower)
          for (const a1 of f.plume)
            for (const a2 of f.sands)
              for (const a3 of f.goblet)
                for (const a4 of f.circlet) {
                  const k = key([a0, a1, a2, a3, a4])
                  enumerated.set(k, (enumerated.get(k) ?? 0) + 1)
                }
      }
      for (const n of enumerated.values()) expect(n).toBe(1)
      // every build of the inventory, checked one at a time
      const masks = exclusionMasks(exclusion)
      const v = values
      for (const a0 of v.flower)
        for (const a1 of v.plume)
          for (const a2 of v.sands)
            for (const a3 of v.goblet)
              for (const a4 of v.circlet) {
                const b = [a0, a1, a2, a3, a4]
                const allowed = buildAllowed(
                  b.map((a) => a.set),
                  masks
                )
                if (allowed !== enumerated.has(key(b)))
                  throw new Error(
                    `${JSON.stringify(exclusion)} ${b.map((a) => a.set ?? '(empty)').join(',')}: allowed=${allowed}, enumerated=${enumerated.has(key(b))}`
                  )
                compared++
              }
    }
    expect(compared).toBeGreaterThan(50_000)
  })
})
