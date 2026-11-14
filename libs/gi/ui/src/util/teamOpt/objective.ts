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
  assignReads,
  constant,
  constantFolder,
  data,
  dynamicData,
  greaterEq,
  input,
  max,
  mergeData,
  min,
  none,
  optimize,
  optimizeFolded,
  percent,
  prod,
  resetData,
  sum,
} from '@genshin-optimizer/gi/wr'
import { statFilterToNumNode } from '../statFilterToNumNode'
import type {
  BonusStats,
  BuffContext,
  BuffRef,
  CharacterOverride,
  TeamDataOverrides,
} from './data'
import {
  buffContextKey,
  getTeamDataSelect,
  getTeamDataWith,
  teamOptMembers,
} from './data'

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
) => buffContextKey({ excluded, states })

type Team = ReturnType<typeof uiDataForTeam>
/** Artifact variables stay in a folded formula; everything else is folded in */
const shouldFold = ({ path: [p] }: { path: readonly string[] }) => p !== 'dyn'
/** Attack nodes made once per attack and display (so the same node is folded once) */
type AttackNodes = WeakMap<object, Map<string, NumNode | undefined>>

/** A team calculation in one buff context */
interface TeamView {
  team: Team
  /**
   * `nodes`, read in `data` (a member's data in `team`; `{}` for nodes that carry their own),
   * folded for this context: only the artifact variables stay
   */
  fold: (nodes: NumNode[], data: Data) => NumNode[]
  nodes?: AttackNodes
}
/** Where a rotation's team calculations come from */
interface TeamSource {
  /** A group of hits' team: its buffs off and in their states, `active` on the field */
  group: (context: BuffContext, active: CharacterKey) => TeamView | undefined
  /** A captured context's team: its states, nothing off */
  captured: (
    states: BuffContext['states'],
    active: CharacterKey
  ) => TeamView | undefined
  /** The rotation's formulas, once all are folded (absent: each fold's are final) */
  finish?: (nodes: OptNode[]) => OptNode[]
}

/** The optimized member's artifact stats become variables, also in the buffs it gives */
function withDynamic(team: Team, dyn: CharacterKey | undefined): Team {
  const own = dyn && team[dyn]?.target.data[0]
  if (own) Object.assign(own, mergeData([own, dynamicData]))
  return team
}

/** A team calculated elsewhere, as a view (folded on its own) */
const viewOf = (team: Team): TeamView => ({
  team,
  fold: (nodes, data) => optimize(nodes, data, shouldFold) as NumNode[],
})

/** One team calculation per buff context (each folded on its own) */
function contextSource(
  database: ArtCharDatabase,
  teamId: string,
  gender: GenderKey,
  overrides: TeamDataOverrides,
  dyn?: CharacterKey
): TeamSource {
  const view = (team: Team | undefined): TeamView | undefined =>
    team && {
      team: withDynamic(team, dyn),
      fold: (nodes, data) => optimize(nodes, data, shouldFold) as NumNode[],
    }
  const teams = new Map<string, ReturnType<typeof getTeamDataWith>>()
  const groups = new Map<string, TeamView | undefined>()
  const captured = new Map<string, TeamView | undefined>()
  return {
    group(context, active) {
      const key = buffContextKey(context)
      if (!teams.has(key))
        teams.set(
          key,
          getTeamDataWith(database, teamId, { ...overrides, ...context })
        )
      const teamData = teams.get(key)
      const id = `${key}@${active}`
      if (!groups.has(id))
        groups.set(
          id,
          view(
            teamData?.[active]
              ? uiDataForTeam(
                  // the member on the field first, as in the app (its data is the team's
                  // "active" one)
                  { [active]: teamData[active], ...teamData },
                  gender,
                  active
                )
              : undefined
          )
        )
      return groups.get(id)
    },
    captured(states, active) {
      const key = JSON.stringify([states, active])
      if (!captured.has(key)) {
        const team = getTeamDataWith(database, teamId, {
          ...overrides,
          states,
          excluded: [],
        })
        captured.set(
          key,
          view(
            team?.[active]
              ? uiDataForTeam(
                  { [active]: team[active], ...team },
                  gender,
                  active
                )
              : undefined
          )
        )
      }
      return captured.get(key)
    },
  }
}

/**
 * One team calculation for every buff context (`getTeamDataSelect`: a conditional that differs
 * between contexts is a switch), folded with one memory, so what the contexts and the attacks
 * share is computed once; each context's own comes from its switches' values. The same
 * formulas as `contextSource`, for a fraction of the work when a rotation has many contexts.
 */
function sharedSource(
  database: ArtCharDatabase,
  teamId: string,
  gender: GenderKey,
  overrides: TeamDataOverrides,
  dyn: CharacterKey | undefined,
  contexts: readonly BuffContext[]
): TeamSource | undefined {
  const select = getTeamDataSelect(database, teamId, overrides, contexts)
  if (!select) return undefined
  const fold = constantFolder(shouldFold)
  const nodes: AttackNodes = new WeakMap()
  const holds = new WeakMap<OptNode, boolean>()
  const teams = new Map<CharacterKey, Team | undefined>()
  const views = new Map<string, TeamView | undefined>()
  const keys = new WeakMap<object, string>()
  const keyOf = (context: BuffContext, by: object) => {
    let key = keys.get(by)
    if (key === undefined) {
      key = buffContextKey(context)
      keys.set(by, key)
    }
    return key
  }
  const view = (context: BuffContext, active: CharacterKey, by: object) => {
    const key = keyOf(context, by)
    const id = `${key}@${active}`
    if (!views.has(id)) {
      const values = select.values(key)
      if (!values) throw new Error(`Buff context not prepared: ${key}`)
      if (!teams.has(active)) {
        const { teamData } = select
        teams.set(
          active,
          teamData[active]
            ? withDynamic(
                uiDataForTeam(
                  { [active]: teamData[active], ...teamData },
                  gender,
                  active
                ),
                dyn
              )
            : undefined
        )
      }
      const team = teams.get(active)
      // a switch's read: under `dyn`, its key marked (see `getTeamDataSelect`)
      const value = (read: { path: readonly string[] }) =>
        read.path[0] === 'dyn' && read.path[1].charCodeAt(0) === 0xa7
          ? values[read.path[1]]
          : undefined
      views.set(
        id,
        team && {
          team,
          nodes,
          // (folded with every context's version, then this context's taken; simplified at the
          // end, all the rotation's formulas at once)
          fold: (ns, data) =>
            assignReads(fold(ns, data), value, holds) as NumNode[],
        }
      )
    }
    return views.get(id)
  }
  return {
    group: (context, active) => view(context, active, context),
    captured: (states, active) =>
      view({ states, excluded: [] }, active, states),
    // (simplified, not put in one canonical order: what takes the formulas does its own
    // sharing: KQM's `mergeIdentical`, Team optimize's `optimize` of their sum)
    finish: (all) => optimizeFolded(all, {}, false),
  }
}

/** An attack's node with its own hit mode, reaction, infusion and bonus stats */
function attackNode(
  display: Data['display'],
  attack: TeamOptAttack,
  globalHitMode: string,
  snapshotAdjustments: Partial<Record<string, NumNode>> = {},
  cache?: AttackNodes
): NumNode | undefined {
  // (an attack without snapshots is the same node whatever buffs its hits get)
  if (cache && display && !Object.keys(snapshotAdjustments).length) {
    let nodes = cache.get(display)
    if (!nodes) {
      nodes = new Map()
      cache.set(display, nodes)
    }
    const key = JSON.stringify([
      attack.path,
      attack.hitMode === 'global' ? globalHitMode : attack.hitMode,
      attack.reaction,
      attack.infusionAura,
      attack.bonusStats,
      attack.talentMultiplier,
      attack.healing,
    ])
    if (!nodes.has(key))
      nodes.set(key, attackNode(display, attack, globalHitMode))
    return nodes.get(key)
  }
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

/** Native special reactions rank the rolled contributions, rather than their averages.
 * Enumerate at most 16 independent crit outcomes. Each contributor is folded in its own
 * context first, retaining artifact variables for whichever member is being optimized.
 */
function reactionAttackNode(
  view: TeamView,
  characterKey: CharacterKey,
  attack: TeamOptAttack,
  hitMode: string,
  snapshotFor: ReturnType<typeof snapshotReader>,
  source: TeamSource,
  collectRoll?: (damage: NumNode, probability: NumNode) => void
): NumNode | undefined {
  const current = view.team[characterKey]?.target.data[0]
  if (!current) return undefined
  if (!attack.reactionContributors?.length)
    return attackNode(
      current.display,
      attack,
      hitMode,
      snapshotFor(characterKey, attack, current, view),
      view.nodes
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
  const contributions = attack.reactionContributors.flatMap((key) => {
    const capturedStates = attack.reactionContributorStates?.[key]
    const from =
      capturedStates && attack.onField
        ? source.captured(capturedStates, attack.onField)
        : view
    const own = from?.team[key]?.target.data[0]
    if (!own || !from) return []
    const adjustment = snapshotFor(key, attack, own, from)
    const normal = attackNode(
      own.display,
      { ...attack, hitMode: 'hit' },
      hitMode,
      adjustment,
      from.nodes
    )
    const critical = attackNode(
      own.display,
      { ...attack, hitMode: 'critHit' },
      hitMode,
      adjustment,
      from.nodes
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
    const [base, crit, chance] = from.fold([normal, critical, cr], own)
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
function snapshotReader(teams: TeamSource) {
  const dataOf = (view: TeamView | undefined, member: CharacterKey) => {
    const data = view?.team[member]?.target.data[0]
    return view && data ? { view, data } : undefined
  }
  return (
    characterKey: CharacterKey,
    attack: TeamOptAttack,
    /** The member's data in the hit's own team, and that team */
    current: Data,
    currentView: TeamView
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
      const captured = dataOf(
        teams.captured(snapshot.states, snapshot.onField),
        source
      )
      const currentSource = totalSnapshot
        ? dataOf(
            teams.captured(totalSnapshot.states, totalSnapshot.onField),
            source
          )
        : source === characterKey
          ? { view: currentView, data: current }
          : dataOf(
              teams.captured(
                attack.states ?? [],
                attack.onField ?? snapshot.onField
              ),
              source
            )
      const original =
        currentSource &&
        (objPathValue(currentSource.data, snapshot.path) as NumNode | undefined)
      const replacement =
        captured &&
        (objPathValue(captured.data, snapshot.path) as NumNode | undefined)
      if (
        !original?.operation ||
        !replacement?.operation ||
        !captured ||
        !currentSource
      )
        continue
      const before = currentSource.view.fold([original], currentSource.data)[0]
      const after = captured.view.fold([replacement], captured.data)[0]
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
  settings: TeamRotationSettings
): TeamRotationNodes | undefined {
  if (teamRotationEngine.shared)
    try {
      return rotationNodes(database, teamId, gender, settings, true)
    } catch (e) {
      // (a formula the shared calculation cannot hold: each context on its own, as before)
      teamRotationEngine.fallbacks++
      teamRotationEngine.lastError = e
    }
  return rotationNodes(database, teamId, gender, settings, false)
}

/**
 * How `teamRotationNodes` computes: `shared` (one team calculation for all buff contexts, see
 * `sharedSource`) or one per context; `fallbacks` counts the times the shared one could not be
 * used.
 */
export const teamRotationEngine: {
  shared: boolean
  fallbacks: number
  lastError?: unknown
} = { shared: true, fallbacks: 0 }

export interface TeamRotationSettings {
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

function rotationNodes(
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
  }: TeamRotationSettings,
  shared: boolean
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

  const overrides: TeamDataOverrides = {
    arts: dyn ? { ...arts, [dyn]: [] } : arts,
    mainStatAssumptionLevel,
    weapons,
    extraConditionals,
    bonusStats,
    characters,
    conditionalOverrides,
  }
  let source: TeamSource | undefined
  if (shared) {
    // every buff context the rotation is computed in: the groups', and the ones its attacks
    // captured (snapshots, reaction contributors)
    const contexts = new Map<string, BuffContext>()
    const want = (context: BuffContext) =>
      contexts.set(buffContextKey(context), context)
    for (const { excluded, states } of groups.values())
      want({ excluded, states })
    for (const { characterKey } of members)
      for (const def of attacks[characterKey] ?? []) {
        for (const states of Object.values(def.reactionContributorStates ?? {}))
          if (states) want({ excluded: [], states })
        if (def.statSnapshots?.length) {
          want({ excluded: [], states: def.states ?? [] })
          for (const { states } of def.statSnapshots)
            want({ excluded: [], states })
        }
      }
    source = sharedSource(database, teamId, gender, overrides, dyn, [
      ...contexts.values(),
    ])
  }
  source ??= contextSource(database, teamId, gender, overrides, dyn)
  const snapshotFor = snapshotReader(source)
  const terms: TeamOptTerm[] = []
  const constraints: TeamOptConstraint[] = []
  for (const group of groups.values()) {
    for (const [active, items] of group.byActive) {
      const withConstraints = group === base && active === defaultActive
      if (!items.length && !withConstraints) continue
      const view = source.group(group, active)
      if (!view) continue
      const uiData = view.team
      if (dyn && !uiData[dyn]?.target.data[0]) return undefined
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
                  view,
                  characterKey,
                  def,
                  teamChar.hitMode,
                  snapshotFor,
                  source
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
        view
          .fold(
            batch.map((b) => b.node),
            {}
          )
          .forEach((node, i) => batch[i].add(node as OptNode))
    }
  }
  if (source.finish) {
    const all = source.finish([
      ...terms.map((t) => t.node),
      ...constraints.map((c) => c.value),
    ])
    terms.forEach((t, i) => {
      t.node = all[i]
    })
    constraints.forEach((c, i) => {
      c.value = all[terms.length + i]
    })
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
  const source = contextSource(database, teamId, gender, {
    arts,
    mainStatAssumptionLevel,
    weapons,
    bonusStats,
  })
  const snapshotFor = snapshotReader(source)
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
            viewOf(team),
            characterKey,
            def,
            teamChar.hitMode,
            snapshotFor,
            source
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
  const source = contextSource(database, teamId, gender, {
    mainStatAssumptionLevel,
    bonusStats,
  })
  const node = reactionAttackNode(
    viewOf(ui),
    characterKey,
    attack,
    member.teamChar.hitMode,
    snapshotReader(source),
    source
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
  const source = contextSource(database, teamId, gender, overrides)
  const snapshotFor = snapshotReader(source)
  const view = viewOf(ui)
  const value = (node: NumNode | undefined) => node && target.get(node)?.value
  const nodeFor = (hitMode: TeamOptAttack['hitMode']) =>
    reactionAttackNode(
      view,
      characterKey,
      { ...attack, hitMode },
      member.teamChar.hitMode,
      snapshotFor,
      source
    )
  const rolls: { damage: number; probability: number }[] = []
  if (attack.reactionContributors?.length) {
    reactionAttackNode(
      view,
      characterKey,
      { ...attack, hitMode: 'avgHit' },
      member.teamChar.hitMode,
      snapshotFor,
      source,
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
