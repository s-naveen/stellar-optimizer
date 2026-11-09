import { allArtifactSlotKeys } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import type { TeamOptResult } from '@genshin-optimizer/gi/ui'
import { teamOptMembers } from '@genshin-optimizer/gi/ui'

/** The optimized members whose build differs from what they have now */
export function changedMembers(
  database: ArtCharDatabase,
  teamId: string,
  result: TeamOptResult
) {
  return teamOptMembers(database, teamId).filter(
    ({ characterKey, artifactIds, weaponId }) => {
      const build = result.builds[characterKey]
      const weapon = result.weapons?.[characterKey]
      return (
        result.optimized.includes(characterKey) &&
        ((!!build &&
          allArtifactSlotKeys.some((s) => build[s] !== artifactIds[s])) ||
          (!!weapon && weapon !== weaponId))
      )
    }
  )
}

/**
 * Puts the result on the team: a member on its equipped build gets the artifacts equipped (they
 * move from whoever has them, as when equipping from the optimizer); a member on a saved build
 * gets that build updated.
 */
export function equipTeamResult(
  database: ArtCharDatabase,
  teamId: string,
  result: TeamOptResult
) {
  for (const member of changedMembers(database, teamId, result)) {
    const build = result.builds[member.characterKey]!
    const { loadoutDatum, characterKey, location } = member
    const weaponId = result.weapons?.[characterKey]
    if (loadoutDatum.buildType === 'real' && loadoutDatum.buildId) {
      database.builds.set(loadoutDatum.buildId, {
        artifactIds: build,
        ...(weaponId ? { weaponId } : {}),
      })
      continue
    }
    // (equipping moves the weapon from whoever wields it, like the artifacts below)
    if (weaponId && weaponId !== member.weaponId)
      database.weapons.set(weaponId, { location })
    const char = database.chars.get(characterKey)
    for (const slotKey of allArtifactSlotKeys) {
      const id = build[slotKey]
      if (id) database.arts.set(id, { location })
      else {
        const old = char?.equippedArtifacts[slotKey]
        if (old && database.arts.get(old))
          database.arts.set(old, { location: '' })
      }
    }
  }
}

/**
 * Saves the result as a new build per member and switches the team to them: nothing is moved
 * between characters (the builds can be equipped later, from each member's build list).
 */
export function saveTeamResult(
  database: ArtCharDatabase,
  teamId: string,
  result: TeamOptResult,
  name: string
) {
  for (const member of changedMembers(database, teamId, result)) {
    const { characterKey, teamCharId, loadoutDatum } = member
    const weaponId =
      result.weapons?.[characterKey] ??
      database.teams.getLoadoutWeaponId(loadoutDatum)
    const buildId = database.builds.new({
      characterKey,
      name,
      artifactIds: result.builds[characterKey]!,
      weaponId,
      srcTeamCharId: teamCharId,
    })
    database.teams.setLoadoutDatum(teamId, teamCharId, {
      buildType: 'real',
      buildId,
    })
  }
}
