import type {
  ArtifactSetKey,
  CharacterKey,
  ElementKey,
  GenderKey,
  MainStatKey,
  SubstatKey,
  WeaponKey,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSetKeys,
  allMainStatKeys,
  allSubstatKeys,
  allWeaponKeys,
} from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  ArtSetExclusion,
  ICachedWeapon,
  OptConfig,
  StatFilters,
  TeamOpt,
  TeamOptAttack,
  TeamOptKqm,
} from '@genshin-optimizer/gi/db'
import { defaultTeamOptKqm } from '@genshin-optimizer/gi/db'
import type { IConditionalValues } from '@genshin-optimizer/gi/sheets'
import type {
  KqmMains,
  KqmMainValues,
  KqmProblem,
  KqmProblemSpec,
  KqmRolls,
  KqmScore,
  KqmSetSearch,
  KqmSets,
  KqmSetTask,
} from '@genshin-optimizer/gi/solver'
import {
  betterScore,
  cappedRolls,
  compareScores,
  DEFICIT_TOL,
  KQM_FIXED_ROLLS,
  KQM_ROLLS,
  KQM_SUBSTAT_ROLLS,
  KqmSearchCancelled,
  kqmProblem,
  kqmRollCaps,
  kqmStatValues,
  queueKqmSetTasks,
  releaseKqmWorkers,
  scoreOf,
  yieldTask,
} from '@genshin-optimizer/gi/solver'
import {
  getArtSetStat,
  getCharEle,
  getCharStat,
  getCharWeaponType,
  getWeaponStat,
} from '@genshin-optimizer/gi/stats'
import { getMainStatValue } from '@genshin-optimizer/gi/util'
import type { Data } from '@genshin-optimizer/gi/wr'
import { constant, percent } from '@genshin-optimizer/gi/wr'
import type { TeamDataOverrides, TeamOptMember } from './data'
import { teamOptBonusStats, teamOptMembers } from './data'
import { calculateEnergyRecharge, syncEnergyCalculator } from './energyCalc'
import type { ItemConditionalCtx } from './itemConditionals'
import { itemConditionals } from './itemConditionals'
import type { KqmBuiltProblem } from './kqmBuild'
import { buildKqmProblem } from './kqmBuild'
import {
  KQM_ONE_COPY,
  KQM_THREE_STARS,
  kqmWeaponSource,
} from './kqmWeaponSources'
import { constValue, teamRotationNodes } from './objective'
import type { SimGear } from './rotation/types'
import type { TeamOptEvaluation } from './solve'
import { allowedCounts, evaluateTeamRotation, TeamOptCancelled } from './solve'
import { withEnergyRelief } from './weapons'

/*
 * KQM mode: every optimized member gets KQM Standards artifacts instead of the inventory's, and
 * any weapon of its type (at the refinement set for its rarity), all chosen for the team's
 * rotation damage. KQM Standards (KQMS): five 5★ artifacts at +20 (HP flower, ATK plume), 2
 * rolls of every substat (average roll value), and 20 more rolls placed freely, at most 2 per
 * piece whose main stat is not that stat (10 for a stat no main stat has).
 */

export type { KqmMains, KqmRolls, KqmSets } from '@genshin-optimizer/gi/solver'
export {
  KQM_FIXED_ROLLS,
  KQM_ROLLS,
  KQM_SUBSTAT_ROLLS,
  kqmRollCaps,
} from '@genshin-optimizer/gi/solver'

/** The KQM standard constellation (4★ C6, 5★ C0), independent of the saved character. */
export const kqmConstellation = (key: CharacterKey): 0 | 6 =>
  getCharStat(key).rarity === 4 ? 6 : 0
/** The constellation a KQM build uses: the team's own choice, else the KQM standard */
export const kqmMemberConstellation = (
  key: CharacterKey,
  kqm: Pick<TeamOptKqm, 'constellations'> | undefined
): number => kqm?.constellations?.[key] ?? kqmConstellation(key)

/** The members' talent levels: as set, else 9/9/9 (KQM's guides; 10 is the other choice) */
export const KQM_TALENT_DEFAULT = 9
export const kqmTalentLevel = (
  kqm: Pick<TeamOptKqm, 'talents'> | undefined
): 9 | 10 => kqm?.talents ?? KQM_TALENT_DEFAULT

/** A valid total ER target: finite and at least 100%. */
export const kqmHasEnergyRequirement = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 100

/** A member's total ER target until one is set in KQM Setup: 100%, i.e. no requirement */
export const KQM_ER_DEFAULT = 100
/** A member's total ER target: the one set in KQM Setup, else `KQM_ER_DEFAULT` */
export const kqmEnergyRequirement = (
  kqm: Pick<TeamOptKqm, 'energyRecharge'> | undefined,
  characterKey: CharacterKey
): number => {
  const value = kqm?.energyRecharge?.[characterKey]
  return kqmHasEnergyRequirement(value) ? value : KQM_ER_DEFAULT
}

export const kqmSandsKeys = [
  'atk_',
  'hp_',
  'def_',
  'eleMas',
  'enerRech_',
] as const satisfies readonly MainStatKey[]
export const kqmCircletKeys = [
  'critRate_',
  'critDMG_',
  'atk_',
  'hp_',
  'def_',
  'eleMas',
  'heal_',
] as const satisfies readonly MainStatKey[]
const gobletBaseKeys = [
  'atk_',
  'hp_',
  'def_',
  'eleMas',
  'physical_dmg_',
] as const satisfies readonly MainStatKey[]
export const kqmGobletKeys = (element: ElementKey): MainStatKey[] => [
  `${element}_dmg_` as MainStatKey,
  ...gobletBaseKeys,
]

export interface KqmWeapon {
  key: WeaponKey
  refinement: number
}
export interface KqmBuild {
  weapon: KqmWeapon
  sets: KqmSets
  mains: KqmMains
  rolls: KqmRolls
}
/** Another build for one member (the others at their best), and the team's damage with it */
export interface KqmCatchUp {
  status: 'matched' | 'tied' | 'limit'
  /** Extra average rolls beyond the standard 20-roll budget; the original build is unchanged. */
  rolls: KqmRolls
  count: number
  total: number
  target: number
}
export interface KqmOption extends KqmBuild {
  total: number
  /** Its requirements are not met */
  unmet: boolean
  /** Estimated extra rolls to match the preceding feasible option in this ranking. */
  catchUp?: KqmCatchUp
  /** The requirements it misses: their stat's path, what it reaches, what it needs */
  shortfalls?: { path: string[]; value: number; min: number }[]
}
export interface KqmRanking {
  /** The best build with each set (or 2+2), the weapon the best one's */
  sets: KqmOption[]
  /** The best build with each weapon, the sets the best one's */
  weapons: KqmOption[]
}
export interface KqmResult {
  builds: Partial<Record<CharacterKey, KqmBuild>>
  /** Snapshot of the constellations actually used, including kept members. */
  constellations: Partial<Record<CharacterKey, number>>
  /** Total ER percentages: user target, minimum after weapon energy adjustments, and actual. */
  energyRecharge: Partial<
    Record<CharacterKey, { target: number; minimum: number; value: number }>
  >
  /** The team with the builds (kept members: their own) */
  after: TeamOptEvaluation
  rankings: Partial<Record<CharacterKey, KqmRanking>>
  /**
   * Per member: the weapon and set effects counted as on by rule (`itemConditionals`) because
   * the user never set them, for the member's weapon and sets
   */
  assumed: Partial<Record<CharacterKey, { path: string[]; value: string }[]>>
  optimized: CharacterKey[]
  rounds: number
  /**
   * The written rotation as it was played for these builds (`KqmRunArgs.replay`); absent: the
   * team's attacks were used as they are (nothing written)
   */
  played?: KqmPlayed
}
/** The written rotation played for KQM builds: each member's attacks per rotation */
export interface KqmPlayed {
  attacks: TeamOpt['attacks']
  /** Seconds per rotation (absent: the team's rotation time) */
  rotationTime?: number
  /** What each rotation waits for to be ready, seconds */
  stalls?: { label: string; seconds: number }[]
}
/**
 * What a KQM replay plays the rotation with: the KQM constellations, the builds' weapons and sets
 * (none before any build is found), and the builds' calculation data (for stats and heals the
 * simulation reads)
 */
export interface KqmReplayInput {
  constellations: Partial<Record<CharacterKey, number>>
  gear: Partial<Record<CharacterKey, SimGear>>
  overrides: TeamDataOverrides
}
/** A KQM run's progress */
export interface KqmStep {
  phase: 'search' | 'ranking'
  round: number
  maxRounds: number
  /** Search: the member's place in the round; ranking: members ranked so far */
  step: number
  steps: number
  /** The member being searched (ranking: the first one not ranked yet) */
  characterKey: CharacterKey
  /** A member's search: its weapons tried with its current artifacts, then the best few searched */
  stage?: 'weapons' | 'artifacts'
  /** The stage's progress (weapons tried, or searches done) */
  done?: number
  total?: number
  /** The whole run's estimated progress (0 to 1; it never goes back) */
  progress?: number
  /** Builds tried so far (main stats and rolls placed for a weapon and sets) */
  tried?: number
}

const subRoll = (key: SubstatKey) => KQM_SUBSTAT_ROLLS[key]
const mainValue = (key: MainStatKey) => getMainStatValue(key, 5, 20)
const slotMains = (m: KqmMains): MainStatKey[] => [
  'hp',
  'atk',
  m.sands,
  m.goblet,
  m.circlet,
]
/** Every 5★ +20 main stat's value (for the search kernel, which has no stat data) */
let mainValuesTable: KqmMainValues | undefined
const kqmMainValues = () =>
  (mainValuesTable ??= Object.fromEntries(
    allMainStatKeys.map((k) => [k, mainValue(k)])
  ) as KqmMainValues)

/** A build's artifact stats, as the solver reads them (`dyn`: fractions for % stats) */
export function kqmValues(
  build: Pick<KqmBuild, 'sets' | 'mains' | 'rolls'>
): Record<string, number> {
  return kqmStatValues(build, kqmMainValues())
}

export interface KqmArtifactStat {
  key: MainStatKey | SubstatKey
  main: number
  fixed: number
  distributed: number
  total: number
  rolls: number
}

/** Artifact contributions only, without character base stats, weapons or set bonuses. */
export function kqmArtifactStats(
  build: Pick<KqmBuild, 'mains' | 'rolls'>
): KqmArtifactStat[] {
  const keys = [
    ...new Set<MainStatKey | SubstatKey>([
      ...allSubstatKeys,
      ...slotMains(build.mains),
    ]),
  ]
  return keys
    .map((key) => {
      const mainCount = slotMains(build.mains).filter((k) => k === key).length
      const main = mainCount ? mainCount * mainValue(key as MainStatKey) : 0
      const rollValue = KQM_SUBSTAT_ROLLS[key as SubstatKey] ?? 0
      const fixed = KQM_FIXED_ROLLS * rollValue
      const rolls = build.rolls[key as SubstatKey] ?? 0
      const distributed = rolls * rollValue
      return {
        key,
        main,
        fixed,
        distributed,
        total: main + fixed + distributed,
        rolls,
      }
    })
    .filter((stat) => stat.total > 0)
}

/**
 * Greedy damage-equivalent estimate, re-evaluated for each added roll and a fractional last roll.
 * It adds up to 20 hypothetical rolls beyond KQMS while respecting the per-stat placement caps.
 * The build, equipment, main stats, teammates and ER constraints remain fixed.
 */
export function estimateKqmCatchUp(
  build: KqmBuild,
  target: number,
  evaluate: (values: Record<string, number>) => {
    total: number
    valid: boolean
  }
): KqmCatchUp {
  const values = kqmValues(build)
  const rolls: KqmRolls = {}
  const caps = kqmRollCaps(build.mains)
  let { total, valid } = evaluate(values)
  const tolerance = Math.max(1e-6, Math.abs(target) * 1e-9)
  const result = (status: KqmCatchUp['status']): KqmCatchUp => ({
    status,
    rolls: { ...rolls },
    count: Object.values(rolls).reduce((sum, n) => sum + (n ?? 0), 0),
    total,
    target,
  })
  if (!valid) return result('limit')
  if (total + tolerance >= target) return result('tied')
  for (let i = 0; i < KQM_ROLLS; i++) {
    let chosen: SubstatKey | undefined
    let chosenTotal = total
    for (const key of allSubstatKeys) {
      if ((build.rolls[key] ?? 0) + (rolls[key] ?? 0) + 1 > caps[key]) continue
      values[key] += subRoll(key)
      const candidate = evaluate(values)
      values[key] -= subRoll(key)
      if (candidate.valid && candidate.total > chosenTotal + tolerance * 0.01) {
        chosen = key
        chosenTotal = candidate.total
      }
    }
    if (!chosen) return result('limit')
    let added = 1
    if (chosenTotal + tolerance >= target) {
      let lo = 0
      let hi = 1
      for (let j = 0; j < 24; j++) {
        const mid = (lo + hi) / 2
        values[chosen] += mid * subRoll(chosen)
        const candidate = evaluate(values)
        values[chosen] -= mid * subRoll(chosen)
        if (candidate.valid && candidate.total + tolerance >= target) hi = mid
        else lo = mid
      }
      added = hi
    }
    rolls[chosen] = (rolls[chosen] ?? 0) + added
    values[chosen] += added * subRoll(chosen)
    ;({ total, valid } = evaluate(values))
    if (valid && total + tolerance >= target) return result('matched')
  }
  return result('limit')
}

/** A build's artifacts as calculation data (what `getTeamDataWith` takes for a member) */
export function kqmArtData(
  build: Pick<KqmBuild, 'sets' | 'mains' | 'rolls'>
): Data {
  const values = kqmValues(build)
  const art: Record<string, ReturnType<typeof constant>> = {}
  const artSet: Record<string, ReturnType<typeof constant>> = {}
  for (const [k, v] of Object.entries(values)) {
    if (k in build.sets) artSet[k] = constant(v)
    else art[k] = k.endsWith('_') ? percent(v) : constant(v)
  }
  return { art, artSet } as Data
}

export function kqmWeaponData(
  weapon: KqmWeapon,
  characterKey: CharacterKey
): ICachedWeapon {
  return {
    id: `kqm:${weapon.key}`,
    key: weapon.key,
    level: 90,
    ascension: 6,
    refinement: weapon.refinement as ICachedWeapon['refinement'],
    location: characterKey as ICachedWeapon['location'],
    lock: false,
  }
}

/**
 * The weapons a member may get: every 4★ and 5★ of its type, plus the 3★ Harbinger of Dawn,
 * Slingshot and Thrilling Tales of Dragon Slayers (`KQM_THREE_STARS`), at the settings' refinement
 */
export function kqmWeapons(
  characterKey: CharacterKey,
  kqm: TeamOptKqm = defaultTeamOptKqm,
  { all = false }: { all?: boolean } = {}
): KqmWeapon[] {
  const type = getCharWeaponType(characterKey)
  const ofType = (allWeaponKeys as readonly WeaponKey[]).filter((key) => {
    const stat = getWeaponStat(key)
    return (
      stat?.weaponType === type &&
      ((stat?.rarity ?? 0) >= 4 || KQM_THREE_STARS.includes(key))
    )
  })
  const excluded = kqmExcludedWeapons(kqm)
  const allowed = ofType.filter((key) => !excluded.has(key))
  return (
    (all ? ofType : allowed)
      // free weapons (and the 3★) first, then 4★ wish and shop ones, then 5★ standard, then 5★
      // event wish
      .sort((a, b) => weaponOrder(a) - weaponOrder(b))
      .map((key) => ({ key, refinement: kqmRefinement(key, kqm) }))
  )
}

const weaponOrder = (key: WeaponKey) => {
  const group = kqmWeaponGroup(key)
  return group === 'wish5'
    ? 3
    : group === 'standard5'
      ? 2
      : group === 'wish4'
        ? 1
        : 0
}

/**
 * The weapons KQM mode turns on and off together, each with its refinement setting: Battle Pass,
 * 4★ event wish (and Starglitter shop), 5★ standard wish, 5★ event wish. (The standard wish pool's
 * 4★, like the other free ones, are no group: on at R5.)
 */
export type KqmWeaponGroup = 'bp' | 'wish4' | 'standard5' | 'wish5'
export function kqmWeaponGroup(key: WeaponKey): KqmWeaponGroup | undefined {
  const source = kqmWeaponSource(key)
  const five = getWeaponStat(key)?.rarity === 5
  if (source === 'bp') return 'bp'
  if (source === 'standard') return five ? 'standard5' : undefined
  if (source === 'gacha' || source === 'starglitter')
    return five ? 'wish5' : 'wish4'
  return undefined
}
/** The setting a group's refinement is */
export const kqmGroupRefinementKey = {
  bp: 'refinementBp',
  wish4: 'refinement4',
  standard5: 'refinementStandard5',
  wish5: 'refinement5',
} as const satisfies Record<KqmWeaponGroup, keyof TeamOptKqm>

/**
 * The refinement a weapon is counted at: as set for it, else by where it comes from (forged,
 * event, fishing and 4★ standard-wish weapons R5; one-copy rewards R1; Battle Pass and 5★
 * standard-wish ones their setting's, R1), else the settings' 5★ / 4★ event wish refinement
 */
export function kqmRefinement(
  key: WeaponKey,
  kqm: TeamOptKqm = defaultTeamOptKqm
): number {
  const own = kqm.refinements?.[key]
  if (own) return own
  switch (kqmWeaponSource(key)) {
    case 'craft':
    case 'event':
    case 'fishing':
      return 5
    case 'standard':
      return getWeaponStat(key)?.rarity === 5
        ? (kqm.refinementStandard5 ?? 1)
        : 5
    case 'bp':
      return kqm.refinementBp ?? 1
    case 'quest':
    case 'console':
      return 1
    default:
      return getWeaponStat(key)?.rarity === 5
        ? kqm.refinement5
        : kqm.refinement4
  }
}

/**
 * The weapons KQM mode leaves out: as set, else the default: the event-wish and Starglitter-shop
 * ones, 4★ and 5★, and the standard wish pool's 5★ (in: forged, event, Battle Pass, fishing,
 * quests, Exaiphanes Blade, and the standard wish pool's 4★). A list saved before the standard wish pool was its own
 * (`weaponList` absent) had them off with the wish ones: they are on again (`onSinceList2`).
 */
export function kqmExcludedWeapons(kqm: TeamOptKqm = defaultTeamOptKqm) {
  const saved = kqm.excludedWeapons
  if (!saved) return new Set<WeaponKey>(kqmDefaultExcludedWeapons())
  return new Set<WeaponKey>(
    (kqm.weaponList ?? 1) >= KQM_WEAPON_LIST
      ? saved
      : saved.filter((key) => !onSinceList2(key))
  )
}
/** What a saved weapon list is written for (see `TeamOptKqm.weaponList`) */
export const KQM_WEAPON_LIST = 2
/**
 * On by default since list 2, off before with the wish weapons: the standard wish pool's 4★, and
 * Moonweaver's Dawn (a free copy from a world quest)
 */
const onSinceList2 = (key: WeaponKey) =>
  (kqmWeaponSource(key) === 'standard' && getWeaponStat(key)?.rarity === 4) ||
  key === 'MoonweaversDawn'
/** The groups left out by default (the Battle Pass's is in) */
const offByDefault: readonly KqmWeaponGroup[] = ['wish4', 'standard5', 'wish5']
export const kqmDefaultExcludedWeapons = () =>
  (allWeaponKeys as readonly WeaponKey[]).filter((key) => {
    const group = kqmWeaponGroup(key)
    return (
      (getWeaponStat(key)?.rarity ?? 0) >= 4 &&
      !!group &&
      offByDefault.includes(group)
    )
  })

/** Every 5★ artifact set (the ones KQM builds are made of) */
export const kqmSets = () => fiveStarSets()

const fiveStarSets = () =>
  (allArtifactSetKeys as readonly ArtifactSetKey[]).filter((k) =>
    (getArtSetStat(k)?.rarities as readonly number[] | undefined)?.includes(5)
  )

/** Sets whose 2-piece is a plain, well-known stat: preferred as the name of a 2-piece bonus */
const WELL_KNOWN_2PC: readonly string[] = [
  'GladiatorsFinale',
  'ShimenawasReminiscence',
  'EmblemOfSeveredFate',
  'NoblesseOblige',
  'WanderersTroupe',
  'GildedDreams',
  'TenacityOfTheMillelith',
  'VermillionHereafter',
  'HuskOfOpulentDreams',
  'HeartOfDepth',
  'CrimsonWitchOfFlames',
  'ThunderingFury',
  'BlizzardStrayer',
  'ViridescentVenerer',
  'ArchaicPetra',
  'DeepwoodMemories',
  'MaidenBeloved',
  'BloodstainedChivalry',
  'PaleFlame',
]
const pref = (k: string) => {
  const i = WELL_KNOWN_2PC.indexOf(k)
  return i < 0 ? WELL_KNOWN_2PC.length : i
}

/** The member's set rules (its Optimize tab's set exclusions) allow `count` pieces of `setKey` */
const allows = (
  exclusion: ArtSetExclusion | undefined,
  setKey: ArtifactSetKey,
  count: number
) =>
  allowedCounts(
    exclusion?.[setKey as keyof ArtSetExclusion] as number[] | undefined
  ).includes(count)

const mainsId = (m: KqmMains) => [m.sands, m.goblet, m.circlet].sort().join('+')
export const kqmSetsId = (sets: KqmSets) =>
  Object.entries(sets)
    .filter(([, n]) => n)
    .map(([k, n]) => `${k}:${n}`)
    .sort()
    .join('+')
const buildId = (b: KqmBuild) =>
  `${b.weapon.key}@${b.weapon.refinement}|${kqmSetsId(b.sets)}|${b.mains.sands},${b.mains.goblet},${b.mains.circlet}|${JSON.stringify(Object.entries(b.rolls).sort())}`

/** A member's compiled problem: for searches here, and as sent to the workers */
interface Problem extends KqmProblem {
  spec: KqmProblemSpec
  /** Each requirement's stat path */
  paths: string[][]
}
type Score = KqmScore
const better = betterScore

let problemCount = 0
/** A built problem, compiled here and given its id (it goes to the search workers) */
function compile(built: KqmBuiltProblem): Problem {
  const { paths, ...rest } = built
  const spec: KqmProblemSpec = { id: `kqm${++problemCount}`, ...rest }
  return { ...kqmProblem(spec), spec, paths }
}

/** Yields to the page now and then, so a long search keeps it responsive */
function ticker(isCancelled: () => boolean) {
  let last = performance.now()
  return async () => {
    if (isCancelled()) throw new TeamOptCancelled()
    if (performance.now() - last < 30) return
    // (not a timer: a run left in a background tab goes on at full speed)
    await yieldTask()
    last = performance.now()
    if (isCancelled()) throw new TeamOptCancelled()
  }
}

interface MemberSpace {
  member: TeamOptMember
  weapons: KqmWeapon[]
  /** Sets allowed as 4 pieces */
  four: ArtifactSetKey[]
  /** Sets allowed as 2 pieces */
  two: ArtifactSetKey[]
  mains: KqmMains[]
}

function memberSpace(
  member: TeamOptMember,
  optConfig: OptConfig | undefined,
  kqm: TeamOptKqm
): MemberSpace {
  const { characterKey } = member
  const exclusion = optConfig?.artSetExclusion
  const sets = fiveStarSets()
  const allowedMains = optConfig?.mainStatKeys as
    | Partial<Record<'sands' | 'goblet' | 'circlet', string[]>>
    | undefined
  const pick = <K extends string>(
    slot: 'sands' | 'goblet' | 'circlet',
    keys: readonly K[]
  ) => {
    const allowed = allowedMains?.[slot]
    const kept = allowed?.length
      ? keys.filter((k) => allowed.includes(k))
      : keys
    return kept.length ? kept : keys
  }
  const sands = pick('sands', kqmSandsKeys)
  const goblet = pick('goblet', kqmGobletKeys(getCharEle(characterKey)))
  const circlet = pick('circlet', kqmCircletKeys)
  const all: KqmMains[] = sands.flatMap((s) =>
    goblet.flatMap((g) =>
      circlet.map((c) => ({ sands: s, goblet: g, circlet: c }))
    )
  )
  return {
    member,
    weapons: kqmWeapons(characterKey, kqm),
    four: sets.filter(
      (k) => !kqm.excludedSets?.includes(k) && allows(exclusion, k, 4)
    ),
    two: sets.filter(
      (k) => !kqm.excludedSets?.includes(k) && allows(exclusion, k, 2)
    ),
    mains: all.filter(
      (m, i) => all.findIndex((o) => mainsId(o) === mainsId(m)) === i
    ),
  }
}

/** The rule-based conditionals for a member (what it does in the rotation, its team's elements) */
function memberCtx(
  database: ArtCharDatabase,
  teamId: string,
  characterKey: CharacterKey,
  teamOpt: Pick<TeamOpt, 'attacks'>
): ItemConditionalCtx {
  const members = teamOptMembers(database, teamId)
  const attacks = new Set<ItemConditionalCtx['attacks'][number]>()
  const kinds = ['normal', 'charged', 'plunging', 'skill', 'burst'] as const
  for (const attack of teamOpt.attacks[characterKey] ?? []) {
    const text = attack.path.join('.').toLowerCase()
    for (const kind of kinds) if (text.includes(kind)) attacks.add(kind)
  }
  const elements = members.map((m) => getCharEle(m.characterKey))
  const auras = new Set<string>(
    elements.filter((e) => e !== 'anemo' && e !== 'geo')
  )
  for (const attacks of Object.values(teamOpt.attacks))
    for (const attack of attacks ?? [])
      if (attack.path.join('.').toLowerCase().includes('stellar'))
        auras.add('stellar')
  const own = getCharEle(characterKey)
  return {
    attacks: [...attacks],
    auras: [...auras],
    otherElements: new Set(elements.filter((e) => e !== own)).size,
  }
}

/**
 * Per member, how much less Energy Recharge it needs with the team's weapons: what KQM mode's
 * weapon window sets for each weapon (`TeamOptKqm.weaponEnergy`), added up over the team's
 * weapons. (Team optimize's settings for the user's own weapons play no part.)
 */
export function kqmEnergyRelief(
  weaponKeys: readonly WeaponKey[],
  teamOpt: Pick<TeamOpt, 'kqm'>
): Partial<Record<CharacterKey, number>> {
  const relief: Partial<Record<CharacterKey, number>> = {}
  for (const key of new Set(weaponKeys))
    for (const [ck, v] of Object.entries(
      teamOpt.kqm?.weaponEnergy?.[key] ?? {}
    ) as [CharacterKey, number][])
      relief[ck] = (relief[ck] ?? 0) + v
  return relief
}

/**
 * Per optimized member, the weapon and set effects counted by rule where nobody set them (see
 * `itemConditionals`): from what it does in the rotation and the team's elements
 */
export function kqmRuleConditionals(
  database: ArtCharDatabase,
  teamId: string,
  teamOpt: Pick<TeamOpt, 'attacks'>
): Partial<Record<CharacterKey, ReturnType<typeof itemConditionals>>> {
  return Object.fromEntries(
    teamOptMembers(database, teamId).map((m) => [
      m.characterKey,
      itemConditionals(memberCtx(database, teamId, m.characterKey, teamOpt), {
        weapons: kqmWeapons(m.characterKey, undefined, { all: true }).map(
          (w) => w.key
        ),
      }),
    ])
  )
}

/**
 * Where a member's search starts: the first allowed weapon, set and main stats, no placed rolls.
 * Only the KQM settings decide it (never the member's own gear), so a run's builds are the same
 * whatever the user has equipped.
 */
function startBuild(space: MemberSpace): KqmBuild {
  return {
    weapon: space.weapons[0],
    sets: space.four[0] ? { [space.four[0]]: 4 } : {},
    mains: { ...space.mains[0] },
    rolls: {},
  }
}

type TeamOptBuffState = NonNullable<TeamOptAttack['states']>[number]
const SET_KEYS: ReadonlySet<string> = new Set(allArtifactSetKeys)
const WEAPON_KEYS: ReadonlySet<string> = new Set(allWeaponKeys)

/**
 * A problem's attacks, where only `dyn`'s artifacts vary: a buff state of a set or weapon that no
 * build in it can have (another member's set or weapon not on it, a weapon `dyn` does not hold)
 * counts nothing there (its sheet needs the pieces or the weapon), so it is dropped, and the
 * attacks it split are merged again. (A replay's candidate windows split them for every option.)
 */
export function kqmProblemAttacks(
  attacks: TeamOpt['attacks'],
  dyn: CharacterKey,
  state: Partial<Record<CharacterKey, KqmBuild>>
): TeamOpt['attacks'] {
  const keep = (s: TeamOptBuffState) => {
    if (s.owner === 'team') return true
    const build = state[s.owner as CharacterKey]
    const key = s.path[0]
    if (!build || !key) return true
    if (WEAPON_KEYS.has(key)) return build.weapon.key === key
    if (SET_KEYS.has(key))
      return s.owner === dyn || !!build.sets[key as ArtifactSetKey]
    return true
  }
  const prune = (list: TeamOptBuffState[]) => list.filter(keep)
  const out: TeamOpt['attacks'] = {}
  for (const [ck, list] of Object.entries(attacks) as [
    CharacterKey,
    TeamOptAttack[] | undefined,
  ][]) {
    if (!list) continue
    const merged = new Map<string, TeamOptAttack>()
    for (const a of list) {
      const next: TeamOptAttack = { ...a }
      if (a.states) next.states = prune(a.states)
      if (a.reactionContributorStates)
        next.reactionContributorStates = Object.fromEntries(
          Object.entries(a.reactionContributorStates).map(([k, v]) => [
            k,
            v && prune(v),
          ])
        )
      if (a.statSnapshots)
        next.statSnapshots = a.statSnapshots.map((snap) => ({
          ...snap,
          states: prune(snap.states),
        }))
      const id = JSON.stringify({ ...next, hits: 0 })
      const same = merged.get(id)
      if (same) same.hits += a.hits
      else merged.set(id, next)
    }
    out[ck] = [...merged.values()]
  }
  return out
}

/** A build's weapon and sets as the rotation simulation plays them (set and weapon effects) */
export const kqmSimGear = (build: KqmBuild): SimGear => ({
  sets: { ...build.sets },
  weapon: build.weapon.key,
  refinement: build.weapon.refinement,
})

/** Members' builds per team step (search breadth) */
const WEAPONS_SEARCHED = 4
const SETS_SEARCHED = 6
const TWO_PIECE_CLASSES = 5
/** Problems a run keeps compiled (the rounds' and rankings' for every weapon of the team fit) */
const PROBLEMS_KEPT = 200
/** Times a ranked option better than its member's build is taken, and the rounds go on */
const ADOPT_PASSES = 1
/** Rounds after a ranked option is taken, at most */
const ADOPT_ROUNDS = 2

interface KqmRunArgs {
  database: ArtCharDatabase
  teamId: string
  gender: GenderKey
  teamOpt: TeamOpt
  onStep?: (step: KqmStep) => void | Promise<void>
  isCancelled?: () => boolean
  maxRounds?: number
  /**
   * The written rotation played for KQM builds (at the KQM constellations, with the builds' own
   * weapons and sets; never the members' own gear): before the search with no gear, then again
   * with the builds found, which are searched again while what it plays changes. Without it, or
   * when it gives nothing, the team's attacks are used as they are.
   */
  replay?: (input: KqmReplayInput) => KqmPlayed | undefined
}
/** Times the rotation is played again for the builds found (each time they change it) */
const REPLAYS = 2
export const optimizeTeamKqm = (args: KqmRunArgs) => runKqm(args)

/** Re-rank one member for a chosen weapon/set pair, keeping every teammate's build fixed. */
export async function compareTeamKqm({
  result,
  characterKey,
  weapon,
  sets,
  ...args
}: Omit<KqmRunArgs, 'maxRounds'> & {
  result: KqmResult
  characterKey: CharacterKey
  weapon: KqmWeapon
  sets: KqmSets
}): Promise<KqmResult | undefined> {
  return runKqm({
    ...args,
    maxRounds: 0,
    comparison: { result, characterKey, weapon, sets },
  })
}

async function runKqm({
  database,
  teamId,
  gender,
  teamOpt,
  onStep,
  isCancelled = () => false,
  maxRounds = 3,
  replay,
  comparison,
}: KqmRunArgs & {
  comparison?: {
    result: KqmResult
    characterKey: CharacterKey
    weapon: KqmWeapon
    sets: KqmSets
  }
}): Promise<KqmResult | undefined> {
  const tick = ticker(isCancelled)
  const kqm = teamOpt.kqm ?? defaultTeamOptKqm
  const members = teamOptMembers(database, teamId)
  const keys = members.map((m) => m.characterKey)
  // The rotation the builds are for: as played for them (`replay`), else the team's attacks. A
  // comparison keeps its run's (its `teamOpt` has them).
  let played: KqmPlayed | undefined = comparison?.result.played
  const attacksNow = () => played?.attacks ?? teamOpt.attacks
  const rotationTimeNow = () => played?.rotationTime ?? teamOpt.rotationTime
  // the calculator's settings as they fit the team now (members, rotation time, constellations
  // may have changed since they were saved)
  const calculatorFor = (rotationTime: number | undefined) =>
    kqm.energySource === 'calculator' && kqm.energyCalculator
      ? {
          ...syncEnergyCalculator(
            keys,
            kqm.energyCalculator,
            rotationTime ?? kqm.energyCalculator.rotationTime,
            teamOpt.onField ?? keys[0],
            Object.fromEntries(
              keys.map((k) => [k, kqmMemberConstellation(k, kqm)])
            )
          ),
          rotationTime: rotationTime ?? kqm.energyCalculator.rotationTime,
        }
      : undefined
  let calculator = calculatorFor(rotationTimeNow())
  if (kqm.energySource === 'calculator') {
    if (!calculator)
      throw new Error(
        'Configure the ER calculator before generating KQM builds.'
      )
    const estimate = calculateEnergyRecharge(keys, calculator)
    if (estimate.errors.length) throw new Error(estimate.errors.join(' '))
  }
  // KQM Theorycrafting is the KQM standard for the whole team: every member gets a KQM build
  // (Team optimize's kept members are a setting of that tab only)
  const optimized = members
  if (!optimized.length) return undefined
  for (const m of optimized)
    if (!kqmWeapons(m.characterKey, kqm).length)
      throw new Error(
        `Select at least one weapon for ${m.characterKey} in KQM settings.`
      )
  const characters = Object.fromEntries(
    optimized.map(({ characterKey }) => [
      characterKey,
      {
        level: 90,
        ascension: 6,
        constellation: kqmMemberConstellation(characterKey, kqm),
        talent: {
          auto: kqmTalentLevel(kqm),
          skill: kqmTalentLevel(kqm),
          burst: kqmTalentLevel(kqm),
        },
      },
    ])
  )
  const constellations = Object.fromEntries(
    optimized.map(({ characterKey }) => [
      characterKey,
      characters[characterKey]!.constellation,
    ])
  )
  const optConfigs = Object.fromEntries(
    members.map((m) => [
      m.characterKey,
      database.optConfigs.get(m.teamChar.optConfigId),
    ])
  ) as Partial<Record<CharacterKey, OptConfig>>
  const baseFilters = Object.fromEntries(
    members.map(({ characterKey }) => {
      // KQM's explicit ER target replaces loadout ER filters. Other requirements still apply.
      const filters = { ...optConfigs[characterKey]?.statFilters }
      for (const path of Object.keys(filters)) {
        try {
          if ((JSON.parse(path) as string[]).at(-1) === 'enerRech_')
            delete filters[path]
        } catch {
          /* Other filter paths are left unchanged. */
        }
      }
      filters[JSON.stringify(['basic', 'enerRech_'])] = [
        { value: kqmEnergyRequirement(kqm, characterKey), disabled: false },
      ]
      return [characterKey, filters]
    })
  ) as Partial<Record<CharacterKey, StatFilters>>
  const bonusStats = teamOptBonusStats(teamOpt, keys)
  const spaces = new Map(
    optimized.map((m) => [
      m.characterKey,
      memberSpace(m, optConfigs[m.characterKey], kqm),
    ])
  )
  /**
   * The weapons a member may take with the others' builds in `state`: not a one-copy weapon
   * (`KQM_ONE_COPY`: a quest reward like Exaiphanes' Blade) another member already has
   */
  const weaponsFor = (
    ck: CharacterKey,
    state: Partial<Record<CharacterKey, KqmBuild>>
  ) => {
    const all = spaces.get(ck)?.weapons ?? []
    const taken = new Set(
      Object.entries(state)
        .filter(
          ([k, b]) => k !== ck && b && KQM_ONE_COPY.includes(b.weapon.key)
        )
        .map(([, b]) => b!.weapon.key)
    )
    return taken.size ? all.filter((w) => !taken.has(w.key)) : all
  }
  /** The sets and weapons a member's search may give it (see `SimGear.candidates`) */
  const candidatesOf = (ck: CharacterKey) => {
    const space = spaces.get(ck)
    return {
      sets: [...new Set([...(space?.four ?? []), ...(space?.two ?? [])])],
      weapons: [...new Set((space?.weapons ?? []).map((w) => w.key))],
    }
  }
  // the weapon and set effects nobody set up, by rule; the members' own settings win over them,
  // and KQM mode's own (`conditionalOverrides`) over both
  // (from what the members do in the rotation: again when it is played differently)
  const ruleConditionals = () => {
    const ctx = kqmRuleConditionals(database, teamId, { attacks: attacksNow() })
    return {
      ctx,
      extra: Object.fromEntries(
        Object.entries(ctx).map(([k, v]) => [k, v!.conditional])
      ) as Partial<Record<CharacterKey, IConditionalValues>>,
    }
  }
  let { ctx: ctxConditionals, extra: extraConditionals } = ruleConditionals()
  const conditionalOverrides = kqm.passives

  const builds: Partial<Record<CharacterKey, KqmBuild>> = comparison
    ? structuredClone(comparison.result.builds)
    : {}
  if (!comparison)
    for (const m of optimized)
      builds[m.characterKey] = startBuild(spaces.get(m.characterKey)!)

  const gearOf = (state: Partial<Record<CharacterKey, KqmBuild>>) => {
    const arts: Partial<Record<CharacterKey, Data>> = {}
    const weapons: Partial<Record<CharacterKey, ICachedWeapon>> = {}
    for (const [ck, b] of Object.entries(state) as [CharacterKey, KqmBuild][]) {
      arts[ck] = kqmArtData(b)
      weapons[ck] = kqmWeaponData(b.weapon, ck)
    }
    return { arts, weapons }
  }
  // (every member has a KQM build in `state`: its weapon is the one counted)
  const filtersFor = (state: Partial<Record<CharacterKey, KqmBuild>>) => {
    const relief = kqmEnergyRelief(
      Object.values(state).map((b) => b!.weapon.key),
      teamOpt
    )
    const calculated = calculator
      ? calculateEnergyRecharge(
          keys,
          calculator,
          Object.fromEntries(
            Object.entries(state).map(([ck, b]) => [ck, b!.weapon.key])
          ),
          Object.fromEntries(
            Object.entries(state).map(([ck, b]) => [ck, b!.weapon.refinement])
          )
        )
      : undefined
    if (calculated?.errors.length) throw new Error(calculated.errors.join(' '))
    return Object.fromEntries(
      Object.entries(baseFilters).map(([ck, f]) => [
        ck,
        calculated
          ? {
              ...f,
              [JSON.stringify(['basic', 'enerRech_'])]: [
                {
                  value: calculated.targets[ck as CharacterKey]!,
                  disabled: false,
                },
              ],
            }
          : withEnergyRelief(f ?? {}, relief[ck as CharacterKey] ?? 0),
      ])
    ) as Partial<Record<CharacterKey, StatFilters>>
  }

  /** The team's damage as a function of `ck`'s artifacts, with `weapon` on it, the others as in `state` */
  const problemCache = new Map<string, Problem | undefined>()
  const problemKey = (
    ck: CharacterKey,
    weapon: KqmWeapon,
    state: Partial<Record<CharacterKey, KqmBuild>>
  ) =>
    `${ck}|${weapon.key}@${weapon.refinement}|${Object.entries(state)
      .filter(([k]) => k !== ck)
      .map(([k, b]) => `${k}=${buildId(b!)}`)
      .sort()
      .join(';')}`
  const problemFor = (
    ck: CharacterKey,
    weapon: KqmWeapon,
    state: Partial<Record<CharacterKey, KqmBuild>>
  ): Problem | undefined => {
    const cacheKey = problemKey(ck, weapon, state)
    if (problemCache.has(cacheKey)) return problemCache.get(cacheKey)
    const withWeapon = { ...state, [ck]: { ...state[ck]!, weapon } }
    const { arts, weapons } = gearOf(withWeapon)
    delete arts[ck]
    const built = buildKqmProblem(database, teamId, gender, {
      dyn: ck,
      arts,
      attacks: kqmProblemAttacks(attacksNow(), ck, withWeapon),
      statFilters: calculator
        ? filtersFor(withWeapon)
        : { [ck]: filtersFor(withWeapon)[ck] ?? {} },
      weapons,
      extraConditionals,
      conditionalOverrides,
      characters,
      onField: teamOpt.onField,
      bonusStats,
    })
    const problem = built && compile(built)
    // (the oldest go first: a problem is large compiled code)
    while (problemCache.size >= PROBLEMS_KEPT)
      problemCache.delete(problemCache.keys().next().value!)
    problemCache.set(cacheKey, problem)
    return problem
  }

  // Progress: a member's search is a unit, a member's rankings 0.6; two rounds are expected
  // (one to find the builds, one to confirm them), a third is added when the second changes one
  const steps = optimized.length
  const rankedMembers = comparison
    ? optimized.filter((m) => m.characterKey === comparison.characterKey)
    : optimized
  const RANK_UNITS = 0.6
  let plannedRounds = Math.min(maxRounds, 2)
  let tried = 0
  let shown = 0
  // when more work is planned (another round), the rest of the line is shared out from where
  // it is, so that it keeps moving instead of waiting for the estimate to catch up
  let rebase = { shown: 0, units: 0, total: 0 }
  const emit = (
    step: Omit<KqmStep, 'maxRounds' | 'progress' | 'tried'>,
    units: number
  ) => {
    const total = plannedRounds * steps + RANK_UNITS * rankedMembers.length
    if (total !== rebase.total) rebase = { shown, units, total }
    const left = total - rebase.units
    const progress =
      left > 0
        ? rebase.shown + ((1 - rebase.shown) * (units - rebase.units)) / left
        : 1
    shown = Math.max(shown, Math.min(1, progress))
    return onStep?.({ ...step, maxRounds, progress: shown, tried })
  }
  const cancelled = (e: unknown) =>
    e instanceof KqmSearchCancelled ? new TeamOptCancelled() : e

  /** A set's search (main stats and rolls), in a worker; each one once per run */
  const setSearches = new Map<string, Promise<KqmSetSearch | undefined>>()
  interface Counter {
    done: number
    total: number
    onDone?: () => void
  }
  const setSearch = (
    ck: CharacterKey,
    problem: Problem,
    sets: KqmSets,
    counter?: Counter
  ) => {
    const key = `${problem.spec.id}|${kqmSetsId(sets)}`
    let search = setSearches.get(key)
    if (!search) {
      const task: KqmSetTask = {
        problem: problem.spec,
        local: problem,
        sets,
        mains: spaces.get(ck)!.mains,
      }
      search = queueKqmSetTasks([task], kqmMainValues(), isCancelled)[0].then(
        (r) => {
          tried += r?.tried ?? 0
          return r
        }
      )
      // (a search nobody waits for any more, after a cancel, is no error)
      search.catch(() => undefined)
      setSearches.set(key, search)
    }
    if (counter) {
      counter.total++
      search.then(
        () => {
          counter.done++
          counter.onDone?.()
        },
        () => undefined
      )
    }
    return search
  }

  /**
   * The best sets, main stats and rolls for `ck` with `weapon` (sets limited to `setsList` if
   * given): the sets screened here, each one's main stats and rolls searched in the workers
   */
  const searchArtifacts = async (
    ck: CharacterKey,
    weapon: KqmWeapon,
    state: Partial<Record<CharacterKey, KqmBuild>>,
    {
      setsList,
      setsKept = SETS_SEARCHED,
      counter,
    }: { setsList?: KqmSets[]; setsKept?: number; counter?: Counter } = {}
  ): Promise<{ build: KqmBuild; score: Score }[]> => {
    const space = spaces.get(ck)!
    const current = state[ck]!
    const problem = problemFor(ck, weapon, state)
    if (!problem) return []
    const evalPick = (sets: KqmSets, mains: KqmMains) =>
      scoreOf(
        problem,
        kqmValues({ sets, mains, rolls: cappedRolls(current.rolls, mains) })
      )
    const combos = setsList ?? setCombos(problem, space, current)
    // sets screened with the current main stats and rolls
    const screened = combos
      .map((sets) => ({ sets, score: evalPick(sets, current.mains) }))
      .sort((a, b) => compareScores(a.score, b.score))
      .slice(0, setsKept)
    return Promise.all(
      screened.map(({ sets }) => setSearch(ck, problem, sets, counter))
    ).then((found) =>
      found
        .flatMap((r, i) =>
          r
            ? [
                {
                  build: {
                    weapon,
                    sets: screened[i].sets,
                    mains: r.mains,
                    rolls: r.rolls,
                  },
                  score: r.score,
                },
              ]
            : []
        )
        .sort((a, b) => compareScores(a.score, b.score))
    )
  }

  /** 4-piece sets, and 2+2 of the best 2-piece bonuses (sets with the same bonus count once) */
  const setCombos = (
    problem: Problem,
    space: MemberSpace,
    current: KqmBuild
  ): KqmSets[] => {
    const rolls = current.rolls
    const two = space.two
      .map((k) => ({
        k,
        v: scoreOf(
          problem,
          kqmValues({ sets: { [k]: 2 }, mains: current.mains, rolls })
        ).total,
      }))
      .sort((a, b) => b.v - a.v || pref(a.k) - pref(b.k))
      .filter(
        (x, i, all) =>
          all.findIndex((o) => Math.abs(o.v - x.v) <= 1e-9 * Math.abs(x.v)) ===
          i
      )
      .slice(0, TWO_PIECE_CLASSES)
      .map((x) => x.k)
    return [
      ...space.four.map((k) => ({ [k]: 4 }) as KqmSets),
      ...two.flatMap((a, i) =>
        two.slice(i + 1).map((b) => ({ [a]: 2, [b]: 2 }) as KqmSets)
      ),
    ]
  }

  /**
   * One member's step: weapons screened with its current artifacts, then the best few searched
   * (all at once, in the workers; its current weapon's search starts first, while the others are
   * screened)
   */
  const memberStep = async (
    ck: CharacterKey,
    state: Partial<Record<CharacterKey, KqmBuild>>,
    report: (
      stage: 'weapons' | 'artifacts',
      done: number,
      total: number
    ) => void,
    /** Work for this thread while the workers search (it stops once they are done) */
    whileSearching?: (done: () => boolean) => Promise<void>
  ) => {
    const space = spaces.get(ck)!
    const current = state[ck]!
    const counter: Counter = { done: 0, total: 0 }
    const searches = new Map<string, ReturnType<typeof searchArtifacts>>()
    const search = (weapon: KqmWeapon) => {
      const id = `${weapon.key}@${weapon.refinement}`
      let found = searches.get(id)
      if (!found) {
        found = searchArtifacts(ck, weapon, state, { counter })
        searches.set(id, found)
      }
      return found
    }
    if (weaponsFor(ck, state).some((w) => w.key === current.weapon.key))
      search(current.weapon).catch(() => undefined)
    // The workers are free while the weapons are tried here: each weapon's search with the current
    // sets starts as soon as it is tried (so that at the end no weapon in the member's ranking,
    // each weapon with the chosen sets, beats the chosen build), and a weapon's full search as
    // soon as it is among the best few so far (most of them stay)
    const withCurrentSets: ReturnType<typeof searchArtifacts>[] = []
    const screened: { weapon: KqmWeapon; score: Score }[] = []
    const allowed = weaponsFor(ck, state)
    for (const [i, weapon] of allowed.entries()) {
      await tick()
      report('weapons', i, allowed.length)
      const problem = problemFor(ck, weapon, state)
      if (!problem) continue
      const score = scoreOf(problem, kqmValues(current))
      screened.push({ weapon, score })
      const found = searchArtifacts(ck, weapon, state, {
        setsList: [current.sets],
        setsKept: 1,
        counter,
      })
      found.catch(() => undefined)
      withCurrentSets.push(found)
      if (
        screened.filter((s) => better(s.score, score)).length < WEAPONS_SEARCHED
      )
        search(weapon).catch(() => undefined)
    }
    tried += allowed.length
    screened.sort((a, b) => compareScores(a.score, b.score))
    const weapons = screened.slice(0, WEAPONS_SEARCHED).map((s) => s.weapon)
    if (
      allowed.some((w) => w.key === current.weapon.key) &&
      !weapons.some((w) => w.key === current.weapon.key)
    )
      weapons.push(current.weapon)
    const found = weapons.map(search)
    counter.onDone = () => report('artifacts', counter.done, counter.total)
    report('artifacts', counter.done, counter.total)
    const all = Promise.all([...found, ...withCurrentSets])
    let finished = false
    all.then(
      () => {
        finished = true
      },
      () => {
        finished = true
      }
    )
    await whileSearching?.(() => finished)
    let best: { build: KqmBuild; score: Score } | undefined
    for (const [top] of await all)
      if (top && (!best || better(top.score, best.score))) best = top
    return best
  }

  /**
   * While a member's artifacts are searched (in the workers), this thread builds the next
   * member's problems as if this member's build stays: it usually does once the builds have
   * settled, and then the next step finds them built
   */
  const prebuild =
    (ck: CharacterKey, state: Partial<Record<CharacterKey, KqmBuild>>) =>
    async (done: () => boolean) => {
      const space = spaces.get(ck)
      if (!space) return
      for (const weapon of space.weapons) {
        await yieldTask()
        if (done() || isCancelled()) return
        problemFor(ck, weapon, state)
      }
    }

  const rankings: Partial<Record<CharacterKey, KqmRanking>> = {}

  // Rounds of member steps (each member's search with the others' builds fixed), until no
  // build changes. A step is skipped when its result is known: its last one changed nothing and
  // no other build changed since.
  let rounds = 0
  let changes = 0
  const lastChange: Partial<Record<CharacterKey, number>> = {}
  const settled: Partial<Record<CharacterKey, number>> = {}
  /** Rounds `first` to `last` at most, until one changes no build */
  const descend = async (first: number, last: number) => {
    for (let round = first; round <= last; round++) {
      rounds = round
      let changed = false
      for (const [i, m] of optimized.entries()) {
        const ck = m.characterKey
        const base = (round - 1) * steps + i
        await emit(
          { phase: 'search', round, step: i + 1, steps, characterKey: ck },
          base
        )
        if (isCancelled()) throw new TeamOptCancelled()
        const known =
          settled[ck] !== undefined &&
          optimized.every(
            ({ characterKey: other }) =>
              other === ck || (lastChange[other] ?? 0) <= settled[ck]!
          )
        if (
          known &&
          weaponsFor(ck, builds).some((w) => w.key === builds[ck]!.weapon.key)
        )
          continue
        const before = builds[ck]!
        const problem = problemFor(ck, before.weapon, builds)
        // (a one-copy weapon another member has: any allowed build replaces it)
        const conflict = !weaponsFor(ck, builds).some(
          (w) => w.key === before.weapon.key
        )
        const beforeScore =
          problem && !conflict ? scoreOf(problem, kqmValues(before)) : undefined
        // (from the second round, when builds mostly stay: see `prebuild`)
        const next = optimized[(i + 1) % steps].characterKey
        const best = await memberStep(
          ck,
          builds,
          (stage, done, total) =>
            emit(
              {
                phase: 'search',
                round,
                step: i + 1,
                steps,
                characterKey: ck,
                stage,
                done,
                total,
              },
              base +
                // (trying the weapons builds a problem for each: most of a step's time)
                (stage === 'weapons'
                  ? 0.75 * (total ? done / total : 0)
                  : 0.75 + 0.25 * (total ? done / total : 0))
            ),
          round > 1 && next !== ck ? prebuild(next, builds) : undefined
        )
        if (
          best &&
          (!beforeScore || better(best.score, beforeScore)) &&
          buildId(best.build) !== buildId(before)
        ) {
          changed = true
          builds[ck] = best.build
          lastChange[ck] = ++changes
          delete settled[ck]
        } else {
          if (best && (!beforeScore || better(best.score, beforeScore)))
            builds[ck] = best.build
          settled[ck] = changes
        }
      }
      if (!changed) break
      if (round === plannedRounds && round < last) plannedRounds++
    }
    plannedRounds = rounds
  }

  /** Each ranked member's rankings: each list varies one item, the rest of the team fixed */
  const rankAll = async () => {
    // Each list varies one item; the selected weapon/set and every teammate stay fixed. The
    // members are ranked together, their searches in the workers.
    const rankBase = rounds * steps
    const counter: Counter = { done: 0, total: 0 }
    const rankedDone = new Set<CharacterKey>()
    const reportRanking = () =>
      emit(
        {
          phase: 'ranking',
          round: rounds,
          step: rankedDone.size,
          steps: rankedMembers.length,
          characterKey: (
            rankedMembers.find((m) => !rankedDone.has(m.characterKey)) ??
            rankedMembers[rankedMembers.length - 1]
          ).characterKey,
          done: counter.done,
          total: counter.total,
        },
        rankBase +
          RANK_UNITS *
            rankedMembers.length *
            (counter.total ? counter.done / counter.total : 0)
      )
    counter.onDone = reportRanking
    await reportRanking()
    const rankMember = async (
      ck: CharacterKey
    ): Promise<KqmRanking | undefined> => {
      const best = builds[ck]!
      const space = spaces.get(ck)!
      await tick()
      const problem = problemFor(ck, best.weapon, builds)
      if (!problem) return undefined
      // An option misses its requirements when it misses one the chosen build meets: one nobody
      // meets (another member's that no build of this one reaches) marks none of them
      const chosen = scoreOf(problem, kqmValues(best))
      const chosenCons = problem.run(kqmValues(best)).cons
      const chosenMeets = problem.mins.map((min, j) => chosenCons[j] >= min)
      const meetsAsChosen = (score: Score) =>
        score.deficit <= chosen.deficit + DEFICIT_TOL
      const option = (r: { build: KqmBuild; score: Score }): KqmOption => {
        const own = problemFor(ck, r.build.weapon, builds)
        const cons = own?.run(kqmValues(r.build)).cons ?? []
        const shortfalls = (own?.mins ?? []).flatMap((min, j) =>
          cons[j] >= min || !chosenMeets[j]
            ? []
            : [{ path: own!.paths[j], value: cons[j], min }]
        )
        const unmet = !meetsAsChosen(r.score) || shortfalls.length > 0
        return unmet
          ? { ...r.build, total: r.score.total, unmet, shortfalls }
          : { ...r.build, total: r.score.total, unmet }
      }
      const allSets = setCombos(problem, space, best)
      if (!allSets.some((sets) => kqmSetsId(sets) === kqmSetsId(best.sets)))
        allSets.push(best.sets)
      const bySetsFound = searchArtifacts(ck, best.weapon, builds, {
        setsList: allSets,
        setsKept: allSets.length,
        counter,
      })
      bySetsFound.catch(() => undefined)
      const byWeaponFound: Promise<
        { build: KqmBuild; score: Score } | undefined
      >[] = []
      for (const weapon of weaponsFor(ck, builds)) {
        await tick()
        const found = searchArtifacts(ck, weapon, builds, {
          setsList: [best.sets],
          setsKept: 1,
          counter,
        }).then(([top]) => top)
        found.catch(() => undefined)
        byWeaponFound.push(found)
      }
      const bySets = await bySetsFound
      const byWeapon = (await Promise.all(byWeaponFound)).flatMap((top) =>
        top ? [option(top)] : []
      )
      const order = (a: KqmOption, b: KqmOption) =>
        Number(a.unmet) - Number(b.unmet) || b.total - a.total
      const withCatchUp = async (options: KqmOption[]) => {
        options.sort(order)
        for (let i = 1; i < options.length; i++) {
          await tick()
          const current = options[i]
          const previous = options[i - 1]
          if (current.unmet || previous.unmet) continue
          const own = problemFor(ck, current.weapon, builds)
          if (!own) continue
          current.catchUp = estimateKqmCatchUp(
            current,
            previous.total,
            (values) => {
              const score = scoreOf(own, values)
              return { total: score.total, valid: meetsAsChosen(score) }
            }
          )
        }
        return options
      }
      const ranking = {
        sets: await withCatchUp(bySets.map(option)),
        weapons: await withCatchUp(byWeapon),
      }
      rankedDone.add(ck)
      await reportRanking()
      return ranking
    }
    const ranked = await Promise.all(
      rankedMembers.map((m) => rankMember(m.characterKey))
    )
    for (const [i, m] of rankedMembers.entries())
      if (ranked[i]) rankings[m.characterKey] = ranked[i]
  }

  /**
   * A ranked option better than its member's build (its member's search missed it: the sets it
   * screened left it out), the best such one over the team
   */
  const missedBest = () => {
    let found: { ck: CharacterKey; build: KqmBuild; gain: number } | undefined
    for (const { characterKey: ck } of rankedMembers) {
      const own = builds[ck]!
      const problem = problemFor(ck, own.weapon, builds)
      const ranking = rankings[ck]
      if (!problem || !ranking) continue
      const score = scoreOf(problem, kqmValues(own))
      const allowed = weaponsFor(ck, builds)
      for (const option of [...ranking.sets, ...ranking.weapons]) {
        // (unmet: it misses a requirement this build meets)
        if (option.unmet) continue
        if (!allowed.some((w) => w.key === option.weapon.key)) continue
        const gain = option.total / score.total - 1
        if (gain > 1e-9 && (!found || gain > found.gain)) {
          const { weapon, sets, mains, rolls } = option
          found = { ck, build: { weapon, sets, mains, rolls }, gain }
        }
      }
    }
    return found
  }

  /**
   * Before the rounds: each member's artifacts for its starting weapon, so that the first round's
   * weapons are tried against the others' fitting artifacts, not their starting ones (one problem
   * per member; it saves a round of all the weapons' problems). Members in `order`, from `from`:
   * the team's builds after, and the team's score with them (the last member's search).
   */
  const warmUp = async (
    from: Partial<Record<CharacterKey, KqmBuild>>,
    order: CharacterKey[],
    pass: number
  ) => {
    const state = { ...from }
    let score: Score | undefined
    for (const [i, ck] of order.entries()) {
      await emit(
        {
          phase: 'search',
          round: 1,
          step: i + 1,
          steps,
          characterKey: ck,
          stage: 'artifacts',
        },
        (0.25 * (pass * steps + i)) / (2 * steps)
      )
      const start = state[ck]!
      const problem = problemFor(ck, start.weapon, state)
      if (!problem) continue
      score = scoreOf(problem, kqmValues(start))
      const [top] = await searchArtifacts(ck, start.weapon, state)
      if (top && better(top.score, score)) {
        state[ck] = top.build
        score = top.score
      }
    }
    return { state, score }
  }

  /**
   * The rotation played for `state` (with its weapons and sets when `withGear`): when it plays
   * differently from before, the run counts it from now on (its time, the ER calculator's targets
   * and the rule effects follow) and true is returned
   */
  const replayFor = (
    state: Partial<Record<CharacterKey, KqmBuild>>,
    withGear: boolean
  ) => {
    if (!replay) return false
    const { arts, weapons } = gearOf(state)
    const next = replay({
      constellations,
      // (every member's allowed sets and weapons as candidates: the effects that only open their
      // own buff windows are played for each of them, so the search judges every option with
      // its effects in the rotation, not only the ones already worn)
      gear: Object.fromEntries(
        optimized.map(({ characterKey: ck }) => [
          ck,
          {
            ...(withGear && state[ck] ? kqmSimGear(state[ck]!) : {}),
            candidates: candidatesOf(ck),
          },
        ])
      ),
      overrides: {
        arts,
        weapons,
        characters,
        extraConditionals,
        conditionalOverrides,
        bonusStats,
      },
    })
    if (!next) return false
    const playedId = (p: KqmPlayed) =>
      JSON.stringify([p.attacks, p.rotationTime])
    const changed = !played || playedId(next) !== playedId(played)
    played = next
    if (!changed) return false
    calculator = calculatorFor(rotationTimeNow())
    ;({ ctx: ctxConditionals, extra: extraConditionals } = ruleConditionals())
    // (problems and searches were for the attacks before)
    problemCache.clear()
    setSearches.clear()
    return true
  }

  try {
    // the rotation at the KQM constellations, with no weapon or set effects yet (its builds are
    // not found yet)
    if (!comparison) replayFor(builds, false)
    // The first builds, warmed up in the team's order and in reverse (the last ones choose with
    // the first ones' sets on: a team-wide set goes to whoever chooses first), the better kept:
    // which way the rounds settle depends on it, and only the KQM settings decide it
    if (!comparison && maxRounds > 0) {
      const order = optimized.map((m) => m.characterKey)
      const forward = await warmUp(builds, order, 0)
      const reverse =
        order.length > 1
          ? await warmUp(builds, [...order].reverse(), 1)
          : undefined
      const start =
        reverse?.score &&
        (!forward.score || better(reverse.score, forward.score))
          ? reverse
          : forward
      Object.assign(builds, start.state)
    }
    await descend(1, maxRounds)
    // Played again with the builds found (their weapons' and sets' effects in it): while that
    // changes what it plays, the builds are searched again from where they are
    for (
      let r = 0;
      !comparison && maxRounds > 0 && r < REPLAYS && replayFor(builds, true);
      r++
    ) {
      for (const ck of Object.keys(settled) as CharacterKey[])
        delete settled[ck]
      plannedRounds = rounds + 1
      await descend(rounds + 1, rounds + maxRounds)
    }
    if (comparison) {
      const { characterKey, weapon, sets } = comparison
      const space = spaces.get(characterKey)
      if (!space || !builds[characterKey])
        throw new Error('This member has no KQM build to compare.')
      if (
        !space.weapons.some(
          (w) => w.key === weapon.key && w.refinement === weapon.refinement
        )
      )
        throw new Error('This weapon is not allowed by the run settings.')
      const counts = Object.entries(sets)
      if (
        counts.length > 2 ||
        counts.some(([key, n]) =>
          n === 4
            ? counts.length !== 1 || !space.four.includes(key as ArtifactSetKey)
            : n !== 2 || !space.two.includes(key as ArtifactSetKey)
        )
      )
        throw new Error('This artifact set is not allowed by the run settings.')
      // the rotation played again with the picked weapon and sets on (their effects, and what
      // they change for the team: a set's debuff, a weapon's buff for the next member)
      replayFor(
        {
          ...builds,
          [characterKey]: { ...builds[characterKey]!, weapon, sets },
        },
        true
      )
      const [selected] = await searchArtifacts(characterKey, weapon, builds, {
        setsList: [sets],
        setsKept: 1,
      })
      if (!selected)
        throw new Error('Could not evaluate this equipment combination.')
      builds[characterKey] = selected.build
    }
    for (let pass = 0; ; pass++) {
      await rankAll()
      if (comparison || pass >= ADOPT_PASSES) break
      const missed = missedBest()
      if (!missed) break
      // taken, and the rounds go on from there (the others' best builds may change with it)
      builds[missed.ck] = missed.build
      lastChange[missed.ck] = ++changes
      delete settled[missed.ck]
      plannedRounds = rounds + ADOPT_ROUNDS
      await descend(rounds + 1, rounds + ADOPT_ROUNDS)
    }
  } catch (e) {
    throw cancelled(e)
  } finally {
    releaseKqmWorkers()
  }

  const { arts, weapons } = gearOf(builds)
  const finalSettings = {
    arts,
    attacks: attacksNow(),
    statFilters: filtersFor(builds),
    weapons,
    extraConditionals,
    conditionalOverrides,
    characters,
    onField: teamOpt.onField,
    bonusStats,
  }
  const after = evaluateTeamRotation(database, teamId, gender, finalSettings)
  if (!after) return undefined
  const finalNodes = teamRotationNodes(database, teamId, gender, finalSettings)
  const energyRecharge: KqmResult['energyRecharge'] = {}
  for (const { characterKey, path, value, min } of finalNodes?.constraints ??
    [])
    if (path.at(-1) === 'enerRech_')
      energyRecharge[characterKey] = {
        target: calculator
          ? min * 100
          : kqmEnergyRequirement(kqm, characterKey),
        minimum: min * 100,
        value: constValue(value) * 100,
      }

  // what was counted by rule for each member's own weapon and sets (not set by the user)
  const assumed: KqmResult['assumed'] = {}
  for (const m of optimized) {
    const ck = m.characterKey
    const b = builds[ck]!
    const own = m.teamChar.conditional as
      | Record<string, Record<string, unknown>>
      | undefined
    const items = new Set<string>([b.weapon.key, ...Object.keys(b.sets)])
    assumed[ck] = (ctxConditionals[ck]?.picked ?? []).filter(
      ({ path }) =>
        items.has(path[0]) &&
        own?.[path[0]]?.[path[path.length - 1]] === undefined &&
        kqm.passives?.[ck]?.[path[0]]?.[path[path.length - 1]] === undefined
    )
  }

  return {
    builds,
    constellations,
    energyRecharge,
    after,
    rankings,
    assumed,
    optimized: optimized.map((m) => m.characterKey),
    rounds,
    played,
  }
}
