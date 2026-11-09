import type { SolverBuild } from '../common.js'
import { mergeBuilds, mergePlot } from '../common.js'
import type {
  FinalizeResult,
  OptProblemInput,
  PlotConfig,
  Setup,
  WorkerCommand,
  WorkerResult,
  WorkItem,
} from '../type.js'
import { exclusionMasks } from './exclusion.js'
import { GPUSolver } from './gpu.js'
import { PlotStore } from './SolverWorker.js'
import {
  chunkSizeFor,
  insertTop,
  ThresholdTracker,
  takeBatch,
  WorkHeap,
} from './schedule.js'

/** Problems up to this many builds are solved by the lead worker alone, right away */
const LOCAL_MAX = 1_000_000
/**
 * WebGPU is used (racing the CPU workers, see `start`) for problems with at least this many
 * builds in their whole search space
 */
const GPU_MIN_TOTAL = 64_000_000
/**
 * The CPU workers wait while the GPU sweeps (running both made the tab stutter, for no gain with
 * a working GPU), unless the GPU looks this slow (ms, projected from its progress): then they race
 */
const GPU_HEDGE_MS = 60_000
/** Idle pooled workers are terminated after this long */
const POOL_IDLE_MS = 120_000
/** If the lead worker does not answer within this long, it is replaced (once) by a fresh worker */
const LEAD_TIMEOUT_MS = 20_000

type Status = Record<
  | 'tested'
  | 'failed'
  | 'skipped'
  | 'total'
  | 'testedPerSecond'
  | 'skippedPerSecond',
  number
>

// Workers are pooled across runs: no startup cost on re-runs, and their compiled kernels and
// JIT state stay warm (re-running the same character/settings skips the kernel warm-up).
const pool: Worker[] = []
let poolTimer: ReturnType<typeof setTimeout> | undefined
let nextRun = 0
// Dev only: pooled workers run the code they were started with, so drop them when this
// module is hot-replaced instead of mixing versions
;(import.meta as { hot?: { dispose: (cb: () => void) => void } }).hot?.dispose(
  () => pool.splice(0).forEach((w) => w.terminate())
)
function newWorker(): Worker {
  return new Worker(new URL('./BackgroundWorker.ts', import.meta.url), {
    type: 'module',
  })
}
function acquireWorker(): Worker {
  clearTimeout(poolTimer)
  return pool.pop() ?? newWorker()
}
function releaseWorkers(workers: Worker[]) {
  const max = globalThis.navigator?.hardwareConcurrency || 8
  for (const w of workers) {
    w.onmessage = null
    w.onerror = null
    if (pool.length < max) pool.push(w)
    else w.terminate()
  }
  clearTimeout(poolTimer)
  poolTimer = setTimeout(
    () => pool.splice(0).forEach((w) => w.terminate()),
    POOL_IDLE_MS
  )
}

/**
 * Start loading a solver worker ahead of the first run (e.g. when the optimizer UI opens),
 * so that the run does not wait for the worker to load. It is dropped after `POOL_IDLE_MS`
 * if no run uses it.
 */
export function prewarmSolver() {
  if (!pool.length && typeof Worker !== 'undefined')
    releaseWorkers([newWorker()])
}

/**
 * Artifact optimizer: finds the `topN` builds maximizing the optimization target subject to
 * the constraints (and, when plotting, the best build per plot value).
 *
 * Nothing heavy runs on the calling (UI) thread: a lead worker preprocesses the problem and
 * either solves it right away (small problems) or enumerates the initial work. More workers
 * then join and pull from a best-first queue of sub-spaces; the global top-N threshold is
 * merged from every worker's best builds and broadcast so that all of them prune with it.
 * Large problems can also be brute-forced on the GPU (WebGPU), every GPU candidate being
 * re-evaluated exactly.
 */
export class GOSolver {
  private readonly problem: OptProblemInput
  private readonly status: Status
  private readonly numWorkers: number
  /** May the GPU take part (also needs WebGPU, and a problem big enough) */
  private readonly allowGPU: boolean
  private readonly run = nextRun++
  private workers: Worker[] = []
  /** Workers with an outstanding command (may still be computing for this run) */
  private readonly busy = new Set<Worker>()
  private gpu: GPUSolver | undefined
  private finished = false
  private rejectSolve: ((e: unknown) => void) | undefined
  private stopTracking: (() => void) | undefined

  /** `options.gpu`: `false` keeps the GPU out of this solve (the CPU workers only) */
  constructor(
    problem: OptProblemInput,
    status: Status,
    numWorker: number,
    options: { gpu?: boolean } = {}
  ) {
    this.problem = problem
    this.status = status
    this.allowGPU = options.gpu ?? true
    // one core is left for the browser (drawing the page, the GPU process): with every core busy
    // computing, the whole tab stutters while the optimizer runs
    const cores = globalThis.navigator?.hardwareConcurrency || 8
    this.numWorkers = Math.max(
      1,
      Math.min(Math.floor(numWorker) || 1, cores - 1)
    )
    status.total = Number.NaN
    status.testedPerSecond = 0
    status.skippedPerSecond = 0
  }

  /** Stop solving (rejecting `solve` with `e` if still running) and release the workers */
  cancel(e?: unknown) {
    if (!this.finished) {
      this.finished = true
      this.rejectSolve?.(e ?? new Error('Solver cancelled'))
    }
    this.stopTracking?.()
    // Busy workers are still computing for this run: stop them. Idle ones go back to the pool.
    this.workers.filter((w) => this.busy.has(w)).forEach((w) => w.terminate())
    releaseWorkers(this.workers.filter((w) => !this.busy.has(w)))
    this.workers = []
    this.busy.clear()
    this.gpu?.destroy()
    this.gpu = undefined
  }

  async solve(): Promise<FinalizeResult[]> {
    this.stopTracking = this.trackBuildsPerSecond()
    try {
      return await new Promise<FinalizeResult[]>((resolve, reject) => {
        this.rejectSolve = reject
        this.start(resolve)
      })
    } finally {
      this.stopTracking()
    }
  }

  private start(resolve: (r: FinalizeResult[]) => void) {
    const { status, run, problem } = this
    const plotMode = !!problem.plotBase
    const mins = problem.constraints
      .filter((c) => c.min > Number.NEGATIVE_INFINITY)
      .map((c) => c.min)
    const nCons = mins.length
    const topN = problem.topN
    // "Beat this value", a constraint on the target itself (each step of Team Optimize asks its
    // member to beat its current build): few builds meet the constraints, and the GPU collects
    // them as it sweeps instead of sweeping twice
    const floored = problem.constraints.some(
      (c) =>
        c.value === problem.optimizationTarget &&
        c.min > Number.NEGATIVE_INFINITY
    )

    let leadReady = false
    /** The GPU is sweeping: the CPU workers wait (see `GPU_HEDGE_MS`) */
    let gpuRacing = false,
      cpuHedge = false
    /** Starts the helper workers (deferred while the GPU sweeps) */
    let spawnHelpers: (() => void) | undefined
    // The GPU may solve the problem alone: the lead then prepares the CPU's work only once it
    // is needed (`proceed`), and meanwhile stays idle, so it is not stopped when the GPU wins
    // (and goes back to the pool, warm, for the next run)
    const waitForCPU = this.allowGPU && gpuAllowed()
    let leadWorker: Worker | undefined
    /** The lead waits for `proceed` */
    let leadWaiting = false
    const proceed = () => {
      if (!leadWaiting || !leadWorker) return
      leadWaiting = false
      post(leadWorker, { command: 'proceed', run })
    }
    /** Builds the lead dropped while preparing, counted once the CPU does the work */
    let leadSkipped = 0
    let plot: PlotConfig | undefined
    let chunkSize = Number.POSITIVE_INFINITY
    const cpuHeap = new WorkHeap()
    const route = (item: WorkItem) => cpuHeap.push(item)

    const tracker = new ThresholdTracker(topN)
    let threshold = Number.NEGATIVE_INFINITY
    const post = (w: Worker, msg: WorkerCommand, expectReply = true) => {
      if (expectReply) this.busy.add(w)
      w.postMessage(msg)
    }
    const report = (source: unknown, values: number[]) => {
      const t = tracker.report(source, values)
      if (t > threshold) {
        threshold = t
        for (const w of ready)
          post(w, { command: 'threshold', run, threshold: t }, false)
      }
    }
    const skip = (count: number) => (status.skipped += count)

    const ready: Worker[] = [] // initialized for this run
    const idle: Worker[] = []
    /** Helpers asked to join that are still starting (loading, initializing) */
    const starting = new Set<Worker>()
    let finalizing = false
    const finals: {
      builds: SolverBuild[]
      plotData?: FinalizeResult['plotData']
    }[] = []

    const fail = (e: unknown) => {
      if (!this.finished) this.cancel(e)
    }
    const finish = (
      builds: SolverBuild[],
      plotData: FinalizeResult['plotData']
    ) => {
      if (this.finished) return
      this.finished = true
      this.cancel() // releases the (now idle) workers to the pool
      resolve([{ resultType: 'finalize', builds, plotData }])
    }

    const pump = () => {
      if (this.finished || finalizing || !leadReady) return
      if (gpuRacing && !cpuHedge) return
      while (idle.length) {
        const batch = takeBatch(cpuHeap, threshold, plotMode, skip)
        if (!batch.length) break
        post(idle.pop()!, { command: 'work', run, items: batch, chunkSize })
      }
      if (this.busy.size === starting.size && !cpuHeap.size) {
        finalizing = true
        // Helpers that are still starting have nothing to report: do not wait for them
        starting.forEach(retire)
        for (const w of ready) post(w, { command: 'finalize', run })
      }
    }
    /** Lets a helper that was not needed after all finish starting, then pools it */
    const retire = (w: Worker) => {
      starting.delete(w)
      this.busy.delete(w)
      this.workers = this.workers.filter((x) => x !== w)
      w.onmessage = ({ data: r }: MessageEvent<WorkerResult>) => {
        if (r.run !== run) return
        // `finalize` drops the run's state, so that the pooled worker holds no memory
        if (r.resultType === 'ready')
          w.postMessage({ command: 'finalize', run })
        else if (r.resultType === 'finalized') releaseWorkers([w])
        else w.terminate()
      }
      w.onerror = () => w.terminate()
    }

    /**
     * The GPU solves the problem on its own, racing the CPU workers: one dense sweep of the
     * whole search space, with the set rules checked per build (see `gpu.ts`). Whichever
     * finishes first gives the result; both are exact. It starts as soon as the lead has
     * preprocessed the problem, while the lead still enumerates the CPU's work.
     */
    /** Let the CPU workers work: the GPU failed, or looks slow (`hedge`: it carries on, racing) */
    const startCPU = (hedge: boolean) => {
      if (this.finished || !gpuRacing || cpuHedge) return
      if (hedge) cpuHedge = true
      else gpuRacing = false
      // the status now shows the CPU's progress
      status.tested = 0
      status.failed = 0
      status.skipped += leadSkipped
      leadSkipped = 0
      proceed()
      spawnHelpers?.()
      pump()
    }
    /**
     * The GPU solves the problem on its own: one dense sweep of the whole search space, with the
     * set rules checked per build (see `gpu.ts`). The CPU workers wait meanwhile (the lead still
     * prepares their work): if the GPU fails they take over, and if it looks slow they race it
     * (first to finish wins; both are exact). It starts as soon as the lead has preprocessed the
     * problem.
     */
    const raceGPU = async (
      setup: Setup,
      plotCfg: PlotConfig | undefined,
      fullTotal: number
    ) => {
      gpuRacing = true
      // the progress bar follows the GPU (until the lead knows the exact total)
      if (!Number.isFinite(status.total)) status.total = fullTotal
      const started = performance.now()
      try {
        const gpu = await GPUSolver.create(
          setup,
          plotCfg,
          exclusionMasks(problem.exclusion)
        )
        if (!gpu) return startCPU(false)
        if (this.finished) return gpu.destroy()
        this.gpu = gpu
        const res = await gpu.run(
          setup.arts,
          plotMode ? Number.NEGATIVE_INFINITY : threshold,
          (fraction) => {
            if (this.finished || cpuHedge) return
            status.tested = Math.round(Math.min(1, fraction) * status.total)
            const elapsed = performance.now() - started
            if (elapsed > 3000 && elapsed / fraction > GPU_HEDGE_MS)
              startCPU(true)
          },
          floored
        )
        if (this.finished) return
        if (!res.ok) {
          console.warn(
            `WebGPU sweep stopped (${res.reason}), continuing on the CPU`
          )
          return startCPU(false)
        }
        const top: SolverBuild[] = []
        const store = plotCfg ? new PlotStore(plotCfg) : undefined
        for (const { arts: picked, values, bin } of res.candidates) {
          if (!mins.every((m, i) => m <= values[1 + i])) continue
          const artifactIds = picked.map((a) => a.id).filter((id) => id)
          store?.add(values[1 + nCons], values[0], () => artifactIds, bin)
          insertTop(top, { value: values[0], artifactIds }, topN)
        }
        // the builds the set rules allow, all evaluated
        status.total = res.tested
        status.tested = res.tested
        status.failed = res.failed
        status.skipped = 0
        finish(
          top,
          plotCfg && store
            ? mergePlot([store.data()], plotCfg.scale)
            : undefined
        )
      } catch (e) {
        // (device lost, ...): the CPU workers take over
        if (this.finished) return
        console.warn('WebGPU solver stopped:', e)
        startCPU(false)
      }
    }

    const onMessage = (w: Worker, r: WorkerResult) => {
      if (this.finished) return
      if (r.resultType === 'err' && r.run !== run)
        return fail(new Error(`Worker Error: ${r.message}`))
      if (r.run !== run) return
      leadAnswered = true
      // the lead is alive and still preparing the work
      if (r.resultType === 'started') return
      if (r.resultType === 'prepared') {
        if (waitForCPU) {
          leadWaiting = true
          if (r.fullTotal >= GPU_MIN_TOTAL) {
            // (the lead finishes listing the items, then idles until `proceed`)
            this.busy.delete(w)
            void raceGPU(r.setup, r.plot, r.fullTotal)
          } else proceed()
        }
        return
      }
      if (r.resultType !== 'err') this.busy.delete(w)
      switch (r.resultType) {
        case 'ready': {
          starting.delete(w)
          ready.push(w)
          idle.push(w)
          if (!r.lead) break
          const { items, total, local, setup } = r.lead
          plot = r.lead.plot
          status.total = total
          if (gpuRacing && !cpuHedge) leadSkipped += r.lead.skipped ?? 0
          else status.skipped += r.lead.skipped ?? 0
          if (local) {
            status.tested += local.tested
            status.failed += local.failed
            status.skipped += local.skipped
            return finish(
              local.builds,
              plot ? (local.plotData ?? {}) : undefined
            )
          }
          if (!setup) return fail(new Error('Worker Error: missing setup'))
          leadReady = true
          chunkSize = chunkSizeFor(total, this.numWorkers)
          items.forEach(route)
          // Helpers join for large problems, starting from the lead's preprocessed setup
          const helpers =
            Math.min(
              this.numWorkers,
              Math.max(items.length, Math.ceil(total / chunkSize))
            ) - 1
          spawnHelpers = () => {
            spawnHelpers = undefined
            for (let i = 0; i < helpers; i++) {
              const h = acquireWorker()
              attach(h)
              starting.add(h)
              post(h, { command: 'init', run, lead: false, setup })
            }
          }
          // (while the GPU sweeps, they start only if it fails or looks slow)
          if (!gpuRacing || cpuHedge) spawnHelpers()
          break
        }
        case 'work':
          idle.push(w)
          status.tested += r.tested
          status.failed += r.failed
          status.skipped += r.skipped
          r.items.forEach(route)
          if (r.buildValues) report(w, r.buildValues)
          break
        case 'finalized':
          finals.push(r)
          if (finals.length === ready.length)
            finish(
              mergeBuilds(
                finals.map((f) => f.builds),
                topN
              ),
              plot
                ? mergePlot(
                    finals.map((f) => f.plotData ?? {}),
                    plot.scale
                  )
                : undefined
            )
          return
        case 'err':
          return fail(new Error(`Worker Error: ${r.message}`))
      }
      pump()
    }
    const attach = (w: Worker) => {
      w.onmessage = (e: MessageEvent<WorkerResult>) => onMessage(w, e.data)
      w.onerror = (e) => fail(new Error(`Worker Error: ${e.message}`))
      this.workers.push(w)
    }

    let leadAnswered = false
    const startLead = (attempt: number) => {
      const lead = attempt ? newWorker() : acquireWorker()
      leadWorker = lead
      attach(lead)
      post(lead, {
        command: 'init',
        run,
        lead: true,
        problem,
        localMax: LOCAL_MAX,
        waitForCPU,
      })
      // A worker that never answers (failed to load, stale code, ...) must not hang the UI
      setTimeout(() => {
        if (this.finished || leadAnswered) return
        lead.terminate()
        this.busy.delete(lead)
        this.workers = this.workers.filter((w) => w !== lead)
        if (attempt) fail(new Error('The optimizer worker did not start'))
        else startLead(1)
      }, LEAD_TIMEOUT_MS)
    }
    startLead(0)
  }

  /** Tracks number of builds processed per second. Returns a cleanup function. */
  private trackBuildsPerSecond() {
    let lastTime = performance.now(),
      lastTested = this.status.tested,
      lastSkipped = this.status.skipped
    const id = setInterval(() => {
      const now = performance.now()
      const elapsed = (now - lastTime) / 1000
      if (elapsed > 0) {
        this.status.testedPerSecond =
          (this.status.tested - lastTested) / elapsed
        this.status.skippedPerSecond =
          (this.status.skipped - lastSkipped) / elapsed
      }
      lastTime = now
      lastTested = this.status.tested
      lastSkipped = this.status.skipped
    }, 1000)
    return () => clearInterval(id)
  }
}

/** WebGPU can be turned off with `localStorage.go_opt_gpu = 'off'` */
function gpuAllowed(): boolean {
  try {
    if (!globalThis.navigator?.gpu) return false
    return globalThis.localStorage?.getItem('go_opt_gpu') !== 'off'
  } catch {
    return false
  }
}
