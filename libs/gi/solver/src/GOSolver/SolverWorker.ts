import { objMap } from '@genshin-optimizer/common/util'
import { allArtifactSlotKeys } from '@genshin-optimizer/gi/consts'
import type { OptNode } from '@genshin-optimizer/gi/wr'
import { forEachNodes } from '@genshin-optimizer/gi/wr'
import type {
  ArtifactBuildData,
  ArtifactsBySlot,
  MinMax,
  PlotData,
  RequestFilter,
  SolverBuild,
} from '../common.js'
import {
  computeFullArtRange,
  computeNodeRange,
  countBuilds,
  filterArts,
} from '../common.js'
import type { PlotConfig, Setup, WorkItem } from '../type.js'
import { linearUB } from './BNBSplitWorker/linearUB.js'
import type { KernelPlot } from './kernel.js'
import { compileKernel, newKernelState } from './kernel.js'
import { insertTop } from './schedule.js'

/** Maximum number of children produced by one split */
const MAX_PARTS = 16

export type WorkResult = {
  /** sub-problems to schedule, when an item was too large to compute directly */
  items: WorkItem[]
  tested: number
  failed: number
  skipped: number
  /** the worker's current top values, when they changed during this call */
  buildValues?: number[]
}

/**
 * Solves work items for one worker (or in-process). Keeps the best `topN` builds it has seen
 * and, when plotting, the best build per plot bin.
 *
 * Pruning used here is only ever based on valid upper bounds:
 * - a linear upper bound of the target/constraints over the whole search space (computed once),
 *   used to drop artifacts and whole items cheaply,
 * - interval bounds inside the compiled kernel.
 * When plotting, the target threshold is never used for pruning (any build may be the best at
 * its plot value); only constraints prune.
 *
 * Every item is computed with the same (setup) formula, so all items share one compiled, warm
 * kernel. Re-simplifying the formula per item (`pruneAll`) was measured to cost far more
 * (recompiles + JIT warm-up) than it saved.
 */
export class SolverWorker {
  readonly topN: number
  readonly plotMode: boolean
  private readonly arts: ArtifactsBySlot
  /** `[target, ...constraints, plot?]` */
  private readonly nodes: OptNode[]
  private readonly mins: number[]
  private threshold = Number.NEGATIVE_INFINITY
  private top: SolverBuild[] = []
  private topChanged = false
  /** Linear upper bounds valid over the whole search space; per node: base and per-artifact contribution */
  private readonly lin?: { c0: number[]; conts: Map<string, number[]> }
  // Kernel inputs, precomputed once
  private readonly column: Map<string, number>
  private readonly rows: Map<string, Float64Array>
  private readonly base: Float64Array
  private readonly ranges: Map<OptNode, MinMax>
  private readonly boundLevels: number[]
  private readonly plot?: PlotStore

  constructor(setup: Setup, plot?: PlotConfig) {
    const { arts, optTarget, constraints, plotBase, topN } = setup
    this.arts = arts
    this.topN = topN
    this.plotMode = !!plotBase
    this.mins = constraints.map((c) => c.min)
    this.nodes = [optTarget, ...constraints.map((c) => c.value)]
    if (plotBase) this.nodes.push(plotBase)

    try {
      const lins = linearUB(this.nodes.slice(0, 1 + this.mins.length), arts)
      const allFinite = lins.every((lin) =>
        Object.values(lin).every(Number.isFinite)
      )
      if (allFinite) {
        const dot = (
          values: Record<string, number>,
          lin: Record<string, number>
        ) =>
          Object.entries(values).reduce((s, [k, v]) => s + (lin[k] ?? 0) * v, 0)
        const conts = new Map<string, number[]>()
        for (const slot of allArtifactSlotKeys)
          for (const art of arts.values[slot])
            conts.set(
              art.id,
              lins.map((lin) => dot(art.values, lin))
            )
        this.lin = {
          c0: lins.map((lin) => lin.$c + dot(arts.base, lin)),
          conts,
        }
      }
    } catch {
      // Formula not approximable (e.g. multivariate min/max); no linear pruning or ordering
    }

    const keys = readKeys(this.nodes)
    this.column = new Map(keys.map((k, i) => [k, i]))
    this.base = new Float64Array(keys.map((k) => arts.base[k] ?? 0))
    this.rows = new Map()
    for (const slot of allArtifactSlotKeys)
      for (const art of arts.values[slot])
        this.rows.set(
          art.id,
          new Float64Array(keys.map((k) => art.values[k] ?? 0))
        )
    this.ranges = computeNodeRange(this.nodes, computeFullArtRange(arts))
    this.boundLevels = boundLevelsFor(this.nodes)
    if (plotBase && plot) this.plot = new PlotStore(plot)
  }

  setThreshold(threshold: number) {
    if (threshold > this.threshold) this.threshold = threshold
  }

  /** Lowest value a new build needs to enter the (global) top-N */
  private insertThreshold(): number {
    const local =
      this.top.length >= this.topN
        ? this.top[this.topN - 1].value
        : Number.NEGATIVE_INFINITY
    return Math.max(local, this.threshold)
  }
  /** Threshold used for pruning the target (never when plotting) */
  private pruneThreshold(): number {
    return this.plotMode ? Number.NEGATIVE_INFINITY : this.insertThreshold()
  }

  work(items: WorkItem[], chunkSize: number): WorkResult {
    const result: WorkResult = { items: [], tested: 0, failed: 0, skipped: 0 }
    for (const item of items) this.workOne(item, chunkSize, result)
    if (this.topChanged) {
      result.buildValues = this.top.map((b) => b.value)
      this.topChanged = false
    }
    return result
  }

  private workOne(item: WorkItem, chunkSize: number, result: WorkResult) {
    let arts = filterArts(this.arts, item.filter)
    const count0 = countBuilds(arts)
    if (!count0) return
    if (this.lin) arts = this.linearPrune(arts)
    const count = countBuilds(arts)
    result.skipped += count0 - count
    if (!count) return
    if (count > chunkSize)
      result.items.push(...this.split(arts, count, chunkSize))
    else this.compute(arts, result)
  }

  /** Remove artifacts that cannot satisfy a constraint (or beat the threshold) given the best of the other slots */
  private linearPrune(arts: ArtifactsBySlot): ArtifactsBySlot {
    const { c0, conts } = this.lin!
    const mins = [this.pruneThreshold(), ...this.mins]
    let values = arts.values
    for (let pass = 0; pass < 3; pass++) {
      const maxBySlot = objMap(values, (list) =>
        mins.map((_, i) =>
          list.reduce(
            (m, art) => Math.max(m, conts.get(art.id)![i]),
            Number.NEGATIVE_INFINITY
          )
        )
      )
      const total = mins.map((_, i) =>
        Object.values(maxBySlot).reduce((s, m) => s + m[i], c0[i])
      )
      let changed = false
      values = objMap(values, (list, slot) => {
        const kept = list.filter((art) => {
          const cont = conts.get(art.id)!
          return mins.every(
            (m, i) =>
              m === Number.NEGATIVE_INFINITY ||
              total[i] - maxBySlot[slot][i] + cont[i] >= m
          )
        })
        if (kept.length !== list.length) changed = true
        return kept
      })
      if (!changed) break
    }
    return { base: arts.base, values }
  }

  /**
   * Split the smallest slot (with more than one artifact) into (at most `MAX_PARTS`) groups, best first.
   *
   * The kernel loops over the smallest slot outermost, so each child is exactly a slice of the
   * parent's search: the bounds inside the kernel are unchanged, and the children together do
   * the same work as the parent would. (Splitting a large, inner slot instead changes the loop
   * order and loosens the bounds, roughly doubling the work in practice.)
   */
  private split(
    arts: ArtifactsBySlot,
    count: number,
    chunkSize: number
  ): WorkItem[] {
    const slot = allArtifactSlotKeys
      .filter((s) => arts.values[s].length > 1)
      .reduce((a, b) =>
        arts.values[a].length <= arts.values[b].length ? a : b
      )
    const list = this.sorted(arts.values[slot])
    const parts = Math.min(list.length, MAX_PARTS, Math.ceil(count / chunkSize))
    const size = Math.ceil(list.length / parts)
    const items: WorkItem[] = []
    for (let i = 0; i < list.length; i += size) {
      const values = { ...arts.values, [slot]: list.slice(i, i + size) }
      items.push({
        filter: objMap(values, (l) => ({
          kind: 'id' as const,
          ids: new Set(l.map((a) => a.id)),
        })) as RequestFilter,
        count: countBuilds({ base: arts.base, values }),
        ub: this.upperBound(values),
      })
    }
    return items
  }

  /** Linear upper bound of the target over the given artifacts (Infinity if unavailable) */
  private upperBound(values: ArtifactsBySlot['values']): number {
    if (!this.lin) return Number.POSITIVE_INFINITY
    const { c0, conts } = this.lin
    return Object.values(values).reduce(
      (s, list) =>
        s +
        list.reduce(
          (m, art) => Math.max(m, conts.get(art.id)![0]),
          Number.NEGATIVE_INFINITY
        ),
      c0[0]
    )
  }

  /** Artifacts ordered by their (linear) target contribution, best first */
  private sorted(list: ArtifactBuildData[]): ArtifactBuildData[] {
    const conts = this.lin?.conts
    if (!conts) return list
    return [...list].sort((a, b) => conts.get(b.id)![0] - conts.get(a.id)![0])
  }

  /** Enumerate every build of `arts` with the compiled kernel */
  private compute(arts: ArtifactsBySlot, result: WorkResult) {
    const { column, base, ranges, rows } = this
    const K = column.size
    // Largest slot innermost; good artifacts first so that the threshold rises early
    const lists = allArtifactSlotKeys
      .map((slot) => this.sorted(arts.values[slot]))
      .sort((a, b) => a.length - b.length)
    const n = lists.map((l) => l.length)
    const A = lists.map((list) => {
      const arr = new Float64Array(list.length * K)
      list.forEach((art, j) => arr.set(rows.get(art.id)!, j * K))
      return arr
    })
    const R = [0, 1, 2, 3].map((l) => {
      const r = new Float64Array(2 * K)
      for (let m = l + 1; m < 5; m++)
        for (let k = 0; k < K; k++) {
          let lo = Number.POSITIVE_INFINITY,
            hi = Number.NEGATIVE_INFINITY
          for (let j = 0; j < n[m]; j++) {
            const v = A[m][j * K + k]
            if (v < lo) lo = v
            if (v > hi) hi = v
          }
          r[2 * k] += lo
          r[2 * k + 1] += hi
        }
      return r
    })

    const kernel = compileKernel({
      nodes: this.nodes,
      mins: this.mins,
      plot: this.plotMode,
      column,
      K,
      ranges,
      boundTarget: !this.plotMode,
      boundLevels: this.boundLevels,
    })
    const state = newKernelState(this.topN, this.insertThreshold())
    if (this.plot) state.plot = this.plot.kernelPlot(lists)
    kernel({ A, n, base, R }, state)
    result.tested += state.tested
    result.failed += state.failed
    result.skipped += state.skipped

    for (let j = 0; j < this.topN; j++) {
      const value = state.topV[j]
      if (!(value > Number.NEGATIVE_INFINITY)) break
      this.insertTop({
        value,
        artifactIds: idsOf(lists, state.topI, j),
      })
    }
    this.plot?.commit(lists)
  }

  private insertTop(build: SolverBuild) {
    if (insertTop(this.top, build, this.topN)) this.topChanged = true
  }

  finalize(): { builds: SolverBuild[]; plotData?: PlotData } {
    return { builds: this.top, plotData: this.plot?.data() }
  }
}

/** Best build per plot bin, for one worker */
export class PlotStore {
  private readonly cfg: PlotConfig
  private readonly V: Float64Array
  private readonly X: Float64Array
  private readonly I: Int32Array
  private readonly D: Uint8Array
  private readonly ids: (string[] | undefined)[]
  private readonly miss = new Map<number, SolverBuild>()

  constructor(cfg: PlotConfig) {
    this.cfg = cfg
    this.V = new Float64Array(cfg.len).fill(Number.NEGATIVE_INFINITY)
    this.X = new Float64Array(cfg.len)
    this.I = new Int32Array(cfg.len * 5)
    this.D = new Uint8Array(cfg.len)
    this.ids = Array(cfg.len)
  }
  kernelPlot(lists: ArtifactBuildData[][]): KernelPlot {
    const { scale, base } = this.cfg
    return {
      scale,
      base,
      V: this.V,
      X: this.X,
      I: this.I,
      D: this.D,
      miss: (x, v, i0, i1, i2, i3, i4) =>
        this.add(x, v, () => idsOf(lists, [i0, i1, i2, i3, i4], 0)),
    }
  }
  /** Record a build outside the kernel (out-of-range bins, GPU results) */
  add(x: number, v: number, ids: () => string[]) {
    if (!Number.isFinite(x) || !(v > Number.NEGATIVE_INFINITY)) return
    const bin = Math.floor(x / this.cfg.scale) - this.cfg.base
    if (bin >= 0 && bin < this.cfg.len) {
      if (v > this.V[bin]) {
        this.V[bin] = v
        this.X[bin] = x
        this.ids[bin] = ids()
      }
      return
    }
    const key = bin
    const old = this.miss.get(key)
    if (!old || old.value < v)
      this.miss.set(key, { value: v, plot: x, artifactIds: ids() })
  }
  /** Resolve artifact ids of bins updated by the last kernel call */
  commit(lists: ArtifactBuildData[][]) {
    const { D, I, ids } = this
    for (let b = 0; b < D.length; b++)
      if (D[b]) {
        D[b] = 0
        ids[b] = idsOf(lists, I, b)
      }
  }
  data(): PlotData {
    const out: PlotData = {}
    let i = 0
    for (let b = 0; b < this.V.length; b++)
      if (this.V[b] > Number.NEGATIVE_INFINITY && this.ids[b])
        out[i++] = {
          value: this.V[b],
          plot: this.X[b],
          artifactIds: this.ids[b]!,
        }
    for (const build of this.miss.values()) out[i++] = build
    return out
  }
}

function idsOf(
  lists: ArtifactBuildData[][],
  indices: ArrayLike<number>,
  entry: number
): string[] {
  const ids: string[] = []
  for (let l = 0; l < 5; l++) {
    const id = lists[l][indices[entry * 5 + l]].id
    if (id) ids.push(id) // '' = empty slot (partial builds)
  }
  return ids
}

export function readKeys(nodes: OptNode[]): string[] {
  const keys = new Set<string>()
  forEachNodes(
    nodes,
    (_) => {},
    (f) => {
      if (f.operation === 'read') keys.add(f.path[1] as string)
    }
  )
  return [...keys]
}

/**
 * Full (target + constraint) bounds are only checked before the innermost loop: any sub-tree
 * that a bound at an outer level would skip is skipped at the innermost level anyway, so outer
 * bounds only save bound checks, and on real problems they cost more than they save (measured,
 * including constraint-only variants).
 */
function boundLevelsFor(_nodes: OptNode[]): number[] {
  return [3]
}
