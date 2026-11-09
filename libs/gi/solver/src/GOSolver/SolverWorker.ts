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
import type { PlotConfig, Setup, SlotFilter, WorkItem } from '../type.js'
import { linearUB } from './bounds/linearUB.js'
import type { Kernel, KernelData, KernelPlot, KernelState } from './kernel.js'
import { compileKernel, newKernelState } from './kernel.js'
import { insertTop } from './schedule.js'

/** Maximum number of children produced by one split */
const MAX_PARTS = 16
/**
 * Initial items with fewer builds than this are packed together (see `packItems`); larger ones
 * stay single items (split by the workers, or brute-forced on the GPU)
 */
const PACK_ITEM_MAX = 1_000_000
/** Builds per pack: about one CPU chunk, so that packs balance like the other work */
const PACK_COMBOS = 4_000_000
/** Members per pack (bounds the message size) */
const PACK_LEN = 8192

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
  /** Each slot's artifacts, best (linear) target contribution first (see `sorted`) */
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
  /** The run's kernel: the same formula for every item, compiled once */
  private kernel?: Kernel
  /** Filters of the packed items' members, per slot (see `packItems`) */
  private slotFilters?: Record<string, SlotFilter[]>
  /** Per slot, per slot filter (index): its artifacts with their stat rows and ranges */
  private readonly slotData: Map<number, SlotData>[] = allArtifactSlotKeys.map(
    () => new Map()
  )
  /** Reused by `computeMember` */
  private memberScratch?: {
    levels: SlotData[]
    lists: ArtifactBuildData[][]
    R: Float64Array[]
    data: KernelData
    state: KernelState
  }

  constructor(setup: Setup, plot?: PlotConfig) {
    const { arts, optTarget, constraints, plotBase, topN } = setup
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
    // Sorted once here: every list the worker handles is a filtered (order-preserving) subset
    const conts = this.lin?.conts
    this.arts = conts
      ? {
          base: arts.base,
          values: objMap(arts.values, (list: ArtifactBuildData[]) =>
            [...list].sort((a, b) => conts.get(b.id)![0] - conts.get(a.id)![0])
          ),
        }
      : arts

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
    this.slotFilters = setup.slotFilters
  }

  /**
   * Prepare the initial work (one item per allowed artifact-set combination: with set
   * restrictions that can be millions of tiny items). Each item gets an upper bound for the target
   * and the constraints, from the best (linear) contribution each slot can make with its sets;
   * items that cannot meet a constraint are dropped. The small items are then packed, best first,
   * into a few large ones: a pack is one message and one task, and its worker solves the members
   * in order, skipping the rest of the pack as soon as one cannot beat the threshold. Sending
   * every tiny item on its own (each a message of filter objects through the main thread) made
   * such runs take a minute while the CPU sat mostly idle.
   *
   * Returns the work, the builds dropped, and the slot filters the packs refer to (they go to
   * the other workers with the setup).
   */
  packItems(items: WorkItem[]): {
    items: WorkItem[]
    skipped: number
    slotFilters: Record<string, SlotFilter[]>
  } {
    const nNodes = 1 + this.mins.length
    const n = items.length
    // Distinct slot filters per slot. `artSetPerm` shares its filter objects, so identity finds
    // almost all of them; equal filters that are distinct objects are merged by content.
    const tables: Record<string, SlotFilter[]> = {}
    const idxAll = new Uint16Array(5 * n)
    for (let s = 0; s < 5; s++) {
      const slot = allArtifactSlotKeys[s]
      const table: SlotFilter[] = (tables[slot] = [])
      const byObject = new Map<SlotFilter, number>()
      const byKey = new Map<string, number>()
      for (let i = 0; i < n; i++) {
        const f = items[i].filter[slot]
        let t = byObject.get(f)
        if (t === undefined) {
          const key = slotFilterKey(f)
          t = byKey.get(key)
          if (t === undefined) {
            t = table.length
            // (indices are 16 bits; never reached in practice)
            if (t > 0xffff)
              return { items, skipped: 0, slotFilters: this.slotFilters ?? {} }
            table.push(f)
            byKey.set(key, t)
          }
          byObject.set(f, t)
        }
        idxAll[5 * i + s] = t
      }
    }
    // Upper bounds: the base plus each slot's best contribution with its filter, per node
    // (target, then constraints). Without linear bounds, nothing is known (Infinity).
    const lin = this.lin
    const best = allArtifactSlotKeys.map((slot) => {
      const table = tables[slot]
      const max = new Float64Array(table.length * nNodes).fill(
        lin ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
      )
      if (lin)
        table.forEach((f, t) => {
          for (const art of this.arts.values[slot]) {
            if (!matches(f, art)) continue
            const cont = lin.conts.get(art.id)!
            for (let j = 0; j < nNodes; j++)
              if (cont[j] > max[t * nNodes + j]) max[t * nNodes + j] = cont[j]
          }
        })
      return max
    })
    const c0 = lin?.c0 ?? new Array<number>(nNodes).fill(0)
    const mins = this.mins
    const ubAll = new Float64Array(n)
    const kept = new Uint32Array(n)
    let nKept = 0,
      skipped = 0
    item: for (let i = 0; i < n; i++) {
      const o = 5 * i
      for (let j = 0; j < nNodes; j++) {
        let b = c0[j]
        for (let s = 0; s < 5; s++) b += best[s][idxAll[o + s] * nNodes + j]
        // cannot meet a constraint: dropped (counted as skipped)
        if (j > 0 && b < mins[j - 1]) {
          skipped += items[i].count
          continue item
        }
        if (j === 0) ubAll[i] = Number.isNaN(b) ? Number.POSITIVE_INFINITY : b
      }
      kept[nKept++] = i
    }

    // Best first, approximately: bucketed by bound (exact order is not needed, each member's
    // bound is checked on its own; a comparison sort of millions of items took seconds)
    const order = bucketOrder(kept.subarray(0, nKept), ubAll)
    const out: WorkItem[] = []
    let start = 0
    const flush = (end: number) => {
      const len = end - start
      if (!len) return
      if (len === 1) {
        const i = order[start]
        out.push({ ...items[i], ub: ubAll[i] })
      } else {
        const idx = new Uint16Array(5 * len),
          counts = new Float64Array(len),
          ubs = new Float64Array(len)
        let combos = 0,
          ub = Number.NEGATIVE_INFINITY
        for (let m = 0; m < len; m++) {
          const i = order[start + m]
          for (let s = 0; s < 5; s++) idx[5 * m + s] = idxAll[5 * i + s]
          counts[m] = items[i].count
          ubs[m] = ubAll[i]
          combos += counts[m]
          if (ubs[m] > ub) ub = ubs[m]
        }
        out.push({
          filter: items[order[start]].filter,
          count: combos,
          ub,
          cpu: true,
          pack: { idx, counts, ubs },
        })
      }
      start = end
    }
    let combos = 0
    for (let k = 0; k < order.length; k++) {
      const item = items[order[k]]
      // large items stay on their own (split by the workers, or solved on the GPU)
      if (item.count >= PACK_ITEM_MAX) {
        flush(k)
        out.push({ ...item, ub: ubAll[order[k]] })
        start = k + 1
        combos = 0
        continue
      }
      if (
        k > start &&
        (k - start >= PACK_LEN || combos + item.count > PACK_COMBOS)
      ) {
        flush(k)
        combos = 0
      }
      combos += item.count
    }
    flush(order.length)
    this.slotFilters = tables
    return { items: out, skipped, slotFilters: tables }
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
    if (item.pack) return this.workPack(item, result)
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

  /** Solve the members of a pack in order (best bounds first) */
  private workPack(item: WorkItem, result: WorkResult) {
    const { idx, counts, ubs } = item.pack!
    const tables = this.slotFilters!
    for (let i = 0; i < counts.length; i++) {
      // a member that cannot beat the threshold is skipped without looking at its artifacts
      if (!this.plotMode && ubs[i] <= this.pruneThreshold()) {
        result.skipped += counts[i]
        continue
      }
      // members are small (< PACK_ITEM_MAX builds): computed directly, never split
      if (!this.plotMode) {
        this.computeMember(idx, i, result)
        continue
      }
      const filter = {} as Record<string, SlotFilter>
      for (let s = 0; s < 5; s++)
        filter[allArtifactSlotKeys[s]] =
          tables[allArtifactSlotKeys[s]][idx[5 * i + s]]
      this.workOne(
        { filter: filter as RequestFilter, count: counts[i], ub: ubs[i] },
        Number.POSITIVE_INFINITY,
        result
      )
    }
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
    // `this.arts` is sorted, and every list comes from it through order-preserving filters
    return list
  }

  /** The run's compiled kernel (the same formula for every item) */
  private getKernel(): Kernel {
    // (generating the source to look the kernel up costs more than computing a small item)
    return (this.kernel ??= compileKernel({
      nodes: this.nodes,
      mins: this.mins,
      plot: this.plotMode,
      column: this.column,
      K: this.column.size,
      ranges: this.ranges,
      boundTarget: !this.plotMode,
      boundLevels: this.boundLevels,
    }))
  }

  /** Artifacts of slot `s` passing its `t`-th slot filter, with their stat rows and ranges */
  private dataOf(s: number, t: number): SlotData {
    let d = this.slotData[s].get(t)
    if (!d) {
      const slot = allArtifactSlotKeys[s]
      const f = this.slotFilters![slot][t]
      // already in the worker's (best first) order
      const list = this.arts.values[slot].filter((art) => matches(f, art))
      const K = this.column.size
      const A = new Float64Array(list.length * K)
      const lo = new Float64Array(K).fill(Number.POSITIVE_INFINITY),
        hi = new Float64Array(K).fill(Number.NEGATIVE_INFINITY)
      list.forEach((art, j) => {
        const row = this.rows.get(art.id)!
        A.set(row, j * K)
        for (let k = 0; k < K; k++) {
          if (row[k] < lo[k]) lo[k] = row[k]
          if (row[k] > hi[k]) hi[k] = row[k]
        }
      })
      d = { list, A, lo, hi }
      this.slotData[s].set(t, d)
    }
    return d
  }

  /**
   * Member `i` of a pack (not plotting): the same as `compute` on its artifacts, but from data
   * prepared once per slot filter and with reused buffers. Members are tiny and there can be
   * millions: setting up each one (filtering, copying rows, ranges, allocations) used to cost
   * far more than evaluating its builds.
   */
  private computeMember(idx: Uint16Array, i: number, result: WorkResult) {
    const K = this.column.size
    const sc = (this.memberScratch ??= {
      levels: [],
      lists: [],
      R: [0, 1, 2, 3].map(() => new Float64Array(2 * K)),
      data: { A: [], n: [], base: this.base, R: [] },
      state: newKernelState(this.topN, Number.NEGATIVE_INFINITY),
    })
    const { levels, lists, R, data, state } = sc
    for (let s = 0; s < 5; s++) levels[s] = this.dataOf(s, idx[5 * i + s])
    // largest slot innermost, as in `compute` (stable: equal lengths keep the slot order)
    for (let a = 1; a < 5; a++)
      for (
        let b = a;
        b > 0 && levels[b].list.length < levels[b - 1].list.length;
        b--
      )
        [levels[b], levels[b - 1]] = [levels[b - 1], levels[b]]
    for (let l = 0; l < 5; l++) {
      lists[l] = levels[l].list
      data.A[l] = levels[l].A
      data.n[l] = levels[l].list.length
    }
    if (!data.n[0]) return
    // bounds of the levels below each level: the same sums, in the same order, as `compute`
    for (let l = 0; l < 4; l++) {
      const r = R[l]
      r.fill(0)
      for (let m = l + 1; m < 5; m++) {
        const { lo, hi } = levels[m]
        for (let k = 0; k < K; k++) {
          r[2 * k] += lo[k]
          r[2 * k + 1] += hi[k]
        }
      }
      data.R[l] = r
    }
    state.topV.fill(Number.NEGATIVE_INFINITY)
    state.topI.fill(-1)
    state.thr = this.insertThreshold()
    state.tested = state.failed = state.skipped = 0
    this.getKernel()(data, state)
    result.tested += state.tested
    result.failed += state.failed
    result.skipped += state.skipped
    for (let j = 0; j < this.topN; j++) {
      const value = state.topV[j]
      if (!(value > Number.NEGATIVE_INFINITY)) break
      this.insertTop({ value, artifactIds: idsOf(lists, state.topI, j) })
    }
  }

  /** Enumerate every build of `arts` with the compiled kernel */
  private compute(arts: ArtifactsBySlot, result: WorkResult) {
    const { column, base, rows } = this
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

    const kernel = this.getKernel()
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

/** Artifacts of one slot filter, with their stat rows (`K` per artifact) and per-stat range */
type SlotData = {
  list: ArtifactBuildData[]
  A: Float64Array
  lo: Float64Array
  hi: Float64Array
}

/** Content key of a slot filter */
function slotFilterKey(f: SlotFilter): string {
  return f.kind === 'id'
    ? `i${[...f.ids].sort().join(',')}`
    : `${f.kind === 'required' ? 'r' : 'e'}${[...f.sets].sort().join(',')}`
}

/**
 * `indices` ordered by descending `ub`, approximately: grouped into buckets of equal width
 * between the smallest and largest finite bound (infinite bounds first).
 */
function bucketOrder(indices: Uint32Array, ub: Float64Array): Uint32Array {
  const BUCKETS = 4096
  let lo = Number.POSITIVE_INFINITY,
    hi = Number.NEGATIVE_INFINITY
  for (const i of indices)
    if (Number.isFinite(ub[i])) {
      if (ub[i] < lo) lo = ub[i]
      if (ub[i] > hi) hi = ub[i]
    }
  const scale = hi > lo ? (BUCKETS - 1) / (hi - lo) : 0
  const bucketOf = (u: number) =>
    u === Number.POSITIVE_INFINITY
      ? 0
      : u === Number.NEGATIVE_INFINITY
        ? BUCKETS + 1
        : 1 + Math.floor((hi - u) * scale)
  const counts = new Uint32Array(BUCKETS + 3)
  for (const i of indices) counts[bucketOf(ub[i]) + 1]++
  for (let b = 1; b < counts.length; b++) counts[b] += counts[b - 1]
  const out = new Uint32Array(indices.length)
  for (const i of indices) out[counts[bucketOf(ub[i])]++] = i
  return out
}

/** Whether `art` passes the slot filter `f` */
function matches(f: SlotFilter, art: ArtifactBuildData): boolean {
  if (f.kind === 'id') return f.ids.has(art.id)
  if (f.kind === 'required') return f.sets.has(art.set!)
  return !f.sets.has(art.set!)
}

/** Best build per plot bin, for one worker */
/** The value next to `x` whose plot bin (`floor(value / scale)`) is `key`; `x` is close to that bin */
export function insideBin(x: number, key: number, scale: number): number {
  const own = Math.floor(x / scale)
  if (own === key) return x
  const down = own > key
  const edge = (down ? key + 1 : key) * scale
  for (
    let eps = Math.abs(edge) * 2 ** -52 || 2 ** -1074;
    eps < scale;
    eps *= 2
  ) {
    const y = down ? edge - eps : edge + eps
    if (Math.floor(y / scale) === key) return y
  }
  return (key + 0.5) * scale
}

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
  /**
   * Record a build outside the kernel (out-of-range bins, GPU results). `at`: its bin when
   * already decided (by the GPU, from its f32 plot value). A build right on a bin edge then goes
   * to that bin, and its plot value moves inside it (by about f32 rounding), so that `mergePlot`
   * keeps it there too.
   */
  add(x: number, v: number, ids: () => string[], at?: number) {
    if (!Number.isFinite(x) || !(v > Number.NEGATIVE_INFINITY)) return
    const { scale, base, len } = this.cfg
    let bin = Math.floor(x / scale) - base
    if (at !== undefined && at !== bin && at >= 0 && at < len) {
      x = insideBin(x, at + base, scale)
      bin = at
    }
    if (bin >= 0 && bin < len) {
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
