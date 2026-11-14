import { yieldTask } from '../GOSolver/yieldTask.js'
import type {
  KqmMains,
  KqmMainValues,
  KqmProblem,
  KqmProblemSpec,
  KqmSetSearch,
  KqmSets,
} from './search.js'
import { MAINS_SEARCHED, searchSet } from './search.js'

/*
 * The KQM searches' workers: a set's main stat and roll search (`searchSet`) runs in a pool of
 * workers, so a member's sets and weapons are searched in parallel and the page stays smooth.
 * Without workers (tests, or a worker that fails to load) the same searches run here, in turns.
 */

export type KqmWorkerCommand =
  | { type: 'init'; mainValues: KqmMainValues }
  | {
      type: 'set'
      id: number
      /** Its source only the first time the worker gets it */
      problem: Partial<KqmProblemSpec> & { id: string }
      sets: KqmSets
      mains: KqmMains[]
      mainsSearched: number
    }
export type KqmWorkerReply =
  | { type: 'done'; id: number; result?: KqmSetSearch }
  | { type: 'missing'; id: number }
  | { type: 'error'; id: number; message: string }

export interface KqmSetTask {
  problem: KqmProblemSpec
  /** The same problem, compiled here (for running without workers) */
  local: KqmProblem
  sets: KqmSets
  mains: KqmMains[]
  mainsSearched?: number
}

/** A run's searches were cancelled */
export class KqmSearchCancelled extends Error {}

interface Job {
  id: number
  task: KqmSetTask
  mainValues: KqmMainValues
  isCancelled: () => boolean
  resolve: (r: KqmSetSearch | undefined) => void
  reject: (e: unknown) => void
}
interface Slot {
  worker: Worker
  /** The problems the worker has, oldest first (as the worker keeps them) */
  problems: Set<string>
  job?: Job
}

/** Problems a worker keeps compiled (as in `worker.ts`) */
const PROBLEMS_KEPT = 8
/** Unused workers are dropped after this long */
const POOL_IDLE_MS = 60_000
/** Without workers: a turn's length before the page gets a frame */
const INLINE_SLICE_MS = 24

let slots: Slot[] = []
let sentValues: KqmMainValues | undefined
let workersFailed = false
const queue: Job[] = []
let nextId = 1
let idleTimer: ReturnType<typeof setTimeout> | undefined
let inlineRunning = false

// Dev only: workers run the code they were started with, so drop them on hot replacement
;(import.meta as { hot?: { dispose: (cb: () => void) => void } }).hot?.dispose(
  () => dropWorkers()
)

/** How many searches run at once */
export function kqmParallelism() {
  return workersUsable() ? poolSize() : 1
}
function poolSize() {
  const cores = globalThis.navigator?.hardwareConcurrency || 4
  // (the page's own thread builds the problems meanwhile, and is what a run waits on: more
  // workers add little speed, but each is a whole JavaScript engine, ~150–250 MB at a run's peak)
  return Math.max(1, Math.min(cores - 1, 3))
}
function workersUsable() {
  return !workersFailed && typeof Worker !== 'undefined'
}

function dropWorkers() {
  for (const slot of slots) slot.worker.terminate()
  slots = []
  sentValues = undefined
}

/**
 * Ends the workers once a run is over (what they compiled is large, and in the page's process):
 * the next run starts new ones. Searches still queued are left to finish first.
 */
export function releaseKqmWorkers() {
  clearTimeout(idleTimer)
  if (!queue.length && slots.every((s) => !s.job)) dropWorkers()
  else idleTimer = setTimeout(releaseKqmWorkers, 1000)
}

function startWorkers(mainValues: KqmMainValues) {
  if (slots.length && sentValues === mainValues) return
  if (!slots.length)
    for (let i = 0; i < poolSize(); i++) {
      const slot: Slot = {
        worker: new Worker(new URL('./worker.ts', import.meta.url), {
          type: 'module',
        }),
        problems: new Set(),
      }
      slot.worker.onmessage = ({ data }: MessageEvent<KqmWorkerReply>) =>
        onReply(slot, data)
      slot.worker.onerror = (e) => {
        e.preventDefault?.()
        workersBroke()
      }
      slots.push(slot)
    }
  for (const slot of slots)
    slot.worker.postMessage({
      type: 'init',
      mainValues,
    } satisfies KqmWorkerCommand)
  sentValues = mainValues
}

/** A worker failed (did not load): the searches go on here */
function workersBroke() {
  if (workersFailed) return
  workersFailed = true
  const running = slots.flatMap((s) => (s.job ? [s.job] : []))
  dropWorkers()
  queue.unshift(...running)
  runInline()
}

/**
 * Searches each set's best main stats and rolls (`searchSet`), in parallel where workers are
 * available: one promise per task, in the tasks' order
 */
export function queueKqmSetTasks(
  tasks: KqmSetTask[],
  mainValues: KqmMainValues,
  isCancelled: () => boolean
): Promise<KqmSetSearch | undefined>[] {
  clearTimeout(idleTimer)
  const promises = tasks.map(
    (task) =>
      new Promise<KqmSetSearch | undefined>((resolve, reject) =>
        queue.push({
          id: nextId++,
          task,
          mainValues,
          isCancelled,
          resolve,
          reject,
        })
      )
  )
  if (workersUsable()) {
    try {
      startWorkers(mainValues)
    } catch {
      workersFailed = true
    }
  }
  if (workersUsable()) dispatch()
  else runInline()
  return promises
}

/** Takes the next job for a worker: one whose problem it already has, else the first */
function nextJob(slot: Slot): Job | undefined {
  while (queue.length) {
    const scan = Math.min(queue.length, 32)
    let index = 0
    for (let i = 0; i < scan; i++)
      if (slot.problems.has(queue[i].task.problem.id)) {
        index = i
        break
      }
    const [job] = queue.splice(index, 1)
    if (!job.isCancelled()) return job
    job.reject(new KqmSearchCancelled())
  }
  return undefined
}

function dispatch() {
  for (const slot of slots) {
    if (slot.job) continue
    const job = nextJob(slot)
    if (!job) break
    slot.job = job
    const { problem } = job.task
    const has = slot.problems.has(problem.id)
    if (!has) {
      slot.problems.add(problem.id)
      if (slot.problems.size > PROBLEMS_KEPT)
        slot.problems.delete(slot.problems.values().next().value!)
    }
    slot.worker.postMessage({
      type: 'set',
      id: job.id,
      problem: has ? { id: problem.id } : problem,
      sets: job.task.sets,
      mains: job.task.mains,
      mainsSearched: job.task.mainsSearched ?? MAINS_SEARCHED,
    } satisfies KqmWorkerCommand)
  }
  if (!queue.length && slots.every((s) => !s.job)) {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(dropWorkers, POOL_IDLE_MS)
  }
}

function onReply(slot: Slot, reply: KqmWorkerReply) {
  const job = slot.job
  slot.job = undefined
  if (!job || job.id !== reply.id) {
    dispatch()
    return
  }
  switch (reply.type) {
    case 'done':
      job.resolve(reply.result)
      break
    case 'missing':
      // (it dropped the problem: send it again, with its source)
      slot.problems.delete(job.task.problem.id)
      queue.unshift(job)
      break
    case 'error':
      job.reject(new Error(reply.message))
      break
  }
  dispatch()
}

/** Without workers: the searches one after another, with a frame for the page now and then */
function runInline() {
  if (inlineRunning) return
  inlineRunning = true
  const step = () => {
    const start = performance.now()
    while (queue.length && performance.now() - start < INLINE_SLICE_MS) {
      const job = queue.shift()!
      if (job.isCancelled()) {
        job.reject(new KqmSearchCancelled())
        continue
      }
      try {
        const { local, sets, mains, mainsSearched } = job.task
        job.resolve(
          searchSet(
            local,
            sets,
            mains,
            job.mainValues,
            mainsSearched ?? MAINS_SEARCHED
          )
        )
      } catch (e) {
        job.reject(e)
      }
    }
    if (queue.length) void yieldTask().then(step)
    else inlineRunning = false
  }
  void yieldTask().then(step)
}
