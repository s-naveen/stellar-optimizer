import type { ActionResult, KitModel, SimContext } from '../types'
import { atkSpdAdjust, GCSIM, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/mualani, main as of 2026-11-10. */

type Into = NonNullable<ActionResult['framesInto']>

/** Nightsoul's Blessing: points drain 1 per 6 frames while it is on, and it ends at 0 */
const DRAIN = 6
const POINTS_MAX = 60
/** A4 Wavechaser's Exploits: 20 s */
const A4_DURATION = 20 * 60

interface MualaniState {
  /** Nightsoul's Blessing is on */
  blessing: boolean
  /** Its points as of frame `at` */
  points: number
  at: number
  /** Wave Momentum stacks (0-3) */
  momentum: number
  /** Frame the next Wave Momentum stack may come (0.7 s ICD on the enemy) */
  momentumIcd: number
  /** A1: bites of this blessing that gave points (the first two) */
  a1Count: number
  /** C1: the first Surging Bite of this blessing has its bonus */
  c1Done: boolean
  a4Stacks: number
  /** A4's stacks expire at this frame */
  a4End: number
  /** Her first action since being swapped in (still in gcsim's swap state) */
  swappedIn: boolean
}

interface NormalStep {
  hitmarks: number[]
  /** gcsim's CanQueueAfter */
  queueAfter: number
  into: Into
  frames: number
}

/** Outside the blessing: N1..N3 (the string ends at N3) */
const mualaniNormals: NormalStep[] = [
  {
    hitmarks: [11],
    queueAfter: 11,
    into: {
      normal: 23,
      charged: 22,
      skill: 13,
      burst: 11,
      dash: 12,
      jump: 13,
      swap: 11,
    },
    frames: 33,
  },
  {
    hitmarks: [9],
    queueAfter: 8,
    into: {
      normal: 22,
      charged: 24,
      skill: 11,
      burst: 11,
      dash: 10,
      jump: 10,
      swap: 8,
    },
    frames: 32,
  },
  {
    hitmarks: [31],
    queueAfter: 31,
    into: {
      normal: 54,
      charged: 52,
      skill: 32,
      burst: 33,
      dash: 32,
      jump: 34,
      swap: 32,
    },
    frames: 67,
  },
]

/**
 * A normal attack string outside the blessing. It continues the combo (gcsim's NormalCounter
 * survives a wait), every cancel scales with attack speed (gcsim's NewAttackFunc), and a following
 * wait starts at the last hit's CanQueueAfter (attackCQA).
 */
function normalsOut(
  ctx: SimContext,
  count: number,
  onHit: (i: number, delay: number) => void
): ActionResult {
  let start = 0
  const n = Math.max(1, count)
  const first = ctx.normalSequence(mualaniNormals.length, n)
  let last = mualaniNormals[first]
  for (let step = 0; step < n; step++) {
    const i = (first + step) % mualaniNormals.length
    last = mualaniNormals[i]
    last.hitmarks.forEach((h) => onHit(i, start + h))
    if (step < n - 1)
      start += atkSpdAdjust(
        last.into.normal ?? 0,
        ctx.normalAttackSpeed(step > 0)
      )
  }
  const speed = ctx.normalAttackSpeed(n > 1)
  const ls = start
  return {
    frames: ls + atkSpdAdjust(last.frames, speed),
    framesInto: {
      ...Object.fromEntries(
        Object.entries(last.into).map(([k, v]) => [
          k,
          ls + atkSpdAdjust(v as number, speed),
        ])
      ),
      wait: ls + last.queueAfter,
    },
  }
}

/** Sharky's Bite at Wave Momentum stacks 0-2, Surging Bite at 3: its hit, its length and its cancels */
function biteTiming(stacks: number): {
  hit: number
  frames: number
  into: Into
} {
  // the bite starts a 1.8 s Sharky's Bite cooldown at its hit, which sets the next normal: hit + 108
  return stacks >= 3
    ? {
        hit: 42,
        frames: 258,
        into: {
          normal: 150,
          skill: 79,
          burst: 82,
          dash: 78,
          jump: 81,
          swap: 258,
        },
      }
    : {
        hit: 7,
        frames: 215,
        into: {
          normal: 115,
          skill: 39,
          burst: 40,
          dash: 40,
          jump: 40,
          swap: 215,
        },
      }
}

/**
 * The last bite of a `count`-bite string played now (as `bites` plays it) is a Surging Bite: its
 * frames are the action's
 */
function lastBiteSurging(
  ctx: SimContext,
  s: MualaniState,
  count: number
): boolean {
  const c = ctx.constellation('Mualani')
  let momentum = s.momentum
  let a1Count = s.a1Count
  let start = 0
  let surging = false
  for (let i = 0; i < count; i++) {
    if (i > 0 && s.points - (ctx.now + start - s.at) / DRAIN <= 0) break
    const stacks = momentum
    momentum = 0
    if (stacks >= 3 && a1Count < 2) {
      a1Count++
      if (c >= 2) momentum = Math.min(3, momentum + 1)
    }
    surging = stacks >= 3
    start += biteTiming(stacks).into.normal ?? 0
  }
  return surging
}

/** Bring the blessing's points up to frame `t` */
function settle(s: MualaniState, t: number) {
  if (!s.blessing || t <= s.at) return
  s.points -= (t - s.at) / DRAIN
  s.at = t
  if (s.points <= 0) endBlessing(s)
}

function endBlessing(s: MualaniState) {
  s.blessing = false
  s.points = 0
  s.momentum = 0
}

/**
 * The 6 s Skill cooldown a blessing leaves: it starts when the blessing ends, which is when its
 * points run out or (approximated) when Mualani swaps out right after this action (`swapAt`)
 */
function skillCd(s: MualaniState, now: number, swapAt: number) {
  const end = Math.min(s.at + s.points * DRAIN, now + swapAt)
  return { key: 'skill', frames: end + 6 * 60 - now }
}

/** Wave Momentum: while she surfs (dash, jump in the blessing), +1 stack per 0.7 s, max 3 */
function surf(s: MualaniState, from: number, to: number) {
  let t = from
  while (t < to) {
    t = Math.max(t, s.momentumIcd)
    if (t >= to) break
    s.momentum = Math.min(3, s.momentum + 1)
    s.momentumIcd = t + 42
  }
}

/** In the blessing a normal attack is a Sharky's Bite, one per hit of the string */
function bites(ctx: SimContext, s: MualaniState, count: number): ActionResult {
  // a bite resets the normal combo (gcsim's sharkBite sets NormalCounter = 0)
  ctx.normalSequence(1, 1)
  const c = ctx.constellation('Mualani')
  let momentum = s.momentum
  let start = 0
  let lastStart = 0
  let last = biteTiming(0)
  for (let i = 0; i < count; i++) {
    // the blessing ran out before this bite: the rest of the string is not modelled
    if (i > 0 && s.points - (ctx.now + start - s.at) / DRAIN <= 0) {
      ctx.note(
        "Mualani: Nightsoul's Blessing ran out mid-string: the remaining bites are not modelled"
      )
      break
    }
    const stacks = momentum
    const t = biteTiming(stacks)
    momentum = 0 // spent at the bite's hit
    if (stacks >= 3) {
      // C1: +66% Max HP on the first Surging Bite of a blessing (C6: on every one)
      const c1 = c >= 1 && (!s.c1Done || c >= 6)
      if (c1) s.c1Done = true
      ctx.hit(start + t.hit, {
        path: c1 ? ['constellation1', 'surgingDmg'] : ['skill', 'surgingDmg'],
        tag: 'normal',
        element: 'hydro',
        applies: true,
        nightsoul: true,
        label: `Sharky's Surging Bite${c1 ? ' (C1)' : ''}`,
      })
    } else
      ctx.hit(start + t.hit, {
        path: ['skill', ['basicDmg', 'stack1Dmg', 'stack2Dmg'][stacks]],
        tag: 'normal',
        element: 'hydro',
        applies: true,
        nightsoul: true,
        label: stacks ? `Sharky's Bite (${stacks} momentum)` : "Sharky's Bite",
      })
    // A1: a Surging Bite's hit creates a Puffer (at most 2 per blessing), picked up 20 frames
    // later for 20 points (gcsim gives one to any bite; the game text, only to Surging Bites).
    // C2: the pickup also gives +1 Wave Momentum, and the second one 12 more points over 2 s.
    if (stacks >= 3 && s.a1Count < 2) {
      s.a1Count++
      const second = s.a1Count === 2
      ctx.at(start + t.hit + 20, (c2) => {
        settle(s, c2.now)
        if (s.blessing) s.points = Math.min(POINTS_MAX, s.points + 20)
      })
      if (c >= 2) {
        momentum = Math.min(3, momentum + 1)
        if (second)
          for (let k = 1; k <= 12; k++)
            ctx.at(start + t.hit + 20 + 10 * k, (c2) => {
              settle(s, c2.now)
              if (s.blessing) s.points = Math.min(POINTS_MAX, s.points + 1)
            })
      }
    }
    lastStart = start
    last = t
    start += t.into.normal ?? 0
  }
  s.momentum = momentum
  settle(s, ctx.now + lastStart)
  const ls = lastStart
  return {
    frames: ls + last.frames,
    framesInto: Object.fromEntries(
      Object.entries(last.into).map(([k, v]) => [k, ls + (v as number)])
    ),
    cooldown: s.blessing ? skillCd(s, ctx.now, ls + last.frames) : undefined,
  }
}

export const kit: KitModel = {
  characterKey: 'Mualani',
  element: 'hydro',
  source: `${GCSIM}/mualani`,
  nightsoul(ctx, state: MualaniState) {
    const s = { ...state }
    settle(s, ctx.now)
    return { active: s.blessing, points: s.points }
  },
  onNightsoulBurst(ctx, s: MualaniState) {
    // A4 Wavechaser's Exploits: +1 stack (max 3) per party Nightsoul Burst, lasting 20 s
    s.a4Stacks = Math.min(3, (ctx.now < s.a4End ? s.a4Stacks : 0) + 1)
    s.a4End = ctx.now + A4_DURATION
  },
  init: (): MualaniState => ({
    blessing: false,
    points: 0,
    at: 0,
    momentum: 0,
    momentumIcd: -1e9,
    a1Count: 0,
    c1Done: false,
    a4Stacks: 0,
    a4End: -1,
    swappedIn: false,
  }),
  onPartySwap(_ctx, s: MualaniState, _from, to) {
    s.swappedIn = to === 'Mualani'
  },
  // In the blessing she surfs on Sharky: her normal attacks are Sharky's Bites (a Surging Bite at
  // 3 Wave Momentum: its own frames), E ends the blessing, and dash and jump are surfing moves
  variant(ctx, state: MualaniState, action) {
    const s = { ...state }
    settle(s, ctx.now)
    if (!s.blessing) return undefined
    const mode = "Nightsoul's Blessing"
    switch (action.kind) {
      case 'normal':
        return lastBiteSurging(ctx, s, action.count ?? 1)
          ? { key: 'surging', label: "Sharky's Surging Bite", mode }
          : { key: 'sharky', label: "Sharky's Bite", mode }
      case 'skill':
        return { key: 'sharky', label: "End Nightsoul's Blessing", mode }
      case 'dash':
        return { key: 'sharky', label: 'Sharky Surfing Dash', mode }
      case 'jump':
        return { key: 'sharky', label: 'Sharky Surfing Jump', mode }
      default:
        return undefined
    }
  },
  act(ctx, s: MualaniState, action, previous) {
    settle(s, ctx.now)
    const swappedIn = s.swappedIn
    s.swappedIn = false
    switch (action.kind) {
      case 'normal':
        if (s.blessing) return bites(ctx, s, action.count ?? 1)
        return normalsOut(ctx, action.count ?? 1, (i, d) =>
          ctx.hit(d, {
            path: ['normal', `${i}`],
            tag: 'normal',
            element: 'hydro',
            applies: true,
            icd: 'normal',
            label: `N${i + 1}`,
          })
        )
      case 'charged': {
        if (s.blessing)
          return {
            frames: 0,
            failed: "Mualani: no Charged Attack during Nightsoul's Blessing",
          }
        // a windup (13 frames) out of idle (after a wait), a dash, a jump or a swap; otherwise it
        // is rolled into the previous action's cancel (gcsim's CurrentState check)
        const w =
          swappedIn ||
          previous === undefined ||
          previous.kind === 'dash' ||
          previous.kind === 'jump' ||
          previous.kind === 'wait'
            ? 13
            : 0
        ctx.hit(71 + w, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'hydro',
          applies: true,
          label: 'Charged Attack',
        })
        return {
          frames: w + 100,
          framesInto: {
            normal: w + 73,
            charged: w + 85,
            skill: w + 72,
            burst: w + 73,
            dash: w + 72,
            jump: w + 73,
            swap: w + 71,
          },
        }
      }
      case 'skill': {
        if (s.blessing) {
          // E in the blessing ends it: the 6 s Skill cooldown starts now
          endBlessing(s)
          return {
            frames: 17,
            framesInto: { normal: 7, burst: 4, dash: 13, jump: 12, swap: 11 },
            cooldown: { key: 'skill', frames: 6 * 60 },
          }
        }
        // E starts the blessing with 60 points, 2 frames after the cast (C2: 2 Wave Momentum)
        s.blessing = true
        s.points = POINTS_MAX
        s.at = ctx.now + 2
        s.momentum = ctx.constellation('Mualani') >= 2 ? 2 : 0
        s.a1Count = 0
        s.c1Done = false
        ctx.note(
          'Mualani: single target; the surfing enemy is assumed in front of her.'
        )
        return {
          frames: 69,
          framesInto: { normal: 5, burst: 6, dash: 15, jump: 18, swap: 65 },
          cooldown: skillCd(s, ctx.now, 65),
        }
      }
      case 'burst':
        // Boomsharka-laka: 108 frames to the launch, then 70 frames of travel
        ctx.hit(178, {
          path: ['burst', 'dmg'],
          tag: 'burst',
          element: 'hydro',
          applies: true,
          durability: 25,
          nightsoul: true,
          label: 'Boomsharka-laka',
          snapshotDelay: 108,
          states: [
            {
              owner: 'Mualani',
              path: ['Mualani', 'a4Stacks'],
              value: s.a4Stacks && ctx.now < s.a4End ? `${s.a4Stacks}` : '',
            },
          ],
        })
        s.a4Stacks = 0
        return {
          cooldown: { key: 'burst', frames: 15 * 60 },
          frames: 180,
          framesInto: {
            normal: 167,
            skill: 166,
            dash: 167,
            jump: 167,
            swap: 108,
            wait: 108,
          },
        }
      case 'dash': {
        if (!s.blessing)
          // template dash (Girl body): 20 frames, 4 into a jump
          return { frames: 20, framesInto: { jump: 4 } }
        // in the blessing: 10 points and 24 frames of surfing
        s.points -= 10
        const framesInto = { normal: 3, skill: 2, burst: 4, jump: 2, swap: 1 }
        if (s.points <= 0) {
          endBlessing(s)
          return {
            frames: 24,
            framesInto,
            cooldown: { key: 'skill', frames: 6 * 60 },
          }
        }
        surf(s, ctx.now, ctx.now + 24)
        return {
          frames: 24,
          framesInto,
          cooldown: skillCd(s, ctx.now, 1),
        }
      }
      case 'jump': {
        if (!s.blessing)
          // template jump (Girl body): 31 frames, 34 after a dash
          return templateJump('girl', 'catalyst', previous, ctx)
        // in the blessing: 14 points after a dash, else 2, and 54 frames of surfing
        s.points -= previous?.kind === 'dash' ? 14 : 2
        const framesInto = {
          normal: 4,
          burst: 50,
          dash: 49,
          jump: 50,
          swap: 48,
        }
        if (s.points <= 0) {
          endBlessing(s)
          return {
            frames: 54,
            framesInto,
            cooldown: { key: 'skill', frames: 6 * 60 },
          }
        }
        surf(s, ctx.now, ctx.now + 54)
        return {
          frames: 54,
          framesInto,
          cooldown: skillCd(s, ctx.now, 48),
        }
      }
      case 'plunge':
        // gcsim has no plunge frames for Mualani (no plunge.go): not modelled
        ctx.note('Mualani: plunge is not modelled (no plunge frames in gcsim)')
        return { frames: 30 }
      default:
        return { frames: 30 }
    }
  },
  onSwapOut(ctx, s: MualaniState) {
    // swapping out ends the blessing (its 6 s Skill cooldown is set by the last action)
    settle(s, ctx.now)
    endBlessing(s)
  },
  // Skill (E) waits its cooldown only outside the blessing, where E cancels it; burst always waits
  cooldownKey: (s: MualaniState, action) =>
    action.kind === 'skill' && !s.blessing
      ? 'skill'
      : action.kind === 'burst'
        ? 'burst'
        : undefined,
}
