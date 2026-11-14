import type { ActionResult, KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/iansan, main as of 2026-11-10. */

/** The normal attack string (gcsim's attackHitmarks and attackFrames) */
const iansanNormals: NormalHit[] = [
  {
    hitmarks: [14],
    hitlag: [5],
    toNormal: 21,
    toCharged: 21,
    toAbil: 14,
    frames: 27,
  },
  {
    hitmarks: [7],
    hitlag: [8],
    toNormal: 25,
    toCharged: 25,
    toAbil: 7,
    frames: 31,
  },
  { hitmarks: [22], toNormal: 53, toCharged: 55, toAbil: 22, frames: 55 },
]

/** Nightsoul's blessing: 54 points at most, 0.1 a frame (0.6 every 6 frames), 16 s timed */
const NS_MAX = 54
const NS_DECAY = 0.1
const NS_EXIT_POINTS = 0.2
const NS_BLESSING = 960
/** E: the blessing starts 3 frames in; the burst's, 40 frames in (15 points) */
const E_BLESSING_DELAY = 3
const BURST_BLESSING_DELAY = 40
const BURST_POINTS = 15
/** Fast Skill: the next normal attack or charged attack is a Swift Stormflight, for 5 s */
const FAST_SKILL = 300
/** Swift Stormflight's normal attack cancel */
const SWIFT_TO_NORMAL = 32
/** A1 Precise Movement: 15 s, with an ICD of 2.8 s for its points */
const A1_DURATION = 900
const A1_ICD = 168
/** The burst: 12 s (+3 s with C6), 18 s cooldown */
const BURST_DURATION = 720
const C6_BURST_BONUS = 180
const BURST_CD = 1080
/** The burst's ATK is sampled every 0.3 s, as in gcsim */
const BURST_SAMPLE = 18
/** The burst restores points every second */
const RESTORE = 60

interface IansanState {
  /** Nightsoul's blessing is on */
  blessing: boolean
  /** Its points as of `pointsAt` */
  points: number
  pointsAt: number
  /** The blessing's timed end (frame) */
  blessEnd: number
  /** Bumped on each change, so a scheduled exit only runs if it is still the latest */
  gen: number
  /** The burst's status ends (frame) */
  burstUntil: number
  /** Burst generation: a burst's chains stop when a later burst starts */
  burstGen: number
  /** Fast Skill ends (frame) */
  fastUntil: number
  /** A1 Precise Movement is on (its token: only the latest 15 s timer ends it) */
  a1On: boolean
  a1Token: number
  /** When A1's +4 points is next up (ICD) */
  a1Icd: number
  /** C4 Surging Force stacks, gained once per Scale; the last restore's overflow */
  c4Stacks: number
  c4Generated: boolean
  overflow: number
}

/** Points at frame `t` (the blessing is on, or they are gone) */
const pointsAt = (s: IansanState, t: number) =>
  s.blessing ? Math.max(0, s.points - NS_DECAY * (t - s.pointsAt)) : 0

function settle(s: IansanState, t: number) {
  s.points = pointsAt(s, t)
  s.pointsAt = t
}

/** The blessing ends when its points run out or its timer does: schedule that */
function scheduleExit(ctx: SimContext, s: IansanState) {
  s.gen++
  const gen = s.gen
  const end = Math.min(
    s.blessEnd,
    s.pointsAt + Math.max(0, s.points - NS_EXIT_POINTS) / NS_DECAY
  )
  ctx.at(Math.max(0, end - ctx.now), (c2) => {
    if (s.gen === gen) exitBlessing(c2, s)
  })
}

/** exitNightsoul: the blessing, its points, the burst's status and A1 Precise Movement end */
function exitBlessing(ctx: SimContext, s: IansanState) {
  s.blessing = false
  s.points = 0
  s.pointsAt = ctx.now
  s.gen++
  s.burstUntil = Math.min(s.burstUntil, ctx.now)
  a1End(ctx, s)
}

/**
 * A1 Precise Movement (15 s): +20% ATK, and the Scale's restores give +1 point (+4 once per 2.8 s).
 * It expires when the blessing ends (gcsim's exitNightsoul deletes it). C2: while it lasts and
 * Iansan is off-field, the active member gets +30% ATK (the sheet's condition).
 */
function a1Start(ctx: SimContext, s: IansanState) {
  const token = ++s.a1Token
  if (!s.a1On) {
    s.a1On = true
    ctx.state('Iansan', ['Iansan', 'a1Precise'], 'on')
  }
  ctx.at(A1_DURATION, (c2) => {
    if (s.a1Token === token) a1End(c2, s)
  })
}

function a1End(ctx: SimContext, s: IansanState) {
  s.a1Token++
  if (!s.a1On) return
  s.a1On = false
  ctx.state('Iansan', ['Iansan', 'a1Precise'], '')
}

/** EnterTimedBlessing: the points are set, and the 16 s timer starts */
function enterBlessing(ctx: SimContext, s: IansanState, points: number) {
  s.blessing = true
  s.points = points
  s.pointsAt = ctx.now
  s.blessEnd = ctx.now + NS_BLESSING
  scheduleExit(ctx, s)
}

/** A points change: consumed (dash, jump) or generated; ends the blessing if they run out */
function consume(ctx: SimContext, s: IansanState, amount: number) {
  settle(s, ctx.now)
  s.points = Math.max(0, s.points - amount)
  if (s.points <= NS_EXIT_POINTS) exitBlessing(ctx, s)
  else scheduleExit(ctx, s)
}

function generate(ctx: SimContext, s: IansanState, amount: number) {
  settle(s, ctx.now)
  s.points = Math.min(NS_MAX, s.points + amount)
  scheduleExit(ctx, s)
}

/**
 * The burst's ATK: the sheet's burstNs state (the points, as gcsim's 0.3 s tick reads them),
 * for as long as the burst's status lasts
 */
function burstSample(ctx: SimContext, s: IansanState, gen: number) {
  if (gen !== s.burstGen || ctx.now >= s.burstUntil) return
  const points = pointsAt(s, ctx.now)
  if (points >= 1)
    ctx.buff(
      'Iansan',
      ['Iansan', 'burstNs'],
      `${Math.min(42, Math.floor(points))}`,
      0,
      Math.min(BURST_SAMPLE, s.burstUntil - ctx.now)
    )
  ctx.at(BURST_SAMPLE, (c2) => burstSample(c2, s, gen))
}

/**
 * The Scale's restore (every second, gcsim's restorePointsTask): +1 point while A1 is on (+4 when
 * its ICD is up: gcsim needs the active member to gain or spend Nightsoul points, which is assumed
 * whenever the ICD allows); C4: +4 per Surging Force stack and half the last restore's overflow.
 * C6: any overflow gives Extreme Force (+25% DMG for the active member, 3 s). Points from the
 * active member's movement are not modelled.
 */
function restore(ctx: SimContext, s: IansanState, gen: number, c6: boolean) {
  if (gen !== s.burstGen || ctx.now >= s.burstUntil) {
    s.c4Stacks = 0
    return
  }
  let gain = 0
  if (s.a1On) {
    gain = 1
    if (ctx.now >= s.a1Icd) {
      gain = 4
      s.a1Icd = ctx.now + A1_ICD
    }
  }
  if (ctx.constellation('Iansan') >= 4) {
    gain += s.overflow * 0.5
    if (s.c4Stacks > 0) {
      gain += 4
      s.c4Stacks--
    }
  }
  settle(s, ctx.now)
  s.overflow = Math.max(0, s.points + gain - NS_MAX)
  if (c6 && s.overflow > 0)
    ctx.buff('Iansan', ['Iansan', 'c6Extreme'], 'on', 0, 180)
  if (gain > 0) {
    s.points = Math.min(NS_MAX, s.points + gain)
    scheduleExit(ctx, s)
  }
  ctx.at(RESTORE, (c2) => restore(c2, s, gen, c6))
}

/**
 * Swift Stormflight (a charged attack in the blessing or Fast Skill, or the first normal attack
 * of Fast Skill): its hit triggers A1
 */
function swift(ctx: SimContext, s: IansanState): ActionResult {
  ctx.hit(25, {
    path: ['charged', 'swiftDmg'],
    tag: 'charged',
    element: 'electro',
    applies: true,
    icd: 'none',
    nightsoul: true,
    label: 'Swift Stormflight',
  })
  // A1 Precise Movement: from the Swift's hit (once per Swift)
  ctx.at(25, (c2) => a1Start(c2, s))
  return {
    frames: 33,
    framesInto: {
      normal: SWIFT_TO_NORMAL,
      burst: 24,
      dash: 30,
      jump: 27,
      swap: 31,
    },
  }
}

/** A normal attack string, starting `offset` frames into the action */
function normalAt(
  ctx: SimContext,
  count: number,
  offset: number
): ActionResult {
  const r = normalString(
    iansanNormals,
    count,
    (i, d) =>
      ctx.hit(offset + d, {
        path: ['normal', `${i}`],
        tag: 'normal',
        element: 'physical',
        applies: true,
        icd: 'normal',
        label: `N${i + 1}`,
      }),
    ctx
  )
  if (offset === 0) return r
  return {
    frames: offset + r.frames,
    framesInto: Object.fromEntries(
      Object.entries(r.framesInto ?? {}).map(([k, v]) => [
        k,
        offset + (v as number),
      ])
    ),
  }
}

export const kit: KitModel = {
  characterKey: 'Iansan',
  element: 'electro',
  source: `${GCSIM}/iansan`,
  nightsoul(ctx, s: IansanState) {
    return {
      active: s.blessing && ctx.now < s.blessEnd,
      points: pointsAt(s, ctx.now),
    }
  },
  init: (): IansanState => ({
    blessing: false,
    points: 0,
    pointsAt: 0,
    blessEnd: -1,
    gen: 0,
    burstUntil: -1,
    burstGen: 0,
    fastUntil: -1,
    a1On: false,
    a1Token: 0,
    a1Icd: -1,
    c4Stacks: 0,
    c4Generated: false,
    overflow: 0,
  }),
  onPartyAction(ctx, s: IansanState, actor, action) {
    // C4 Surging Force: the active member (not Iansan) bursting while the Scale is up gives 2
    // stacks, once per Scale
    if (
      action.kind === 'burst' &&
      actor !== 'Iansan' &&
      ctx.constellation('Iansan') >= 4 &&
      ctx.now < s.burstUntil &&
      !s.c4Generated
    ) {
      s.c4Stacks = 2
      s.c4Generated = true
    }
  },
  // Her charged attack in the blessing, and her first normal attack within 5 s of her E, is a Swift
  // Stormflight (its own frames)
  variant(ctx, s: IansanState, action) {
    const swift =
      action.kind === 'charged'
        ? s.blessing || ctx.now < s.fastUntil
        : action.kind === 'normal' && ctx.now < s.fastUntil
    return swift
      ? {
          key: 'swift',
          label: 'Swift Stormflight',
          mode: "Nightsoul's Blessing",
        }
      : undefined
  },
  act(ctx, s: IansanState, action, previous) {
    ctx.note(
      "Iansan: Nightsoul points from the active member's movement are not modelled; A1 is assumed (Ascension 1+)."
    )
    const c6 = ctx.constellation('Iansan') >= 6
    switch (action.kind) {
      case 'normal': {
        const count = action.count ?? 1
        if (ctx.now < s.fastUntil) {
          // Fast Skill: this attack is a Swift Stormflight; the rest of the string is normal
          s.fastUntil = -1
          const first = swift(ctx, s)
          if (count <= 1) return first
          return normalAt(ctx, count - 1, SWIFT_TO_NORMAL)
        }
        return normalAt(ctx, count, 0)
      }
      case 'charged':
        if (s.blessing || ctx.now < s.fastUntil) {
          s.fastUntil = -1
          return swift(ctx, s)
        }
        ctx.hit(21, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'PoleExtraAttack',
          label: 'Charged Attack',
        })
        return {
          frames: 55,
          framesInto: {
            normal: 52,
            skill: 51,
            burst: 50,
            dash: 21,
            jump: 21,
            swap: 49,
          },
        }
      case 'skill':
        ctx.hit(9, {
          path: ['skill', 'skillDmg'],
          tag: 'skill',
          element: 'electro',
          applies: true,
          icd: 'none',
          nightsoul: true,
          label: 'Thunderbolt Rush',
        })
        s.fastUntil = ctx.now + FAST_SKILL
        ctx.at(E_BLESSING_DELAY, (c2) => enterBlessing(c2, s, NS_MAX))
        return {
          cooldown: { key: 'skill', frames: 960 },
          frames: 137,
          framesInto: { normal: 32, burst: 31, dash: 27, jump: 32, swap: 33 },
        }
      case 'burst': {
        ctx.hit(38, {
          path: ['burst', 'skillDmg'],
          tag: 'burst',
          element: 'electro',
          applies: true,
          icd: 'none',
          nightsoul: true,
          label: 'The Three Principles of Power',
        })
        s.burstGen++
        const gen = s.burstGen
        s.burstUntil = ctx.now + BURST_DURATION + (c6 ? C6_BURST_BONUS : 0)
        // C4: a new Scale can gain Surging Force again; C2: Precise Movement for 15 s
        s.c4Stacks = 0
        s.c4Generated = false
        if (ctx.constellation('Iansan') >= 2) a1Start(ctx, s)
        ctx.at(BURST_BLESSING_DELAY, (c2) => {
          if (!s.blessing) enterBlessing(c2, s, BURST_POINTS)
          else generate(c2, s, BURST_POINTS)
        })
        burstSample(ctx, s, gen)
        ctx.at(RESTORE, (c2) => restore(c2, s, gen, c6))
        // the hit pauses her 2 frames (gcsim's 0.02 s HitlagHaltFrames)
        return withHitlag(
          {
            cooldown: { key: 'burst', frames: BURST_CD },
            frames: 45,
            framesInto: { normal: 43, skill: 42, dash: 44, jump: 43, swap: 41 },
          },
          { hitmarks: [38], hitlag: [2] }
        )
      }
      case 'dash':
        // Dash costs 10 points while the blessing is on (the template's dash, Loli body)
        if (s.blessing) consume(ctx, s, 10)
        return { frames: 21, framesInto: { jump: 4 } }
      case 'jump':
        // a jump from a dash costs 6 points (the template's jump, Loli body)
        if (s.blessing && previous?.kind === 'dash') consume(ctx, s, 6)
        return templateJump('loli', 'polearm', previous, ctx)
      default:
        // gcsim has no plunge for Iansan: no damage
        return { frames: 30 }
    }
  },
}
