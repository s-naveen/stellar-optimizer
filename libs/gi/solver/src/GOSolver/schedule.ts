import type { ArtSetExclusion } from '@genshin-optimizer/gi/db'
import type { ArtifactsBySlot, SolverBuild } from '../common.js'
import {
  artSetPerm,
  computeFullArtRange,
  computeNodeRange,
  countBuilds,
  filterArts,
  filterFeasiblePerm,
} from '../common.js'
import type { PlotConfig, Setup, WorkItem } from '../type.js'

/** Each worker should get about this many chunks, for load balancing */
const CHUNKS_PER_WORKER = 4
/** Smallest chunk worth splitting off (amortises pruning and messaging) */
const MIN_CHUNK = 4_000_000
/** Items smaller than this are batched together into one message */
const BATCH_ITEM_MAX = 1_000_000
const BATCH_COMBOS = 4_000_000
const BATCH_LEN = 64
/** Finest plot resolution kept by workers, in bins over the whole plot range */
const MAX_PLOT_BINS = 1 << 16

/** Initial work: one item per (disjoint) artifact set permutation allowed by `exclusion` */
export function initialItems(
  arts: ArtifactsBySlot,
  exclusion: ArtSetExclusion
): { items: WorkItem[]; total: number } {
  const sets = new Set(
    Object.values(arts.values).flatMap((list) => list.map((art) => art.set!))
  )
  const items: WorkItem[] = []
  let total = 0
  for (const filter of filterFeasiblePerm(artSetPerm(exclusion, sets), arts)) {
    const count = countBuilds(filterArts(arts, filter))
    if (!count) continue
    total += count
    items.push({ filter, count, ub: Number.POSITIVE_INFINITY })
  }
  return { items, total }
}

export function chunkSizeFor(total: number, workers: number): number {
  return Math.max(MIN_CHUNK, Math.ceil(total / (workers * CHUNKS_PER_WORKER)))
}

export function plotConfigFor(setup: Setup): PlotConfig | undefined {
  const { plotBase, arts } = setup
  if (!plotBase) return undefined
  const range = computeNodeRange([plotBase], computeFullArtRange(arts)).get(
    plotBase
  )!
  let scale = 0.01
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max))
    return { scale, base: 0, len: 0 } // everything goes through the slow path
  while ((range.max - range.min) / scale > MAX_PLOT_BINS) scale *= 2
  const base = Math.floor(range.min / scale) - 1
  return { scale, base, len: Math.floor(range.max / scale) - base + 2 }
}

/** Max-heap of work items by upper bound, so that promising regions are solved first */
export class WorkHeap {
  private readonly heap: WorkItem[] = []
  get size() {
    return this.heap.length
  }
  push(item: WorkItem) {
    const { heap } = this
    heap.push(item)
    let i = heap.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (!before(heap[i], heap[parent])) break
      ;[heap[i], heap[parent]] = [heap[parent], heap[i]]
      i = parent
    }
  }
  pop(): WorkItem | undefined {
    const { heap } = this
    const top = heap[0]
    const last = heap.pop()
    if (heap.length && last) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1
        let best = i
        if (l < heap.length && before(heap[l], heap[best])) best = l
        if (r < heap.length && before(heap[r], heap[best])) best = r
        if (best === i) break
        ;[heap[i], heap[best]] = [heap[best], heap[i]]
        i = best
      }
    }
    return top
  }
  peek(): WorkItem | undefined {
    return this.heap[0]
  }
}
function before(a: WorkItem, b: WorkItem) {
  return a.ub > b.ub || (a.ub === b.ub && a.count > b.count)
}

/**
 * Next batch of work: one large item, or several small ones. Items that cannot beat
 * `threshold` are dropped (reported via `onSkip`), except when plotting.
 */
export function takeBatch(
  heap: WorkHeap,
  threshold: number,
  plotMode: boolean,
  onSkip: (count: number) => void,
  accept: (item: WorkItem) => boolean = () => true
): WorkItem[] {
  const batch: WorkItem[] = []
  let combos = 0
  while (heap.size) {
    const item = heap.peek()!
    if (!plotMode && item.ub <= threshold) {
      heap.pop()
      onSkip(item.count)
      continue
    }
    if (!accept(item)) break
    if (
      batch.length &&
      (item.count >= BATCH_ITEM_MAX ||
        combos + item.count > BATCH_COMBOS ||
        batch.length >= BATCH_LEN)
    )
      break
    heap.pop()
    batch.push(item)
    combos += item.count
    if (item.count >= BATCH_ITEM_MAX) break
  }
  return batch
}

/** Global top-N threshold from the best values reported by each (disjoint) source */
export class ThresholdTracker {
  private readonly values = new Map<unknown, number[]>()
  private readonly topN: number
  constructor(topN: number) {
    this.topN = topN
  }
  /** Record `source`'s current best values and return the new threshold */
  report(source: unknown, values: number[]): number {
    this.values.set(source, values)
    return this.threshold()
  }
  threshold(): number {
    const all = [...this.values.values()].flat().sort((a, b) => b - a)
    return all.length >= this.topN
      ? all[this.topN - 1]
      : Number.NEGATIVE_INFINITY
  }
}

/** Insert `build` into `top` (sorted, best first, at most `topN`); returns whether it was kept */
export function insertTop(
  top: SolverBuild[],
  build: SolverBuild,
  topN: number
): boolean {
  if (top.length >= topN && !(build.value > top[topN - 1].value)) return false
  let j = top.findIndex((b) => b.value < build.value)
  if (j < 0) j = top.length
  top.splice(j, 0, build)
  if (top.length > topN) top.pop()
  return true
}
