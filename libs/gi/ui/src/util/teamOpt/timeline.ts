import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type {
  TeamOpt,
  TeamOptAttack,
  TeamOptAttackTime,
  TeamOptBuffTrigger,
  TeamOptTimedBuff,
  TeamOptTimelineCast,
} from '@genshin-optimizer/gi/db'
import type { BuffRef } from './data'
import { buffRefKey } from './data'
import type { AttackSegment } from './objective'

/**
 * Team Optimize's timeline (the rotation's advanced mode): when each attack happens, and the
 * buffs that only last a while (Instructor: 8 s after its wearer's reaction; Noblesse Oblige:
 * 12 s after a burst). Each hit then counts the buffs that are up at its time: an attack's hits
 * are split into groups by the timed buffs that cover them, as the plain rotation's buff limits
 * do ("the first N hits"), so the optimizer stays exact for the timeline it is given.
 */

/** A rotation's length when the team has none set (seconds) */
export const defaultRotationTime = 20

/** The rotation's length: as set, else the default (the timeline repeats at its end) */
export const timelineLength = (teamOpt: Pick<TeamOpt, 'rotationTime'>) =>
  teamOpt.rotationTime && teamOpt.rotationTime > 0
    ? teamOpt.rotationTime
    : defaultRotationTime

/** `[start, end)` in seconds from the rotation's start */
export type Interval = readonly [number, number]

/** An attack, with its hits already split by a timeline (see `rotationAttacks`) */
export type TimedAttack = TeamOptAttack & { segments?: AttackSegment[] }

/** The section of the character's sheet an attack is in: `normal`, `skill`, `burst`... */
const sectionOf = (attack: TeamOptAttack) => attack.path[0] ?? ''

const REACTION_PATH =
  /swirl|bloom|burgeon|burning|overload|electrocharg|shatter|superconduct|crystal|lunar|stellar|conduct|Sc$/i

/** Whether an attack's hits trigger a reaction (an amplifying one, or a reaction's own damage) */
export function attackReacts(attack: TeamOptAttack) {
  return !!attack.reaction || REACTION_PATH.test(attack.path.join('/'))
}

/** Whether an attack is `trigger` (a cast for `burst`/`skill`/`skillOrBurst`, else each of its hits) */
export function attackTriggers(
  attack: TeamOptAttack,
  trigger: TeamOptBuffTrigger
): boolean {
  const section = sectionOf(attack)
  switch (trigger) {
    case 'burst':
    case 'skill':
      return section === trigger
    case 'skillOrBurst':
      return section === 'skill' || section === 'burst'
    case 'burstHit':
      return section === 'burst'
    case 'skillHit':
      return section === 'skill'
    case 'hit':
      return true
    case 'normal':
    case 'charged':
    case 'plunging':
      return section === trigger
    case 'reaction':
      return attackReacts(attack)
    default:
      return false
  }
}

/** The times of an attack's hits: evenly spread over its span (all at its start if instant) */
export function hitTimes(at: TeamOptAttackTime, hits: number): number[] {
  const count = Math.max(1, Math.round(hits))
  const span = at.end - at.start
  if (!(span > 0)) return [at.start]
  return Array.from(
    { length: count },
    (_, i) => at.start + ((i + 0.5) * span) / count
  )
}

const isCast = (trigger: TeamOptBuffTrigger) =>
  trigger === 'burst' || trigger === 'skill' || trigger === 'skillOrBurst'

/** Whether a timed buff is started by its sources' casts (their start), else by each of their hits */
export const startsOnCast = (buff: TeamOptTimedBuff) => isCast(buff.trigger)

/** A member's attack, by position in its list */
export type AttackRef = { member: CharacterKey; index: number }

/**
 * The attacks that start a timed buff: the ones the user chose (`startedBy`), else its owner's
 * that match its trigger (a team buff's: any member's)
 */
export function buffSources(
  buff: TeamOptTimedBuff,
  attacks: TeamOpt['attacks']
): AttackRef[] {
  if (buff.trigger === 'manual') return []
  const out: AttackRef[] = []
  if (buff.startedBy) {
    for (const { member, path } of buff.startedBy)
      (attacks[member] ?? []).forEach((attack, index) => {
        if (
          attack.path.length === path.length &&
          attack.path.every((p, i) => p === path[i]) &&
          !out.some((r) => r.member === member && r.index === index)
        )
          out.push({ member, index })
      })
    return out
  }
  const owners =
    buff.owner === 'team'
      ? (Object.keys(attacks) as CharacterKey[])
      : [buff.owner as CharacterKey]
  for (const member of owners)
    (attacks[member] ?? []).forEach((attack, index) => {
      if (attackTriggers(attack, buff.trigger)) out.push({ member, index })
    })
  return out
}

/** When an attack starts a timed buff: its cast, or each of its hits */
function sourceTimes(buff: TeamOptTimedBuff, attack: TeamOptAttack) {
  if (!attack.at || !(attack.hits > 0)) return []
  return startsOnCast(buff)
    ? [attack.at.start]
    : hitTimes(attack.at, attack.hits)
}

/**
 * When a timed buff is triggered: its sources' casts or hits (see `buffSources`); with its
 * trigger found automatically, also its owner's casts that deal no damage
 */
export function buffActivations(
  buff: TeamOptTimedBuff,
  attacks: TeamOpt['attacks'],
  casts: readonly TeamOptTimelineCast[] = []
): number[] {
  if (buff.trigger === 'manual') return []
  const times: number[] = []
  for (const { member, index } of buffSources(buff, attacks)) {
    const attack = attacks[member]?.[index]
    if (attack) times.push(...sourceTimes(buff, attack))
  }
  if (!buff.startedBy && isCast(buff.trigger))
    for (const cast of casts)
      if (
        (buff.owner === 'team' || cast.member === buff.owner) &&
        (buff.trigger === 'skillOrBurst' || cast.kind === buff.trigger)
      )
        times.push(cast.at)
  return times.sort((a, b) => a - b)
}

/** The activations that open or refresh a window: one within `cooldown` of the last is ignored */
export function acceptedActivations(
  buff: TeamOptTimedBuff,
  attacks: TeamOpt['attacks'],
  casts: readonly TeamOptTimelineCast[] = []
): number[] {
  const out: number[] = []
  let last = Number.NEGATIVE_INFINITY
  for (const t of buffActivations(buff, attacks, casts)) {
    if (buff.cooldown && t < last + buff.cooldown) continue
    last = t
    out.push(t)
  }
  return out
}

/** Overlapping or touching intervals merged, in order */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals]
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0])
  const out: [number, number][] = []
  for (const [a, b] of sorted) {
    const last = out[out.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

/**
 * When a timed buff is up: a window from each activation (one within `cooldown` of the last
 * accepted one is ignored), overlapping windows merged (a new trigger refreshes it). Rotations
 * repeat: with the rotation's `length`, a window past its end continues at its start.
 */
export function buffWindows(
  buff: TeamOptTimedBuff,
  attacks: TeamOpt['attacks'],
  casts: readonly TeamOptTimelineCast[] = [],
  length?: number
): Interval[] {
  if (buff.trigger === 'manual') return mergeIntervals(buff.windows ?? [])
  const windows: Interval[] = []
  for (const t of acceptedActivations(buff, attacks, casts)) {
    const end = t + buff.duration
    if (length && length > 0 && end > length) {
      windows.push([t, length])
      // (wrapped, at most once around)
      windows.push([0, Math.min(end - length, t)])
    } else windows.push([t, end])
  }
  return mergeIntervals(windows)
}

/** Whether `t` is in one of `intervals` (`[start, end)`) */
const covers = (intervals: readonly Interval[], t: number) =>
  intervals.some(([a, b]) => t >= a && t < b)

/**
 * An attack's hits, grouped by the timed buffs that cover them (`windows`, per buff) and its own
 * limits ("the first N hits", the first part of its span): each group with the buffs that are
 * off for it. An attack without a time keeps its own limits only (every timed buff covers it).
 */
export function timelineSegments(
  attack: TeamOptAttack,
  windows: readonly { ref: BuffRef; intervals: readonly Interval[] }[]
): AttackSegment[] {
  const total = attack.hits
  if (!(total > 0)) return []
  const at = attack.at
  // each buff that may be off for some hits, with the parts of the span it covers
  const spans: { ref: BuffRef; intervals: readonly Interval[] }[] = []
  const start = at?.start ?? 0
  const length = at ? at.end - at.start : 1
  for (const limit of attack.limits ?? []) {
    const ref = { owner: limit.owner, path: limit.path }
    // the first `hits` of the span, as a time interval
    const end =
      start + (Math.max(0, Math.min(total, limit.hits)) / total) * length
    spans.push({ ref, intervals: end > start ? [[start, end]] : [] })
  }
  if (at)
    for (const w of windows) {
      const limited = spans.find((s) => buffRefKey(s.ref) === buffRefKey(w.ref))
      if (limited)
        // both hold: limited to the first hits, and up in the timeline
        limited.intervals = intersect(limited.intervals, w.intervals)
      else spans.push(w)
    }
  if (!spans.length) return [{ hits: total, excluded: [] }]
  const excludedAt = (t: number) =>
    spans.filter((s) => !covers(s.intervals, t)).map((s) => s.ref)
  if (!(length > 0))
    // all its hits at once
    return [{ hits: total, excluded: excludedAt(start) }]
  const end = start + length
  const cuts = [
    ...new Set([
      start,
      end,
      ...spans.flatMap((s) =>
        s.intervals.flat().filter((x) => x > start && x < end)
      ),
    ]),
  ].sort((a, b) => a - b)
  const groups = new Map<string, AttackSegment>()
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i],
      b = cuts[i + 1]
    const excluded = excludedAt((a + b) / 2)
    const key = excluded.map(buffRefKey).sort().join('/')
    const hits = (total * (b - a)) / length
    const group = groups.get(key)
    if (group) group.hits += hits
    else groups.set(key, { hits, excluded })
  }
  return [...groups.values()].filter((g) => g.hits > 0)
}

function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = []
  for (const [a0, a1] of a)
    for (const [b0, b1] of b) {
      const lo = Math.max(a0, b0),
        hi = Math.min(a1, b1)
      if (hi > lo) out.push([lo, hi])
    }
  return mergeIntervals(out)
}

/** Each timed buff's windows in the timeline */
export function timelineWindows(
  teamOpt: TeamOpt
): { buff: TeamOptTimedBuff; ref: BuffRef; intervals: Interval[] }[] {
  const timeline = teamOpt.timeline
  if (!timeline?.on) return []
  return timeline.buffs.map((buff) => ({
    buff,
    ref: { owner: buff.owner, path: buff.path },
    intervals: buffWindows(
      buff,
      teamOpt.attacks,
      timeline.casts,
      timelineLength(teamOpt)
    ),
  }))
}

/**
 * The rotation's attacks as the optimizer counts them: with the timeline on, each timed attack's
 * hits are split by the timed buffs up at their time (`segments`); else the attacks as they are
 */
export function rotationAttacks(
  teamOpt: TeamOpt
): Partial<Record<CharacterKey, TimedAttack[]>> {
  if (!teamOpt.timeline?.on) return teamOpt.attacks
  const windows = timelineWindows(teamOpt)
  const out: Partial<Record<CharacterKey, TimedAttack[]>> = {}
  for (const [key, list] of Object.entries(teamOpt.attacks))
    out[key as CharacterKey] = (list ?? []).map((attack) =>
      attack.at
        ? { ...attack, segments: timelineSegments(attack, windows) }
        : attack
    )
  return out
}

/**
 * The attack that starts a timed buff at `time` (its cast, or one of its hits): moving it moves
 * the buff's window
 */
export function activationSource(
  buff: TeamOptTimedBuff,
  attacks: TeamOpt['attacks'],
  time: number
): AttackRef | undefined {
  for (const ref of buffSources(buff, attacks)) {
    const attack = attacks[ref.member]?.[ref.index]
    if (
      attack &&
      sourceTimes(buff, attack).some((t) => Math.abs(t - time) < 1e-6)
    )
      return ref
  }
  return undefined
}
