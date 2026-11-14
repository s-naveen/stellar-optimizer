import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { RotationAction } from '../parse'
import type { ActionResult, NormalStateStart, SimContext } from '../types'

/** Where gcsim-derived frame data comes from (credited in each kit's `source`) */
export const GCSIM = 'gcsim (AGPLv3), internal/characters'
/** KQM fork commit used for kits absent from upstream gcsim. */
export const KQMSIM =
  'https://github.com/KQM-git/kqmsim/tree/7bdf45f2e299c6bf782f81dc60d6cb19fd0bfb4c/internal/characters'

export type Kind = RotationAction['kind'] | 'swap'

/** A normal attack string's frames: per hit, its hitmarks and its cancel frames */
export interface NormalHit {
  hitmarks: number[]
  /** Frames paused on each hit, including defense hitlag against the standard enemy. */
  hitlag?: number[]
  /** Core.QueueAttack keeps damage on world time; QueueCharTask pauses later hits. */
  worldTimeHits?: boolean
  /**
   * Cancels into these actions count world time, so this hit's hitlag does not delay them (gcsim's
   * UseNormalizedTime: Hu Tao's Paramita N2 and Keqing's N1 into a charged attack)
   */
  normalizedInto?: readonly (keyof NonNullable<ActionResult['framesInto']>)[]
  /** Into the next normal attack hit */
  toNormal: number
  toCharged: number
  /** Into skill, burst, dash, jump and swap */
  toAbil: number
  /** Default (walk / nothing queued) */
  frames: number
}

/** Frames until `next` can start after a normal attack ending with `hit` */
export const normalInto = (hit: NormalHit): ActionResult['framesInto'] => ({
  normal: hit.toNormal,
  charged: hit.toCharged,
  skill: hit.toAbil,
  burst: hit.toAbil,
  dash: hit.toAbil,
  jump: hit.toAbil,
  swap: hit.toAbil,
  // gcsim wait() starts once the next action can be queued, without waiting for full recovery.
  wait: hit.toAbil,
})

/** Native frames.AtkSpdAdjust: the rate above 10% has half effect, capped at 60%. */
export function atkSpdAdjust(frames: number, speed: number) {
  const capped = Math.min(speed, 0.6)
  return (
    frames - Math.trunc(Math.min(capped, 0.1 + (capped - 0.1) / 2) * frames)
  )
}

/**
 * A normal attack string (N1..Nn): each hit after the previous one's cancel into a normal attack;
 * `onHit(i, delay, j)` schedules hit i's j-th damage instance. The result's frames are the last
 * hit's.
 */
export function normalString(
  hits: NormalHit[],
  count: number,
  onHit: (i: number, delay: number, hitIndex: number) => void,
  ctx?: SimContext
): ActionResult {
  let start = 0
  const n = Math.max(1, count)
  const first = ctx?.normalSequence(hits.length, n) ?? 0
  const normalStarts: NormalStateStart[] = []
  for (let step = 0; step < n; step++) {
    const i = (first + step) % hits.length
    normalStarts.push({ offset: start, index: i })
    let pause = 0
    hits[i].hitmarks.forEach((h, j) => {
      const at = start + h + (hits[i].worldTimeHits ? 0 : pause)
      onHit(i, at, j)
      if (ctx && hits[i].hitlag?.[j])
        ctx.hit(at, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: hits[i].hitlag![j],
          label: 'Melee hitlag',
        })
      pause += hits[i].hitlag?.[j] ?? 0
    })
    if (step < n - 1)
      start += withHitlag(
        {
          frames: Math.max(
            hits[i].toAbil,
            atkSpdAdjust(
              hits[i].toNormal,
              ctx?.normalAttackSpeed?.(step > 0) ?? ctx?.attackSpeed ?? 0
            )
          ),
        },
        hits[i]
      ).frames
  }
  const last = hits[(first + n - 1) % hits.length]
  const speed = ctx?.normalAttackSpeed?.(n > 1) ?? ctx?.attackSpeed ?? 0
  const into = Object.fromEntries(
    Object.entries(normalInto(last)!).map(([kind, frames]) => [
      kind,
      Math.max(last.toAbil, atkSpdAdjust(frames!, speed)),
    ])
  )
  const result = withHitlag(
    {
      frames: Math.max(last.toAbil, atkSpdAdjust(last.frames, speed)),
      framesInto: into,
    },
    last
  )
  return {
    normalStarts,
    frames: start + result.frames,
    framesInto: Object.fromEntries(
      Object.entries(result.framesInto!).map(([k, v]) => [
        k,
        start + (v as number),
      ])
    ),
  }
}

/** Add a hit's animation pause to cancels that occur on or after it. Timers keep real time. */
export function withHitlag(
  result: ActionResult,
  hit: Pick<
    NormalHit,
    'hitmarks' | 'hitlag' | 'worldTimeHits' | 'normalizedInto'
  >
): ActionResult {
  const frames = (base: number, includeBoundary = true) => {
    if (hit.worldTimeHits) {
      let end = base,
        pauseEnd = -1
      hit.hitmarks.forEach((at, i) => {
        if (at > end || (!includeBoundary && at === end)) return
        const next = at + (hit.hitlag?.[i] ?? 0)
        end += Math.max(0, next - Math.max(at, pauseEnd))
        pauseEnd = Math.max(pauseEnd, next)
      })
      return end
    }
    return (
      base +
      hit.hitmarks.reduce(
        (sum, at, i) =>
          sum +
          (at < base || (includeBoundary && at === base)
            ? (hit.hitlag?.[i] ?? 0)
            : 0),
        0
      )
    )
  }
  return {
    ...result,
    frames: frames(result.frames),
    ...(result.framesInto
      ? {
          framesInto: Object.fromEntries(
            Object.entries(result.framesInto).map(([kind, base]) => [
              kind,
              hit.normalizedInto?.includes(kind as never)
                ? base!
                : // wait() can queue on the frame a new hitlag pause begins.
                  frames(base!, kind !== 'wait'),
            ])
          ),
        }
      : {}),
  }
}

/** A character's body type, for the template jump (gcsim's CharBody) */
export type JumpBody = 'boy' | 'girl' | 'male' | 'lady' | 'loli'
/**
 * gcsim's template jump (internal/template/character/stam.go): its length by body type, longer
 * right after a dash; the earliest cancel is the low plunge (5 frames for swords and polearms, 4
 * otherwise), which is also where a following wait starts (gcsim's CanQueueAfter).
 */
export const templateJump = (
  body: JumpBody,
  weapon: 'sword' | 'claymore' | 'polearm' | 'bow' | 'catalyst',
  previous: RotationAction | undefined,
  ctx?: Pick<SimContext, 'hasBuff'>
): ActionResult => {
  const plunge = weapon === 'sword' || weapon === 'polearm' ? 5 : 4
  // Xianyun's Stars Gather at Dusk: the jump goes airborne and only a plunge follows (gcsim's
  // AirborneXianyun: low plunge after 4/5 frames, anything else at its 60-frame upper bound)
  if (ctx?.hasBuff('Xianyun', ['Xianyun', '_airborne']))
    return { frames: 60, framesInto: { plunge, wait: plunge } }
  return {
    frames:
      previous?.kind === 'dash'
        ? body === 'boy' || body === 'girl'
          ? 34
          : 37
        : { boy: 31, girl: 31, male: 28, lady: 32, loli: 29 }[body],
    // gcsim: a written wait starts at the low-plunge window (CanQueueAfter), but every action,
    // a plunge included, follows the whole jump
    framesInto: { wait: plunge },
  }
}

export const kitFramesInto = (r: ActionResult, next: Kind | undefined) =>
  next !== undefined && r.framesInto?.[next] !== undefined
    ? r.framesInto[next]!
    : r.frames

/**
 * gcsim's normal-attack watcher (internal/template/minazuki): while `active`, the active character
 * entering a normal attack state fires `fire` (unless within `icd` frames of the last one), then
 * every `every` frames while that normal attack state lasts. Used by Xingqiu's and Yelan's bursts,
 * Thoma's burst and Fischl's C6.
 */
export interface NormalWatcher {
  last: number
  tickId: number
  /** The current normal attack state's end */
  normalEnd: number
  normalStart: number
  firstNormal: boolean
}
export const newNormalWatcher = (): NormalWatcher => ({
  last: Number.NEGATIVE_INFINITY,
  tickId: 0,
  normalEnd: -1,
  normalStart: -1,
  firstNormal: false,
})

export function watchAction(
  ctx: SimContext,
  w: NormalWatcher,
  action: RotationAction,
  /** How long the action lasts before the next one */
  frames: number,
  hooks: {
    active: (c: SimContext) => boolean
    fire: (c: SimContext) => void
    icd?: number
    every?: number
    /** Frames into each normal attack its state is checked (the attack's start delay) */
    delay?: number
    /** Native periodic checks and cooldowns pause on this character's clock. */
    clock?: CharacterKey
  },
  normalStarts?: readonly NormalStateStart[],
  /** How long the normal-attack state lasts (through a following wait); default `frames` */
  stateFrames?: number
) {
  if (action.kind !== 'normal') {
    w.normalEnd = ctx.now
    return
  }
  w.normalEnd = ctx.now + (stateFrames ?? frames)
  const count = Math.max(1, action.count ?? 1)
  const starts =
    normalStarts ??
    Array.from({ length: count }, (_, i) => ({
      offset: Math.round((i * frames) / count),
      index: i,
    }))
  for (const { offset, index } of starts) {
    ctx.at(offset, (c) => {
      w.normalStart = c.now
      w.firstNormal = index === 0
    })
    ctx.at(offset + (hooks.delay ?? 0), (c) => stateStart(c, w, hooks))
  }
}

function stateStart(
  c: SimContext,
  w: NormalWatcher,
  hooks: Parameters<typeof watchAction>[4]
) {
  const clock = hooks.clock ?? c.onField
  const now = c.characterFrame(clock)
  if (!hooks.active(c) || (hooks.icd !== undefined && now - w.last < hooks.icd))
    return
  const id = ++w.tickId
  w.last = now
  hooks.fire(c)
  const tick = (c2: SimContext) => {
    if (id !== w.tickId || c2.now >= w.normalEnd || !hooks.active(c2)) return
    if (w.firstNormal && c2.now - w.normalStart < (hooks.delay ?? 0)) return
    w.last = c2.characterFrame(clock)
    hooks.fire(c2)
    c2.atCharacter(clock, hooks.every ?? 60, tick)
  }
  c.atCharacter(clock, hooks.every ?? 60, tick)
}

/** Hit probability for a circular shot placed uniformly in an annulus around the field. */
export function annulusHitChance(
  targetRadius: number,
  distance: number,
  innerRadius: number,
  outerRadius: number,
  shotRadius: number
) {
  const d = Math.abs(distance)
  const r = targetRadius + shotRadius
  const overlap = (R: number) => {
    if (d >= r + R) return 0
    if (d <= Math.abs(R - r)) return Math.PI * Math.min(R, r) ** 2
    const a = Math.acos(
      Math.max(-1, Math.min(1, (d * d + r * r - R * R) / (2 * d * r)))
    )
    const b = Math.acos(
      Math.max(-1, Math.min(1, (d * d + R * R - r * r) / (2 * d * R)))
    )
    return (
      r * r * a +
      R * R * b -
      0.5 *
        Math.sqrt(
          Math.max(0, (-d + r + R) * (d + r - R) * (d - r + R) * (d + r + R))
        )
    )
  }
  return (
    (overlap(outerRadius) - overlap(innerRadius)) /
    (Math.PI * (outerRadius ** 2 - innerRadius ** 2))
  )
}
