import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOpt, TeamOptAttack } from './TeamOpt'
import { initTeamOpt, validateTeamOpt } from './TeamOpt'

/** What a team rotation export says it is: other JSON pasted by mistake is refused */
export const TEAM_ROTATION_TYPE = 'StellarOptimizer.TeamRotation'

/**
 * A team's rotation in Team Optimize, to copy to another team or share as one JSON: every
 * member's attacks (with their buff settings), how long a rotation takes and who is on the field.
 * Members are by character, so it fits any team with the same characters.
 */
export interface TeamRotation {
  type: typeof TEAM_ROTATION_TYPE
  version: 1
  attacks: Partial<Record<CharacterKey, TeamOptAttack[]>>
  rotationTime?: number
  onField?: CharacterKey
}

/** `teamOpt`'s rotation, for the team's current `members` (in their order) */
export function teamRotationExport(
  teamOpt: TeamOpt,
  members: readonly CharacterKey[]
): TeamRotation {
  const attacks: TeamRotation['attacks'] = {}
  for (const key of members) {
    const list = teamOpt.attacks[key]
    if (list?.length) attacks[key] = list
  }
  return {
    type: TEAM_ROTATION_TYPE,
    version: 1,
    attacks,
    ...(teamOpt.rotationTime ? { rotationTime: teamOpt.rotationTime } : {}),
    ...(teamOpt.onField && members.includes(teamOpt.onField)
      ? { onField: teamOpt.onField }
      : {}),
  }
}

/**
 * A pasted rotation (JSON text or an object), cleaned up like a saved one (unknown characters,
 * invalid attacks and fields dropped); `undefined` when it is not a team rotation export
 */
export function parseTeamRotation(data: unknown): TeamRotation | undefined {
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return undefined
    }
  }
  if (typeof data !== 'object' || data === null) return undefined
  const { type, attacks, rotationTime, onField } = data as Record<
    string,
    unknown
  >
  if (type !== TEAM_ROTATION_TYPE) return undefined
  const valid = validateTeamOpt({
    ...initTeamOpt(),
    attacks,
    rotationTime,
    onField,
  })
  if (!valid) return undefined
  const result: TeamRotation = {
    type: TEAM_ROTATION_TYPE,
    version: 1,
    attacks: {},
  }
  for (const [key, list] of Object.entries(valid.attacks))
    if (list?.length) result.attacks[key as CharacterKey] = list
  if (valid.rotationTime) result.rotationTime = valid.rotationTime
  if (valid.onField) result.onField = valid.onField
  return result
}

/**
 * Put `rotation` in `teamOpt` for the team's `members`: the members it has get its attacks
 * (the others keep theirs), and its rotation time and on-field member are taken when it has them
 * (the on-field one only if in the team). Returns the members that got attacks.
 */
export function applyTeamRotation(
  teamOpt: TeamOpt,
  rotation: TeamRotation,
  members: readonly CharacterKey[]
): CharacterKey[] {
  const applied: CharacterKey[] = []
  for (const key of members) {
    const list = rotation.attacks[key]
    if (!list) continue
    teamOpt.attacks[key] = structuredClone(list)
    applied.push(key)
  }
  if (rotation.rotationTime) teamOpt.rotationTime = rotation.rotationTime
  if (rotation.onField && members.includes(rotation.onField)) {
    if (rotation.onField === members[0]) delete teamOpt.onField
    else teamOpt.onField = rotation.onField
  }
  return applied
}
