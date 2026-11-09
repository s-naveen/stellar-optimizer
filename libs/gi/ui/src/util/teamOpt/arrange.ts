import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOptAttack, TeamOptAttackTime } from '@genshin-optimizer/gi/db'

/**
 * A first timeline for a rotation that has none, laid out as rotations are usually played: the
 * supports first (their skills and bursts, in team order), then the member who stays on the
 * field casts and attacks for the rest. The damage of a field or summon (a skill's or burst's
 * many hits) runs on alongside, from that member's cast. Typical action lengths: a starting point
 * to adjust, not a simulation.
 */

/** Seconds per cast (the action itself) */
const CAST: Record<string, number> = { skill: 0.8, burst: 1.6 }
/** Seconds per hit of an on-field string */
const PER_HIT: Record<string, number> = {
  normal: 0.45,
  charged: 1,
  plunging: 1,
}
/** A skill's or burst's attack with this many hits runs on (a field, a summon) */
const RUNS_ON_HITS = 4
/** How long such damage runs, from its cast */
const RUNS_FOR: Record<string, number> = { skill: 8, burst: 10 }
/** The section of a reaction's own damage (a swirl): no time of its own on the field */
const REACTION = 'reaction'
/** Seconds of an instant add-on (a reaction, a cast's extra hit) */
const ALONGSIDE = 0.5
/** Anything else: one action */
const OTHER = 0.8

const section = (attack: TeamOptAttack) => attack.path[0] ?? ''
const round = (x: number) => Math.round(x * 10) / 10

/** Whether an attack's hits run on after its cast (a field, a summon, damage over time) */
export function runsOn(attack: TeamOptAttack) {
  const s = section(attack)
  return (s === 'skill' || s === 'burst') && attack.hits >= RUNS_ON_HITS
}

/** Seconds of on-field time an attack takes (its cast, or its string of hits) */
function actionSpan(attack: TeamOptAttack) {
  const s = section(attack)
  if (CAST[s] !== undefined) return CAST[s]
  if (PER_HIT[s] !== undefined)
    return Math.max(PER_HIT[s], PER_HIT[s] * Math.min(attack.hits, 20))
  return OTHER
}

/** Seconds of Normal, Charged and Plunging Attacks a member does in the rotation */
function stringTime(attacks: readonly TeamOptAttack[] | undefined) {
  let time = 0
  for (const attack of attacks ?? [])
    if (PER_HIT[section(attack)] !== undefined) time += actionSpan(attack)
  return time
}

/**
 * Times for the attacks (`only`: those without one; else all), members in `order`. Who stays on
 * the field (`carry`, else the member with the most Normal/Charged/Plunging time) goes last. With
 * `length` (the rotation time), on-field time is squeezed to fit and nothing runs past it.
 */
export function arrangeTimeline(
  order: readonly CharacterKey[],
  attacks: Partial<Record<CharacterKey, TeamOptAttack[]>>,
  {
    length,
    only,
    carry,
  }: { length?: number; only?: 'untimed'; carry?: CharacterKey } = {}
): Partial<Record<CharacterKey, TeamOptAttack[]>> {
  type Placed = { member: CharacterKey; index: number; at: TeamOptAttackTime }
  const placed: Placed[] = []
  const todo = (attack: TeamOptAttack) => !(only === 'untimed' && attack.at)
  // who stays on the field: last, after the supports' casts
  let main = carry && order.includes(carry) ? carry : undefined
  if (!main) {
    let most = 0
    for (const member of order) {
      const time = stringTime(attacks[member])
      if (time > most) {
        most = time
        main = member
      }
    }
  }
  const sequence = main
    ? [...order.filter((m) => m !== main), main]
    : [...order]
  // where on-field time stands: after the latest placed action, when only filling gaps
  let t = 0
  if (only === 'untimed')
    for (const member of order)
      for (const attack of attacks[member] ?? [])
        if (attack.at && !runsOn(attack)) t = Math.max(t, attack.at.end)
  const onFieldEnd: number[] = []
  /** The attacks laid out one after another (the others run alongside) */
  const onField = new Set<string>()
  for (const member of sequence) {
    const list = attacks[member] ?? []
    // when the member first casts each kind (its casts already placed count)
    const firstCast: Partial<Record<string, number>> = {}
    const cast = (s: string, time: number) => {
      firstCast[s] = Math.min(firstCast[s] ?? time, time)
    }
    for (const attack of list)
      if (attack.at && !todo(attack) && CAST[section(attack)] !== undefined)
        cast(section(attack), attack.at.start)
    // what takes the member's time on the field: its first cast of each kind (a skill's or
    // burst's other attacks are its ticks and add-ons), then its strings; reactions take none
    const castOf: Partial<Record<string, number>> = {}
    list.forEach((attack, index) => {
      const s = section(attack)
      if (CAST[s] !== undefined && !runsOn(attack) && castOf[s] === undefined)
        castOf[s] = index
    })
    // (a kind with only fields and summons: the first of them is its cast)
    list.forEach((attack, index) => {
      const s = section(attack)
      if (CAST[s] !== undefined && castOf[s] === undefined) castOf[s] = index
    })
    const isAction = (attack: TeamOptAttack, index: number) => {
      const s = section(attack)
      if (CAST[s] !== undefined) return castOf[s] === index
      return s !== REACTION
    }
    const actions = list
      .map((attack, index) => ({ attack, index }))
      .filter(({ attack, index }) => todo(attack) && isAction(attack, index))
      .sort(
        (a, b) =>
          Number(CAST[section(a.attack)] === undefined) -
          Number(CAST[section(b.attack)] === undefined)
      )
    for (const { attack, index } of actions) {
      const at = { start: t, end: t + actionSpan(attack) }
      if (CAST[section(attack)] !== undefined) cast(section(attack), t)
      placed.push({ member, index, at })
      onField.add(`${member}:${index}`)
      t = at.end
      onFieldEnd.push(t)
    }
    // the rest, alongside: a skill's or burst's ticks and fields from its cast, a reaction's
    // damage with the member's first cast (else where it stands)
    const anyCast = Object.values(firstCast).filter(
      (x): x is number => x !== undefined
    )
    const first = anyCast.length ? Math.min(...anyCast) : t
    list.forEach((attack, index) => {
      if (!todo(attack) || isAction(attack, index)) return
      const s = section(attack)
      const start = s === REACTION ? first : (firstCast[s] ?? first)
      const span =
        s === REACTION
          ? ALONGSIDE
          : runsOn(attack) || attack.hits >= 2
            ? (RUNS_FOR[s] ?? 8)
            : ALONGSIDE
      placed.push({ member, index, at: { start, end: start + span } })
    })
  }
  // fit the rotation: on-field time squeezed (all of it laid out again), nothing past its end
  const busy = Math.max(0, ...onFieldEnd)
  const scale =
    length && busy > length && only !== 'untimed' ? length / busy : 1
  const out: Partial<Record<CharacterKey, TeamOptAttack[]>> = {}
  for (const member of order) out[member] = [...(attacks[member] ?? [])]
  for (const { member, index, at } of placed) {
    const attack = attacks[member]![index]
    const span = at.end - at.start
    let start = round(at.start * scale)
    const alongside = !onField.has(`${member}:${index}`)
    let end = round(alongside ? start + span : at.end * scale)
    if (length) {
      // (filling gaps in a full rotation: at its end)
      if (end > length) {
        start = alongside ? start : Math.max(0, round(length - span))
        end = length
      }
      start = Math.min(start, length)
    }
    out[member]![index] = {
      ...attack,
      at: { start, end: Math.max(start, end) },
    }
  }
  return out
}
