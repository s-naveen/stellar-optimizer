import type { ArtSetExclusion } from '@genshin-optimizer/gi/db'
import type { OptNode } from '@genshin-optimizer/gi/wr'
import type {
  ArtifactsBySlot,
  PlotData,
  RequestFilter,
  SolverBuild,
} from './common'

export type OptProblemInput = {
  arts: ArtifactsBySlot
  optimizationTarget: OptNode
  constraints: { value: OptNode; min: number }[]
  exclusion: ArtSetExclusion

  topN: number
  plotBase?: OptNode
}

/** A sub-space of builds to solve */
export interface WorkItem {
  filter: RequestFilter
  /** Number of builds in `filter` */
  count: number
  /** Upper bound of the optimization target over `filter` (`Infinity` if unknown) */
  ub: number
  /** Must be solved on the CPU (e.g. the GPU could not handle it) */
  cpu?: true
}
/** Plot bins `floor(x / scale) - base`, for bins in `[0, len)` */
export interface PlotConfig {
  scale: number
  base: number
  len: number
}

/**
 * Messages to/from the (pooled, reused) workers. Every message carries the `run` it belongs
 * to, so that late messages of a cancelled run are ignored by the next one.
 */
export type WorkerCommand = Init | Work | Threshold | Finalize
export type WorkerResult = Ready | WorkDone | Finalized | WorkerError

/** A preprocessed problem (see `preprocess`) */
export interface Setup {
  command: 'setup'

  arts: ArtifactsBySlot

  optTarget: OptNode
  constraints: { value: OptNode; min: number }[]
  plotBase: OptNode | undefined
  topN: number
  plot?: PlotConfig
}
/**
 * Start a run. The lead worker preprocesses `problem` (keeping that work off the main
 * thread), enumerates the initial work items, and solves the whole problem right away when it
 * is small. Helpers start from the lead's preprocessed setup instead of redoing that work.
 */
export type Init = LeadInit | HelperInit
export interface LeadInit {
  command: 'init'
  run: number
  lead: true
  problem: OptProblemInput
  /** Problems up to this many builds are solved by the lead directly */
  localMax: number
}
export interface HelperInit {
  command: 'init'
  run: number
  lead: false
  setup: Setup
}
export interface Work {
  command: 'work'
  run: number
  items: WorkItem[]
  /** Items with more builds than this are split instead of computed */
  chunkSize: number
}
/** Fire-and-forget: a new global top-N threshold */
export interface Threshold {
  command: 'threshold'
  run: number
  threshold: number
}
export interface Finalize {
  command: 'finalize'
  run: number
}

export interface Ready {
  resultType: 'ready'
  run: number
  /** Lead only */
  lead?: {
    items: WorkItem[]
    total: number
    plot: PlotConfig | undefined
    /** When the problem was small enough to be solved right away */
    local?: {
      builds: SolverBuild[]
      plotData: PlotData | undefined
      tested: number
      failed: number
      skipped: number
    }
    /** The preprocessed problem, for helpers and the GPU (absent when solved right away) */
    setup?: Setup
  }
}
export interface Finalized {
  resultType: 'finalized'
  run: number
  builds: SolverBuild[]
  plotData?: PlotData | undefined
}
export interface WorkDone {
  resultType: 'work'
  run: number
  /** Sub-problems to schedule */
  items: WorkItem[]
  /** Number of builds evaluated, including `failed` */
  tested: number
  /** Number of evaluated builds that do not meet the constraints */
  failed: number
  /** Number of builds pruned without evaluation */
  skipped: number
  /** The worker's current top values, when they changed */
  buildValues?: number[]
}
export interface FinalizeResult {
  resultType: 'finalize'
  builds: SolverBuild[]
  plotData?: PlotData | undefined
}
export interface WorkerError {
  resultType: 'err'
  run: number
  message: string
}
