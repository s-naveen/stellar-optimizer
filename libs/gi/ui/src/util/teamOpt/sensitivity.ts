import { notEmpty } from '@genshin-optimizer/common/util'
import type {
  ArtifactRarity,
  CharacterKey,
  GenderKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  ICachedArtifact,
  ICachedWeapon,
  TeamOpt,
} from '@genshin-optimizer/gi/db'
import { getSubstatValue } from '@genshin-optimizer/gi/util'
import { constant, optimize, precompute, sum } from '@genshin-optimizer/gi/wr'
import type { RollSize } from '../substatValue'
import type { CharacterOverride, TeamOptMember } from './data'
import { addBonusStats, teamOptBonusStats, teamOptMembers } from './data'
import { teamRotationNodes } from './objective'
import type { TeamOptResult } from './solve'
import { evaluateTeamRotation, teamOptArtValues } from './solve'
import { rotationAttacks } from './timeline'

/** The substats whose extra roll is valued */
export const sensitivitySubstats: readonly SubstatKey[] = [
  'hp',
  'hp_',
  'atk',
  'atk_',
  'def',
  'def_',
  'eleMas',
  'critRate_',
  'critDMG_',
  'enerRech_',
]
export const sensitivityTalents = ['auto', 'skill', 'burst'] as const
export type SensitivityTalent = (typeof sensitivityTalents)[number]
export const sensitivityLevels = [80, 95, 100] as const
export type SensitivityLevel = (typeof sensitivityLevels)[number]
/** The highest talent level without constellations */
export const MAX_TALENT_LEVEL = 10

/**
 * What a change to one member is worth to the team, against a Team Optimize result: the
 * rotation's damage with the change, everything else as in the result (builds, weapons, buffs,
 * on-field members, extra buffs). The changes: one more substat roll on the member's artifacts
 * (of the Improve tab's size: a 5★ average roll by default), one more talent level (with its
 * constellation boosts), another level (the same ascension).
 *
 * Substat rolls are cheap: the member's problem is compiled once (the team's damage as a function
 * of its artifacts, the buffs it gives the others included, as the optimizer sees it), then
 * evaluated with each roll added. Talents and levels need the team computed again, one change at
 * a time (\`character\`), so a page can spread them out.
 */
export function teamSensitivity(
  database: ArtCharDatabase,
  teamId: string,
  gender: GenderKey,
  teamOpt: TeamOpt,
  result: Pick<TeamOptResult, 'builds' | 'weapons'>,
  {
    rarity = 5,
    rollSize = 'mid',
  }: { rarity?: ArtifactRarity; rollSize?: RollSize } = {}
) {
  const members = teamOptMembers(database, teamId)
  const memberKeys = members.map((m) => m.characterKey)
  const mainStatAssumptionLevel = teamOpt.assumeMaxMain ? 20 : 0
  const arts = Object.fromEntries(
    members
      .filter((m) => !m.isTc)
      .map((m) => [
        m.characterKey,
        Object.values(result.builds[m.characterKey] ?? {})
          .map((id) => (id ? database.arts.get(id) : undefined))
          .filter(notEmpty),
      ])
  ) as Partial<Record<CharacterKey, ICachedArtifact[]>>
  const weapons = Object.fromEntries(
    members
      .filter((m) => !m.isTc)
      .flatMap((m) => {
        const weapon = database.weapons.get(
          result.weapons?.[m.characterKey] ?? m.weaponId
        )
        return weapon ? [[m.characterKey, weapon]] : []
      })
  ) as Partial<Record<CharacterKey, ICachedWeapon>>
  const bonusStats = teamOptBonusStats(teamOpt, memberKeys)
  const common = {
    attacks: rotationAttacks(teamOpt),
    mainStatAssumptionLevel,
    weapons,
    onField: teamOpt.onField,
    bonusStats,
  }
  const evaluate = (
    changes: {
      characters?: Partial<Record<CharacterKey, CharacterOverride>>
      bonusStats?: typeof bonusStats
    } = {}
  ) =>
    evaluateTeamRotation(database, teamId, gender, {
      ...common,
      ...changes,
      arts,
    })?.total
  const base = evaluate()
  /** One roll of each substat, as the formulas store it (0.0331 for 3.31% Crit Rate) */
  const rolls = Object.fromEntries(
    sensitivitySubstats.map((key) => [
      key,
      getSubstatValue(key, rarity, rollSize, false),
    ])
  ) as Record<SubstatKey, number>

  return {
    /** The rotation's damage as in the result */
    base,
    members,
    rolls,
    /** The rotation's damage with one more roll of each substat on `member`'s artifacts */
    substats(member: TeamOptMember): Partial<Record<SubstatKey, number>> {
      const { characterKey } = member
      if (member.isTc) {
        // a TC build has no artifacts of its own to add to: as a bonus stat
        return Object.fromEntries(
          sensitivitySubstats.map((key) => [
            key,
            evaluate({
              bonusStats: {
                ...bonusStats,
                [characterKey]: addBonusStats(bonusStats[characterKey], {
                  [key]: key.endsWith('_') ? rolls[key] * 100 : rolls[key],
                }),
              },
            }),
          ])
        )
      }
      const nodes = teamRotationNodes(database, teamId, gender, {
        ...common,
        dyn: characterKey,
        arts,
      })
      if (!nodes) return {}
      const [objective] = optimize(
        [
          nodes.terms.length
            ? sum(...nodes.terms.map((t) => t.node))
            : constant(0),
        ],
        {},
        ({ path: [p] }) => p !== 'dyn'
      )
      // its five pieces, and a sixth holding the extra roll
      const compute = precompute([objective], {}, (r) => r.path[1], 6)
      const own = (arts[characterKey] ?? []).map((art) => ({
        values: teamOptArtValues(art, mainStatAssumptionLevel),
      }))
      while (own.length < 5) own.push({ values: {} })
      const at = (extra: Record<string, number>) =>
        compute([...own, { values: extra }] as never)[0]
      return Object.fromEntries(
        sensitivitySubstats.map((key) => [key, at({ [key]: rolls[key] })])
      )
    },
    /**
     * The rotation's damage with `member` changed: one more level of a talent (undefined at its
     * highest), or another level
     */
    character(
      member: TeamOptMember,
      change: { talent: SensitivityTalent } | { level: SensitivityLevel }
    ): number | undefined {
      const character = member.isTc
        ? database.buildTcs.get(member.loadoutDatum.buildTcId)?.character
        : database.chars.get(member.characterKey)
      if (!character) return undefined
      if ('talent' in change) {
        const now = character.talent[change.talent]
        if (now >= MAX_TALENT_LEVEL) return undefined
        return evaluate({
          characters: {
            [member.characterKey]: {
              talent: { ...character.talent, [change.talent]: now + 1 },
            },
          },
        })
      }
      return evaluate({
        characters: { [member.characterKey]: { level: change.level } },
      })
    },
  }
}
