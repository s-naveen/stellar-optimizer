import { objPathValue } from '@genshin-optimizer/common/util'
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
  greaterEq,
  input,
  max,
  mergeData,
  min,
  none,
  optimize,
  percent,
  prod,
  resetData,
  sum,
} from '@genshin-optimizer/gi/wr'
import { statFilterToNumNode } from '../statFilterToNumNode'
import type {
  BonusStats,
  BuffRef,
  CharacterOverride,
  TeamDataOverrides,
} from './data'
import { buffRefKey, getTeamDataWith, teamOptMembers } from './data'

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
  globalHitMode: string,
  snapshotAdjustments: Partial<Record<string, NumNode>> = {}
): NumNode | undefined {
  let node = objPathValue(display ?? {}, attack.path) as NumNode | undefined
  if (
    attack.path.join('.') === 'artifact:OceanHuedClam.heal' &&
    attack.healing?.length
  ) {
    const healing = attack.healing.map(({ path, count }) => {
      const heal = objPathValue(display ?? {}, path) as NumNode | undefined
      return heal?.operation ? prod(heal, count) : constant(0)
    })
    node = greaterEq(
      input.artSet.OceanHuedClam,
      4,
      prod(0.9, min(30000, sum(...healing)), input.enemy.physical_resMulti_)
    )
  }
  if (!node?.operation) return undefined
  const hitMode = attack.hitMode === 'global' ? globalHitMode : attack.hitMode
  return data(node, {
    premod: Object.fromEntries(
      [
        ...new Set([
          ...Object.keys(attack.bonusStats ?? {}),
          ...Object.keys(snapshotAdjustments),
        ]),
      ].map((key) => [
        key,
        sum(
          key.endsWith('_')
            ? percent(
                (attack.bonusStats?.[key as keyof typeof attack.bonusStats] ??
                  0) / 100
              )
            : constant(
                attack.bonusStats?.[key as keyof typeof attack.bonusStats] ?? 0
              ),
          snapshotAdjustments[key] ?? constant(0)
        ),
      ])
    ),
    hit: {
      hitMode: constant(hitMode),
      talentMulti: constant(attack.talentMultiplier ?? 1),
      simReaction: attack.reaction ? constant(attack.reaction) : none,
    },
    // undefined, not `none`: team infusions read the smallest string, and 'none' < 'pyro' would
    // wipe a Pyro team infusion (Bennett C6)
    infusion: {
      team: attack.infusionAura ? constant(attack.infusionAura) : undefined,
    },
  })
}

/** A cached team calculation for a captured context; artifact variables remain live. */
function teamContextReader(
  database: ArtCharDatabase,
  teamId: string,
  gender: GenderKey,
  overrides: TeamDataOverrides,
  dyn?: CharacterKey
) {
  const cache = new Map<string, ReturnType<typeof uiDataForTeam> | undefined>()
  return (
    states: NonNullable<TeamOptAttack['states']>,
    active: CharacterKey
  ) => {
    const key = JSON.stringify([states, active])
    if (!cache.has(key)) {
      const team = getTeamDataWith(database, teamId, {
        ...overrides,
        states,
        excluded: [],
      })
      const ui = team?.[active]
        ? uiDataForTeam({ [active]: team[active], ...team }, gender, active)
        : undefined
      if (dyn && ui?.[dyn]?.target.data[0]) {
        const dynamic = ui[dyn]!.target.data[0]
        Object.assign(dynamic, mergeData([dynamic, dynamicData]))
      }
      cache.set(key, ui)
    }
    return cache.get(key)
  }
}

/** Native special reactions rank the rolled contributions, rather than their averages.
 * Enumerate at most 16 independent crit outcomes. Each contributor is folded in its own
 * context first, retaining artifact variables for whichever member is being optimized.
 */
function reactionAttackNode(
  team: ReturnType<typeof uiDataForTeam>,
  characterKey: CharacterKey,
  attack: TeamOptAttack,
  hitMode: string,
  snapshotFor: ReturnType<typeof snapshotReader>,
  contextFor: ReturnType<typeof teamContextReader>,
  collectRoll?: (damage: NumNode, probability: NumNode) => void
): NumNode | undefined {
  const current = team[characterKey]?.target.data[0]
  if (!current) return undefined
  if (!attack.reactionContributors?.length)
    return attackNode(
      current.display,
      attack,
      hitMode,
      snapshotFor(characterKey, attack, current)
    )
  const nodeName = attack.path[1] ?? ''
  const variant = nodeName.startsWith('stellarswirl')
    ? 'stellarswirl'
    : nodeName === 'lunarcrystallize'
      ? 'lunarcrystallize'
      : 'lunarcharged'
  const element =
    variant === 'stellarswirl'
      ? nodeName.includes('vortex')
        ? 'cryo'
        : 'anemo'
      : variant === 'lunarcrystallize'
        ? 'geo'
        : 'electro'
  const fold = ({ path: [p] }: { path: readonly string[] }) => p !== 'dyn'
  const contributions = attack.reactionContributors.flatMap((key) => {
    const capturedStates = attack.reactionContributorStates?.[key]
    const own = (
      capturedStates && attack.onField
        ? contextFor(capturedStates, attack.onField)?.[key]
        : team[key]
    )?.target.data[0]
    if (!own) return []
    const adjustment = snapshotFor(key, attack, own)
    const normal = attackNode(
      own.display,
      { ...attack, hitMode: 'hit' },
      hitMode,
      adjustment
    )
    const critical = attackNode(
      own.display,
      { ...attack, hitMode: 'critHit' },
      hitMode,
      adjustment
    )
    if (!normal || !critical) return []
    const cr = max(
      0,
      min(
        1,
        sum(
          input.total.critRate_,
          input.total[`${variant}_critRate_`],
          input.total[`${element}_critRate_`]
        )
      )
    )
    const [base, crit, chance] = optimize(
      [normal, critical, cr],
      own,
      fold
    ) as NumNode[]
    return [{ base, crit, chance }]
  })
  if (!contributions.length) return constant(0)
  const ranked = (values: NumNode[]) => {
    const highest = max(...values)
    const pairs = values.flatMap((a, i) =>
      values.slice(i + 1).map((b) => min(a, b))
    )
    const second = pairs.length ? max(...pairs) : constant(0)
    return sum(
      prod(0.05, sum(...values)),
      prod(0.55, highest),
      prod(0.25, second)
    )
  }
  const mode = attack.hitMode === 'global' ? hitMode : attack.hitMode
  if (mode === 'hit') return ranked(contributions.map((c) => c.base))
  if (mode === 'critHit') return ranked(contributions.map((c) => c.crit))
  return sum(
    ...Array.from({ length: 1 << contributions.length }, (_, mask) => {
      const values = contributions.map((c, i) =>
        mask & (1 << i) ? c.crit : c.base
      )
      const probability = prod(
        ...contributions.map((c, i) =>
          mask & (1 << i) ? c.chance : sum(1, prod(-1, c.chance))
        )
      )
      const damage = ranked(values)
      collectRoll?.(damage, probability)
      return prod(probability, damage)
    })
  )
}

/** Fold the snapshot's context, while retaining artifact variables for the optimized member. */
function snapshotReader(
  database: ArtCharDatabase,
  teamId: string,
  gender: GenderKey,
  overrides: TeamDataOverrides,
  dyn?: CharacterKey
) {
  const contextFor = teamContextReader(database, teamId, gender, overrides, dyn)
  return (
    characterKey: CharacterKey,
    attack: TeamOptAttack,
    current: Data
  ): Partial<Record<string, NumNode>> => {
    const adjustments: Partial<Record<string, NumNode>> = {}
    for (const snapshot of attack.statSnapshots ?? []) {
      if (snapshot.recipient && snapshot.recipient !== characterKey) continue
      const source = snapshot.characterKey ?? characterKey
      // A captured total already contains the buff as it was at that earlier time.
      // Replace a captured component relative to that total's context, not the hit's
      // current context, or later source buffs can be counted twice.
      const totalSnapshot = attack.statSnapshots?.find(
        (s) =>
          s !== snapshot &&
          (!s.recipient || s.recipient === characterKey) &&
          s.stat === snapshot.stat &&
          (s.characterKey ?? characterKey) === characterKey &&
          s.path.join('.') === `total.${snapshot.stat}`
      )
      const captured = contextFor(snapshot.states, snapshot.onField)?.[source]
        ?.target.data[0]
      const currentSource = totalSnapshot
        ? contextFor(totalSnapshot.states, totalSnapshot.onField)?.[source]
            ?.target.data[0]
        : source === characterKey
          ? current
          : contextFor(
              attack.states ?? [],
              attack.onField ?? snapshot.onField
            )?.[source]?.target.data[0]
      const original =
        currentSource &&
        (objPathValue(currentSource, snapshot.path) as NumNode | undefined)
      const replacement =
        captured &&
        (objPathValue(captured, snapshot.path) as NumNode | undefined)
      if (
        !original?.operation ||
        !replacement?.operation ||
        !captured ||
        !currentSource
      )
        continue
      const fold = ({ path: [p] }: { path: readonly string[] }) => p !== 'dyn'
      const before = optimize([original], currentSource, fold)[0] as NumNode
      const after = optimize([replacement], captured, fold)[0] as NumNode
      adjustments[snapshot.stat] = sum(
        adjustments[snapshot.stat] ?? constant(0),
        after,
        prod(-1, before)
      )
    }
    return adjustments
  }
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
    conditionalOverrides,
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
    /** Conditionals over the members' own (`TeamDataOverrides.conditionalOverrides`) */
    conditionalOverrides?: TeamDataOverrides['conditionalOverrides']
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
      for (const { hits, excluded } of attackSegments(def)) {
        const { byActive } = groupFor(excluded, def.states ?? [])
        const items = byActive.get(active) ?? []
        byActive.set(active, items)
        items.push({ characterKey, attack, hits, def })
      }
    })

  const shouldFold = ({ path: [p] }: { path: readonly string[] }) => p !== 'dyn'
  const snapshotFor = snapshotReader(
    database,
    teamId,
    gender,
    {
      arts: dyn ? { ...arts, [dyn]: [] } : arts,
      mainStatAssumptionLevel,
      weapons,
      extraConditionals,
      bonusStats,
      characters,
      conditionalOverrides,
    },
    dyn
  )
  const reactionContextFor = teamContextReader(
    database,
    teamId,
    gender,
    {
      arts: dyn ? { ...arts, [dyn]: [] } : arts,
      mainStatAssumptionLevel,
      weapons,
      extraConditionals,
      bonusStats,
      characters,
      conditionalOverrides,
    },
    dyn
  )
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
      conditionalOverrides,
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
      // Every member's hits and requirements are folded together, each in its own data: the
      // teammates' parts they share (buffs, auras) are folded once, not once per member
      const batch: { node: NumNode; add: (node: OptNode) => void }[] = []
      for (const { characterKey, teamChar } of members) {
        const workerData = uiData[characterKey]?.target.data[0]
        if (!workerData) continue
        items.forEach((item) => {
          if (item.characterKey !== characterKey) return
          const { hits, def, attack } = item
          batch.push({
            node: resetData(
              prod(
                constant(hits),
                reactionAttackNode(
                  uiData,
                  characterKey,
                  def,
                  teamChar.hitMode,
                  snapshotFor,
                  reactionContextFor
                ) ?? constant(0)
              ) as NumNode,
              workerData
            ),
            add: (node) => terms.push({ characterKey, attack, node }),
          })
        })
        if (!withConstraints) continue
        const filters = statFilterToNumNode(
          workerData,
          statFilters[characterKey] ?? {}
        )
        filters.forEach(({ value, path, minimum }, index) =>
          batch.push({
            node: resetData(value, workerData),
            add: (node) =>
              constraints.push({
                characterKey,
                index,
                path,
                value: node,
                min: minimum,
              }),
          })
        )
      }
      if (batch.length)
        optimize(
          batch.map((b) => b.node),
          {},
          shouldFold
        ).forEach((node, i) => batch[i].add(node))
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
  const snapshotFor = snapshotReader(database, teamId, gender, {
    arts,
    mainStatAssumptionLevel,
    weapons,
    bonusStats,
  })
  const reactionContextFor = teamContextReader(database, teamId, gender, {
    arts,
    mainStatAssumptionLevel,
    weapons,
    bonusStats,
  })
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
        const team = teamFor(excluded, def.states ?? [], active)
        const target = team?.[characterKey]?.target
        const workerData = target?.data[0]
        const node =
          workerData &&
          team &&
          reactionAttackNode(
            team,
            characterKey,
            def,
            teamChar.hitMode,
            snapshotFor,
            reactionContextFor
          )
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
  const ui = uiDataForTeam(
    { [active]: teamData[active], ...teamData },
    gender,
    active
  )
  const target = ui?.[characterKey]?.target
  if (!target) return undefined
  const overrides = { mainStatAssumptionLevel, bonusStats }
  const node = reactionAttackNode(
    ui,
    characterKey,
    attack,
    member.teamChar.hitMode,
    snapshotReader(database, teamId, gender, overrides),
    teamContextReader(database, teamId, gender, overrides)
  )

  return { target, hit: node ? target.get(node) : undefined }
}

/** Damage rolls for mechanics with damage thresholds. Shared reactions roll each
 * contributor independently, exactly as the rotation objective does. */
export function attackDamageOutcomes(
  database: ArtCharDatabase,
  teamId: string,
  gender: GenderKey,
  characterKey: CharacterKey,
  attack: TeamOptAttack,
  overrides: TeamDataOverrides = {}
): { damage: number; probability: number }[] | undefined {
  const member = teamOptMembers(database, teamId).find(
    (m) => m.characterKey === characterKey
  )
  const active = attack.onField ?? characterKey
  const teamData = getTeamDataWith(database, teamId, {
    ...overrides,
    excluded: [
      ...(overrides.excluded ?? []),
      ...attackSegments({ ...attack, hits: 1 })[0].excluded,
    ],
    states: [...(overrides.states ?? []), ...(attack.states ?? [])],
  })
  if (!member || !teamData?.[active]) return undefined
  const ui = uiDataForTeam(
    { [active]: teamData[active], ...teamData },
    gender,
    active
  )
  const target = ui[characterKey]?.target
  if (!target) return undefined
  const snapshotFor = snapshotReader(database, teamId, gender, overrides)
  const contextFor = teamContextReader(database, teamId, gender, overrides)
  const value = (node: NumNode | undefined) => node && target.get(node)?.value
  const nodeFor = (hitMode: TeamOptAttack['hitMode']) =>
    reactionAttackNode(
      ui,
      characterKey,
      { ...attack, hitMode },
      member.teamChar.hitMode,
      snapshotFor,
      contextFor
    )
  const rolls: { damage: number; probability: number }[] = []
  if (attack.reactionContributors?.length) {
    reactionAttackNode(
      ui,
      characterKey,
      { ...attack, hitMode: 'avgHit' },
      member.teamChar.hitMode,
      snapshotFor,
      contextFor,
      (damage, probability) => {
        const d = value(damage),
          p = value(probability)
        if (typeof d === 'number' && typeof p === 'number' && p > 0)
          rolls.push({ damage: d, probability: p })
      }
    )
  } else {
    const base = value(nodeFor('hit')),
      crit = value(nodeFor('critHit')),
      average = value(nodeFor('avgHit'))
    if (
      typeof base !== 'number' ||
      typeof crit !== 'number' ||
      typeof average !== 'number'
    )
      return undefined
    const chance =
      crit === base
        ? 0
        : Math.max(0, Math.min(1, (average - base) / (crit - base)))
    if (chance < 1) rolls.push({ damage: base, probability: 1 - chance })
    if (chance > 0) rolls.push({ damage: crit, probability: chance })
  }
  return rolls.length &&
    rolls.every(
      (r) => Number.isFinite(r.damage) && Number.isFinite(r.probability)
    )
    ? rolls
    : undefined
}
