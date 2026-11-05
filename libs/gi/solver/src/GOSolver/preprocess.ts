import { optimize } from '@genshin-optimizer/gi/wr'
import { pruneAll, pruneExclusion } from '../common.js'
import type { OptProblemInput, Setup } from '../type.js'

/**
 * Simplify the problem before solving: fold exclusion-dependent set effects, re-parametrize
 * stats (reaffine), and drop artifacts that cannot satisfy the constraints or that are
 * dominated by at least `topN` others.
 *
 * Dominance pruning is skipped when plotting: an artifact dominated by `topN` others can
 * still be part of the best build at some plot value.
 */
export function preprocess({
  plotBase,
  optimizationTarget,
  arts,
  topN,
  exclusion,
  constraints,
}: OptProblemInput): Setup {
  constraints = constraints.filter((x) => x.min > Number.NEGATIVE_INFINITY)

  let nodes = [...constraints.map((x) => x.value), optimizationTarget]
  const minimums = [...constraints.map((x) => x.min), Number.NEGATIVE_INFINITY]
  if (plotBase) {
    nodes.push(plotBase)
    minimums.push(Number.NEGATIVE_INFINITY)
  }

  nodes = pruneExclusion(nodes, exclusion)
  nodes = optimize(nodes, {}, (_) => false)
  ;({ nodes, arts } = pruneAll(
    nodes,
    minimums,
    arts,
    plotBase ? Number.POSITIVE_INFINITY : topN,
    exclusion,
    {
      reaffine: true,
      pruneArtRange: true,
      pruneNodeRange: true,
      pruneOrder: true,
    }
  ))
  nodes = optimize(nodes, {}, (_) => false)

  if (plotBase) plotBase = nodes.pop()
  const optTarget = nodes.pop()!

  return {
    command: 'setup',
    arts,
    optTarget,
    plotBase,
    topN,
    constraints: nodes.map((value, i) => ({ value, min: minimums[i] })),
  }
}
