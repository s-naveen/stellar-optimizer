import type {
  ArtifactRarity,
  ArtifactSlotKey,
  CharacterKey,
  MainStatKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import { allSubstatKeys, artSlotMainKeys } from '@genshin-optimizer/gi/consts'
import { getMainStatValue, getSubstatValue } from '@genshin-optimizer/gi/util'
import { precompute } from '@genshin-optimizer/gi/wr'
import type { TeamData } from '../type'
import { optimizeNodesForScaling } from './optimizeNodesForScaling'

/** Size of one substat roll: the highest tier, the average of the four tiers, or the lowest. */
export type RollSize = 'max' | 'mid' | 'min'

export interface SubstatGain {
  key: SubstatKey
  /** Extra rolls of this substat */
  rolls: number
  /** Stat the rolls add, as the formulas store it (0.0331 for 3.31% Crit Rate) */
  added: number
  /** Optimization target with the rolls added, minus its current value */
  gain: number
  /** What one more roll adds after those (roll #rolls+1) */
  next: number
  /** The gain of a single roll: the order of the list, which then stays put as rolls change */
  one: number
}

export interface SubstatValueResult {
  /** Current value of the optimization target */
  base: number
  /** The substats the target depends on, the most valuable roll first */
  gains: SubstatGain[]
  /** Substats the target does not depend on at all */
  unused: SubstatKey[]
}

/**
 * The optimization target as a function of extra artifact main/substats, on top of the build
 * `teamData` was computed for (everything else folds into constants). `teamData` is modified,
 * so pass a freshly computed one.
 */
function targetOfExtraStats(
  teamData: TeamData,
  characterKey: CharacterKey,
  optimizationTarget: string[]
) {
  const { nodes } = optimizeNodesForScaling(
    teamData,
    characterKey,
    optimizationTarget,
    {}
  )
  if (!nodes?.length) return undefined
  const read = new Set<string>()
  const compute = precompute(
    [nodes[0]],
    {},
    (r) => {
      read.add(r.path[1])
      return r.path[1]
    },
    1
  )
  const evaluate = (values: Record<string, number>) =>
    compute([{ values }] as const)[0]
  const base = evaluate({})
  if (!Number.isFinite(base)) return undefined
  return { evaluate, base, read }
}

/**
 * How much extra rolls of each substat (`rolls`, or `rollsByKey` per substat) would add to the
 * optimization target, on top of the build `teamData` was computed for, and what one more roll
 * adds after those (exact: the target formula is evaluated with the stats added). `teamData` is
 * modified, so pass a freshly computed one.
 */
export function computeSubstatValue(
  teamData: TeamData,
  characterKey: CharacterKey,
  optimizationTarget: string[],
  rolls: number,
  rarity: ArtifactRarity,
  rollSize: RollSize,
  rollsByKey: Partial<Record<SubstatKey, number>> = {}
): SubstatValueResult | undefined {
  const target = targetOfExtraStats(teamData, characterKey, optimizationTarget)
  if (!target) return undefined
  const { evaluate, base, read } = target
  const gains = allSubstatKeys
    .filter((key) => read.has(key))
    .map((key) => {
      const roll = getSubstatValue(key, rarity, rollSize, false)
      const n = rollsByKey[key] ?? rolls
      const after = evaluate({ [key]: n * roll })
      return {
        key,
        rolls: n,
        added: n * roll,
        gain: after - base,
        next: evaluate({ [key]: (n + 1) * roll }) - after,
        one: n === 1 ? after - base : evaluate({ [key]: roll }) - base,
      }
    })
    .sort((a, b) => b.one - a.one)
  return {
    base,
    gains,
    unused: allSubstatKeys.filter((key) => !read.has(key)),
  }
}

/** What a slot's artifact contributes through its main stat */
export interface MainStatPiece {
  statKey: MainStatKey
  rarity: ArtifactRarity
  level: number
}

export interface MainStatOption {
  key: MainStatKey
  /** The main stat at 5★ +20, as the formulas store it */
  value: number
  /** Optimization target with this main stat on the slot (5★ +20), minus its current value */
  gain: number
  /** The slot's artifact has this main stat now */
  current: boolean
}

export const mainStatSlotKeys = ['sands', 'goblet', 'circlet'] as const
export type MainStatSlotKey = (typeof mainStatSlotKeys)[number]

export interface MainStatValueResult {
  /** Current value of the optimization target */
  base: number
  /** Per slot with a choice of main stat: every option, the most valuable first */
  slots: {
    slotKey: MainStatSlotKey
    current: MainStatPiece | undefined
    options: MainStatOption[]
  }[]
}

/**
 * Which main stat is worth the most on each of sands, goblet and circlet: the exact target with
 * the slot's artifact having each main stat at 5★ +20 instead of its own (same set and
 * substats), against the current value. An empty slot just gains the main stat. `teamData` is
 * modified, so pass a freshly computed one.
 */
export function computeMainStatValue(
  teamData: TeamData,
  characterKey: CharacterKey,
  optimizationTarget: string[],
  pieces: Partial<Record<ArtifactSlotKey, MainStatPiece>>
): MainStatValueResult | undefined {
  const target = targetOfExtraStats(teamData, characterKey, optimizationTarget)
  if (!target) return undefined
  const { evaluate, base } = target
  const slots = mainStatSlotKeys.map((slotKey) => {
    const current = pieces[slotKey]
    const options = artSlotMainKeys[slotKey]
      .map((key) => {
        const value = getMainStatValue(key, 5, 20)
        const values: Record<string, number> = {}
        if (current)
          values[current.statKey] = -getMainStatValue(
            current.statKey,
            current.rarity,
            current.level
          )
        values[key] = (values[key] ?? 0) + value
        return {
          key,
          value,
          gain: evaluate(values) - base,
          current: current?.statKey === key,
        }
      })
      .sort((a, b) => b.gain - a.gain)
    return { slotKey, current, options }
  })
  return { base, slots }
}
