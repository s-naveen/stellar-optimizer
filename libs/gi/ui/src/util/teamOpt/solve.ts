import { notEmpty, objKeyMap } from '@genshin-optimizer/common/util'
import type {
  ArtifactSlotKey,
  CharacterKey,
  GenderKey,
} from '@genshin-optimizer/gi/consts'
import { allArtifactSlotKeys, artMaxLevel } from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  ArtSetExclusion,
  ICachedArtifact,
  ICachedWeapon,
  OptConfig,
  StatFilters,
  TeamOpt,
} from '@genshin-optimizer/gi/db'
import type { IConditionalValues } from '@genshin-optimizer/gi/sheets'
import { getMainStatValue } from '@genshin-optimizer/gi/util'
import type { OptNode } from '@genshin-optimizer/gi/wr'
import { constant, optimize, precompute, sum } from '@genshin-optimizer/gi/wr'
import type { BonusStats, CharacterOverride, TeamOptMember } from './data'
import { teamOptBonusStats, teamOptMembers } from './data'
import { constValue, teamRotationNodes } from './objective'
import {
  canWield,
  hasEnergyRequirement,
  teamEnergyRelief,
  teamOptUntickedWeapons,
  teamOptWeaponCandidates,
  teamStatFilters,
} from './weapons'

/** What the optimizer of one member is given: the rest of the team is fixed */
export interface TeamOptSolveInput {
  characterKey: CharacterKey
  arts: ICachedArtifact[]
  /** The team's rotation damage, as a function of the member's artifacts */
  objective: OptNode
  constraints: { value: OptNode; min: number }[]
  exclusion: ArtSetExclusion
  mainStatAssumptionLevel: number
  /** How many builds to find, best first (default 1): the next ones come in `more` */
  topN?: number
  /** Told, after the search, how much of the space it went through */
  onWork?: (work: { tested: number; total: number }) => void
}
/** The best build for `input` (with `topN`, the next ones in `more`), if any meets its constraints */
export type TeamOptSolver = (input: TeamOptSolveInput) => Promise<
  | {
      value: number
      artifactIds: string[]
      more?: { value: number; artifactIds: string[] }[]
    }
  | undefined
>

export interface TeamOptStep {
  round: number
  maxRounds: number
  /** Position of `characterKey` among the members being optimized */
  step: number
  steps: number
  characterKey: CharacterKey
  /** The weapon being tried, when weapons are optimized too (1-based, of `weapons`) */
  weapon?: number
  weapons?: number
  /**
   * While weighing an energy weapon: the member re-optimized with the Energy Recharge
   * requirement the weapon gives it
   */
  energyFor?: CharacterKey
  /** Trying exchanges with the other members (see `optimizeTeam`) */
  exchange?: boolean
  /** Finding the next best team builds (`TeamOpt.topN`), once the best one is found */
  alternatives?: boolean
}

export type TeamOptBuilds = Partial<
  Record<CharacterKey, Record<ArtifactSlotKey, string | undefined>>
>

export interface TeamOptEvaluation {
  /** The rotation's damage */
  total: number
  /** Per member, the damage of its own attacks */
  members: Partial<Record<CharacterKey, number>>
  /** Per member, each attack's damage per rotation */
  attacks: Partial<Record<CharacterKey, number[]>>
  /** Per member, the indices of its constraints that are not met */
  unmet: Partial<Record<CharacterKey, number[]>>
  /** Per member, its requirements that are not met: what they need, and what the build reaches */
  shortfalls?: Partial<Record<CharacterKey, TeamOptShortfall[]>>
}

/** A requirement a build does not meet (in the stat's own unit: a fraction for percentages) */
export interface TeamOptShortfall {
  /** Its stat's path in the member's data (as in its Optimize tab's requirements) */
  path: string[]
  /** What the build reaches */
  value: number
  /** What it needs */
  min: number
}

/** Another team build: the best one with one member's artifacts changed */
export interface TeamOptAlternative {
  builds: TeamOptBuilds
  after: TeamOptEvaluation
  /** The member whose artifacts differ from the best build's */
  changed: CharacterKey
}

export interface TeamOptResult {
  builds: TeamOptBuilds
  /** Each member's weapon (its current one unless weapons are optimized) */
  weapons: Partial<Record<CharacterKey, string>>
  before: TeamOptEvaluation
  after: TeamOptEvaluation
  /** Rounds run (each round optimizes every member once) */
  rounds: number
  /** The members that were optimized, in order */
  optimized: CharacterKey[]
  /**
   * Per member with an Energy Recharge requirement: how much the team's energy weapons lower it
   * (percent points), and which weapons
   */
  energy?: Partial<
    Record<CharacterKey, { relief: number; weaponIds: string[] }>
  >
  /**
   * Optimized members left with a weapon that is not ticked in the weapon chooser: none of the
   * ticked ones was free for them, so they kept theirs
   */
  untickedWeapons?: CharacterKey[]
  /**
   * Optimized members whose own build (before the run) breaks their set rules: they could not keep
   * it, which can leave the team below where it started
   */
  startBreaksSetRules?: CharacterKey[]
  /**
   * Optimized members whose own weapon (before the run) is not ticked in the weapon chooser while
   * a ticked one was free for them: they could not keep it, which can leave the team below where it
   * started
   */
  startUntickedWeapons?: CharacterKey[]
  /**
   * The next best team builds (`TeamOpt.topN` − 1 at most), best first: each one is this build
   * with one member's artifacts changed (its next best ones, the others as they are), the
   * weapons the same
   */
  alternatives?: TeamOptAlternative[]
}

export class TeamOptCancelled extends Error {
  constructor() {
    super('Team optimization cancelled')
  }
}

/**
 * No team build keeps every optimized member's set rules (their Optimize tab's set exclusions):
 * `characterKeys` are the members left outside them, even with the pieces the others hold
 */
export class TeamOptSetRulesUnmet extends Error {
  constructor(readonly characterKeys: CharacterKey[]) {
    super(
      `No build of the artifacts they may use keeps to the allowed sets of ${characterKeys.join(', ')}`
    )
  }
}

/** An artifact's stats as the solver sees them (see `compactArtifacts`) */
export function teamOptArtValues(
  art: ICachedArtifact,
  mainStatAssumptionLevel: number
): Record<string, number> {
  const values: Record<string, number> = {
    [art.setKey]: 1,
    [art.mainStatKey]: getMainStatValue(
      art.mainStatKey,
      art.rarity,
      Math.max(
        Math.min(mainStatAssumptionLevel, artMaxLevel[art.rarity]),
        art.level
      )
    ),
  }
  for (const { key, accurateValue } of art.substats)
    if (key)
      values[key] = key.endsWith('_') ? accurateValue / 100 : accurateValue
  return values
}

function evaluateNodes(
  nodes: OptNode[],
  arts: ICachedArtifact[],
  mainStatAssumptionLevel: number
) {
  const compute = precompute(nodes, {}, (r) => r.path[1], arts.length)
  return compute(
    arts.map((art) => ({
      values: teamOptArtValues(art, mainStatAssumptionLevel),
    })) as never
  )
}

/** The rotation's damage with the given builds (missing members: their loadout's build) */
export function evaluateTeamRotation(
  database: ArtCharDatabase,
  teamId: string,
  gender: GenderKey,
  {
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
    arts: Partial<Record<CharacterKey, ICachedArtifact[]>>
    attacks: TeamOpt['attacks']
    mainStatAssumptionLevel?: number
    statFilters?: Partial<Record<CharacterKey, StatFilters>>
    weapons?: Partial<Record<CharacterKey, ICachedWeapon>>
    extraConditionals?: Partial<Record<CharacterKey, IConditionalValues>>
    /** Who is on the field, unless an attack says otherwise (default: the first member) */
    onField?: CharacterKey
    /** Extra bonus stats per member (`teamOptBonusStats`) */
    bonusStats?: Partial<Record<CharacterKey, BonusStats>>
    /** Members with another level, ascension or talent levels */
    characters?: Partial<Record<CharacterKey, CharacterOverride>>
  }
): TeamOptEvaluation | undefined {
  const nodes = teamRotationNodes(database, teamId, gender, {
    arts,
    attacks,
    mainStatAssumptionLevel,
    statFilters,
    weapons,
    extraConditionals,
    onField,
    bonusStats,
    characters,
  })
  if (!nodes) return undefined
  const result: TeamOptEvaluation = {
    total: 0,
    members: {},
    attacks: {},
    unmet: {},
  }
  for (const { characterKey } of teamOptMembers(database, teamId)) {
    result.members[characterKey] = 0
    result.attacks[characterKey] = (attacks[characterKey] ?? []).map(() => 0)
  }
  for (const { characterKey, attack, node } of nodes.terms) {
    const value = constValue(node) || 0
    result.total += value
    result.members[characterKey] = (result.members[characterKey] ?? 0) + value
    const perAttack = (result.attacks[characterKey] ??= [])
    perAttack[attack] = (perAttack[attack] ?? 0) + value
  }
  for (const { characterKey, index, path, value, min } of nodes.constraints) {
    const reached = constValue(value)
    if (reached >= min) continue
    ;(result.unmet[characterKey] ??= []).push(index)
    ;((result.shortfalls ??= {})[characterKey] ??= []).push({
      path,
      value: reached,
      min,
    })
  }
  return result
}

/** The piece counts set exclusion `rule` allows (as the solver reads it: 2 = 2–3 pieces, 4 = 4–5) */
const allowedCounts = (rule: readonly number[] | undefined) =>
  rule?.includes(2)
    ? rule.includes(4)
      ? [0, 1]
      : [0, 1, 4, 5]
    : rule?.includes(4)
      ? [0, 1, 2, 3]
      : [0, 1, 2, 3, 4, 5]

/**
 * Whether a build keeps to a member's set rules (its Optimize tab's set exclusions), as the solver
 * reads them: each set's piece count, and "rainbow" for the number of pieces whose set has one
 */
export function meetsSetRules(
  arts: readonly ICachedArtifact[],
  exclusion: ArtSetExclusion | undefined
): boolean {
  if (!exclusion || !Object.keys(exclusion).length) return true
  const counts = new Map<string, number>()
  for (const { setKey } of arts)
    counts.set(setKey, (counts.get(setKey) ?? 0) + 1)
  for (const [setKey, n] of counts)
    if (!allowedCounts(exclusion[setKey as keyof ArtSetExclusion]).includes(n))
      return false
  const singles = [...counts.values()].filter((n) => n === 1).length
  return allowedCounts(exclusion.rainbow).includes(singles)
}

/**
 * The artifacts a member may use: the team's settings and the member's own optimizer filters
 * (main stats, excluded artifacts), without the ones `taken` by other members.
 */
export function teamOptPool(
  arts: readonly ICachedArtifact[],
  member: TeamOptMember,
  optConfig: OptConfig,
  teamOpt: TeamOpt,
  teamLocations: ReadonlySet<string>,
  taken: ReadonlySet<string>
): ICachedArtifact[] {
  return arts.filter((art) => {
    if (taken.has(art.id)) return false
    if (art.level < teamOpt.levelLow || art.level > teamOpt.levelHigh)
      return false
    const mainStats = (
      optConfig.mainStatKeys as Partial<Record<ArtifactSlotKey, string[]>>
    )[art.slotKey]
    if (mainStats?.length && !mainStats.includes(art.mainStatKey)) return false
    if (!teamOpt.useExcludedArts && optConfig.artExclusion.includes(art.id))
      return false
    if (
      art.location &&
      art.location !== member.location &&
      !teamLocations.has(art.location) &&
      !teamOpt.useOtherChars
    )
      return false
    return true
  })
}

const bySlot = (
  database: ArtCharDatabase,
  artifactIds: readonly string[]
): Record<ArtifactSlotKey, string | undefined> =>
  objKeyMap(allArtifactSlotKeys, (slotKey) =>
    artifactIds.find((id) => database.arts.get(id)?.slotKey === slotKey)
  )

/** A better build must beat the current one by more than this (relative) */
const MIN_GAIN = 1e-6
const beatOf = (floor: number) =>
  Number.isFinite(floor)
    ? floor + Math.abs(floor) * MIN_GAIN
    : Number.NEGATIVE_INFINITY

/** The team's builds and weapons, at some point of the search */
interface TeamState {
  builds: TeamOptBuilds
  weaponIds: Partial<Record<CharacterKey, string>>
}
const copyState = ({ builds, weaponIds }: TeamState): TeamState => ({
  builds: Object.fromEntries(
    Object.entries(builds).map(([key, build]) => [key, { ...build }])
  ) as TeamOptBuilds,
  weaponIds: { ...weaponIds },
})

/**
 * Builds for the whole team at once: the rotation's damage (every member's attacks, with every
 * buff the members give each other) is maximized, and no artifact goes to two members.
 *
 * Members are optimized one at a time, the others staying fixed (the biggest damage dealer
 * first), with the team's damage as the target: a support whose set or stats buff the others
 * picks what helps the team most, not what makes its own hits biggest. Rounds repeat until no
 * member's build changes (or `maxRounds`), as a member's best build depends on the others'.
 *
 * Once the members' own steps settle, exchanges between members are tried too (a member's step
 * does not take what a settled member holds): a member re-optimized with the others' pieces, and
 * two members swapping the pieces of a slot or their weapons, kept when the team gains.
 *
 * An energy weapon (`TeamOpt.weaponEnergy`) lowers the whole team's Energy Recharge requirements:
 * when a member's weapon would change another member's requirement, that member is re-optimized
 * with it before the weapon is judged, so the weapon is worth what the team gains (or loses).
 */
/** A 53-bit string hash (cyrb53): fingerprints of formulas and artifact pools */
function hash53(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}
const nodePrints = new WeakMap<OptNode, string>()
/** A formula's fingerprint: equal formulas (same operations, constants and reads) print the same */
function nodePrint(node: OptNode): string {
  let print = nodePrints.get(node)
  if (print) return print
  switch (node.operation) {
    case 'const':
      print = `c${node.value}`
      break
    case 'read':
      print = `r${node.path.join('.')}`
      break
    default:
      print = hash53(
        `${node.operation}(${(node.operands as OptNode[]).map(nodePrint).join(',')})`
      )
  }
  nodePrints.set(node, print)
  return print
}
/**
 * Solves already done: the best build of a problem (its top 1, whatever floor it was searched
 * with), or a value its best is proven to be below (a search that found nothing above a floor).
 * Kept across runs: re-running after a small change, most members' problems are the same.
 */
const solveMemo = new Map<
  string,
  { best?: { value: number; artifactIds: string[] }; below?: number }
>()
const SOLVE_MEMO_SIZE = 400
/** Forgets every solve done (tests; or to measure a run from scratch) */
export function clearTeamOptSolveMemo() {
  solveMemo.clear()
}
/**
 * `input` without its floors (constraints on the objective itself, `objective ≥ x`): what a
 * problem is, whatever it must beat. And the highest of those floors.
 */
function solveKey(input: TeamOptSolveInput): { key: string; floor: number } {
  let floor = Number.NEGATIVE_INFINITY
  const constraints: string[] = []
  for (const { value, min } of input.constraints)
    if (value === input.objective) floor = Math.max(floor, min)
    else constraints.push(`${nodePrint(value)}>=${min}`)
  const arts = input.arts
    .map((a) =>
      [
        a.id,
        a.setKey,
        a.slotKey,
        a.rarity,
        a.level,
        a.mainStatKey,
        ...a.substats.map((sub) => `${sub.key}:${sub.value}`),
      ].join('|')
    )
    .sort()
    .join(';')
  const key = [
    input.characterKey,
    nodePrint(input.objective),
    constraints.sort().join(','),
    hash53(arts),
    JSON.stringify(input.exclusion),
    input.mainStatAssumptionLevel,
  ].join('#')
  return { key, floor }
}

export async function optimizeTeam({
  database,
  teamId,
  gender,
  teamOpt,
  solve: solveRaw,
  onStep,
  isCancelled = () => false,
  maxRounds = 4,
  builds = 1,
}: {
  database: ArtCharDatabase
  teamId: string
  gender: GenderKey
  teamOpt: TeamOpt
  solve: TeamOptSolver
  onStep?: (step: TeamOptStep) => void | Promise<void>
  isCancelled?: () => boolean
  maxRounds?: number
  /** Team builds to find (the best, and `builds` − 1 alternatives) */
  builds?: number
}): Promise<TeamOptResult | undefined> {
  // where a run spends its time (logged in development): compiling problems, solving, evaluating
  const profile = {
    memoHits: 0,
    problemHits: 0,
    /** Builds the solves actually went through */
    tested: 0,
    /** Builds the solves covered (the product of each slot's candidates) */
    space: 0,
    problems: 0,
    problemMs: 0,
    solves: 0,
    solveMs: 0,
    found: 0,
    evals: 0,
    evalMs: 0,
    t0: performance.now(),
  }
  const solve: TeamOptSolver = async (input) => {
    const t0 = performance.now()
    // several builds: not in the memo (it keeps a problem's top 1)
    if ((input.topN ?? 1) > 1) {
      const result = await solveRaw(input)
      profile.solves++
      profile.solveMs += performance.now() - t0
      if (result) profile.found++
      return result
    }
    // the same problem solved before (this run or an earlier one): its answer is known
    const { key, floor } = solveKey(input)
    const known = solveMemo.get(key)
    if (known?.best) {
      profile.memoHits++
      return known.best.value >= floor ? known.best : undefined
    }
    if (known?.below !== undefined && known.below <= floor) {
      profile.memoHits++
      return undefined
    }
    const perSlot = new Map<string, number>()
    for (const art of input.arts)
      perSlot.set(art.slotKey, (perSlot.get(art.slotKey) ?? 0) + 1)
    profile.space += [...perSlot.values()].reduce((a, b) => a * b, 1)
    // the solver picks CPU or GPU itself: measured on Apple Silicon, starting members on the
    // CPU's branch and bound was slower than the GPU's sweep, even where the floor pruned it well
    const result = await solveRaw({
      ...input,
      onWork: ({ tested }) => {
        profile.tested += tested
      },
    })
    profile.solves++
    profile.solveMs += performance.now() - t0
    if (result) profile.found++
    // a build found is the problem's best (floors only cut what is below it)
    const entry = result
      ? { best: result }
      : { ...known, below: Math.min(known?.below ?? floor, floor) }
    solveMemo.delete(key)
    solveMemo.set(key, entry)
    if (solveMemo.size > SOLVE_MEMO_SIZE)
      solveMemo.delete(solveMemo.keys().next().value as string)
    return result
  }
  /**
   * When no build meets the requirements of `input`: the one closest to them. Each requirement in
   * turn is raised as high as it goes (up to what it needs), the ones before it kept where they
   * got; then the team's best build with all of them there. `reached`: how high each one got.
   */
  const closest = async (input: TeamOptSolveInput) => {
    const kept: TeamOptSolveInput['constraints'] = []
    const reached: number[] = []
    for (const { value, min } of input.constraints) {
      if (isCancelled()) throw new TeamOptCancelled()
      const most = await solve({
        ...input,
        objective: value,
        constraints: kept,
      })
      if (!most) return undefined
      reached.push(Math.min(min, most.value))
      // (a hair below: the build that got there must still count as getting there)
      kept.push({
        value,
        min: Math.min(min, most.value - Math.abs(most.value) * MIN_GAIN),
      })
    }
    if (isCancelled()) throw new TeamOptCancelled()
    const result = await solve({ ...input, constraints: kept })
    return result && { ...result, reached }
  }
  /** Whether requirements reached `a` are closer to what they need than `b` (1), as close (0), or not */
  const closer = (a: readonly number[], b: readonly number[]) => {
    for (const [j, value] of a.entries()) {
      const tolerance = Math.abs(b[j]) * MIN_GAIN
      if (value > b[j] + tolerance) return 1
      if (value < b[j] - tolerance) return -1
    }
    return 0
  }
  const members = teamOptMembers(database, teamId)
  const optConfigs = Object.fromEntries(
    members.map((m) => [
      m.characterKey,
      database.optConfigs.get(m.teamChar.optConfigId),
    ])
  ) as Partial<Record<CharacterKey, OptConfig>>
  const statFilters = Object.fromEntries(
    members.map((m) => [
      m.characterKey,
      optConfigs[m.characterKey]?.statFilters ?? {},
    ])
  ) as Partial<Record<CharacterKey, StatFilters>>
  const mainStatAssumptionLevel = teamOpt.assumeMaxMain ? 20 : 0
  const { attacks } = teamOpt
  // the extra buffs (food, an Abyss blessing...) of each member
  const bonusStats = teamOptBonusStats(
    teamOpt,
    members.map((m) => m.characterKey)
  )

  // The starting state: the members' current builds (an artifact in two of them stays with the
  // first) and weapons
  const state: TeamState = { builds: {}, weaponIds: {} }
  const claimed = new Set<string>()
  for (const member of members) {
    if (member.isTc) continue
    state.builds[member.characterKey] = objKeyMap(
      allArtifactSlotKeys,
      (slotKey) => {
        const id = member.artifactIds[slotKey]
        if (!id || claimed.has(id) || !database.arts.get(id)) return undefined
        claimed.add(id)
        return id
      }
    )
    if (database.weapons.get(member.weaponId))
      state.weaponIds[member.characterKey] = member.weaponId
  }
  const artsIn = (s: TeamState, characterKey: CharacterKey) =>
    Object.values(s.builds[characterKey] ?? {})
      .map((id) => id && database.arts.get(id))
      .filter(notEmpty)
  const fixedArtsIn = (s: TeamState, except?: CharacterKey) =>
    Object.fromEntries(
      members
        .filter((m) => !m.isTc && m.characterKey !== except)
        .map((m) => [m.characterKey, artsIn(s, m.characterKey)])
    ) as Partial<Record<CharacterKey, ICachedArtifact[]>>
  /**
   * Every member's weapon in `s`. With `own`, `wielder` gets it instead, and a member holding it
   * gets `wielder`'s (equipping swaps them).
   */
  const weaponsIn = (
    s: TeamState,
    wielder?: CharacterKey,
    own?: ICachedWeapon
  ) => {
    const result: Partial<Record<CharacterKey, ICachedWeapon>> = {}
    for (const m of members) {
      if (m.isTc) continue
      let id = s.weaponIds[m.characterKey]
      if (wielder && own) {
        if (m.characterKey === wielder) id = own.id
        else if (id === own.id) id = s.weaponIds[wielder]
      }
      const weapon = id ? database.weapons.get(id) : undefined
      if (weapon) result[m.characterKey] = weapon
    }
    return result
  }
  const evaluateIn = (s: TeamState) => {
    const t0 = performance.now()
    const result = evaluateInRaw(s)
    profile.evals++
    profile.evalMs += performance.now() - t0
    return result
  }
  const evaluateInRaw = (s: TeamState) => {
    const weapons = weaponsIn(s)
    return evaluateTeamRotation(database, teamId, gender, {
      arts: fixedArtsIn(s),
      attacks,
      mainStatAssumptionLevel,
      statFilters: teamStatFilters(statFilters, weapons, teamOpt),
      weapons,
      onField: teamOpt.onField,
      bonusStats,
    })
  }

  const before = evaluateIn(state)
  if (!before) return undefined
  const start = copyState(state)
  const order = members
    .filter((m) => !m.isTc && !teamOpt.keep.includes(m.characterKey))
    .sort(
      (a, b) =>
        (before.members[b.characterKey] ?? 0) -
        (before.members[a.characterKey] ?? 0)
    )
  const teamLocations = new Set(members.map((m) => m.location as string))
  const allArts = database.arts.values
  const shouldFold = ({ path: [p] }: { path: readonly string[] }) => p !== 'dyn'

  /**
   * A member's problem in `s`, with `weapon` (else its weapon in `s`): the team's damage as a
   * function of its artifacts, its constraints, and the other members whose (fixed) builds do not
   * meet theirs
   */
  // Problems compiled in this run. Within a run nothing outside the team's state changes, and a
  // member's problem depends only on its weapon, the others' builds and everyone's weapons (the
  // energy relief): the same state compiles the same problem, so it is compiled once.
  const problems = new Map<string, ReturnType<typeof problemInRaw>>()
  const problemIn = (
    s: TeamState,
    characterKey: CharacterKey,
    weapon?: ICachedWeapon
  ) => {
    const weapons = weaponsIn(s, characterKey, weapon)
    const key = members
      .map(
        (m) =>
          `${m.characterKey}:${weapons[m.characterKey]?.id ?? ''}:${
            m.characterKey === characterKey
              ? '*'
              : Object.values(s.builds[m.characterKey] ?? {}).join(',')
          }`
      )
      .join('|')
    const id = `${characterKey}>${key}`
    if (problems.has(id)) {
      profile.problemHits++
      return problems.get(id)
    }
    const t0 = performance.now()
    const result = problemInRaw(s, characterKey, weapon)
    profile.problems++
    profile.problemMs += performance.now() - t0
    problems.set(id, result)
    return result
  }
  const problemInRaw = (
    s: TeamState,
    characterKey: CharacterKey,
    weapon?: ICachedWeapon
  ) => {
    const weapons = weaponsIn(s, characterKey, weapon)
    const nodes = teamRotationNodes(database, teamId, gender, {
      dyn: characterKey,
      arts: fixedArtsIn(s, characterKey),
      attacks,
      mainStatAssumptionLevel,
      // the team's energy weapons lower the members' Energy Recharge requirements
      statFilters: teamStatFilters(statFilters, weapons, teamOpt),
      weapons,
      onField: teamOpt.onField,
      bonusStats,
    })
    if (!nodes) return undefined
    const [objective] = optimize(
      [
        nodes.terms.length
          ? sum(...nodes.terms.map((t) => t.node))
          : constant(0),
      ],
      {},
      shouldFold
    )
    // constraints that do not depend on this member are what they are: nothing to optimize
    const constraints = nodes.constraints
      .filter(({ value }) => value.operation !== 'const')
      .map(({ value, min }) => ({ value, min }))
    const unmetOthers = new Set(
      nodes.constraints
        .filter(
          (c) =>
            c.characterKey !== characterKey &&
            c.value.operation === 'const' &&
            !(constValue(c.value) >= c.min)
        )
        .map((c) => c.characterKey)
    )
    return { objective, constraints, unmetOthers }
  }
  type Problem = NonNullable<ReturnType<typeof problemIn>>
  /** A member's build in `s`: its value (the team's damage) and whether it meets its constraints */
  const currentIn = (
    s: TeamState,
    characterKey: CharacterKey,
    { objective, constraints }: Problem
  ) => {
    const arts = artsIn(s, characterKey)
    const [value, ...values] = evaluateNodes(
      [objective, ...constraints.map(({ value }) => value)],
      arts,
      mainStatAssumptionLevel
    )
    return {
      value,
      // (its set rules too: a current build outside them is no floor, whatever it is worth)
      ok:
        constraints.every(({ min }, j) => values[j] >= min) &&
        keepsSetRules(characterKey, arts),
    }
  }
  /** Whether `arts` keep to `characterKey`'s set rules */
  const keepsSetRules = (
    characterKey: CharacterKey,
    arts: readonly ICachedArtifact[]
  ) => meetsSetRules(arts, optConfigs[characterKey]?.artSetExclusion)
  /**
   * Whether `after` breaks an optimized member's set rules that `before` kept (a piece swapped
   * away, or in)
   */
  const breaksSetRules = (before: TeamState, after: TeamState) =>
    order.some(
      ({ characterKey }) =>
        !keepsSetRules(characterKey, artsIn(after, characterKey)) &&
        keepsSetRules(characterKey, artsIn(before, characterKey))
    )
  /**
   * A member's build in `s`: what it reaches of each of `problem`'s requirements (up to what they
   * need, as `closest` counts it), and its value
   */
  const reachedIn = (
    s: TeamState,
    characterKey: CharacterKey,
    { objective, constraints }: Problem
  ) => {
    const [value, ...values] = evaluateNodes(
      [objective, ...constraints.map(({ value }) => value)],
      artsIn(s, characterKey),
      mainStatAssumptionLevel
    )
    return {
      value,
      reached: constraints.map(({ min }, j) => Math.min(min, values[j])),
    }
  }
  const isFull = (s: TeamState, characterKey: CharacterKey) =>
    allArtifactSlotKeys.every((slotKey) => s.builds[characterKey]?.[slotKey])
  /**
   * Gives `member` a build and/or a weapon in `s`. A piece it takes from another member is
   * swapped, as equipping does: that member gets this one's previous piece of the slot (if it may
   * use it), so that a member whose artifacts barely matter keeps a full build and changes
   * little. The same for the weapon (a member holding it wields the same type).
   */
  const assign = (
    s: TeamState,
    member: TeamOptMember,
    artifactIds: string[] | undefined,
    weaponId?: string
  ) => {
    const { characterKey } = member
    if (artifactIds) {
      const previous: Partial<Record<ArtifactSlotKey, string>> =
        s.builds[characterKey] ?? {}
      const build = bySlot(database, artifactIds)
      s.builds[characterKey] = build
      for (const other of members) {
        const otherBuild = s.builds[other.characterKey]
        if (other.characterKey === characterKey || !otherBuild) continue
        for (const slotKey of allArtifactSlotKeys) {
          const id = otherBuild[slotKey]
          if (!id || build[slotKey] !== id) continue
          const swap =
            previous[slotKey] && database.arts.get(previous[slotKey]!)
          const otherConfig = optConfigs[other.characterKey]
          otherBuild[slotKey] =
            swap &&
            otherConfig &&
            teamOptPool(
              [swap],
              other,
              otherConfig,
              teamOpt,
              teamLocations,
              new Set()
            ).length
              ? swap.id
              : undefined
        }
      }
    }
    const currentWeaponId = s.weaponIds[characterKey] ?? member.weaponId
    if (weaponId && weaponId !== currentWeaponId) {
      for (const other of members)
        if (
          other.characterKey !== characterKey &&
          s.weaponIds[other.characterKey] === weaponId
        )
          s.weaponIds[other.characterKey] = currentWeaponId
      s.weaponIds[characterKey] = weaponId
    }
  }
  /**
   * Re-optimizes `group` in `s` (artifacts only), in the order members are optimized: like in a
   * first round, each one may take pieces from the members after it, and from `takeable`'s
   * (swapped). `undefined` if one of them can no longer meet its requirements (and could before:
   * not in `unmetBefore`).
   */
  const reoptimizeIn = async (
    s: TeamState,
    group: TeamOptMember[],
    takeable: readonly TeamOptMember[],
    unmetBefore: ReadonlySet<CharacterKey>,
    report: (member: TeamOptMember) => void | Promise<void>
  ) => {
    for (const [j, member] of group.entries()) {
      const { characterKey } = member
      const optConfig = optConfigs[characterKey]
      if (!optConfig) continue
      if (isCancelled()) throw new TeamOptCancelled()
      await report(member)
      if (isCancelled()) throw new TeamOptCancelled()
      const problem = problemIn(s, characterKey)
      if (!problem) return undefined
      const current = currentIn(s, characterKey, problem)
      const full = isFull(s, characterKey)
      const beat = beatOf(
        current.ok && full ? current.value : Number.NEGATIVE_INFINITY
      )
      const open = [...takeable, ...group.slice(j + 1)]
      const taken = new Set(
        members
          .filter((m) => m.characterKey !== characterKey && !open.includes(m))
          .flatMap((m) => Object.values(s.builds[m.characterKey] ?? {}))
          .filter(notEmpty)
      )
      const input = {
        characterKey,
        arts: teamOptPool(
          allArts,
          member,
          optConfig,
          teamOpt,
          teamLocations,
          taken
        ),
        objective: problem.objective,
        constraints: Number.isFinite(beat)
          ? [...problem.constraints, { value: problem.objective, min: beat }]
          : problem.constraints,
        exclusion: optConfig.artSetExclusion,
        mainStatAssumptionLevel,
      }
      let result = await solve(input)
      // No build meets its requirements, and what it has does not either (or has an empty slot,
      // a piece went to a member before it): the build closest to them, not a hole
      if (!result && problem.constraints.length && (!full || !current.ok)) {
        if (isCancelled()) throw new TeamOptCancelled()
        result = await closest({ ...input, constraints: problem.constraints })
      }
      if (isCancelled()) throw new TeamOptCancelled()
      if (result && result.value >= beat) assign(s, member, result.artifactIds)
      else if (!current.ok && !unmetBefore.has(characterKey)) return undefined
    }
    return s
  }

  /**
   * A member's problem in `s` (with `weapon`, else its own), compiled: the team's damage and
   * whether the member's constraints are met, for any build of it (the others fixed)
   */
  const compileIn = (
    s: TeamState,
    characterKey: CharacterKey,
    weapon?: ICachedWeapon
  ) => {
    const problem = problemIn(s, characterKey, weapon)
    if (!problem) return undefined
    const compute = precompute(
      [problem.objective, ...problem.constraints.map(({ value }) => value)],
      {},
      (r) => r.path[1],
      allArtifactSlotKeys.length
    )
    return (build: Partial<Record<ArtifactSlotKey, string | undefined>>) => {
      const [value, ...values] = compute(
        allArtifactSlotKeys.map((slotKey) => {
          const id = build[slotKey]
          const art = id ? database.arts.get(id) : undefined
          return {
            values: art ? teamOptArtValues(art, mainStatAssumptionLevel) : {},
          }
        }) as never
      )
      return {
        value,
        ok: problem.constraints.every(({ min }, j) => values[j] >= min),
      }
    }
  }
  /**
   * Whether `after` leaves a requirement further from what it needs than `before`: one that was met
   * is not, or one that was not (no build of its member meets it: it has the closest) drops further
   */
  const worsened = (before: TeamOptEvaluation, after: TeamOptEvaluation) =>
    members.some(({ characterKey }) => {
      const unmetAfter = after.unmet[characterKey] ?? []
      const unmetBefore = before.unmet[characterKey] ?? []
      return unmetAfter.some((index, j) => {
        const at = unmetBefore.indexOf(index)
        if (at < 0) return true
        const was = before.shortfalls?.[characterKey]?.[at]
        const now = after.shortfalls?.[characterKey]?.[j]
        return (
          !!was &&
          !!now &&
          now.min - now.value >
            was.min - was.value + Math.abs(was.min) * MIN_GAIN
        )
      })
    })
  const mayUse = (member: TeamOptMember, art: ICachedArtifact) => {
    const optConfig = optConfigs[member.characterKey]
    return (
      !!optConfig &&
      !!teamOptPool([art], member, optConfig, teamOpt, teamLocations, new Set())
        .length
    )
  }
  /** The optimized members whose build in `s` breaks their set rules */
  const outsideSetRules = (s: TeamState) =>
    order.filter(
      ({ characterKey }) =>
        !keepsSetRules(characterKey, artsIn(s, characterKey))
    )
  /**
   * Set rules come before damage. A member left outside its set rules (no build of the free pieces
   * keeps to them, say another member holds the only pieces of its set) takes, among everything but
   * the kept members' pieces, its best build that keeps to them; the others get its previous pieces,
   * as equipping does, and settle again in the next round. A repair stands when no other member's
   * set rules break, so each one leaves fewer members outside them.
   */
  const repairIn = async (s: TeamState, round: number) => {
    let repaired = false
    const kept = new Set<string>(
      members
        .filter((m) => !order.includes(m))
        .flatMap((m) => Object.values(s.builds[m.characterKey] ?? {}))
        .filter(notEmpty)
    )
    for (const [i, member] of order.entries()) {
      const { characterKey } = member
      const optConfig = optConfigs[characterKey]
      if (!optConfig || keepsSetRules(characterKey, artsIn(s, characterKey)))
        continue
      if (isCancelled()) throw new TeamOptCancelled()
      await onStep?.({
        round,
        maxRounds,
        step: i + 1,
        steps: order.length,
        characterKey,
        exchange: true,
      })
      if (isCancelled()) throw new TeamOptCancelled()
      const problem = problemIn(s, characterKey)
      if (!problem) continue
      const input = {
        characterKey,
        arts: teamOptPool(
          allArts,
          member,
          optConfig,
          teamOpt,
          teamLocations,
          kept
        ),
        objective: problem.objective,
        constraints: problem.constraints,
        exclusion: optConfig.artSetExclusion,
        mainStatAssumptionLevel,
      }
      // its requirements too if a build meets them, else its set rules alone (the next round gives
      // it the closest build to them that keeps to the rules)
      const result =
        (await solve(input)) ?? (await solve({ ...input, constraints: [] }))
      if (isCancelled()) throw new TeamOptCancelled()
      if (!result) continue
      const next = copyState(s)
      assign(next, member, result.artifactIds)
      if (breaksSetRules(s, next)) continue
      if (outsideSetRules(next).length >= outsideSetRules(s).length) continue
      s.builds = next.builds
      s.weaponIds = next.weaponIds
      repaired = true
    }
    return repaired
  }
  /**
   * Exchanges a member's own step cannot make, as it does not take what a settled member holds:
   * a member re-optimized with the others' pieces too (they get its previous ones, as equipping
   * does), then two members swapping the pieces (or weapons) of a slot. Each is kept only if the
   * team's damage grows, and no requirement that was met is broken.
   */
  const exchangeIn = async (s: TeamState, round: number) => {
    let current = evaluateIn(s)
    if (!current) return false
    let improved = false
    const accept = (next: TeamState) => {
      const evaluation = evaluateIn(next)
      if (
        !evaluation ||
        !(evaluation.total >= beatOf(current!.total)) ||
        worsened(current!, evaluation) ||
        breaksSetRules(s, next)
      )
        return false
      s.builds = next.builds
      s.weaponIds = next.weaponIds
      current = evaluation
      improved = true
      return true
    }
    // Takes: a member's best build among everything but the kept members' pieces
    const kept = new Set<string>(
      members
        .filter((m) => !order.includes(m))
        .flatMap((m) => Object.values(s.builds[m.characterKey] ?? {}))
        .filter(notEmpty)
    )
    for (const [i, member] of order.entries()) {
      const { characterKey } = member
      const optConfig = optConfigs[characterKey]
      if (!optConfig || !isFull(s, characterKey)) continue
      if (isCancelled()) throw new TeamOptCancelled()
      await onStep?.({
        round,
        maxRounds,
        step: i + 1,
        steps: order.length,
        characterKey,
        exchange: true,
      })
      if (isCancelled()) throw new TeamOptCancelled()
      const problem = problemIn(s, characterKey)
      if (!problem) continue
      const own = currentIn(s, characterKey, problem)
      if (!own.ok) continue
      const others = new Set<string>(
        order
          .filter((m) => m !== member)
          .flatMap((m) => Object.values(s.builds[m.characterKey] ?? {}))
          .filter(notEmpty)
      )
      const result = await solve({
        characterKey,
        arts: teamOptPool(
          allArts,
          member,
          optConfig,
          teamOpt,
          teamLocations,
          kept
        ),
        objective: problem.objective,
        constraints: [
          ...problem.constraints,
          { value: problem.objective, min: beatOf(own.value) },
        ],
        exclusion: optConfig.artSetExclusion,
        mainStatAssumptionLevel,
      })
      if (isCancelled()) throw new TeamOptCancelled()
      // (a build of free pieces only: its own step would have found it)
      if (!result?.artifactIds.some((id) => others.has(id))) continue
      const next = copyState(s)
      assign(next, member, result.artifactIds)
      accept(next)
    }
    // Swaps: two members trade the pieces of a slot, or their weapons
    for (let pass = 0; pass < 3; pass++) {
      let swapped = false
      const fns = new Map(
        order.map((m) => [m.characterKey, compileIn(s, m.characterKey)])
      )
      const gain = (
        member: TeamOptMember,
        slotKey: ArtifactSlotKey,
        id: string
      ) => {
        const fn = fns.get(member.characterKey)
        const build = s.builds[member.characterKey]
        if (!fn || !build) return Number.NEGATIVE_INFINITY
        const now = fn(build)
        const then = fn({ ...build, [slotKey]: id })
        return now.ok && !then.ok
          ? Number.NEGATIVE_INFINITY
          : then.value - now.value
      }
      for (const slotKey of allArtifactSlotKeys)
        for (const [i, a] of order.entries())
          for (const b of order.slice(i + 1)) {
            const idA = s.builds[a.characterKey]?.[slotKey]
            const idB = s.builds[b.characterKey]?.[slotKey]
            if (!idA || !idB || idA === idB) continue
            const artA = database.arts.get(idA)
            const artB = database.arts.get(idB)
            if (!artA || !artB || !mayUse(a, artB) || !mayUse(b, artA)) continue
            // estimated with each member's compiled problem, then checked with the whole team
            if (!(gain(a, slotKey, idB) + gain(b, slotKey, idA) > 0)) continue
            const next = copyState(s)
            next.builds[a.characterKey]![slotKey] = idB
            next.builds[b.characterKey]![slotKey] = idA
            if (accept(next)) {
              swapped = true
              fns.set(a.characterKey, compileIn(s, a.characterKey))
              fns.set(b.characterKey, compileIn(s, b.characterKey))
            }
          }
      if (teamOpt.optimizeWeapons) {
        const excluded = new Set(teamOpt.excludedWeapons)
        for (const [i, a] of order.entries())
          for (const b of order.slice(i + 1)) {
            const weaponA = database.weapons.get(
              s.weaponIds[a.characterKey] ?? ''
            )
            const weaponB = database.weapons.get(
              s.weaponIds[b.characterKey] ?? ''
            )
            if (!weaponA || !weaponB || weaponA.id === weaponB.id) continue
            if (excluded.has(weaponA.id) || excluded.has(weaponB.id)) continue
            if (
              !canWield(a.characterKey, weaponB) ||
              !canWield(b.characterKey, weaponA)
            )
              continue
            const buildA = s.builds[a.characterKey] ?? {}
            const buildB = s.builds[b.characterKey] ?? {}
            const nowA = fns.get(a.characterKey)?.(buildA)
            const nowB = fns.get(b.characterKey)?.(buildB)
            const thenA = compileIn(s, a.characterKey, weaponB)?.(buildA)
            const thenB = compileIn(s, b.characterKey, weaponA)?.(buildB)
            if (!nowA || !nowB || !thenA || !thenB) continue
            if (thenA.value - nowA.value + (thenB.value - nowB.value) <= 0)
              continue
            const next = copyState(s)
            next.weaponIds[a.characterKey] = weaponB.id
            next.weaponIds[b.characterKey] = weaponA.id
            if (accept(next)) {
              swapped = true
              fns.set(a.characterKey, compileIn(s, a.characterKey))
              fns.set(b.characterKey, compileIn(s, b.characterKey))
            }
          }
      }
      if (!swapped) break
    }
    return improved
  }

  let rounds = 0
  let exchanges = 0
  /**
   * In the first round, the members not optimized yet hold their builds and weapons only
   * provisionally (`provisional`): the bigger damage dealers before them may take any of those.
   * Without it, every member keeps what it has until its turn, and each step only adds damage.
   */
  let provisional = true
  const runRounds = async () => {
    for (let round = 1; round <= maxRounds && order.length; round++) {
      rounds = round
      let changed = false
      for (const [i, member] of order.entries()) {
        const { characterKey } = member
        const step: TeamOptStep = {
          round,
          maxRounds,
          step: i + 1,
          steps: order.length,
          characterKey,
        }
        if (isCancelled()) throw new TeamOptCancelled()
        // (the caller may let the page show the step before the work starts)
        await onStep?.(step)
        if (isCancelled()) throw new TeamOptCancelled()
        const optConfig = optConfigs[characterKey]
        if (!optConfig) continue
        // In the first round, the members not optimized yet only hold their current builds (and
        // weapons) provisionally: the bigger damage dealers before them may take any of those
        // (they are optimized right after, with what is left). Afterwards, everything is kept
        // until its member's turn.
        const settled = members.filter(
          (m) =>
            m.characterKey !== characterKey &&
            (round > 1 || !provisional || !order.slice(i).includes(m))
        )
        const taken = new Set(
          settled
            .flatMap((m) => Object.values(state.builds[m.characterKey] ?? {}))
            .filter(notEmpty)
        )
        const arts = teamOptPool(
          allArts,
          member,
          optConfig,
          teamOpt,
          teamLocations,
          taken
        )
        const currentWeaponId = state.weaponIds[characterKey] ?? member.weaponId
        const currentWeapon = database.weapons.get(currentWeaponId)
        const weaponChoices = teamOpt.optimizeWeapons
          ? teamOptWeaponCandidates(
              database,
              member,
              currentWeaponId,
              teamOpt,
              teamLocations,
              new Set(
                settled
                  .map((m) => state.weaponIds[m.characterKey])
                  .filter(notEmpty)
              )
            )
          : []
        if (!weaponChoices.length && currentWeapon)
          weaponChoices.push(currentWeapon)
        // A build with an empty slot (a piece went to a member optimized before) takes any full one
        const full = isFull(state, characterKey)
        // what the team's energy weapons lower each member's Energy Recharge requirement by, now
        const relief = teamEnergyRelief(weaponsIn(state), teamOpt)
        let unmetNow: ReadonlySet<CharacterKey> | undefined
        const unmetBefore = () =>
          (unmetNow ??= new Set(
            Object.entries(evaluateIn(state)?.unmet ?? {})
              .filter(([, unmet]) => unmet?.length)
              .map(([key]) => key as CharacterKey)
          ))
        /** What a new build must beat: the current one, then the best found so far */
        let floor = Number.NEGATIVE_INFINITY
        /** The weapons with which no build meets the member's requirements (their solves) */
        const unreachable: {
          weapon: ICachedWeapon
          input: TeamOptSolveInput
        }[] = []
        let best:
          | {
              value: number
              artifactIds?: string[]
              weaponId: string
              /** The team once the members its energy weapon affects are re-optimized */
              next?: TeamState
            }
          | undefined
        // Every candidate weapon's problem, compiled once (cheap next to a solve), and what the
        // member's current build is worth with it, when that team is one it can have as it is (its
        // own and the others' requirements met). The best of those is a floor for every weapon's
        // solve, so each solve only looks above the best team known; a weapon change alone is a
        // result too. The strongest weapons go first; on a tie the current one stays.
        const candidates = weaponChoices.map((weapon) => {
          const problem = problemIn(state, characterKey, weapon)
          let current: number | undefined
          if (problem && full) {
            const own = currentIn(state, characterKey, problem)
            if (
              own.ok &&
              ![...problem.unmetOthers].some((key) => !unmetBefore().has(key))
            )
              current = own.value
          }
          return { weapon, problem, current }
        })
        const currentOf = (c: (typeof candidates)[number]) =>
          c.current ?? Number.NEGATIVE_INFINITY
        candidates.sort(
          (a, b) =>
            currentOf(b) - currentOf(a) ||
            Number(b.weapon.id === currentWeaponId) -
              Number(a.weapon.id === currentWeaponId)
        )
        const ownValue = candidates.find(
          (c) => c.weapon.id === currentWeaponId
        )?.current
        const top = candidates[0]
        if (top?.current !== undefined) {
          floor = top.current
          // another weapon with the same build: worth it only for a real gain over keeping its own
          if (
            top.weapon.id !== currentWeaponId &&
            (ownValue === undefined || top.current >= beatOf(ownValue))
          )
            best = { value: top.current, weaponId: top.weapon.id }
        }
        for (const [w, { weapon, problem }] of candidates.entries()) {
          if (isCancelled()) throw new TeamOptCancelled()
          const weaponStep: TeamOptStep =
            weaponChoices.length > 1
              ? { ...step, weapon: w + 1, weapons: weaponChoices.length }
              : step
          if (weaponChoices.length > 1 && w) await onStep?.(weaponStep)
          if (!problem) continue
          const { objective, constraints } = problem
          // only a build that beats the floor is of interest: it also prunes the search
          const beat = beatOf(floor)
          // The other members whose Energy Recharge requirement this weapon changes (it is an
          // energy weapon, or it replaces one)
          const reliefWith = teamEnergyRelief(
            weaponsIn(state, characterKey, weapon),
            teamOpt
          )
          const changes = members.filter(
            (m) =>
              !m.isTc &&
              m.characterKey !== characterKey &&
              (reliefWith[m.characterKey] ?? 0) !==
                (relief[m.characterKey] ?? 0) &&
              hasEnergyRequirement(statFilters[m.characterKey])
          )
          // a kept member's build stays as it is: the weapon must not break its requirement
          if (
            changes.some(
              (m) =>
                !order.includes(m) &&
                problem.unmetOthers.has(m.characterKey) &&
                !unmetBefore().has(m.characterKey)
            )
          )
            continue
          const affected = order.filter((m) => changes.includes(m))
          // a weapon that leaves another member's requirement unmet (one it met) is not one, unless
          // that member is re-optimized with it below (the energy it gives changes the requirement)
          if (
            [...problem.unmetOthers].some(
              (key) =>
                !unmetBefore().has(key) &&
                !affected.some((m) => m.characterKey === key)
            )
          )
            continue
          const input = {
            characterKey,
            arts,
            objective,
            constraints: Number.isFinite(beat)
              ? [...constraints, { value: objective, min: beat }]
              : constraints,
            exclusion: optConfig.artSetExclusion,
            mainStatAssumptionLevel,
          }
          if (affected.length) {
            // What the weapon is worth to the team is known once the members whose requirement it
            // changes are re-optimized with it, along with this one (in order, each taking what it
            // needs first). When they only lose, this member must first beat the floor on its own.
            const gains = affected.some(
              (m) =>
                (reliefWith[m.characterKey] ?? 0) >
                (relief[m.characterKey] ?? 0)
            )
            if (!gains && Number.isFinite(beat) && !(await solve(input)))
              continue
            if (isCancelled()) throw new TeamOptCancelled()
            const next = copyState(state)
            assign(next, member, undefined, weapon.id)
            const reoptimized = await reoptimizeIn(
              next,
              order.filter((m) => m === member || affected.includes(m)),
              round === 1 && provisional
                ? order.slice(i + 1).filter((m) => !affected.includes(m))
                : [],
              unmetBefore(),
              (other) =>
                onStep?.(
                  other === member
                    ? weaponStep
                    : { ...weaponStep, energyFor: other.characterKey }
                )
            )
            const evaluation = reoptimized && evaluateIn(reoptimized)
            if (
              evaluation &&
              evaluation.total >= beat &&
              !members.some(
                (m) =>
                  evaluation.unmet[m.characterKey]?.length &&
                  !unmetBefore().has(m.characterKey)
              )
            ) {
              best = { value: evaluation.total, weaponId: weapon.id, next }
              floor = Math.max(floor, evaluation.total)
            }
            continue
          }
          const result = await solve(input)
          if (isCancelled()) throw new TeamOptCancelled()
          if (result && result.value >= beat) {
            best = { ...result, weaponId: weapon.id }
            floor = Math.max(floor, result.value)
          }
          if (!result && constraints.length) unreachable.push({ weapon, input })
        }
        // No build meets its requirements, whatever the weapon, and what it has does not either (or
        // has an empty slot: a piece went to a member before it). It gets the build and weapon
        // closest to them, then the team's best with that (the result tells how far it is), rather
        // than what it held: a weapon kept for no reason, or a hole.
        if (!best && !Number.isFinite(floor)) {
          let closestFound:
            | {
                value: number
                artifactIds: string[]
                weaponId: string
                reached: number[]
              }
            | undefined
          for (const { weapon, input } of unreachable) {
            const found = await closest(input)
            if (!found) continue
            const order = closestFound
              ? closer(found.reached, closestFound.reached)
              : 1
            if (
              order > 0 ||
              (order === 0 &&
                !!closestFound &&
                found.value >= beatOf(closestFound.value))
            )
              closestFound = {
                value: found.value,
                artifactIds: found.artifactIds,
                weaponId: weapon.id,
                reached: found.reached,
              }
          }
          // what it has (whole, with its weapon still free) is as close and worth as much: it stays,
          // the step changes nothing
          const own = full
            ? candidates.find((c) => c.weapon.id === currentWeaponId)?.problem
            : undefined
          const ownNow = own && reachedIn(state, characterKey, own)
          const keepsOwn =
            !!ownNow &&
            !!closestFound &&
            keepsSetRules(characterKey, artsIn(state, characterKey)) &&
            closer(ownNow.reached, closestFound.reached) >= 0 &&
            ownNow.value >=
              closestFound.value - Math.abs(closestFound.value) * MIN_GAIN
          if (closestFound && !keepsOwn) best = closestFound
        }
        if (best) {
          if (best.next) {
            state.builds = best.next.builds
            state.weaponIds = best.next.weaponIds
          } else assign(state, member, best.artifactIds, best.weaponId)
          changed = true
        }
      }
      // a member left outside its set rules takes the pieces it needs from the others
      if (order.length > 1 && (await repairIn(state, round))) changed = true
      // once the members' own steps settle: the exchanges between members (twice at most)
      if (!changed && exchanges < 2 && order.length > 1) {
        exchanges++
        changed = await exchangeIn(state, round)
      }
      if (!changed) break
    }
  }
  await runRounds()
  // The provisional takes can leave the team below where it started: a bigger damage dealer's
  // step counts the later members' builds as they were, and those then lose what it took (say
  // its weapon, which another member keeps once settled). The result is never worse than the
  // members' own builds (when those keep every requirement and set rule): run again from them
  // without provisional takes (each step then only adds), else keep them as they are.
  const notBelowStart = () => {
    const now = evaluateIn(state)
    return (
      !now ||
      now.total >= before.total - Math.abs(before.total) * MIN_GAIN ||
      worsened(now, before) ||
      breaksSetRules(state, start)
    )
  }
  // A weapon left out in the weapon chooser (not ticked) is one a member only keeps when none of
  // the ticked ones is free for it: the members' own builds are no result to fall back on when one
  // of them holds such a weapon and the run found it a ticked one.
  const leftOut = new Set(
    teamOpt.optimizeWeapons ? teamOpt.excludedWeapons : []
  )
  const weaponOf = (s: TeamState, member: TeamOptMember) =>
    s.weaponIds[member.characterKey] ?? member.weaponId
  /** The members whose weapon in `s` is not ticked while `than` gives them a ticked one */
  const untickedAgainst = (s: TeamState, than: TeamState) =>
    order
      .filter(
        (m) => leftOut.has(weaponOf(s, m)) && !leftOut.has(weaponOf(than, m))
      )
      .map((m) => m.characterKey)
  if (!notBelowStart()) {
    const first = copyState(state)
    const firstTotal = evaluateIn(state)?.total ?? Number.NEGATIVE_INFINITY
    state.builds = copyState(start).builds
    state.weaponIds = { ...start.weaponIds }
    provisional = false
    exchanges = 0
    await runRounds()
    const again = evaluateIn(state)
    // (the first run, if the second did no better)
    if (!again || again.total < firstTotal) {
      state.builds = first.builds
      state.weaponIds = first.weaponIds
    }
    if (!notBelowStart() && !untickedAgainst(start, state).length) {
      state.builds = copyState(start).builds
      state.weaponIds = { ...start.weaponIds }
    }
  }
  const after = evaluateIn(state)
  if (!after) return undefined

  // The next best team builds: each optimized member's next best builds (the others as they are,
  // their pieces out of reach), by the team's damage. One member changes at a time; one that
  // would leave another member's requirements unmet is passed over.
  const alternatives: TeamOptAlternative[] = []
  if (builds > 1) {
    const candidates: {
      member: TeamOptMember
      value: number
      artifactIds: string[]
    }[] = []
    const idsOf = (build: TeamOptBuilds[CharacterKey]) =>
      Object.values(build ?? {})
        .filter(notEmpty)
        .sort()
        .join()
    for (const [i, member] of order.entries()) {
      const { characterKey } = member
      const optConfig = optConfigs[characterKey]
      if (!optConfig) continue
      if (isCancelled()) throw new TeamOptCancelled()
      await onStep?.({
        round: rounds,
        maxRounds,
        step: i + 1,
        steps: order.length,
        characterKey,
        alternatives: true,
      })
      if (isCancelled()) throw new TeamOptCancelled()
      const problem = problemIn(state, characterKey)
      if (!problem) continue
      const taken = new Set(
        members
          .filter((m) => m.characterKey !== characterKey)
          .flatMap((m) => Object.values(state.builds[m.characterKey] ?? {}))
          .filter(notEmpty)
      )
      const result = await solve({
        characterKey,
        arts: teamOptPool(
          allArts,
          member,
          optConfig,
          teamOpt,
          teamLocations,
          taken
        ),
        objective: problem.objective,
        constraints: problem.constraints,
        exclusion: optConfig.artSetExclusion,
        mainStatAssumptionLevel,
        topN: builds,
      })
      if (isCancelled()) throw new TeamOptCancelled()
      const current = idsOf(state.builds[characterKey])
      for (const found of result ? [result, ...(result.more ?? [])] : [])
        if ([...found.artifactIds].sort().join() !== current)
          candidates.push({ member, ...found })
    }
    candidates.sort((a, b) => b.value - a.value)
    const seen = new Set<string>()
    for (const { member, artifactIds } of candidates) {
      if (alternatives.length >= builds - 1) break
      const next = copyState(state)
      assign(next, member, artifactIds)
      const key = JSON.stringify(next.builds)
      if (seen.has(key)) continue
      seen.add(key)
      const evaluation = evaluateIn(next)
      if (
        !evaluation ||
        worsened(after, evaluation) ||
        breaksSetRules(state, next)
      )
        continue
      alternatives.push({
        builds: next.builds,
        after: evaluation,
        changed: member.characterKey,
      })
    }
    alternatives.sort((a, b) => b.after.total - a.after.total)
  }
  if (process.env['NODE_ENV'] === 'development')
    console.log('[TeamOpt] profile', {
      ...profile,
      totalMs: Math.round(performance.now() - profile.t0),
      problemMs: Math.round(profile.problemMs),
      solveMs: Math.round(profile.solveMs),
      evalMs: Math.round(profile.evalMs),
      rounds,
    })
  const teamWeaponIds = [
    ...new Set(Object.values(weaponsIn(state)).map((weapon) => weapon!.id)),
  ]
  const energy: NonNullable<TeamOptResult['energy']> = {}
  for (const { characterKey, isTc } of members) {
    if (isTc || !hasEnergyRequirement(statFilters[characterKey])) continue
    const weaponIds = teamWeaponIds.filter(
      (id) => (teamOpt.weaponEnergy[id]?.[characterKey] ?? 0) > 0
    )
    const relief = weaponIds.reduce(
      (total, id) => total + (teamOpt.weaponEnergy[id]?.[characterKey] ?? 0),
      0
    )
    if (relief > 0) energy[characterKey] = { relief, weaponIds }
  }
  const untickedWeapons = teamOptUntickedWeapons(
    order,
    state.weaponIds,
    teamOpt
  )
  // no team build keeps every member's set rules: no result (a partial one would break them)
  const setRulesUnmet = outsideSetRules(state).map((m) => m.characterKey)
  if (setRulesUnmet.length) throw new TeamOptSetRulesUnmet(setRulesUnmet)
  const startBreaksSetRules = order
    .filter(({ characterKey }) => isFull(start, characterKey))
    .filter(
      ({ characterKey }) =>
        !keepsSetRules(characterKey, artsIn(start, characterKey))
    )
    .map((m) => m.characterKey)
  const startUntickedWeapons = untickedAgainst(start, state)
  return {
    builds: state.builds,
    weapons: { ...state.weaponIds },
    before,
    after,
    rounds,
    optimized: order.map((m) => m.characterKey),
    energy,
    ...(untickedWeapons.length ? { untickedWeapons } : {}),
    ...(startBreaksSetRules.length ? { startBreaksSetRules } : {}),
    ...(startUntickedWeapons.length ? { startUntickedWeapons } : {}),
    ...(alternatives.length ? { alternatives } : {}),
  }
}
