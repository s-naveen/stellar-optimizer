import type { SolverBuild } from '../common.js'
import { filterArts, mergeBuilds, mergePlot } from '../common.js'
import type {
  FinalizeResult,
  OptProblemInput,
  PlotConfig,
  Setup,
  WorkerCommand,
  WorkerResult,
  WorkItem,
} from '../type.js'
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
/** WebGPU is only used for problems with at least this many builds... */
const GPU_MIN_TOTAL = 64_000_000
/** ...and then for every item with at least this many builds (smaller ones stay on the CPU) */
const GPU_MIN_ITEM = 1_000_000
/** If the GPU has not started within this long, the CPU takes over its work */
const GPU_START_TIMEOUT_MS = 2_000
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
  private readonly run = nextRun++
  private workers: Worker[] = []
  /** Workers with an outstanding command (may still be computing for this run) */
  private readonly busy = new Set<Worker>()
  private gpu: GPUSolver | undefined
  private finished = false
  private rejectSolve: ((e: unknown) => void) | undefined
  private stopTracking: (() => void) | undefined

  constructor(problem: OptProblemInput, status: Status, numWorker: number) {
    this.problem = problem
    this.status = status
    this.numWorkers = Math.max(1, Math.floor(numWorker) || 1)
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

    /** Preprocessed setup, when the GPU is used */
    let gpuSetup: Setup | undefined
    let leadReady = false
    let plot: PlotConfig | undefined
    let chunkSize = Number.POSITIVE_INFINITY
    const cpuHeap = new WorkHeap(),
      gpuHeap = new WorkHeap()
    /** The GPU is used for this run (it may still be starting) */
    let gpuInUse = false
    let gpuActive = false,
      gpuBusy = false
    const gpuTop: SolverBuild[] = []
    let gpuPlot: PlotStore | undefined
    const eligible = (item: WorkItem) => !item.cpu && item.count >= GPU_MIN_ITEM
    // While the GPU is in use, its items wait for it (even while it starts): it finishes one in
    // milliseconds, while a CPU worker that took one would hold up the end of the run
    const route = (item: WorkItem) =>
      (gpuInUse && eligible(item) ? gpuHeap : cpuHeap).push(item)
    /** The GPU could not start, or stopped working: the CPU takes over its items */
    const dropGPU = () => {
      gpuInUse = false
      gpuActive = false
      for (let next = gpuHeap.pop(); next; next = gpuHeap.pop())
        cpuHeap.push(next)
    }

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
      while (idle.length) {
        const batch = takeBatch(cpuHeap, threshold, plotMode, skip)
        if (!batch.length) break
        post(idle.pop()!, { command: 'work', run, items: batch, chunkSize })
      }
      void runGPU()
      if (
        this.busy.size === starting.size &&
        !gpuBusy &&
        !cpuHeap.size &&
        !gpuHeap.size
      ) {
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

    const runGPU = async () => {
      const gpu = this.gpu
      const setup = gpuSetup
      if (!gpu || !gpuActive || gpuBusy || this.finished || !setup) return
      const [item] = takeBatch(gpuHeap, threshold, plotMode, skip)
      if (!item) return
      gpuBusy = true
      try {
        const arts = filterArts(setup.arts, item.filter)
        const res = await gpu.run(
          arts,
          plotMode ? Number.NEGATIVE_INFINITY : threshold
        )
        if (this.finished) return
        if (!res.ok) cpuHeap.push({ ...item, cpu: true })
        else {
          status.tested += res.tested
          status.failed += res.failed
          let changed = false
          for (const { arts: picked, values } of res.candidates) {
            if (!mins.every((m, i) => m <= values[1 + i])) continue
            const artifactIds = picked.map((a) => a.id).filter((id) => id)
            gpuPlot?.add(values[1 + nCons], values[0], () => artifactIds)
            if (insertTop(gpuTop, { value: values[0], artifactIds }, topN))
              changed = true
          }
          if (changed)
            report(
              'gpu',
              gpuTop.map((b) => b.value)
            )
        }
      } catch (e) {
        // GPU failed (device lost, ...): continue on the CPU
        console.warn('WebGPU solver disabled:', e)
        this.gpu?.destroy()
        this.gpu = undefined
        cpuHeap.push({ ...item, cpu: true })
        dropGPU()
      } finally {
        gpuBusy = false
      }
      pump()
    }

    const startGPU = (s: Setup) => {
      gpuInUse = true
      // A GPU that never starts must not hold its items forever
      const timeout = setTimeout(() => {
        if (this.finished || gpuActive || !gpuInUse) return
        console.warn('WebGPU did not start in time, continuing on the CPU')
        dropGPU()
        pump()
      }, GPU_START_TIMEOUT_MS)
      return GPUSolver.create(s, plot).then(
        (gpu) => {
          clearTimeout(timeout)
          if (this.finished) return gpu?.destroy()
          if (!gpu) {
            dropGPU()
            return pump()
          }
          this.gpu = gpu
          gpuInUse = true
          gpuActive = true
          // Hand it the waiting items (all of them, if it started after the timeout)
          const pending: WorkItem[] = []
          for (let next = cpuHeap.pop(); next; next = cpuHeap.pop())
            pending.push(next)
          pending.forEach(route)
          pump()
        },
        (e) => {
          clearTimeout(timeout)
          console.warn('WebGPU unavailable:', e)
          if (this.finished) return
          dropGPU()
          pump()
        }
      )
    }

    const onMessage = (w: Worker, r: WorkerResult) => {
      if (this.finished) return
      if (r.resultType === 'err' && r.run !== run)
        return fail(new Error(`Worker Error: ${r.message}`))
      if (r.run !== run) return
      leadAnswered = true
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
          if (plot) gpuPlot = new PlotStore(plot)
          chunkSize = chunkSizeFor(total, this.numWorkers)
          // Before routing: the GPU's items wait for it while it starts
          if (total >= GPU_MIN_TOTAL && gpuAllowed()) {
            gpuSetup = setup
            void startGPU(setup)
          }
          items.forEach(route)
          // Helpers join for large problems, starting from the lead's preprocessed setup
          const helpers =
            Math.min(
              this.numWorkers,
              Math.max(items.length, Math.ceil(total / chunkSize))
            ) - 1
          for (let i = 0; i < helpers; i++) {
            const h = acquireWorker()
            attach(h)
            starting.add(h)
            post(h, { command: 'init', run, lead: false, setup })
          }
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
              mergeBuilds([...finals.map((f) => f.builds), gpuTop], topN),
              plot
                ? mergePlot(
                    [
                      ...finals.map((f) => f.plotData ?? {}),
                      gpuPlot?.data() ?? {},
                    ],
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
      attach(lead)
      post(lead, {
        command: 'init',
        run,
        lead: true,
        problem,
        localMax: LOCAL_MAX,
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
