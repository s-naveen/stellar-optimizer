import type { RotationAction } from '../parse'
import type { ActionResult, KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/lisa, main as of 2026-11-10. */

const lisaNormals: NormalHit[] = [
  {
    hitmarks: [26],
    toNormal: 30,
    toCharged: 30,
    toAbil: 26,
    frames: 30,
  },
  {
    hitmarks: [18],
    toNormal: 20,
    toCharged: 24,
    toAbil: 18,
    frames: 24,
  },
  {
    hitmarks: [17],
    toNormal: 40,
    toCharged: 34,
    toAbil: 17,
    frames: 40,
  },
  {
    hitmarks: [31],
    toNormal: 57,
    toCharged: 57,
    toAbil: 31,
    frames: 57,
  },
]

interface LisaState {
  /** Conductive stacks on the enemy (max 3), spent by Hold E */
  conductive: number
  /** C6: the swap-in Conductive is ready again at this frame */
  c6Ready: number
  /** Her last action's animation ends, and whether it was a normal attack or a Hold E */
  animEnd: number
  lastKind?: 'normal' | 'hold' | 'other'
}

const addConductive = (s: LisaState) => {
  s.conductive = Math.min(3, s.conductive + 1)
}

function act(
  ctx: SimContext,
  s: LisaState,
  action: RotationAction,
  previous: RotationAction | undefined
): ActionResult {
  switch (action.kind) {
    case 'normal':
      return normalString(
        lisaNormals,
        action.count ?? 1,
        (i, d) =>
          ctx.hit(d, {
            path: ['normal', `${i}`],
            tag: 'normal',
            element: 'electro',
            applies: true,
            icd: 'LisaElectro',
            label: `N${i + 1}`,
          }),
        ctx
      )
    case 'charged': {
      // The charged attack's windup (14f) is skipped while a normal attack or a Hold E is still
      // animating, its last frame included (gcsim: CurrentState)
      const windup =
        ctx.now <= s.animEnd &&
        (s.lastKind === 'normal' || s.lastKind === 'hold')
          ? 14
          : 0
      ctx.hit(70 - windup, {
        path: ['charged', 'dmg'],
        tag: 'charged',
        element: 'electro',
        applies: true,
        label: 'Charged Attack',
      })
      // A1: a charged attack hit adds a Conductive stack (assumed: ascension 1+)
      ctx.at(70 - windup, () => addConductive(s))
      return {
        frames: 93 - windup,
        framesInto: {
          normal: 91 - windup,
          charged: 90 - windup,
          dash: 70 - windup,
          jump: 70 - windup,
          swap: 90 - windup,
        },
      }
    }
    case 'skill': {
      if (!action.hold) {
        // Violet Arc (press): snapshotted at the cast, it hits at 22f and adds a Conductive stack
        // if Lisa is still on the field
        ctx.hit(22, {
          path: ['skill', 'press'],
          tag: 'skill',
          element: 'electro',
          applies: true,
          icd: 'LisaElectro',
          label: 'Violet Arc',
          snapshotDelay: 0,
        })
        ctx.at(22, (c) => {
          if (c.onField === 'Lisa') addConductive(s)
        })
        return {
          cooldown: { key: 'skill', frames: 60, delay: 17 },
          frames: 40,
          framesInto: {
            normal: 37,
            charged: 38,
            dash: 35,
            jump: 20,
            swap: 20,
          },
        }
      }
      // Violet Arc (hold): snapshotted at the cast, 117f, its damage by the Conductive stacks
      // (every stack source has landed by the time a hold starts), which it spends. C2: +25% DEF
      // while it is held (126 frames)
      const n = s.conductive
      ctx.hit(117, {
        path: ['skill', `stack${n}`],
        tag: 'skill',
        element: 'electro',
        applies: true,
        durability: 50,
        icd: 'none',
        label: `Violet Arc (hold, ${n} Conductive)`,
        snapshotDelay: 0,
      })
      ctx.at(117, () => {
        s.conductive = 0
      })
      if (ctx.constellation('Lisa') >= 2)
        ctx.buff('Lisa', ['Lisa', 'LisaC2'], 'on', 0, 126)
      return {
        cooldown: { key: 'skill', frames: 960, delay: 114 },
        frames: 143,
        framesInto: {
          charged: 138,
          burst: 138,
          dash: 116,
          jump: 117,
          swap: 117,
        },
      }
    }
    case 'burst': {
      // Lightning Rose: the initial zap at 56f (no Durability), then 30 zaps every 30f from 119f,
      // snapshotted at 55f. Single target: each zap is one discharge (C4's extra ones need more
      // targets).
      ctx.hit(56, {
        path: ['burst', 'summon'],
        tag: 'burst',
        element: 'electro',
        applies: false,
        icd: 'none',
        label: 'Lightning Rose (initial)',
      })
      for (let i = 0; i < 15 * 60; i += 30)
        ctx.hit(119 + i, {
          path: ['burst', 'tick'],
          tag: 'burst',
          element: 'electro',
          applies: true,
          icd: 'burst',
          label: 'Lightning Rose',
          snapshotDelay: 55,
        })
      // A4: the enemy's DEF -15% for 10 s after each zap (from 119f to the last zap + 10 s)
      ctx.buff('Lisa', ['Lisa', 'LisaA4'], 'on', 119, 870 + 600)
      return {
        cooldown: { key: 'burst', frames: 20 * 60, delay: 53 },
        frames: 88,
        framesInto: {
          normal: 86,
          charged: 86,
          skill: 87,
          jump: 57,
          swap: 56,
        },
      }
    }
    case 'plunge':
      // The parser's plunge is modelled as the low plunge (gcsim's high plunge is not separate)
      ctx.hit(45, {
        path: ['plunging', 'low'],
        tag: 'plunge',
        element: 'electro',
        applies: true,
        icd: 'none',
        label: 'Low Plunge',
      })
      return {
        frames: 67,
        framesInto: {
          normal: 58,
          charged: 48,
          skill: 58,
          burst: 57,
          dash: 45,
          swap: 50,
        },
      }
    case 'dash':
      // Lady body: 22f, and 3f into a jump
      return { frames: 22, framesInto: { jump: 3 } }
    case 'jump':
      // Lady body: 37f after a dash, 32f otherwise
      return templateJump('lady', 'catalyst', previous, ctx)
    default:
      return { frames: 30 }
  }
}

export const kit: KitModel = {
  characterKey: 'Lisa',
  element: 'electro',
  source: `${GCSIM}/lisa`,
  init: (): LisaState => ({ conductive: 0, c6Ready: -1, animEnd: -1 }),
  act(ctx, s: LisaState, action, previous) {
    const result = act(ctx, s, action, previous)
    if (!result.failed) {
      s.animEnd = ctx.now + result.frames
      s.lastKind =
        action.kind === 'normal'
          ? 'normal'
          : action.kind === 'skill' && action.hold
            ? 'hold'
            : 'other'
    }
    return result
  },
  onPartySwap(ctx, s: LisaState, _from, to) {
    if (to !== 'Lisa') return
    s.lastKind = undefined
    // C6: taking the field gives the enemy 3 Conductive stacks (5 s cooldown)
    if (ctx.constellation('Lisa') >= 6 && ctx.now >= s.c6Ready) {
      s.conductive = 3
      s.c6Ready = ctx.now + 5 * 60
    }
  },
}
