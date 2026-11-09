import { assertUnreachable } from '@genshin-optimizer/common/util'
import { countBuilds } from '../common.js'
import type { WorkerCommand, WorkerResult } from '../type.js'
import { solveLocal } from './local.js'
import { preprocess } from './preprocess.js'
import { SolverWorker } from './SolverWorker.js'
import { initialItems, plotConfigFor } from './schedule.js'

declare function postMessage(result: WorkerResult): void

/**
 * Pooled solver worker. Workers are reused across runs (see `GOSolver`), so compiled kernels
 * and the JIT stay warm; each `init` replaces the previous run's state.
 */
let worker: SolverWorker | undefined
let run = -1
/** The lead's CPU work, prepared once the CPU is needed (see `LeadInit.waitForCPU`) */
let prepareCPU: (() => void) | undefined

function handle(data: WorkerCommand) {
  const { command } = data
  switch (command) {
    case 'init': {
      run = data.run
      worker = undefined
      prepareCPU = undefined
      // loaded and working: splitting a large problem can take a while
      if (data.lead) postMessage({ resultType: 'started', run })
      if (!data.lead) {
        worker = new SolverWorker(data.setup, data.setup.plot)
        postMessage({ resultType: 'ready', run })
        break
      }
      const setup = preprocess(data.problem)
      const plot = plotConfigFor(setup)
      setup.plot = plot
      postMessage({
        resultType: 'prepared',
        run,
        setup,
        plot,
        fullTotal: countBuilds(setup.arts),
      })
      const { items, total } = initialItems(setup.arts, data.problem.exclusion)
      if (total <= data.localMax) {
        const local = solveLocal(setup, data.problem.exclusion)
        postMessage({
          resultType: 'ready',
          run,
          lead: { items: [], total, plot, local },
        })
        break
      }
      const thisRun = run
      prepareCPU = () => {
        prepareCPU = undefined
        worker = new SolverWorker(setup, plot)
        // a few bounded, best-first packs instead of (possibly) millions of tiny items
        const packed = worker.packItems(items)
        setup.slotFilters = packed.slotFilters
        postMessage({
          resultType: 'ready',
          run: thisRun,
          lead: {
            items: packed.items,
            total,
            plot,
            setup,
            skipped: packed.skipped,
          },
        })
      }
      if (!data.waitForCPU) prepareCPU()
      break
    }
    case 'proceed':
      if (data.run === run) prepareCPU?.()
      break
    case 'threshold':
      if (data.run === run) worker?.setThreshold(data.threshold)
      break
    case 'work':
      if (data.run !== run || !worker) break
      postMessage({
        resultType: 'work',
        run,
        ...worker.work(data.items, data.chunkSize),
      })
      break
    case 'finalize':
      if (data.run !== run || !worker) break
      postMessage({ resultType: 'finalized', run, ...worker.finalize() })
      worker = undefined // free memory while pooled
      break
    default:
      assertUnreachable(command)
  }
}

onmessage = (e: MessageEvent<WorkerCommand>) => {
  try {
    handle(e.data)
  } catch (err) {
    postMessage({ resultType: 'err', run, message: (err as Error).message })
  }
}
