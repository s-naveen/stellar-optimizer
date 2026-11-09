import {
  deepClone,
  deletePropPath,
  layeredAssignment,
  notEmpty,
  objKeyMap,
} from '@genshin-optimizer/common/util'
import type {
  ArtifactSlotKey,
  CharacterKey,
  LocationCharacterKey,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSlotKeys,
  charKeyToLocCharKey,
} from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  ICachedArtifact,
  ICachedWeapon,
  LoadoutDatum,
  TeamCharacter,
  TeamOpt,
  TeamOptBuffOwner,
} from '@genshin-optimizer/gi/db'
import type { ICharacter } from '@genshin-optimizer/gi/good'
import type { IConditionalValues } from '@genshin-optimizer/gi/sheets'
import type { Data } from '@genshin-optimizer/gi/wr'
import type { InputPremodKey } from '@genshin-optimizer/gi/wr-types'

/** Bonus stats (percent points for `_` stats), as a character's own */
export type BonusStats = Partial<Record<InputPremodKey, number>>

/** `a` and `b` added up */
export function addBonusStats(
  a: BonusStats | undefined,
  b: BonusStats | undefined
): BonusStats {
  const result: BonusStats = { ...a }
  for (const [key, value] of Object.entries(b ?? {}) as [
    InputPremodKey,
    number,
  ][])
    result[key] = (result[key] ?? 0) + value
  return result
}

/** Each member's extra buffs (`TeamOpt.bonusStats`): the whole team's and its own */
export function teamOptBonusStats(
  teamOpt: Pick<TeamOpt, 'bonusStats'>,
  characterKeys: readonly CharacterKey[]
): Partial<Record<CharacterKey, BonusStats>> {
  const { bonusStats } = teamOpt
  if (!bonusStats) return {}
  return Object.fromEntries(
    characterKeys.map((characterKey) => [
      characterKey,
      addBonusStats(bonusStats.team, bonusStats[characterKey]),
    ])
  )
}

import { getCharDataBundle } from '../../hooks/useTeamData'
import { getBuildTcArtifactData } from '../getBuildTcData'

/** A conditional of the team, by whose it is and its path */
export interface BuffRef {
  owner: TeamOptBuffOwner
  path: readonly string[]
}
export const buffRefKey = ({ owner, path }: BuffRef) =>
  `${owner}|${path.join('|')}`
export const sameBuff = (a: BuffRef, b: BuffRef) =>
  buffRefKey(a) === buffRefKey(b)

/** A team member, as Team Optimize sees it */
export interface TeamOptMember {
  characterKey: CharacterKey
  teamCharId: string
  teamChar: TeamCharacter
  loadoutDatum: LoadoutDatum
  /** Where the member's equipped artifacts are, in the database */
  location: LocationCharacterKey
  /** The artifacts of the member's build, per slot (none for a TC build) */
  artifactIds: Record<ArtifactSlotKey, string | undefined>
  /** The weapon of the member's build ('invalid' for a TC build) */
  weaponId: string
  /** The member uses a TC build: no real artifacts, kept as it is */
  isTc: boolean
}

/** The team's members, in team order (the first one is the active character, by default) */
export function teamOptMembers(
  database: ArtCharDatabase,
  teamId: string
): TeamOptMember[] {
  const team = database.teams.get(teamId)
  if (!team) return []
  return team.loadoutData.filter(notEmpty).flatMap((loadoutDatum) => {
    const teamChar = database.teamChars.get(loadoutDatum.teamCharId)
    if (!teamChar) return []
    const isTc = loadoutDatum.buildType === 'tc' && !!loadoutDatum.buildTcId
    return [
      {
        characterKey: teamChar.key,
        teamCharId: loadoutDatum.teamCharId,
        teamChar,
        loadoutDatum,
        location: charKeyToLocCharKey(teamChar.key),
        artifactIds: isTc
          ? objKeyMap(allArtifactSlotKeys, () => undefined)
          : { ...database.teams.getLoadoutArtifactIds(loadoutDatum) },
        weaponId: database.teams.getLoadoutWeapon(loadoutDatum).id,
        isTc,
      },
    ]
  })
}

/** Every conditional that is set in the team: the members' and the team's own */
export function teamConditionals(
  database: ArtCharDatabase,
  teamId: string
): { ref: BuffRef; value: string }[] {
  const team = database.teams.get(teamId)
  if (!team) return []
  const result: { ref: BuffRef; value: string }[] = []
  const crawl = (owner: TeamOptBuffOwner, obj: unknown, path: string[]) => {
    if (typeof obj === 'string') {
      if (obj) result.push({ ref: { owner, path }, value: obj })
      return
    }
    if (typeof obj !== 'object' || obj === null) return
    for (const [key, value] of Object.entries(obj))
      crawl(owner, value, [...path, key])
  }
  for (const member of teamOptMembers(database, teamId))
    crawl(member.characterKey, member.teamChar.conditional, [])
  crawl('team', team.conditional, [])
  return result
}

/** `base` with `own` on top, per sheet */
export function mergeConditionals(
  base: IConditionalValues | undefined,
  own: IConditionalValues
): IConditionalValues {
  if (!base) return own
  const result: Record<string, Record<string, string>> = {}
  for (const [sheet, values] of Object.entries(base))
    result[sheet] = { ...values }
  for (const [sheet, values] of Object.entries(own))
    result[sheet] = { ...(result[sheet] ?? {}), ...values }
  return result as IConditionalValues
}

/** `conditional` with the conditionals at `values`' paths in those states */
function withValues<T extends object>(
  conditional: T,
  values: readonly { path: readonly string[]; value: string }[]
): T {
  if (!values.length) return conditional
  const result = deepClone(conditional) as unknown as Record<string, unknown>
  for (const { path, value } of values)
    layeredAssignment(result, path as string[], value)
  return result as unknown as T
}

function withoutPaths<T extends object>(
  conditional: T,
  paths: readonly (readonly string[])[]
): T {
  if (!paths.length) return conditional
  const result = deepClone(conditional)
  for (const path of paths)
    deletePropPath(result as unknown as Record<string, unknown>, path)
  return result
}

export interface TeamDataOverrides {
  /** Artifacts per member: real ones or data; members without an entry use their loadout's */
  arts?: Partial<Record<CharacterKey, ICachedArtifact[] | Data>>
  /** Conditionals that are off */
  excluded?: readonly BuffRef[]
  /** Conditionals in another state (before `excluded`) */
  states?: readonly (BuffRef & { value: string })[]
  /** Main stats are counted at this level (at least) for every member's artifacts */
  mainStatAssumptionLevel?: number
  /** Weapons per member; members without an entry use their loadout's */
  weapons?: Partial<Record<CharacterKey, ICachedWeapon>>
  /** Conditionals per member, under its own (which win): e.g. a new weapon's passive */
  extraConditionals?: Partial<Record<CharacterKey, IConditionalValues>>
  /** Bonus stats per member, on top of its own (extra buffs: food, an Abyss blessing...) */
  bonusStats?: Partial<Record<CharacterKey, BonusStats>>
  /** A member's level, ascension or talents other than its own (e.g. one talent level more) */
  characters?: Partial<Record<CharacterKey, CharacterOverride>>
}

/** What may differ from a member's character: its level, ascension and talent levels */
export type CharacterOverride = Partial<
  Pick<ICharacter, 'level' | 'ascension' | 'talent'>
>

/**
 * The team's calculation data, as `getTeamData` builds it, with overrides for any member: its
 * artifacts, and conditionals turned off.
 */
export function getTeamDataWith(
  database: ArtCharDatabase,
  teamId: string,
  {
    arts = {},
    excluded = [],
    states = [],
    mainStatAssumptionLevel = 0,
    weapons = {},
    extraConditionals = {},
    bonusStats: extraBonusStats = {},
    characters = {},
  }: TeamDataOverrides
): Partial<Record<CharacterKey, Data[]>> | undefined {
  const team = database.teams.get(teamId)
  if (!team) return undefined
  const { enemyOverride } = team
  const teamConditional = withoutPaths(
    withValues(
      team.conditional,
      states.filter((s) => s.owner === 'team')
    ),
    excluded.filter((e) => e.owner === 'team').map((e) => e.path)
  )
  const teamData: Partial<Record<CharacterKey, Data[]>> = {}
  for (const member of teamOptMembers(database, teamId)) {
    const { characterKey, teamChar, loadoutDatum, isTc } = member
    const {
      infusionAura,
      customMultiTargets,
      conditional,
      bonusStats,
      hitMode,
      reaction,
    } = teamChar
    const dbChar = database.chars.get(characterKey)
    if (!dbChar) continue
    const buildTc = isTc
      ? database.buildTcs.get(loadoutDatum.buildTcId)
      : undefined
    const char: Omit<ICharacter, 'key'> = {
      ...(buildTc?.character ?? dbChar),
      ...characters[characterKey],
    }
    const { level, constellation, ascension, talent } = char

    const memberArts =
      arts[characterKey] ??
      (buildTc
        ? getBuildTcArtifactData(buildTc)
        : (Object.values(
            database.teams.getLoadoutArtifacts(loadoutDatum)
          ).filter(notEmpty) as ICachedArtifact[]))
    const ownConditional = withoutPaths(
      withValues(
        mergeConditionals(extraConditionals[characterKey], conditional),
        states.filter((s) => s.owner === characterKey)
      ),
      excluded.filter((e) => e.owner === characterKey).map((e) => e.path)
    )
    const bundle = getCharDataBundle(
      database,
      false,
      mainStatAssumptionLevel,
      {
        key: characterKey,
        level,
        constellation,
        ascension,
        talent,
        infusionAura,
        customMultiTargets,
        conditional: { ...ownConditional, ...teamConditional },
        bonusStats: extraBonusStats[characterKey]
          ? addBonusStats(bonusStats, extraBonusStats[characterKey])
          : bonusStats,
        enemyOverride,
        hitMode,
        reaction,
      },
      weapons[characterKey] ?? database.teams.getLoadoutWeapon(loadoutDatum),
      memberArts
    )
    if (bundle) teamData[characterKey] = bundle.data
  }
  return teamData
}
