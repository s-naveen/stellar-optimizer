import type { KitModel } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/xiangling, main as of 2026-11-10. */

/** Five-hit string: the damage lands at each hitmark (no travel) */
const xianglingNormals: NormalHit[] = [
  {
    hitmarks: [12],
    hitlag: [6],
    toNormal: 20,
    toCharged: 20,
    toAbil: 12,
    frames: 20,
  },
  {
    hitmarks: [8],
    hitlag: [6],
    toNormal: 17,
    toCharged: 17,
    toAbil: 8,
    frames: 17,
  },
  {
    hitmarks: [11, 18],
    hitlag: [6, 4],
    toNormal: 28,
    toCharged: 24,
    toAbil: 18,
    frames: 28,
  },
  {
    hitmarks: [5, 15, 24, 29],
    hitlag: [4, 4, 4, 6],
    toNormal: 37,
    toCharged: 34,
    toAbil: 29,
    frames: 37,
  },
  {
    hitmarks: [21],
    hitlag: [9],
    toNormal: 70,
    toCharged: 70,
    toAbil: 21,
    frames: 70,
  },
]

interface XianglingState {
  /** C2: the Oil Meets Fire debuff on the enemy lasts until this frame */
  c2Until: number
}

export const kit: KitModel = {
  characterKey: 'Xiangling',
  element: 'pyro',
  source: `${GCSIM}/xiangling`,
  init: (): XianglingState => ({ c2Until: -1 }),
  // the timeline turns off the sheet's anti-C6 correction on Pyronado: its own snapshot (before
  // C6's buff starts) already leaves C6 out
  onStart(ctx) {
    ctx.state('Xiangling', ['Xiangling', 'timeline'], 'on')
  },
  act(ctx, s: XianglingState, action, previous) {
    switch (action.kind) {
      case 'normal': {
        const c2 = ctx.constellation('Xiangling') >= 2
        return normalString(
          xianglingNormals,
          action.count ?? 1,
          (i, d) => {
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            })
            // C2: the 5th hit sets off Oil Meets Fire 120 frames later, unless one is pending
            // (gcsim: the debuff is active on its expiry frame)
            if (i === 4 && c2 && ctx.now + d > s.c2Until) {
              s.c2Until = ctx.now + d + 120
              ctx.hit(d + 120, {
                path: ['constellation2', 'dmg'],
                tag: 'other',
                element: 'pyro',
                applies: true,
                label: 'Oil Meets Fire (C2)',
              })
            }
          },
          ctx
        )
      }
      case 'charged': {
        // gcsim: a Charged Attack needs a normal attack just before it (any other action resets the
        // normal counter, and a finished 5-hit string leaves it at 0)
        if (
          !(
            previous?.kind === 'normal' &&
            Math.min(previous.count ?? 1, 5) % 5 !== 0
          )
        )
          return {
            frames: 0,
            failed:
              'Xiangling: a Charged Attack needs a normal attack just before it',
          }
        ctx.hit(24, {
          path: ['charged', 'dmg1'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'PoleExtraAttack',
          label: 'Charged Attack',
        })
        return {
          frames: 69,
          framesInto: { normal: 67, dash: 24, jump: 24, burst: 67, swap: 66 },
        }
      }
      case 'skill': {
        // Guoba's flames: the first at frame 126, then every 100 frames while it lasts, all with
        // the stats Guoba snapshotted when it appeared (frame 13)
        for (const t of [126, 226, 326, 426]) {
          ctx.hit(t, {
            path: ['skill', 'press'],
            tag: 'skill',
            element: 'pyro',
            applies: true,
            label: 'Guoba Flame',
            snapshotDelay: 13,
          })
          // C1: the enemy's Pyro RES -15% for 6 s after each flame
          if (ctx.constellation('Xiangling') >= 1)
            ctx.buff(
              'Xiangling',
              ['Xiangling', 'afterGuobaHit'],
              'afterGuobaHit',
              t,
              6 * 60
            )
        }
        // A4's chili pepper (needs a pick-up delay, which the rotation does not give): not modelled
        return {
          cooldown: { key: 'skill', frames: 12 * 60, delay: 13 },
          frames: 39,
          framesInto: { dash: 14, jump: 14, swap: 38 },
        }
      }
      case 'burst': {
        // Pyronado: three swings, then a spin every 73 frames from frame 56 (for 10 s, 14 s with C4)
        for (const [i, t] of [18, 33, 57].entries())
          ctx.atCharacter('Xiangling', t, (c) => {
            c.hit(0, {
              path: ['burst', `dmg${i + 1}`],
              tag: 'burst',
              element: 'pyro',
              applies: true,
              icd: 'burst',
              label: `Pyronado Swing ${i + 1}`,
              snapshotDelay: 0,
            })
            c.hit(0, {
              path: ['_marker', 'hitlag'],
              tag: 'other',
              element: 'physical',
              animationPause: 6,
              label: 'Pyronado swing hitlag',
            })
          })
        const duration = ctx.constellation('Xiangling') >= 4 ? 14 * 60 : 10 * 60
        ctx.atCharacter('Xiangling', 56, (c) => {
          for (let d = 0; d <= duration; d += 73)
            c.hit(d, {
              path: ['burst', 'dmgNado'],
              tag: 'burst',
              element: 'pyro',
              applies: true,
              label: 'Pyronado',
              snapshotDelay: 0,
            })
          // Snapshot first: C6 does not buff this Pyronado's captured Pyro DMG.
          if (c.constellation('Xiangling') >= 6)
            c.buff(
              'Xiangling',
              ['Xiangling', 'afterPyronado'],
              'duringPyronado',
              0,
              duration
            )
        })
        return withHitlag(
          {
            cooldown: { key: 'burst', frames: 20 * 60, delay: 18 },
            frames: 80,
            framesInto: { swap: 79 },
          },
          { hitmarks: [18, 33, 57], hitlag: [6, 6, 6] }
        )
      }
      case 'plunge':
        // the rotation's P is the Low Plunge (High Plunge needs a variant in the text)
        ctx.hit(45, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          label: 'Low Plunge',
        })
        return {
          frames: 77,
          framesInto: { normal: 59, skill: 59, burst: 58, dash: 75, swap: 62 },
        }
      case 'dash':
        // the template dash (Xiangling is a Girl): 20 frames, a jump after 4
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // Girl: 31 frames, 34 after a dash
        return templateJump('girl', 'polearm', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
}
