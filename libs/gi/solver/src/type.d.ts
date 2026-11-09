import type { ArtifactSlotKey } from '@genshin-optimizer/gi/consts'
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
  /**
   * Many small sub-spaces solved together, in order (see `SolverWorker.packItems`). `filter`
   * is then its first (best) member's, `count` the total and `ub` the first member's bound.
   */
  pack?: PackedItems
}
/**
 * Members of a pack, as typed arrays (cheap to send between threads, unlike millions of
 * filter objects). Member `i`'s filter is `Setup.slotFilters[slot][idx[5 * i + s]]` for the
 * `s`-th slot of `allArtifactSlotKeys`.
 */
export interface PackedItems {
  idx: Uint16Array
  /** Builds of each member */
  counts: Float64Array
  /** Upper bound of the target over each member, in descending order */
  ubs: Float64Array
}
/** One slot of a `RequestFilter` */
export type SlotFilter = RequestFilter[ArtifactSlotKey]
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
export type WorkerCommand = Init | Work | Threshold | Finalize | Proceed
export type WorkerResult =
  | Started
  | Prepared
  | Ready
  | WorkDone
  | Finalized
  | WorkerError

/** A preprocessed problem (see `preprocess`) */
export interface Setup {
  command: 'setup'

  arts: ArtifactsBySlot

  optTarget: OptNode
  constraints: { value: OptNode; min: number }[]
  plotBase: OptNode | undefined
  topN: number
  plot?: PlotConfig
  /** The distinct slot filters of the packed work items, per slot (set by the lead) */
  slotFilters?: Record<ArtifactSlotKey, SlotFilter[]>
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
  /**
   * After `prepared`, wait for `proceed` before preparing the CPU's work: the GPU may solve
   * the problem alone, and this worker then stays idle (and warm, back in the pool)
   */
  waitForCPU?: boolean
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
/** The CPU is needed after all (see `LeadInit.waitForCPU`): the lead prepares its work */
export interface Proceed {
  command: 'proceed'
  run: number
}

/** The lead's first answer to `init`, before its (possibly long) preprocessing: it has loaded */
export interface Started {
  resultType: 'started'
  run: number
}
/**
 * The lead's preprocessed problem, before it enumerates the work: the GPU can start on the
 * whole search space meanwhile (see `GOSolver`)
 */
export interface Prepared {
  resultType: 'prepared'
  run: number
  setup: Setup
  plot: PlotConfig | undefined
  /** Builds in the whole search space, set rules not applied */
  fullTotal: number
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
    /** Builds dropped while preparing `items` (they cannot meet the constraints) */
    skipped?: number
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
