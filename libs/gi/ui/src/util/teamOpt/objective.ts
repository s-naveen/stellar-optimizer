import { objMap, objPathValue } from '@genshin-optimizer/common/util'
import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  ICachedArtifact,
  ICachedWeapon,
  StatFilters,
  TeamOpt,
  TeamOptAttack,
} from '@genshin-optimizer/gi/db'
import type { IConditionalValues } from '@genshin-optimizer/gi/sheets'
import type { CalcResult, UIData } from '@genshin-optimizer/gi/uidata'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import type { Data, NumNode, OptNode } from '@genshin-optimizer/gi/wr'
import {
  constant,
  data,
  dynamicData,
  mergeData,
  none,
  optimize,
  percent,
  prod,
} from '@genshin-optimizer/gi/wr'
import { statFilterToNumNode } from '../statFilterToNumNode'
import type { BonusStats, BuffRef, CharacterOverride } from './data'
import { buffRefKey, getTeamDataWith, teamOptMembers } from './data'
import type { TimedAttack } from './timeline'

/** A run of an attack's hits that all get the same buffs */
export interface AttackSegment {
  hits: number
  /** Buffs that are off for these hits */
  excluded: BuffRef[]
}

/**
 * An attack's hits, split by the buffs they get. A limited buff covers the attack's first hits
 * (Shenhe's quills are used by the first hits that come, a buff that runs out covers the
 * earliest ones); a limit of 0 hits turns the buff off for the whole attack.
 */
export function attackSegments(attack: TeamOptAttack): AttackSegment[] {
  const total = attack.hits
  if (!(total > 0)) return []
  const limits = (attack.limits ?? []).map(({ owner, path, hits }) => ({
    ref: { owner, path },
    hits: Math.max(0, Math.min(total, hits)),
  }))
  const breaks = [...new Set([0, total, ...limits.map(({ hits }) => hits)])]
    .filter((x) => x <= total)
    .sort((a, b) => a - b)
  const segments: AttackSegment[] = []
  for (let i = 0; i + 1 < breaks.length; i++) {
    const start = breaks[i],
      end = breaks[i + 1]
    segments.push({
      hits: end - start,
      excluded: limits
        .filter(({ hits }) => hits <= start)
        .map(({ ref }) => ref),
    })
  }
  return segments
}

/** A group of hits: the buffs that are off, and the ones in another state */
const groupKey = (
  excluded: readonly BuffRef[],
  states: readonly (BuffRef & { value: string })[]
) =>
  `${excluded.map(buffRefKey).sort().join('/')}#${states
    .map((s) => `${buffRefKey(s)}=${s.value}`)
    .sort()
    .join('/')}`

/** An attack's node with its own hit mode, reaction, infusion and bonus stats */
function attackNode(
  display: Data['display'],
  attack: TeamOptAttack,
  globalHitMode: string
): NumNode | undefined {
  const node = objPathValue(display ?? {}, attack.path) as NumNode | undefined
  if (!node?.operation) return undefined
  const hitMode = attack.hitMode === 'global' ? globalHitMode : attack.hitMode
  return data(node, {
    premod: objMap(attack.bonusStats ?? {}, (v, k) =>
      k.endsWith('_') ? percent(v / 100) : constant(v)
    ),
    hit: {
      hitMode: constant(hitMode),
      reaction: attack.reaction ? constant(attack.reaction) : none,
    },
    infusion: {
      team: attack.infusionAura ? constant(attack.infusionAura) : none,
    },
  })
}

/** One attack's (or part of one attack's) damage per rotation */
export interface TeamOptTerm {
  characterKey: CharacterKey
  /** Index of the attack in its member's rotation */
  attack: number
  node: OptNode
}
export interface TeamOptConstraint {
  characterKey: CharacterKey
  /** Index of the constraint among the member's enabled ones */
  index: number
  /** Its stat's path in the member's data (as in its Optimize tab's requirements) */
  path: string[]
  value: OptNode
  min: number
}
export interface TeamRotationNodes {
  terms: TeamOptTerm[]
  constraints: TeamOptConstraint[]
}

/**
 * The team's rotation damage, attack by attack, and every member's stat constraints, as nodes.
 * With `dyn`, that member's artifact stats are variables (`dyn` reads, as in the optimizer) and
 * everything else is folded in; without, every node is a constant: the rotation's damage with
 * the given builds.
 *
 * Each hit is computed with whoever is on the field during it as the active character (the
 * attack's `onField`, else `onField`, else the first member, as in the app), and with the
 * attack's buff states; the constraints with the default member on the field.
 */
export function teamRotationNodes(
  database: ArtCharDatabase,
  teamId: string,
  gender: GenderKey,
  {
    dyn,
    arts,
    attacks,
    mainStatAssumptionLevel = 0,
    statFilters = {},
    weapons,
    extraConditionals,
    onField,
    bonusStats,
    characters,
  }: {
    dyn?: CharacterKey
    /** Builds of the members (missing: their loadout's) */
    arts: Partial<Record<CharacterKey, ICachedArtifact[] | Data>>
    attacks: TeamOpt['attacks']
    mainStatAssumptionLevel?: number
    /** Constraints per member, as its optimizer stores them */
    statFilters?: Partial<Record<CharacterKey, StatFilters>>
    /** Weapons of the members (missing: their loadout's) */
    weapons?: Partial<Record<CharacterKey, ICachedWeapon>>
    /** Conditionals under the members' own (e.g. a new weapon's passive) */
    extraConditionals?: Partial<Record<CharacterKey, IConditionalValues>>
    /** Who is on the field during the hits, unless an attack says otherwise (default: the first member) */
    onField?: CharacterKey
    /** Extra bonus stats per member (`teamOptBonusStats`) */
    bonusStats?: Partial<Record<CharacterKey, BonusStats>>
    /** Members with another level, ascension or talent levels */
    characters?: Partial<Record<CharacterKey, CharacterOverride>>
  }
): TeamRotationNodes | undefined {
  const members = teamOptMembers(database, teamId)
  const memberKeys = members.map((m) => m.characterKey)
  const defaultActive =
    onField && memberKeys.includes(onField) ? onField : memberKeys[0]
  if (!defaultActive) return undefined
  if (dyn && !memberKeys.includes(dyn)) return undefined

  type Item = {
    characterKey: CharacterKey
    attack: number
    hits: number
    def: TeamOptAttack
  }
  type BuffState = BuffRef & { value: string }
  // The hits of every attack, grouped by the buffs they get (one team calculation per group),
  // then by who is on the field (buffs for the active character go to them)
  const groups = new Map<
    string,
    {
      excluded: BuffRef[]
      states: BuffState[]
      byActive: Map<CharacterKey, Item[]>
    }
  >()
  const groupFor = (excluded: BuffRef[], states: BuffState[]) => {
    const key = groupKey(excluded, states)
    let group = groups.get(key)
    if (!group) {
      group = { excluded, states, byActive: new Map() }
      groups.set(key, group)
    }
    return group
  }
  // the members' constraints are computed in the base group, with the default member on the field
  const base = groupFor([], [])
  base.byActive.set(defaultActive, [])
  for (const { characterKey } of members)
    (attacks[characterKey] ?? []).forEach((def, attack) => {
      const active =
        def.onField && memberKeys.includes(def.onField)
          ? def.onField
          : defaultActive
      // (split by the timeline, see `rotationAttacks`, else by its own limits)
      const segments = (def as TimedAttack).segments ?? attackSegments(def)
      for (const { hits, excluded } of segments) {
        const { byActive } = groupFor(excluded, def.states ?? [])
        const items = byActive.get(active) ?? []
        byActive.set(active, items)
        items.push({ characterKey, attack, hits, def })
      }
    })

  const shouldFold = ({ path: [p] }: { path: readonly string[] }) => p !== 'dyn'
  const terms: TeamOptTerm[] = []
  const constraints: TeamOptConstraint[] = []
  for (const group of groups.values()) {
    const teamData = getTeamDataWith(database, teamId, {
      arts: dyn ? { ...arts, [dyn]: [] } : arts,
      excluded: group.excluded,
      states: group.states,
      mainStatAssumptionLevel,
      weapons,
      extraConditionals,
      bonusStats,
      characters,
    })
    if (!teamData) return undefined
    for (const [active, items] of group.byActive) {
      const withConstraints = group === base && active === defaultActive
      if (!items.length && !withConstraints) continue
      if (!teamData[active]) continue
      // the member on the field first, as in the app (its data is the team's "active" one)
      const ordered = { [active]: teamData[active], ...teamData }
      const uiData = uiDataForTeam(ordered, gender, active)
      if (dyn) {
        const workerData = uiData[dyn]?.target.data[0]
        if (!workerData) return undefined
        // the member's artifact stats become variables, also in the buffs it gives
        Object.assign(workerData, mergeData([workerData, dynamicData]))
      }
      for (const { characterKey, teamChar } of members) {
        const workerData = uiData[characterKey]?.target.data[0]
        if (!workerData) continue
        const own = items.filter((item) => item.characterKey === characterKey)
        if (own.length) {
          const nodes = own.map(
            ({ hits, def }) =>
              prod(
                constant(hits),
                attackNode(workerData.display, def, teamChar.hitMode) ??
                  constant(0)
              ) as NumNode
          )
          optimize(nodes, workerData, shouldFold).forEach((node, i) =>
            terms.push({ characterKey, attack: own[i].attack, node })
          )
        }
        if (!withConstraints) continue
        const filters = statFilterToNumNode(
          workerData,
          statFilters[characterKey] ?? {}
        )
        if (filters.length)
          optimize(
            filters.map(({ value }) => value),
            workerData,
            shouldFold
          ).forEach((value, index) =>
            constraints.push({
              characterKey,
              index,
              path: filters[index].path,
              value,
              min: filters[index].minimum,
            })
          )
      }
    }
  }
  return { terms, constraints }
}

/** The value of constant nodes (what `teamRotationNodes` returns without `dyn`) */
export const constValue = (node: OptNode) =>
  node.operation === 'const' ? (node.value as number) : Number.NaN

/** A run of an attack's hits (`AttackSegment`) and one of them, as the app computes it */
export interface TeamOptHit extends AttackSegment {
  /** One hit's damage, its formula included (undefined: the attack has no such node) */
  hit: CalcResult<number> | undefined
}

/**
 * Every attack's hits, run by run, each with one hit's damage as the character's page computes
 * it (so with its formula and the values it uses), in the team the rotation counts: the given
 * builds, each attack's own buffs, states, hit mode, reaction and member on the field, the extra
 * buffs. The rotation's damage per attack is the sum of `hits × hit` over its runs.
 */
export function teamRotationHits(
  database: ArtCharDatabase,
  teamId: string,
  gender: GenderKey,
  {
    arts = {},
    attacks,
    mainStatAssumptionLevel = 0,
    weapons,
    onField,
    bonusStats,
  }: {
    /** Artifacts per member (data or real ones); members without an entry use their loadout's */
    arts?: Partial<Record<CharacterKey, ICachedArtifact[]>>
    attacks: TeamOpt['attacks']
    mainStatAssumptionLevel?: number
    weapons?: Partial<Record<CharacterKey, ICachedWeapon>>
    /** Who is on the field, unless an attack says otherwise (default: the first member) */
    onField?: CharacterKey
    /** Extra bonus stats per member (`teamOptBonusStats`) */
    bonusStats?: Partial<Record<CharacterKey, BonusStats>>
  }
): Partial<Record<CharacterKey, TeamOptHit[][]>> | undefined {
  const members = teamOptMembers(database, teamId)
  const memberKeys = members.map((m) => m.characterKey)
  const defaultActive =
    onField && memberKeys.includes(onField) ? onField : memberKeys[0]
  if (!defaultActive) return undefined
  // one team calculation per group of hits (as `teamRotationNodes`)
  const teams = new Map<string, ReturnType<typeof uiDataForTeam> | undefined>()
  const teamFor = (
    excluded: BuffRef[],
    states: readonly (BuffRef & { value: string })[],
    active: CharacterKey
  ) => {
    const key = `${groupKey(excluded, states)}@${active}`
    if (!teams.has(key)) {
      const teamData = getTeamDataWith(database, teamId, {
        arts,
        excluded,
        states,
        mainStatAssumptionLevel,
        weapons,
        bonusStats,
      })
      teams.set(
        key,
        teamData?.[active]
          ? uiDataForTeam(
              { [active]: teamData[active], ...teamData },
              gender,
              active
            )
          : undefined
      )
    }
    return teams.get(key)
  }
  const result: Partial<Record<CharacterKey, TeamOptHit[][]>> = {}
  for (const { characterKey, teamChar } of members)
    result[characterKey] = (attacks[characterKey] ?? []).map((def) => {
      const active =
        def.onField && memberKeys.includes(def.onField)
          ? def.onField
          : defaultActive
      return attackSegments(def).map(({ hits, excluded }) => {
        const target = teamFor(excluded, def.states ?? [], active)?.[
          characterKey
        ]?.target
        const workerData = target?.data[0]
        const node =
          workerData && attackNode(workerData.display, def, teamChar.hitMode)
        return {
          hits,
          excluded,
          hit: node && target ? target.get(node) : undefined,
        }
      })
    })
  return result
}

/**
 * One hit of `attack` (one of its first hits, with the buffs those get) as the rotation computes
 * it: `characterKey`'s data during it, and the hit's damage (with its formula). Where the attack
 * editor reads the stats the hit uses, and what each buff gives the attacker (this with the buff
 * up, against this without it).
 */
export function attackHitData(
  database: ArtCharDatabase,
  teamId: string,
  gender: GenderKey,
  {
    attack,
    characterKey,
    mainStatAssumptionLevel = 0,
    onField,
    bonusStats,
  }: {
    attack: TeamOptAttack
    characterKey: CharacterKey
    mainStatAssumptionLevel?: number
    /** Who is on the field, unless the attack says otherwise (default: the first member) */
    onField?: CharacterKey
    /** Extra bonus stats per member (`teamOptBonusStats`) */
    bonusStats?: Partial<Record<CharacterKey, BonusStats>>
  }
): { target: UIData; hit: CalcResult | undefined } | undefined {
  const members = teamOptMembers(database, teamId)
  const keys = members.map((m) => m.characterKey)
  const member = members.find((m) => m.characterKey === characterKey)
  if (!member) return undefined
  const active =
    attack.onField && keys.includes(attack.onField)
      ? attack.onField
      : onField && keys.includes(onField)
        ? onField
        : keys[0]
  // (an attack of no hits: one, as it would be)
  const [first] = attackSegments({ ...attack, hits: Math.max(attack.hits, 1) })
  const teamData = getTeamDataWith(database, teamId, {
    excluded: first?.excluded ?? [],
    states: attack.states ?? [],
    mainStatAssumptionLevel,
    bonusStats,
  })
  if (!teamData?.[active]) return undefined
  const target = uiDataForTeam(
    { [active]: teamData[active], ...teamData },
    gender,
    active
  )?.[characterKey]?.target
  if (!target) return undefined
  const node = attackNode(
    target.data[0].display,
    attack,
    member.teamChar.hitMode
  )
  return { target, hit: node ? target.get(node) : undefined }
}
