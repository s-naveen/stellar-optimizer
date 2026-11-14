import type { GenderKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import type { KqmProblemSpec } from '@genshin-optimizer/gi/solver'
import { mergeIdentical, precomputeSource } from '@genshin-optimizer/gi/wr'
import { teamRotationNodes } from './objective'

/** What a KQM problem is built from: a member's artifacts variable, the rest of the team fixed */
export type KqmBuildSettings = Parameters<typeof teamRotationNodes>[3]

/** A built KQM problem (`KqmProblemSpec` without its id), with its requirements' stat paths */
export interface KqmBuiltProblem extends Omit<KqmProblemSpec, 'id'> {
  paths: string[][]
}

/**
 * The team's rotation damage and the member's requirements as a function of the member's
 * artifact stats, compiled to source (`precomputeSource`) with its identical parts shared
 * (`mergeIdentical`)
 */
export function buildKqmProblem(
  database: ArtCharDatabase,
  teamId: string,
  gender: GenderKey,
  settings: KqmBuildSettings
): KqmBuiltProblem | undefined {
  const nodes = teamRotationNodes(database, teamId, gender, settings)
  if (!nodes) return undefined
  // each buff group is optimized apart: shared parts (the member's stats, the teammates' buffs)
  // would be computed once per group without the merge, which makes the source ~8x larger
  const formulas = mergeIdentical([
    ...nodes.terms.map((t) => t.node),
    ...nodes.constraints.map((c) => c.value),
  ])
  const scales = new Set<string>()
  const source = precomputeSource(
    formulas,
    {},
    (r) => {
      scales.add(r.path[1])
      return r.path[1]
    },
    1
  )
  return {
    source,
    nTerms: nodes.terms.length,
    mins: nodes.constraints.map((c) => c.min),
    scales: [...scales],
    paths: nodes.constraints.map((c) => c.path),
  }
}
