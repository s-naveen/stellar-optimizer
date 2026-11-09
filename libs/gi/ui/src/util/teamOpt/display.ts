import { notEmpty } from '@genshin-optimizer/common/util'
import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  ICachedArtifact,
  ICachedWeapon,
  TeamOpt,
} from '@genshin-optimizer/gi/db'
import { KeyMap } from '@genshin-optimizer/gi/keymap'
import type { CalcResult, UIData } from '@genshin-optimizer/gi/uidata'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import { uiInput } from '@genshin-optimizer/gi/wr'
import { getTeamDataWith, teamOptBonusStats, teamOptMembers } from './data'
import type { TeamOptResult } from './solve'

/**
 * The artifacts and weapons of a Team Optimize result, per member (TC builds are kept as they
 * are: no entry), as `getTeamDataWith` takes them
 */
export function teamOptResultGear(
  database: ArtCharDatabase,
  teamId: string,
  result: Pick<TeamOptResult, 'builds' | 'weapons'>
): {
  arts: Partial<Record<CharacterKey, ICachedArtifact[]>>
  weapons: Partial<Record<CharacterKey, ICachedWeapon>>
} {
  const arts: Partial<Record<CharacterKey, ICachedArtifact[]>> = {}
  const weapons: Partial<Record<CharacterKey, ICachedWeapon>> = {}
  for (const member of teamOptMembers(database, teamId)) {
    if (member.isTc) continue
    const { characterKey } = member
    arts[characterKey] = Object.values(result.builds[characterKey] ?? {})
      .map((id) => (id ? database.arts.get(id) : undefined))
      .filter(notEmpty)
    const weapon = database.weapons.get(
      result.weapons?.[characterKey] ?? member.weaponId
    )
    if (weapon) weapons[characterKey] = weapon
  }
  return { arts, weapons }
}

/**
 * Each member's calculation data with the builds and weapons of a Team Optimize result (without
 * one: what is equipped now), as the rotation counts them: the team's buffs in their usual
 * states, the extra buffs, the member on the field first. What a result's final stats are read
 * from (`UIData.getDisplay()`, as on the character's page).
 */
export function teamOptUIData(
  database: ArtCharDatabase,
  teamId: string,
  gender: GenderKey,
  teamOpt: TeamOpt,
  result?: Pick<TeamOptResult, 'builds' | 'weapons'>
): Partial<Record<CharacterKey, UIData>> | undefined {
  const keys = teamOptMembers(database, teamId).map((m) => m.characterKey)
  const { arts, weapons } = result
    ? teamOptResultGear(database, teamId, result)
    : { arts: {}, weapons: {} }
  const teamData = getTeamDataWith(database, teamId, {
    arts,
    weapons,
    mainStatAssumptionLevel: teamOpt.assumeMaxMain ? 20 : 0,
    bonusStats: teamOptBonusStats(teamOpt, keys),
  })
  if (!teamData) return undefined
  const active =
    teamOpt.onField && teamData[teamOpt.onField]
      ? teamOpt.onField
      : keys.find((key) => teamData[key])
  if (!active) return undefined
  // the member on the field first, as in the app (its data is the team's "active" one)
  const uiData = uiDataForTeam(
    { [active]: teamData[active], ...teamData },
    gender,
    active
  )
  return Object.fromEntries(
    keys.flatMap((key) => {
      const target = uiData[key]?.target
      return target ? [[key, target]] : []
    })
  )
}

/** A stat a buff changes on the attacker: its key, and by how much (a fraction for percentages) */
export interface StatGain {
  key: string
  value: number
}

/** Stats whose final value follows from others' (ATK from ATK% and flat ATK, and so on) */
const derived: Record<string, readonly string[]> = {
  atk: ['atk', 'atk_'],
  hp: ['hp', 'hp_'],
  def: ['def', 'def_'],
}

/**
 * What a buff gives a member, exactly: its stats with the buff up (`on`) against without it
 * (`off`). The stats before conversions (as the buffs add them: ATK%, CRIT DMG, an enemy's RES);
 * then the final ones a buff adds to directly (e.g. ATK from a teammate's HP), when nothing it
 * follows from changed.
 */
export function statGains(on: UIData, off: UIData): StatGain[] {
  const changed = (a: number, b: number) =>
    Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
  const numberAt = (data: UIData, node: unknown) => {
    const value = data.get(node as never).value
    return typeof value === 'number' ? value : 0
  }
  const gains: StatGain[] = []
  const premod = uiInput.premod as Record<string, unknown>
  for (const key of Object.keys(premod)) {
    const a = numberAt(on, premod[key])
    const b = numberAt(off, premod[key])
    if (changed(a, b)) gains.push({ key, value: a - b })
  }
  const total = uiInput.total as Record<string, unknown>
  for (const key of Object.keys(total)) {
    const from = derived[key] ?? [key]
    if (gains.some((g) => from.includes(g.key))) continue
    const a = numberAt(on, total[key])
    const b = numberAt(off, total[key])
    if (changed(a, b)) gains.push({ key, value: a - b })
  }
  // Flat ATK (HP, DEF) that only follows from the ATK% (HP%, DEF%) it gives (its share of the
  // base), and what has no name of its own (internal values): not listed
  const base = uiInput.base as Record<string, unknown>
  return gains.filter(({ key, value }) => {
    if (!KeyMap.getStr(key)) return false
    const percent = derived[key] && gains.find((g) => g.key === `${key}_`)
    if (!percent) return true
    return changed(value, numberAt(on, base[key]) * percent.value)
  })
}

/**
 * The parts of a hit's formula, as its tooltip shows them: the named values it is computed from
 * (Total ATK, DMG Bonus, CRIT Rate, the enemy's RES and DEF…), each once; and the numbers it is
 * multiplied by that have no name (the talent's multiplier: "190.9%")
 */
export function hitFormulaParts(hit: CalcResult): {
  parts: CalcResult[]
  multipliers: number[]
} {
  const hasNamedPart = (node: CalcResult): boolean =>
    node.meta.ops.some((op) => !!op.info?.path || hasNamedPart(op))
  const parts: CalcResult[] = []
  const multipliers: number[] = []
  const seen = new Set<string>()
  const walk = (node: CalcResult, root: boolean) => {
    // (a name comes from a path, as in the formula's display.) A named value is one part when
    // the formula shows it as one (a pivot, a constant), or when nothing in it has a name;
    // otherwise its parts are.
    const named = !!node.info?.path
    if (
      !root &&
      named &&
      (node.info.pivot || node.meta.op === 'const' || !hasNamedPart(node))
    ) {
      const key = `${node.info.path}|${node.value}`
      if (!seen.has(key)) {
        seen.add(key)
        parts.push(node)
      }
      return
    }
    if (node.meta.op === 'mul')
      for (const op of node.meta.ops)
        if (
          op.meta.op === 'const' &&
          !op.info?.path &&
          typeof op.value === 'number' &&
          op.value !== 1
        )
          multipliers.push(op.value)
    for (const op of node.meta.ops) walk(op, false)
  }
  walk(hit, true)
  return { parts, multipliers }
}

/**
 * What a part of a hit adds up, when it is a sum: its terms down to the named ones (not 0), each
 * with where it comes from. CRIT Rate 88.4% is Default 5% + Art. 63.4% + Mitya's 10% + Electro
 * CRIT Rate (Valeriy) 10%; an enemy's RES is its base 10% + each reduction. Found through what
 * keeps the value around the sum (a cap, a single term), never through a calculation (a
 * transformative multiplier is computed from EM: EM's parts are not its parts). None: it is one
 * value, or its sum has a term with no name (then its named terms one level down, if they add up
 * to it).
 */
/**
 * The value a part of a hit has before its cap, when it is capped (CRIT Rate: its terms add up to
 * 135.2%, the hit uses 100%); `undefined` when it is not capped or holds no capped sum.
 */
export function partUncapped(part: CalcResult): number | undefined {
  let node = part
  let capped = false
  for (let depth = 0; depth < 8; depth++) {
    if (node.meta.op === 'add') break
    if (!['min', 'max'].includes(node.meta.op)) return undefined
    const inner = node.meta.ops.filter((op) => op.meta.op !== 'const')
    if (inner.length !== 1) return undefined
    capped = true
    node = inner[0]
  }
  if (!capped || node.meta.op !== 'add') return undefined
  const differs =
    Math.abs(node.value - part.value) >
    1e-9 * Math.max(1, Math.abs(node.value), Math.abs(part.value))
  return differs ? node.value : undefined
}

export function partTerms(part: CalcResult): CalcResult[] {
  let node = part
  for (let depth = 0; depth < 8; depth++) {
    const nonZero = node.meta.ops.filter((op) => op.value !== 0)
    if (node.meta.op === 'add' && nonZero.length >= 2) break
    if (!['add', 'min', 'max'].includes(node.meta.op)) return []
    const inner = node.meta.ops.filter((op) => op.meta.op !== 'const')
    if (inner.length !== 1) return []
    node = inner[0]
  }
  if (node.meta.op !== 'add') return []
  // every term of the nested sums, down to what is not a sum
  const leaves: CalcResult[] = []
  const flatten = (sum: CalcResult) => {
    for (const op of sum.meta.ops) {
      if (op.value === 0) continue
      if (op.meta.op === 'add') flatten(op)
      else leaves.push(op)
    }
  }
  flatten(node)
  if (leaves.length >= 2 && leaves.every((leaf) => !!leaf.info?.path))
    return leaves
  // (a term with no name: the named terms one level down, when they are all there is)
  const named = node.meta.ops.filter((op) => op.value !== 0)
  return named.length >= 2 && named.every((op) => !!op.info?.path) ? named : []
}
