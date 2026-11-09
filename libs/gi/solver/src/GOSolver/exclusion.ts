import type { ArtifactSetKey } from '@genshin-optimizer/gi/consts'
import type { ArtSetExclusion } from '@genshin-optimizer/gi/db'
import { exclusionToAllowed } from '../common.js'

/**
 * The artifact-set rules of an `ArtSetExclusion` as bit masks, for checking one build at a time
 * (e.g. on the GPU, which sweeps the whole search space instead of enumerating the allowed set
 * combinations like `artSetPerm`). Bit `n` of a mask is set when `n` pieces are allowed:
 * - `sets[set]`: pieces of that set (only for sets with a rule),
 * - `rainbow`: "rainbow" pieces, i.e. pieces whose set no other piece has.
 * Empty slots (partial builds) count as pieces of one more set (`undefined`), as in `artSetPerm`
 * (`initialItems` passes it the sets of all artifacts, `undefined` included).
 */
export type ExclusionMasks = {
  sets: Partial<Record<ArtifactSetKey, number>>
  rainbow: number
}

const toMask = (allowed: Set<number>) =>
  [...allowed].reduce((mask, n) => mask | (1 << n), 0)

export function exclusionMasks(exclusion: ArtSetExclusion): ExclusionMasks {
  const sets: ExclusionMasks['sets'] = {}
  for (const [key, rule] of Object.entries(exclusion)) {
    if (key === 'rainbow' || !rule?.length) continue
    sets[key as ArtifactSetKey] = toMask(exclusionToAllowed(rule))
  }
  return { sets, rainbow: toMask(exclusionToAllowed(exclusion.rainbow)) }
}

/** Whether a build whose pieces have these sets (`undefined`: empty slot) is allowed */
export function buildAllowed(
  sets: readonly (ArtifactSetKey | undefined)[],
  masks: ExclusionMasks
): boolean {
  let rainbow = 0
  for (let i = 0; i < sets.length; i++) {
    const set = sets[i]
    let count = 0
    for (const other of sets) if (other === set) count++
    if (count === 1) rainbow++
    if (set === undefined) continue
    const mask = masks.sets[set]
    if (mask !== undefined && !((mask >> count) & 1)) return false
  }
  return !!((masks.rainbow >> rainbow) & 1)
}
