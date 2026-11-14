import type { RotationAction } from '../parse'
import type { ActionResult, KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/yanfei, main as of 2026-11-10. */

/** Orbs fly 10 frames (gcsim's travel default) */
const TRAVEL = 10

/** Normal attack string (gcsim attack.go): the hits land TRAVEL after their hitmark */
const yanfeiNormals: NormalHit[] = [
  { hitmarks: [22], toNormal: 26, toCharged: 21, toAbil: 12, frames: 26 },
  { hitmarks: [26], toNormal: 28, toCharged: 16, toAbil: 16, frames: 28 },
  { hitmarks: [47], toNormal: 73, toCharged: 42, toAbil: 37, frames: 73 },
]

/** Scarlet Seals: the most (3, or 4 with C6) */
const maxSeals = (c: number) => (c >= 6 ? 4 : 3)

interface YanfeiState {
  /** Scarlet Seals */
  seals: number
  /** The Scarlet Seal buff (10 s, refreshed by each seal) lasts until this frame */
  sealEnd: number
  /** Off the field since her last action: a Charged Attack that follows a swap has no windup */
  away: boolean
  /** Her last action's animation ends (after it she is idle: no Charged Attack windup) */
  animEnd: number
  /** Brilliance (Done Deal): its run, ended early when she leaves the field */
  brilliance: number
  /** A1's latest Charged Attack (a new one dispels the previous effect) */
  a1: number
}

const yanfeiClock = (ctx: SimContext) => ctx.characterFrame('Yanfei')

function addSeal(ctx: SimContext, s: YanfeiState, max = false) {
  const top = maxSeals(ctx.constellation('Yanfei'))
  s.seals = max ? Math.max(s.seals, top) : Math.min(top, s.seals + 1)
  s.sealEnd = yanfeiClock(ctx) + 600
}

function act(
  ctx: SimContext,
  s: YanfeiState,
  action: RotationAction,
  previous: RotationAction | undefined
): ActionResult {
  const away = s.away
  s.away = false
  switch (action.kind) {
    case 'normal':
      return normalString(
        yanfeiNormals,
        action.count ?? 1,
        (i, d) =>
          ctx.hit(d, {
            path: ['normal', `${i}`],
            tag: 'normal',
            element: 'pyro',
            applies: true,
            icd: 'normal',
            label: `N${i + 1}`,
            // the orb snapshots when it is thrown, TRAVEL before it lands
            snapshotDelay: d - TRAVEL,
          }),
        ctx
      )
    case 'charged': {
      // The Charged Attack has a 16-frame windup, unless she is idle (her last action's animation
      // is over) or has just swapped in (gcsim: CurrentState Idle or SwapState)
      const w = away || previous === undefined || ctx.now > s.animEnd ? 0 : 16
      // The seals are cleared once their buff is over (checked as the attack starts), and consumed
      if (yanfeiClock(ctx) > s.sealEnd) s.seals = 0
      const n = s.seals
      s.seals = 0
      s.sealEnd = -1
      // A1: +5% Pyro DMG per seal consumed for 6 s; this Charged Attack dispels the previous effect
      const a1 = ++s.a1
      ctx.state('Yanfei', ['Yanfei', 'p1Seals'], n ? `${n}` : '')
      ctx.atCharacter('Yanfei', 360, (c) => {
        if (s.a1 === a1) c.state('Yanfei', ['Yanfei', 'p1Seals'], '')
      })
      ctx.hit(63 - w, {
        path: ['charged', `${n}`],
        tag: 'charged',
        element: 'pyro',
        applies: true,
        durability: 25,
        icd: 'none',
        label: n ? `Charged Attack (${n} seals)` : 'Charged Attack',
      })
      // A4: a crit Charged Attack's extra hit, 10 frames later, while she is on the field (the
      // crit chance is the node's hit mode)
      ctx.at(63 - w, (c) => {
        if (c.onField === 'Yanfei')
          c.hit(10, {
            path: ['passive2', 'probabilistic_dmg'],
            tag: 'charged',
            element: 'pyro',
            applies: true,
            durability: 25,
            icd: 'none',
            label: 'Blazing Eye (A4)',
          })
      })
      return {
        frames: 79 - w,
        framesInto: {
          charged: 78 - w,
          skill: 63 - w,
          burst: 63 - w,
          dash: 51 - w,
          jump: 49 - w,
          swap: 59 - w,
        },
      }
    }
    case 'skill':
      // Signed Edict: snapshotted at the cast, it lands at 32 (max seals on hit, see onHit)
      ctx.hit(32, {
        path: ['skill', 'dmg'],
        tag: 'skill',
        element: 'pyro',
        applies: true,
        durability: 25,
        icd: 'none',
        snapshotDelay: 0,
        label: 'Signed Edict',
      })
      return {
        cooldown: { key: 'skill', frames: 540, delay: 28 },
        frames: 46,
        framesInto: { charged: 35, burst: 43, dash: 29, jump: 34, swap: 44 },
      }
    case 'burst': {
      ctx.hit(24, {
        path: ['burst', 'dmg'],
        tag: 'burst',
        element: 'pyro',
        applies: true,
        durability: 50,
        icd: 'none',
        // (gcsim: stats at the cast)
        snapshotDelay: 0,
        label: 'Done Deal',
      })
      // its hit pauses her: gcsim's default defense halt (3.6 frames, applied as 4); Blazing
      // Eye (A4) does too, but only on a crit, so it is left out of the expected timeline
      ctx.hit(24, {
        path: ['_marker', 'hitlag'],
        tag: 'other',
        element: 'physical',
        animationPause: 4,
        label: 'Done Deal hitlag',
      })
      // Brilliance: Charged Attack DMG for 15 s and a Scarlet Seal every second. "The effects of
      // Brilliance will end if Yanfei leaves the field" (game text; gcsim keeps both off-field)
      const run = ++s.brilliance
      ctx.state('Yanfei', ['Yanfei', 'afterBurst'], 'on')
      ctx.atCharacter('Yanfei', 900, (c) => {
        if (s.brilliance === run)
          c.state('Yanfei', ['Yanfei', 'afterBurst'], '')
      })
      // the seal ticks at 1..15 s (gcsim's 901-frame status lets the 15th one in)
      const tick = (c: SimContext, k: number) => {
        if (s.brilliance !== run) return
        addSeal(c, s)
        if (k < 15) c.atCharacter('Yanfei', 60, (c2) => tick(c2, k + 1))
      }
      ctx.atCharacter('Yanfei', 60, (c) => tick(c, 1))
      return withHitlag(
        {
          cooldown: { key: 'burst', frames: 1200 },
          frames: 58,
          framesInto: {
            charged: 47,
            skill: 55,
            dash: 33,
            jump: 32,
            swap: 46,
          },
        },
        { hitmarks: [24], hitlag: [4] }
      )
    }
    case 'dash':
      return { frames: 20, framesInto: { jump: 4 } }
    case 'jump':
      return templateJump('girl', 'catalyst', previous, ctx)
    case 'plunge':
      // gcsim's low plunge (gcsim itself allows it only in Xianyun's airborne state)
      ctx.hit(45, {
        path: ['plunging', 'low'],
        tag: 'plunge',
        element: 'pyro',
        applies: true,
        durability: 25,
        icd: 'none',
        label: 'Low Plunge',
      })
      return {
        frames: 65,
        framesInto: {
          normal: 57,
          charged: 46,
          skill: 57,
          burst: 57,
          dash: 45,
          swap: 48,
        },
      }
    default:
      return { frames: 30 }
  }
}

// Not modelled: C2 (needs the enemy below 50% HP: the sheet's condition), C1's stamina and C4's
// shield.
export const kit: KitModel = {
  characterKey: 'Yanfei',
  element: 'pyro',
  source: `${GCSIM}/yanfei`,
  init: (): YanfeiState => ({
    seals: 0,
    sealEnd: -1,
    away: false,
    animEnd: -1,
    brilliance: 0,
    a1: 0,
  }),
  act(ctx, s: YanfeiState, action, previous) {
    const result = act(ctx, s, action, previous)
    if (!result.failed) s.animEnd = ctx.now + result.frames
    return result
  },
  onHit(ctx, s: YanfeiState, hit) {
    if (hit.characterKey !== 'Yanfei') return
    if (hit.tag === 'normal' && hit.onField === 'Yanfei') {
      // A normal attack hit adds a seal while she is on the field
      addSeal(ctx, s)
    } else if (
      hit.path[1] === 'dmg' &&
      (hit.path[0] === 'skill' || hit.path[0] === 'burst')
    ) {
      // Signed Edict and Done Deal: max seals on hit
      addSeal(ctx, s, true)
    }
  },
  onSwapOut(ctx, s: YanfeiState) {
    // Leaving the field clears the seals and their buff, and ends Brilliance
    s.seals = 0
    s.sealEnd = -1
    s.away = true
    ctx.state('Yanfei', ['Yanfei', 'afterBurst'], '')
    s.brilliance++
  },
}
