import type { GenderKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import { read } from '@genshin-optimizer/gi/wr'
import { getTeamDataWith, type TeamDataOverrides } from './data'
import { attackDamageOutcomes } from './objective'
import type { RotationCalculation } from './rotation/types'

/** Evaluate a heal or stat in the timeline's buff context, without changing the saved build. */
export function rotationCalculation(
  database: ArtCharDatabase,
  teamId: string,
  gender: GenderKey,
  overrides: TeamDataOverrides = {}
): RotationCalculation {
  const cache = new Map<string, ReturnType<typeof uiDataForTeam> | undefined>()
  const calculate: RotationCalculation = (
    characterKey,
    path,
    states,
    onField
  ) => {
    const key = JSON.stringify([states, onField])
    if (!cache.has(key)) {
      const team = getTeamDataWith(database, teamId, { ...overrides, states })
      cache.set(
        key,
        team?.[onField]
          ? uiDataForTeam(
              { [onField]: team[onField], ...team },
              gender,
              onField
            )
          : undefined
      )
    }
    const value = cache
      .get(key)
      ?.[characterKey]?.target.get({ ...read(), path })?.value
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined
  }
  const damageCache = new Map<string, ReturnType<typeof attackDamageOutcomes>>()
  calculate.damage = (characterKey, attack) => {
    const key = JSON.stringify([characterKey, attack])
    if (!damageCache.has(key))
      damageCache.set(
        key,
        attackDamageOutcomes(
          database,
          teamId,
          gender,
          characterKey,
          attack,
          overrides
        )
      )
    return damageCache.get(key)
  }
  return calculate
}
