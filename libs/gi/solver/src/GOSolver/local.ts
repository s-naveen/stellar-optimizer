import type { ArtSetExclusion } from '@genshin-optimizer/gi/db'
import type { PlotData, SolverBuild } from '../common.js'
import { mergeBuilds, mergePlot } from '../common.js'
import type { Setup } from '../type.js'
import { SolverWorker } from './SolverWorker.js'
import {
  chunkSizeFor,
  initialItems,
  plotConfigFor,
  ThresholdTracker,
  takeBatch,
  WorkHeap,
} from './schedule.js'

export type LocalResult = {
  builds: SolverBuild[]
  plotData: PlotData | undefined
  tested: number
  failed: number
  skipped: number
  total: number
}

/**
 * Solve in-process, with `workers` simulated workers taking turns (same scheduling and
 * threshold logic as `GOSolver`). Used for small problems and for tests.
 */
export function solveLocal(
  setup: Setup,
  exclusion: ArtSetExclusion,
  opts: { workers?: number; chunkSize?: number } = {}
): LocalResult {
  const plot = plotConfigFor(setup)
  const plotMode = !!setup.plotBase
  const numWorkers = opts.workers ?? 1
  const { items: initial, total } = initialItems(setup.arts, exclusion)
  // same preparation as the lead worker's (see `SolverWorker.packItems`)
  const first = new SolverWorker(setup, plot)
  const packed = first.packItems(initial)
  const packedSetup = { ...setup, slotFilters: packed.slotFilters }
  const workers = [
    first,
    ...Array.from(
      { length: numWorkers - 1 },
      () => new SolverWorker(packedSetup, plot)
    ),
  ]
  const heap = new WorkHeap()
  packed.items.forEach((item) => heap.push(item))
  const chunkSize = opts.chunkSize ?? chunkSizeFor(total, numWorkers)
  const tracker = new ThresholdTracker(setup.topN)
  let threshold = Number.NEGATIVE_INFINITY,
    tested = 0,
    failed = 0,
    skipped = packed.skipped,
    turn = 0
  while (heap.size) {
    const batch = takeBatch(heap, threshold, plotMode, (c) => (skipped += c))
    if (!batch.length) continue
    const worker = workers[turn++ % numWorkers]
    const result = worker.work(batch, chunkSize)
    tested += result.tested
    failed += result.failed
    skipped += result.skipped
    result.items.forEach((item) => heap.push(item))
    if (result.buildValues) {
      const t = tracker.report(worker, result.buildValues)
      if (t > threshold) {
        threshold = t
        workers.forEach((w) => w.setThreshold(t))
      }
    }
  }
  const finals = workers.map((w) => w.finalize())
  return {
    builds: mergeBuilds(
      finals.map((f) => f.builds),
      setup.topN
    ),
    plotData: plot
      ? mergePlot(
          finals.map((f) => f.plotData ?? {}),
          plot.scale
        )
      : undefined,
    tested,
    failed,
    skipped,
    total,
  }
}
