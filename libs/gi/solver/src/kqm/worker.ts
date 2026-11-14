import type { KqmWorkerCommand, KqmWorkerReply } from './pool.js'
import type {
  KqmMainValues,
  KqmProblem,
  KqmProblemSpec,
  KqmSetSearch,
} from './search.js'
import { kqmProblem, searchSet } from './search.js'

declare function postMessage(reply: KqmWorkerReply): void

/**
 * A KQM search worker (see `pool.ts`): searches one member's main stats and rolls for a set, with
 * the problems it was sent compiled once and kept (the most recent `PROBLEMS_KEPT`).
 */
// (a team's problem is large compiled code; workers share the page's process memory)
const PROBLEMS_KEPT = 8
const problems = new Map<string, KqmProblem>()
let mainValues: KqmMainValues = {}

function problemFor(spec: Partial<KqmProblemSpec> & { id: string }) {
  let problem = problems.get(spec.id)
  if (!problem && spec.source !== undefined) {
    problem = kqmProblem(spec as KqmProblemSpec)
    problems.set(spec.id, problem)
    if (problems.size > PROBLEMS_KEPT)
      problems.delete(problems.keys().next().value!)
  }
  return problem
}

onmessage = ({ data }: MessageEvent<KqmWorkerCommand>) => {
  switch (data.type) {
    case 'init':
      mainValues = data.mainValues
      return
    case 'set': {
      const problem = problemFor(data.problem)
      if (!problem) {
        postMessage({ type: 'missing', id: data.id })
        return
      }
      let result: KqmSetSearch | undefined
      try {
        result = searchSet(
          problem,
          data.sets,
          data.mains,
          mainValues,
          data.mainsSearched
        )
      } catch (e) {
        postMessage({ type: 'error', id: data.id, message: String(e) })
        return
      }
      postMessage({ type: 'done', id: data.id, result })
    }
  }
}
