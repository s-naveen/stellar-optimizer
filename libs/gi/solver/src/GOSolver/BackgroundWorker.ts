import { assertUnreachable } from '@genshin-optimizer/common/util'
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

function handle(data: WorkerCommand) {
  const { command } = data
  switch (command) {
    case 'init': {
      run = data.run
      worker = undefined
      if (!data.lead) {
        worker = new SolverWorker(data.setup, data.setup.plot)
        postMessage({ resultType: 'ready', run })
        break
      }
      const setup = preprocess(data.problem)
      const plot = plotConfigFor(setup)
      setup.plot = plot
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
      worker = new SolverWorker(setup, plot)
      postMessage({
        resultType: 'ready',
        run,
        lead: { items, total, plot, setup },
      })
      break
    }
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
