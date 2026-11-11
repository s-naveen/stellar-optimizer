import {
  zodBoolean,
  zodClampedNumber,
  zodEnumWithDefault,
  zodFilteredArray,
} from '@genshin-optimizer/common/database'
import type {
  AdditiveReactionKey,
  AmpReactionKey,
  CharacterKey,
  InfusionAuraElementKey,
  MultiOptHitModeKey,
} from '@genshin-optimizer/gi/consts'
import {
  allAdditiveReactions,
  allAmpReactionKeys,
  allCharacterKeys,
  allInfusionAuraElementKeys,
  allMultiOptHitModeKeys,
  defaultOptArtifactLevel,
} from '@genshin-optimizer/gi/consts'
import type { InputPremodKey } from '@genshin-optimizer/gi/wr-types'
import { allInputPremodKeys } from '@genshin-optimizer/gi/wr-types'
import { z } from 'zod'

/** Attacks per member, at most */
export const TEAM_OPT_MAX_ATTACKS = 40

/**
 * Whose conditional a buff is: a member's (its talents, weapon and artifact sets, stored on its
 * loadout) or the team's (resonance and reactions, stored on the team).
 */
export type TeamOptBuffOwner = CharacterKey | 'team'

/** A buff (a conditional that is on) that covers only the first `hits` hits of an attack */
export interface TeamOptBuffLimit {
  owner: TeamOptBuffOwner
  /** The conditional's path, e.g. `['Shenhe', 'quill']` */
  path: string[]
  /** 0: the buff is off for the whole attack */
  hits: number
}

/** A buff (a conditional that is on) in another of its states for an attack */
export interface TeamOptBuffState {
  owner: TeamOptBuffOwner
  /** The conditional's path, e.g. `['Anastasya', 'accolades']` */
  path: string[]
  /** Its state during the attack, e.g. `'on'` instead of the rotation's `'loveSeal'` */
  value: string
}

/** One line of a member's rotation: an attack and how often it hits per rotation */
export interface TeamOptAttack {
  /** The attack's path in its character's display, e.g. `['burst', 'dmg']` */
  path: string[]
  /** Hits per rotation (may be fractional: an average) */
  hits: number
  hitMode: MultiOptHitModeKey
  reaction?: AmpReactionKey | AdditiveReactionKey
  infusionAura?: InfusionAuraElementKey
  bonusStats?: Partial<Record<InputPremodKey, number>>
  /** Buffs that are off for this attack, or cover only its first hits (e.g. Shenhe's quills) */
  limits?: TeamOptBuffLimit[]
  /** Buffs in another state during this attack (e.g. Accolades not Sealed) */
  states?: TeamOptBuffState[]
  /**
   * Who is on the field while it hits (buffs for the active character go to them); absent: the
   * rotation's default (`TeamOpt.onField`)
   */
  onField?: CharacterKey
  description?: string
}

/** Team Optimize settings of a team. Absent until the user sets something. */
export interface TeamOpt {
  /** Each member's attacks in one rotation */
  attacks: Partial<Record<CharacterKey, TeamOptAttack[]>>
  /** Members whose current build is kept as it is */
  keep: CharacterKey[]
  /** Also take artifacts equipped on characters outside the team */
  useOtherChars: boolean
  /** Also take artifacts excluded in the members' own optimizer (Optimize tab) */
  useExcludedArts: boolean
  /** Artifacts this team's optimization never uses (ids) */
  excludedArts: string[]
  levelLow: number
  levelHigh: number
  /** Count every main stat at +20 */
  assumeMaxMain: boolean
  /** Also choose each member's weapon, among the inventory's (of its type) */
  optimizeWeapons: boolean
  /** Weapons left out of that choice */
  excludedWeapons: string[]
  /**
   * Energy weapons (a Favonius weapon...): per weapon (id) and per member, how much lower the
   * member's Energy Recharge requirement may be (percent points) while someone in the team wields
   * the weapon. Its particles or energy reach the whole team, each member differently, and no
   * stat counts them: the user sets them (e.g. from an Energy Recharge calculator).
   */
  weaponEnergy: Record<string, Partial<Record<CharacterKey, number>>>
  /**
   * Who is on the field during the rotation's hits, unless an attack says otherwise; absent: the
   * team's first member (the active character everywhere else in the app)
   */
  onField?: CharacterKey
  /**
   * Buffs the game data does not have (food, an Abyss blessing, a custom bonus), as bonus stats
   * (percent points for `_` stats): for the whole team (`team`) or one member. They count in
   * the members' stats like their own bonus stats do.
   */
  bonusStats?: Partial<
    Record<CharacterKey | 'team', Partial<Record<InputPremodKey, number>>>
  >
  /** How long one rotation takes (seconds): damage is then shown per second (DPS) */
  rotationTime?: number
  /** How many team builds to find, best first (2 to 5); absent: 1 */
  topN?: number
}

const reactionKeys = [...allAmpReactionKeys, ...allAdditiveReactions] as const
const ownerKeys = [...allCharacterKeys, 'team'] as const

const buffLimitSchema = z.object({
  owner: z.enum(ownerKeys as unknown as [string, ...string[]]),
  path: z.array(z.string()).min(1).max(6),
  hits: z.number().finite().min(0),
})

/** Bonus stats with valid keys and finite values; undefined when none */
function cleanBonusStats(
  val: unknown
): Partial<Record<InputPremodKey, number>> | undefined {
  if (typeof val !== 'object' || val === null) return undefined
  const result: Partial<Record<InputPremodKey, number>> = {}
  for (const [key, value] of Object.entries(val))
    if (
      allInputPremodKeys.includes(key as InputPremodKey) &&
      typeof value === 'number' &&
      Number.isFinite(value)
    )
      result[key as InputPremodKey] = value
  return Object.keys(result).length ? result : undefined
}

const bonusStatsSchema = z.preprocess(
  cleanBonusStats,
  z.record(z.string(), z.number()).optional()
) as z.ZodType<Partial<Record<InputPremodKey, number>> | undefined>

const buffStateSchema = z.object({
  owner: z.enum(ownerKeys as unknown as [string, ...string[]]),
  path: z.array(z.string()).min(1).max(6),
  value: z.string().min(1).max(60),
})

const attackSchema = z.object({
  path: z.array(z.string()).min(1).max(6),
  hits: z.number().finite().min(0).catch(1),
  hitMode: zodEnumWithDefault(allMultiOptHitModeKeys, 'avgHit'),
  reaction: z.enum(reactionKeys).optional().catch(undefined),
  infusionAura: z.enum(allInfusionAuraElementKeys).optional().catch(undefined),
  bonusStats: bonusStatsSchema.catch(undefined),
  limits: z
    .array(z.unknown())
    .optional()
    .catch(undefined)
    .transform((limits) => {
      const valid = (limits ?? []).flatMap((limit) => {
        const parsed = buffLimitSchema.safeParse(limit)
        return parsed.success ? [parsed.data as TeamOptBuffLimit] : []
      })
      return valid.length ? valid : undefined
    }),
  states: z
    .array(z.unknown())
    .optional()
    .catch(undefined)
    .transform((states) => {
      const valid = (states ?? []).flatMap((state) => {
        const parsed = buffStateSchema.safeParse(state)
        return parsed.success ? [parsed.data as TeamOptBuffState] : []
      })
      return valid.length ? valid : undefined
    }),
  onField: z.enum(allCharacterKeys).optional().catch(undefined),
  description: z.string().max(500).optional().catch(undefined),
})

const teamOptSchema = z.object({
  attacks: z
    .record(z.string(), z.unknown())
    .catch({})
    .transform((record) => {
      const result: Partial<Record<CharacterKey, TeamOptAttack[]>> = {}
      for (const [key, attacks] of Object.entries(record)) {
        if (!allCharacterKeys.includes(key as CharacterKey)) continue
        if (!Array.isArray(attacks)) continue
        result[key as CharacterKey] = attacks
          .flatMap((attack) => {
            const parsed = attackSchema.safeParse(attack)
            return parsed.success ? [stripUndefined(parsed.data)] : []
          })
          .slice(0, TEAM_OPT_MAX_ATTACKS)
      }
      return result
    }),
  keep: zodFilteredArray(allCharacterKeys, []),
  useOtherChars: zodBoolean(false),
  useExcludedArts: zodBoolean(false),
  excludedArts: z
    .array(z.unknown())
    .catch([])
    .transform((ids) => [
      ...new Set(ids.filter((id): id is string => typeof id === 'string')),
    ]),
  levelLow: zodClampedNumber(0, 20, defaultOptArtifactLevel),
  levelHigh: zodClampedNumber(0, 20, defaultOptArtifactLevel),
  assumeMaxMain: zodBoolean(false),
  optimizeWeapons: zodBoolean(false),
  weaponEnergy: z
    .record(z.string(), z.unknown())
    .catch({})
    .transform((record) => {
      const result: Record<string, Partial<Record<CharacterKey, number>>> = {}
      for (const [id, perMember] of Object.entries(record)) {
        if (typeof perMember !== 'object' || perMember === null) continue
        const values: Partial<Record<CharacterKey, number>> = {}
        for (const [key, value] of Object.entries(perMember))
          if (
            allCharacterKeys.includes(key as CharacterKey) &&
            typeof value === 'number' &&
            Number.isFinite(value) &&
            value > 0
          )
            values[key as CharacterKey] = Math.min(value, 500)
        if (Object.keys(values).length) result[id] = values
      }
      return result
    }),
  excludedWeapons: z
    .array(z.unknown())
    .catch([])
    .transform((ids) => [
      ...new Set(ids.filter((id): id is string => typeof id === 'string')),
    ]),
  onField: z.enum(allCharacterKeys).optional().catch(undefined),
  rotationTime: z
    .number()
    .finite()
    .positive()
    .max(600)
    .optional()
    .catch(undefined),
  topN: z.number().int().min(2).max(5).optional().catch(undefined),
  bonusStats: z
    .unknown()
    .optional()
    .transform((record) => {
      if (typeof record !== 'object' || record === null) return undefined
      const result: NonNullable<TeamOpt['bonusStats']> = {}
      for (const [key, stats] of Object.entries(record)) {
        if (key !== 'team' && !allCharacterKeys.includes(key as CharacterKey))
          continue
        const cleaned = cleanBonusStats(stats)
        if (cleaned) result[key as CharacterKey | 'team'] = cleaned
      }
      return Object.keys(result).length ? result : undefined
    }),
})

/** Optional fields are left out rather than stored as `undefined` */
function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined)
  ) as T
}

export function initTeamOpt(): TeamOpt {
  return {
    attacks: {},
    keep: [],
    useOtherChars: false,
    useExcludedArts: false,
    excludedArts: [],
    levelLow: defaultOptArtifactLevel,
    levelHigh: defaultOptArtifactLevel,
    assumeMaxMain: false,
    optimizeWeapons: false,
    excludedWeapons: [],
    weaponEnergy: {},
  }
}

/** A team's `teamOpt`, cleaned up; `undefined` when it is not an object at all */
export function validateTeamOpt(teamOpt: unknown): TeamOpt | undefined {
  if (typeof teamOpt !== 'object' || teamOpt === null) return undefined
  const result = teamOptSchema.safeParse(teamOpt)
  if (!result.success) return undefined
  const { levelLow, levelHigh, ...rest } = result.data
  return stripUndefined({
    ...rest,
    levelLow: Math.min(levelLow, levelHigh),
    levelHigh: Math.max(levelLow, levelHigh),
  }) as TeamOpt
}

export function initTeamOptAttack(path: string[], hits = 1): TeamOptAttack {
  return { path, hits, hitMode: 'avgHit' }
}
