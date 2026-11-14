import type {
  ArtifactSetKey,
  MainStatKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import { allSubstatKeys } from '@genshin-optimizer/gi/consts'

/*
 * The KQM search kernel: a member's free rolls, main stats and sets for one compiled problem
 * (the team's damage as a function of that member's artifact stats). It has no database or
 * sheet code, so that it also runs in the KQM workers (`worker.ts`).
 */

/** Rolls placed freely on top of the fixed ones (KQMS) */
export const KQM_ROLLS = 20
/** Fixed rolls of every substat (KQMS) */
export const KQM_FIXED_ROLLS = 2
/** Main stats kept after the screening of a set's main stats, then searched with refined rolls */
export const MAINS_SEARCHED = 6

/** Published five-star average-roll scalars (KQMS 3.0). Percent stats use fractions, as the calculation graph expects. */
export const KQM_SUBSTAT_ROLLS: Record<SubstatKey, number> = {
  hp_: 0.0496,
  hp: 253.94,
  atk_: 0.0496,
  atk: 16.54,
  def_: 0.062,
  def: 19.68,
  eleMas: 19.82,
  critRate_: 0.0331,
  critDMG_: 0.0662,
  enerRech_: 0.0551,
}
const subRoll = (key: SubstatKey) => KQM_SUBSTAT_ROLLS[key]

export interface KqmMains {
  sands: MainStatKey
  goblet: MainStatKey
  circlet: MainStatKey
}
/** Set piece counts: one set at 4, two at 2 (2+2), or none */
export type KqmSets = Partial<Record<ArtifactSetKey, number>>
/** The rolls placed freely, per substat (the fixed 2 of each are not in it) */
export type KqmRolls = Partial<Record<SubstatKey, number>>
/** A 5★ +20 main stat's value, per main stat (`getMainStatValue(key, 5, 20)`) */
export type KqmMainValues = Partial<Record<MainStatKey, number>>

const slotMains = (m: KqmMains): MainStatKey[] => [
  'hp',
  'atk',
  m.sands,
  m.goblet,
  m.circlet,
]
/** How many free rolls a substat may get with these main stats */
export function kqmRollCaps(mains: KqmMains): Record<SubstatKey, number> {
  const all = slotMains(mains)
  return Object.fromEntries(
    allSubstatKeys.map((k) => [
      k,
      (5 - all.filter((s) => s === k).length) * KQM_FIXED_ROLLS,
    ])
  ) as Record<SubstatKey, number>
}
export function cappedRolls(rolls: KqmRolls, mains: KqmMains): KqmRolls {
  const caps = kqmRollCaps(mains)
  const out: KqmRolls = {}
  for (const [k, n] of Object.entries(rolls) as [SubstatKey, number][])
    if (n > 0) out[k] = Math.min(n, caps[k])
  return out
}

/** A build's artifact stats, as the solver reads them (`dyn`: fractions for % stats) */
export function kqmStatValues(
  build: { sets: KqmSets; mains: KqmMains; rolls: KqmRolls },
  mainValues: KqmMainValues
): Record<string, number> {
  const values: Record<string, number> = {}
  for (const k of allSubstatKeys)
    values[k] = (KQM_FIXED_ROLLS + (build.rolls[k] ?? 0)) * subRoll(k)
  for (const k of slotMains(build.mains))
    values[k] = (values[k] ?? 0) + (mainValues[k] ?? 0)
  for (const [k, n] of Object.entries(build.sets)) if (n) values[k] = n
  return values
}

/** A compiled problem as it is sent to a worker */
export interface KqmProblemSpec {
  id: string
  /** `precomputeSource` of the damage terms, then the requirements */
  source: string
  nTerms: number
  mins: number[]
  /** The stats the damage or a requirement reads */
  scales: string[]
}
/** The rotation's damage and a member's requirements as a function of its artifacts */
export interface KqmProblem {
  /** Team damage, and each requirement's value */
  run: (values: Record<string, number>) => { total: number; cons: number[] }
  /**
   * Every formula's value (the damage terms, then the requirements) in one array, the same one
   * each time: no garbage in the search's millions of calls
   */
  values: (values: Record<string, number>) => Float64Array
  nTerms: number
  mins: number[]
  scales: Set<string>
}
export function kqmProblem(spec: Omit<KqmProblemSpec, 'id'>): KqmProblem {
  // The optimizer's compiled formulas, as `precompute` makes them, but writing their values into
  // one array (`o`) instead of returning a new one each call
  const source = spec.source.replace(
    /return \[([^\]]*)\]\s*$/,
    (_, list: string) =>
      `${list
        .split(',')
        .map((name, i) => `o[${i}]=${name};`)
        .join('')}return o`
  )
  const compute = new Function('b', 'o', source) as (
    b: { values: Record<string, number> }[],
    o: Float64Array
  ) => Float64Array
  const { nTerms, mins } = spec
  const out = new Float64Array(nTerms + mins.length)
  const arg = [{ values: {} as Record<string, number> }]
  const values = (v: Record<string, number>) => {
    arg[0].values = v
    return compute(arg, out)
  }
  return {
    run: (v) => {
      const o = values(v)
      let total = 0
      for (let i = 0; i < nTerms; i++) total += o[i] || 0
      return { total, cons: Array.from(o.subarray(nTerms)) }
    },
    values,
    nTerms,
    mins,
    scales: new Set(spec.scales),
  }
}

export interface KqmScore {
  total: number
  /** How far the requirements are from being met (0: met), relative */
  deficit: number
}
export const DEFICIT_TOL = 1e-9
/** Whether `a` is better than `b`: closer to the requirements, then more damage */
export const betterScore = (a: KqmScore, b: KqmScore) =>
  a.deficit < b.deficit - DEFICIT_TOL ||
  (a.deficit <= b.deficit + DEFICIT_TOL &&
    a.total > b.total + Math.abs(b.total) * 1e-12)
/** Best first (a stable order for ties) */
export const compareScores = (a: KqmScore, b: KqmScore) =>
  betterScore(a, b) ? -1 : betterScore(b, a) ? 1 : 0

export function scoreOf(
  problem: KqmProblem,
  values: Record<string, number>
): KqmScore {
  const o = problem.values(values)
  const { nTerms, mins } = problem
  let total = 0
  for (let i = 0; i < nTerms; i++) total += o[i] || 0
  let deficit = 0
  for (let j = 0; j < mins.length; j++) {
    const v = o[nTerms + j]
    const min = mins[j]
    if (!(v >= min)) deficit += (min - (v || 0)) / Math.max(Math.abs(min), 1e-9)
  }
  return { total, deficit }
}

/**
 * The free rolls for these sets and main stats: greedily, the requirements first, then each
 * roll where it adds most; then single rolls moved while that helps.
 */
export function placeRolls(
  problem: KqmProblem,
  sets: KqmSets,
  mains: KqmMains,
  mainValues: KqmMainValues,
  refine = true
): { rolls: KqmRolls; score: KqmScore } {
  const caps = kqmRollCaps(mains)
  const subs = allSubstatKeys.filter(
    (k) => caps[k] > 0 && problem.scales.has(k)
  )
  const rolls: KqmRolls = {}
  const values = kqmStatValues({ sets, mains, rolls }, mainValues)
  let score = scoreOf(problem, values)

  const add = (k: SubstatKey, n: number) => {
    values[k] += n * subRoll(k)
    rolls[k] = (rolls[k] ?? 0) + n
  }
  for (let i = 0; i < KQM_ROLLS; i++) {
    let best: SubstatKey | undefined
    let bestScore: KqmScore | undefined
    for (const k of subs) {
      if ((rolls[k] ?? 0) >= caps[k]) continue
      add(k, 1)
      const s = scoreOf(problem, values)
      add(k, -1)
      if (!bestScore || betterScore(s, bestScore)) (best = k), (bestScore = s)
    }
    if (!best || !bestScore) break
    add(best, 1)
    score = bestScore
  }
  // a roll moved from one substat to another, while one helps
  for (let iter = 0; refine && iter < 40; iter++) {
    let move: [SubstatKey, SubstatKey] | undefined
    let moveScore = score
    for (const a of subs) {
      if (!(rolls[a] ?? 0)) continue
      for (const b of subs) {
        if (a === b || (rolls[b] ?? 0) >= caps[b]) continue
        add(a, -1)
        add(b, 1)
        const s = scoreOf(problem, values)
        add(b, -1)
        add(a, 1)
        if (betterScore(s, moveScore)) (move = [a, b]), (moveScore = s)
      }
    }
    if (!move) break
    add(move[0], -1)
    add(move[1], 1)
    score = moveScore
  }
  // KQMS requires all 20 distributed rolls, including harmless filler when useful stats cap out.
  let remaining =
    KQM_ROLLS - Object.values(rolls).reduce((sum, n) => sum + (n ?? 0), 0)
  for (const key of allSubstatKeys) {
    if (!remaining) break
    const count = Math.min(remaining, caps[key] - (rolls[key] ?? 0))
    if (count > 0) {
      add(key, count)
      remaining -= count
    }
  }
  score = scoreOf(problem, values)
  for (const k of Object.keys(rolls) as SubstatKey[])
    if (!rolls[k]) delete rolls[k]
  return { rolls, score }
}

/**
 * Main stat choices that score the same for this problem count once: a main stat nothing reads
 * (an HP% sands for an ATK scaler) is as good as any other unread one. The first of each kind is
 * kept (the one the full search would pick on a tie).
 */
export function distinctMains(
  problem: KqmProblem,
  mains: readonly KqmMains[]
): KqmMains[] {
  const seen = new Set<string>()
  return mains.filter((m) => {
    const id = [m.sands, m.goblet, m.circlet]
      .map((k) => (problem.scales.has(k) ? k : '-'))
      .sort()
      .join('+')
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export interface KqmSetSearch {
  mains: KqmMains
  rolls: KqmRolls
  score: KqmScore
  /** Builds tried (main stats screened and refined) */
  tried: number
}
/**
 * The best main stats and rolls with these sets: every main stat choice screened with greedy
 * rolls, the best few searched with rolls moved
 */
export function searchSet(
  problem: KqmProblem,
  sets: KqmSets,
  mains: readonly KqmMains[],
  mainValues: KqmMainValues,
  mainsSearched = MAINS_SEARCHED
): KqmSetSearch | undefined {
  const choices = distinctMains(problem, mains)
  const kept = choices
    // Allocate the roll budget before screening: an ATK sands can satisfy ER via substats.
    .map((m) => ({
      mains: m,
      score: placeRolls(problem, sets, m, mainValues, false).score,
    }))
    .sort((a, b) => compareScores(a.score, b.score))
    .slice(0, mainsSearched)
  let best: KqmSetSearch | undefined
  for (const { mains: m } of kept) {
    const { rolls, score } = placeRolls(problem, sets, m, mainValues)
    if (!best || betterScore(score, best.score))
      best = { mains: m, rolls, score, tried: 0 }
  }
  if (best) best.tried = choices.length + kept.length
  return best
}
