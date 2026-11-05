import {
  type ArtifactSetKey,
  allArtifactSlotKeys,
} from '@genshin-optimizer/gi/consts'
import type { ArtSetExclusion } from '@genshin-optimizer/gi/db'
import type { OptNode } from '@genshin-optimizer/gi/wr'
import {
  dynRead,
  frac,
  max,
  min,
  precompute,
  prod,
  res,
  sum,
  threshold,
} from '@genshin-optimizer/gi/wr'
import type {
  ArtifactBuildData,
  ArtifactsBySlot,
  PlotData,
  SolverBuild,
} from '../common'
import {
  artSetPerm,
  computeFullArtRange,
  filterArts,
  filterFeasiblePerm,
  mergePlot,
} from '../common'
import { testing as kernelTesting } from './kernel'
import { solveLocal } from './local'
import { preprocess } from './preprocess'
import { plotConfigFor } from './schedule'

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

const sets = [
  'GladiatorsFinale',
  'WanderersTroupe',
  'NoblesseOblige',
] as ArtifactSetKey[]
const [A, B, C] = sets
const r = (key: string) => dynRead(key)

function makeArts(
  rand: () => number,
  perSlot: number,
  partial: boolean
): ArtifactsBySlot {
  let id = 0
  const keys = ['atk_', 'atk', 'cr', 'cd', 'er', 'em', 'dmg_', ...sets]
  const values = Object.fromEntries(
    allArtifactSlotKeys.map((slot) => {
      const list: ArtifactBuildData[] = []
      for (let i = 0; i < perSlot; i++) {
        const set = sets[Math.floor(rand() * sets.length)]
        const v: Record<string, number> = { [set]: 1 }
        // multiples of 1/16 keep sums exact, so plot bins are unambiguous
        const q = (x: number) => Math.round(x * 16) / 16
        if (rand() < 0.7) v['atk_'] = q(rand() * 0.5)
        if (rand() < 0.5) v['atk'] = Math.round(rand() * 300)
        if (rand() < 0.6) v['cr'] = q(rand() * 0.3)
        if (rand() < 0.6) v['cd'] = q(rand() * 0.6)
        if (rand() < 0.5) v['er'] = q(rand() * 0.5)
        if (rand() < 0.4) v['em'] = Math.round(rand() * 200)
        if (slot === 'goblet' && rand() < 0.5) v['dmg_'] = 0.466
        list.push({ id: `${slot}${id++}`, set, values: v })
      }
      if (partial) list.push({ id: '', values: {} })
      return [slot, list]
    })
  ) as ArtifactsBySlot['values']
  return { base: Object.fromEntries(keys.map((k) => [k, 0])), values }
}

/** A GI-shaped formula: multiplicative damage, crit cap, set bonuses, res shred, EM reaction */
function formula() {
  const atk = sum(prod(1000, sum(1, r('atk_'))), r('atk'))
  const critRate = min(max(r('cr'), 0), 1)
  const critMult = sum(1, prod(critRate, sum(0.5, r('cd'))))
  const dmgBonus = sum(
    1,
    r('dmg_'),
    threshold(r(A), 4, 0.35, 0),
    threshold(r(B), 2, 0.2, 0)
  )
  const enemyRes = res(sum(0.1, threshold(r(C), 4, -0.4, 0)))
  const reaction = prod(1200, sum(1, prod(2.78, frac(r('em'), 1400))))
  const target = sum(
    prod(atk, critMult, dmgBonus, enemyRes),
    prod(0.2, reaction)
  )
  const er = sum(1, r('er'), threshold(r(C), 2, 0.2, 0))
  return { target, er, critRate }
}

type Case = {
  seed: number
  perSlot: number
  topN: number
  exclusion: ArtSetExclusion
  partial?: boolean
  constraints?: 'er' | 'er+cr'
  plot?: boolean
}

function bruteForce(
  arts: ArtifactsBySlot,
  nodes: OptNode[],
  mins: number[],
  exclusion: ArtSetExclusion,
  topN: number,
  withPlot: boolean
) {
  const f = precompute(nodes, arts.base, (x) => x.path[1], 5)
  const artSets = new Set(
    Object.values(arts.values).flatMap((l) => l.map((a) => a.set!))
  )
  const all: { value: number; plot?: number; ids: string[] }[] = []
  for (const filter of filterFeasiblePerm(
    artSetPerm(exclusion, artSets),
    arts
  )) {
    const lists = allArtifactSlotKeys.map(
      (s) => filterArts(arts, filter).values[s]
    )
    for (const a0 of lists[0])
      for (const a1 of lists[1])
        for (const a2 of lists[2])
          for (const a3 of lists[3])
            for (const a4 of lists[4]) {
              const out = f([a0, a1, a2, a3, a4])
              if (!mins.every((m, i) => m <= out[1 + i])) continue
              all.push({
                value: out[0],
                plot: withPlot ? out[1 + mins.length] : undefined,
                ids: [a0, a1, a2, a3, a4].map((a) => a.id).filter((x) => x),
              })
            }
  }
  all.sort((a, b) => b.value - a.value)
  return { top: all.slice(0, topN), all }
}

function close(a: number, b: number) {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
}

function run(c: Case, opts: { workers: number; chunkSize?: number }) {
  const rand = rng(c.seed)
  const arts = makeArts(rand, c.perSlot, !!c.partial)
  const { target, er, critRate } = formula()
  const constraints: { value: OptNode; min: number }[] = []
  // 1.3125 is reachable exactly (stats are multiples of 1/16), so boundary builds must be kept
  if (c.constraints) constraints.push({ value: er, min: 1.3125 })
  if (c.constraints === 'er+cr') constraints.push({ value: critRate, min: 0.5 })
  const plotBase = c.plot ? er : undefined
  const setup = preprocess({
    arts,
    optimizationTarget: target,
    constraints,
    exclusion: c.exclusion,
    topN: c.topN,
    plotBase,
  })
  const result = solveLocal(setup, c.exclusion, opts)
  const nodes = [
    target,
    ...constraints.map((x) => x.value),
    ...(plotBase ? [plotBase] : []),
  ]
  const truth = bruteForce(
    arts,
    nodes,
    constraints.map((x) => x.min),
    c.exclusion,
    c.topN,
    !!c.plot
  )
  return { setup, result, truth, arts, nodes, constraints }
}

const cases: Case[] = [
  { seed: 1, perSlot: 9, topN: 5, exclusion: {} },
  { seed: 2, perSlot: 9, topN: 1, exclusion: {}, constraints: 'er' },
  { seed: 3, perSlot: 8, topN: 10, exclusion: {}, constraints: 'er+cr' },
  { seed: 4, perSlot: 9, topN: 5, exclusion: { [A]: [2], rainbow: [2, 4] } },
  { seed: 5, perSlot: 8, topN: 3, exclusion: { [B]: [2, 4] }, partial: true },
  {
    seed: 6,
    perSlot: 8,
    topN: 5,
    exclusion: {},
    constraints: 'er',
    plot: true,
  },
  {
    seed: 7,
    perSlot: 7,
    topN: 4,
    exclusion: { [C]: [4] },
    partial: true,
    plot: true,
  },
  {
    seed: 8,
    perSlot: 10,
    topN: 2,
    exclusion: { rainbow: [2, 4] },
    constraints: 'er+cr',
  },
]
const schedules = [
  { workers: 1 },
  { workers: 3, chunkSize: 2_000 },
  { workers: 4, chunkSize: 150 },
]

describe('solver matches brute force', () => {
  for (const c of cases)
    for (const opts of schedules)
      test(`case ${c.seed} (top ${c.topN}${c.constraints ? `, ${c.constraints}` : ''}${c.plot ? ', plot' : ''}${c.partial ? ', partial' : ''}) with ${opts.workers} worker(s), chunk ${opts.chunkSize ?? 'auto'}`, () => {
        const { result, truth, arts, nodes, constraints } = run(c, opts)
        // same top-N values
        expect(result.builds.length).toBe(truth.top.length)
        result.builds.forEach((b, i) =>
          expect(close(b.value, truth.top[i].value)).toBe(true)
        )
        // every reported build exists, satisfies the constraints and has the reported value
        const f = precompute(nodes, arts.base, (x) => x.path[1], 5)
        const byId = new Map(
          allArtifactSlotKeys.flatMap((s) =>
            arts.values[s]
              .filter((a) => a.id)
              .map((a) => [a.id, { slot: s, art: a }] as const)
          )
        )
        const empty = { id: '', values: {} }
        const evaluate = (b: SolverBuild) => {
          const bySlot = new Map(
            b.artifactIds.map((id) => [byId.get(id)!.slot, byId.get(id)!.art])
          )
          expect(bySlot.size).toBe(b.artifactIds.length)
          return f(allArtifactSlotKeys.map((s) => bySlot.get(s) ?? empty))
        }
        for (const b of result.builds) {
          const out = evaluate(b)
          expect(close(out[0], b.value)).toBe(true)
          constraints.forEach((x, i) =>
            expect(out[1 + i]).toBeGreaterThanOrEqual(x.min)
          )
        }
        // accounting: every build is either tested or skipped
        expect(result.tested + result.skipped).toBe(result.total)
        if (c.plot) {
          const scale = plotConfigFor(run(c, opts).setup)!.scale
          const truthPlot: PlotData = {}
          truth.all.forEach(
            (b, i) =>
              (truthPlot[i] = {
                value: b.value,
                plot: b.plot,
                artifactIds: b.ids,
              })
          )
          const expected = mergePlot([truthPlot], scale)
          const got = result.plotData!
          const keys = (p: PlotData) =>
            Object.keys(p)
              .map(Number)
              .sort((a, b) => a - b)
          expect(keys(got)).toEqual(keys(expected))
          for (const k of keys(expected))
            expect(close(got[k]!.value, expected[k]!.value)).toBe(true)
        }
      })
})

describe('common fixes', () => {
  test('computeFullArtRange includes 0 for keys missing from some artifacts, with negative values', () => {
    const arts: ArtifactsBySlot = {
      base: { x: 0 },
      values: {
        flower: [
          { id: 'a', values: { x: -5 } },
          { id: 'b', values: {} },
          { id: 'c', values: { x: -3 } },
        ],
        plume: [{ id: 'd', values: {} }],
        sands: [{ id: 'e', values: {} }],
        goblet: [{ id: 'f', values: {} }],
        circlet: [{ id: 'g', values: {} }],
      },
    }
    expect(computeFullArtRange(arts)['x']).toEqual({ min: -5, max: 0 })
  })
  test('mergePlot bins nest exactly across scales', () => {
    const plot: PlotData = {}
    for (let i = 0; i < 5000; i++)
      plot[i] = { value: (i * 7919) % 1000, plot: i * 0.003, artifactIds: [] }
    const once = mergePlot([plot], 0.01)
    // re-merging an already merged plot must not change it
    expect(mergePlot([once], 0.01)).toEqual(once)
    expect(Object.keys(once).length).toBeLessThanOrEqual(1500)
  })
})

describe('kernel interval bounds are sound', () => {
  const { target, er, critRate } = formula()
  const nodes = [target, er, critRate]
  const keys = ['atk_', 'atk', 'cr', 'cd', 'er', 'em', 'dmg_', ...sets]
  const col = new Map(keys.map((k, i) => [k, i]))
  const iv = kernelTesting.emitInterval(
    [nodes],
    (k) => [`L[${col.get(k)}]`, `H[${col.get(k)}]`],
    'u_'
  )
  const bounds = new Function(
    'L',
    'H',
    `${kernelTesting.RES};${iv.codes[0]};return [${iv.outs[0].map(([l, h]) => `${l},${h}`).join(',')}]`
  ) as (L: number[], H: number[]) => number[]
  const point = precompute(
    nodes,
    Object.fromEntries(keys.map((k) => [k, 0])),
    (x) => x.path[1],
    1
  )
  test('random boxes and points', () => {
    const rand = rng(42)
    const spans: Record<string, [number, number]> = {
      atk_: [0, 2.5],
      atk: [0, 1500],
      cr: [-0.2, 1.6],
      cd: [0, 3],
      er: [0, 2.5],
      em: [0, 1000],
      dmg_: [0, 0.6],
    }
    for (let t = 0; t < 2000; t++) {
      const L: number[] = [],
        H: number[] = []
      for (const k of keys) {
        const [a, b] = spans[k] ?? [0, 5] // set counts
        const x = a + rand() * (b - a),
          y = a + rand() * (b - a)
        L.push(Math.min(x, y))
        H.push(Math.max(x, y))
      }
      const out = bounds(L, H)
      for (let p = 0; p < 20; p++) {
        const values = Object.fromEntries(
          keys.map((k, i) => [k, L[i] + rand() * (H[i] - L[i])])
        )
        const v = point([{ values }])
        v.forEach((x, i) => {
          expect(x).toBeGreaterThanOrEqual(out[2 * i] - 1e-9 * Math.abs(x))
          expect(x).toBeLessThanOrEqual(out[2 * i + 1] + 1e-9 * Math.abs(x))
        })
      }
    }
  })
})
