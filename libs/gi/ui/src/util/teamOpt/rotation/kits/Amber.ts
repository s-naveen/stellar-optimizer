import type { ActionResult, KitModel } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/amber, main as of 2026-11-10. */

/** Arrows fly 10 frames (gcsim's travel default): a normal attack lands `TRAVEL` after its hitmark */
const TRAVEL = 10

/** Explosive Puppet held (gcsim's `hold` is frames held, default 0): hE is modelled as a 1 s hold */
const HOLD = 60

const amberNormals: NormalHit[] = [
  // cancels use the hitmark (Aim is Amber's charged attack); the damage lands TRAVEL later
  {
    hitmarks: [14 + TRAVEL],
    toNormal: 26,
    toCharged: 14,
    toAbil: 14,
    frames: 26,
  },
  {
    hitmarks: [10 + TRAVEL],
    toNormal: 22,
    toCharged: 10,
    toAbil: 10,
    frames: 22,
  },
  {
    hitmarks: [27 + TRAVEL],
    toNormal: 37,
    toCharged: 27,
    toAbil: 27,
    frames: 37,
  },
  {
    hitmarks: [26 + TRAVEL],
    toNormal: 34,
    toCharged: 26,
    toAbil: 26,
    frames: 34,
  },
  {
    hitmarks: [26 + TRAVEL],
    toNormal: 60,
    toCharged: 26,
    toAbil: 26,
    frames: 60,
  },
]

/** Fiery Rain's 18 arrows: 72 + the spawn offsets (5 every 0.4 s, 3 every 0.6 s, 10 every 0.2 s) */
const fieryRainArrows = [
  ...[24, 48, 72, 96, 120],
  ...[36, 72, 108],
  ...[12, 24, 36, 48, 60, 72, 84, 96, 108, 120],
]
  .map((t) => 72 + t)
  .sort((a, b) => a - b)

interface AmberState {
  /** Explosive Puppet charges left (undefined: all of them) */
  charges?: number
  /** When the next charge comes back */
  restoreAt?: number
}

/** Charges come back one at a time, `cd` frames each (gcsim's charge timers) */
function settleCharges(s: AmberState, t: number, max: number, cd: number) {
  while (s.restoreAt !== undefined && s.restoreAt <= t) {
    s.charges = (s.charges ?? max) + 1
    s.restoreAt = s.charges < max ? s.restoreAt + cd : undefined
  }
}

export const kit: KitModel = {
  characterKey: 'Amber',
  element: 'pyro',
  source: `${GCSIM}/amber`,
  init: (): AmberState => ({}),
  act(ctx, s: AmberState, action, previous) {
    const c = ctx.constellation('Amber')
    switch (action.kind) {
      case 'normal':
        return normalString(
          amberNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'none',
              label: `N${i + 1}`,
              // the arrow snapshots when it is fired (gcsim's QueueAttack snapshot delay)
              snapshotDelay: d - TRAVEL,
            }),
          ctx
        )
      case 'charged': {
        // the fully-charged Aimed Shot (gcsim's default for "aim"), 86 + travel
        ctx.hit(96, {
          path: ['charged', 'aimedCharged'],
          tag: 'charged',
          element: 'pyro',
          applies: true,
          durability: 50,
          icd: 'extra',
          icdGroup: 'Amber',
          label: 'Fully-Charged Aimed Shot',
          snapshotDelay: 86,
        })
        // C1: a second arrow 9 frames after the first, at 20% of its damage
        if (c >= 1)
          ctx.hit(105, {
            path: ['constellation1', 'secondAimedCharged'],
            tag: 'charged',
            element: 'pyro',
            applies: true,
            durability: 50,
            icd: 'extra',
            icdGroup: 'Amber',
            label: 'Fully-Charged Aimed Shot (C1 arrow)',
            snapshotDelay: 95,
          })
        return { frames: 96, framesInto: { dash: 86, jump: 86 } }
      }
      case 'skill': {
        const hold = action.hold ? HOLD : 0
        const max = c >= 4 ? 2 : 1
        const cd = c >= 4 ? 720 : 900
        settleCharges(s, ctx.now, max, cd)
        const left = s.charges ?? max
        if (left <= 0)
          return {
            frames: 0,
            failed: 'Amber: no Explosive Puppet charge ready',
          }
        s.charges = left - 1
        // the charge comes back `cd` after the cast's release (frame 5 + hold)
        if (s.restoreAt === undefined) s.restoreAt = ctx.now + 5 + hold + cd
        // the Baron Bunny lands at 45 + hold (its explosion snapshots there) and explodes when it
        // expires (484 frames), 1 frame later
        ctx.hit(530 + hold, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'pyro',
          applies: true,
          durability: 50,
          icd: 'none',
          label: 'Baron Bunny (explosion)',
          snapshotDelay: 45 + hold,
        })
        if (c >= 2)
          ctx.note(
            'Amber: C2 manual detonation (an Aimed Shot at the Baron Bunny) and Overload explosions not modelled.'
          )
        const result: ActionResult = {
          frames: 33 + hold,
          framesInto: {
            normal: 32 + hold,
            burst: 32 + hold,
            dash: 8 + hold,
            jump: 8 + hold,
            swap: 23 + hold,
            // gcsim's CanQueueAfter is the release (frame 5 + hold)
            wait: 5 + hold,
          },
        }
        if (s.charges === 0 && s.restoreAt !== undefined)
          result.cooldown = { key: 'skill', frames: s.restoreAt - ctx.now }
        return result
      }
      case 'burst': {
        // Fiery Rain: 18 arrows, each Pyro (gcsim's Amber ICD group: 1 s, 1 of every 3 applies),
        // all snapshotted at the cast
        fieryRainArrows.forEach((t) =>
          ctx.hit(t, {
            path: ['burst', 'dmgPerWave'],
            tag: 'burst',
            element: 'pyro',
            applies: true,
            icd: 'burst',
            icdGroup: 'Amber',
            label: 'Fiery Rain arrow',
            snapshotDelay: 0,
          })
        )
        // C6: team ATK and move speed "for 10s" (game text; gcsim has 900 frames)
        if (c >= 6) ctx.buff('Amber', ['Amber', 'C6'], 'on', 0, 600)
        return {
          cooldown: { key: 'burst', frames: 720, delay: 56 },
          frames: 111,
          framesInto: { dash: 57, jump: 58, swap: 60 },
        }
      }
      case 'plunge':
        // gcsim has no plunging attack for Amber
        ctx.note('Amber: plunging attack not modelled (gcsim has none).')
        return { frames: 30 }
      case 'dash':
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        return templateJump('girl', 'bow', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  // Explosive Puppet: 2 charges from C4 (720 frames each), else 1 charge (900 frames)
  cooldownKey: (s: AmberState, action) =>
    action.kind === 'burst'
      ? 'burst'
      : action.kind === 'skill' && s.charges === 0
        ? 'skill'
        : undefined,
}
