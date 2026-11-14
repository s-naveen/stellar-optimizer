import type { KitModel } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/bennett, main as of 2026-11-10. */

const bennettNormals: NormalHit[] = [
  {
    hitmarks: [13],
    hitlag: [6],
    toNormal: 20,
    toCharged: 33,
    toAbil: 13,
    frames: 33,
  },
  {
    hitmarks: [9],
    hitlag: [6],
    toNormal: 17,
    toCharged: 27,
    toAbil: 9,
    frames: 27,
  },
  {
    hitmarks: [13],
    hitlag: [8],
    toNormal: 37,
    toCharged: 46,
    toAbil: 13,
    frames: 46,
  },
  {
    hitmarks: [25],
    hitlag: [9],
    toNormal: 44,
    toCharged: 48,
    toAbil: 25,
    frames: 48,
  },
  {
    hitmarks: [24],
    hitlag: [11],
    toNormal: 60,
    toCharged: 60,
    toAbil: 24,
    frames: 60,
  },
]

interface BennettState {
  /**
   * Bennett's own field buff (gcsim's StatModIsActive(burstFieldKey), which A4 checks): a tick
   * while he is on field grants it for 126 frames of his clock (hitlag extends it)
   */
  a4Until: number
}

/** Passion Overload's CD: A1 -20%, then A4 -50% inside the field (ascension assumed unlocked) */
function passionCd(base: number, inField: boolean): number {
  const a1 = Math.trunc(base * 0.8)
  return inField ? Math.trunc(a1 * 0.5) : a1
}

export const kit: KitModel = {
  characterKey: 'Bennett',
  element: 'pyro',
  source: `${GCSIM}/bennett`,
  init: (): BennettState => ({ a4Until: Number.NEGATIVE_INFINITY }),
  // C2: +30% Energy Recharge while his HP is below 70% (tracked HP)
  onHpChange(ctx, _s: BennettState, change) {
    const ratio = ctx.hpRatio('Bennett')
    if (change.characterKey === 'Bennett' && ratio !== undefined)
      ctx.state('Bennett', ['Bennett', 'underHP'], ratio < 0.7 ? 'underHP' : '')
  },
  onStart(ctx) {
    ctx.state('Bennett', ['Bennett', 'timeline'], 'on')
    ctx.state('Bennett', ['Bennett', 'fieldRecipient'], '')
  },
  act(ctx, s: BennettState, action, previous) {
    // A4 ("within the area"): the field buff is on Bennett (gcsim: active on its expiry frame)
    const inField = ctx.characterFrame('Bennett') <= s.a4Until
    switch (action.kind) {
      case 'normal':
        return normalString(
          bennettNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged':
        ctx.hit(10, {
          path: ['charged', 'dmg1'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'normal',
          label: 'Charged Attack (1)',
        })
        ctx.hit(21, {
          path: ['charged', 'dmg2'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'normal',
          label: 'Charged Attack (2)',
        })
        return {
          frames: 55,
          framesInto: { skill: 41, burst: 41, dash: 21, jump: 21, swap: 44 },
        }
      case 'skill': {
        if (!action.hold) {
          ctx.hit(16, {
            path: ['skill', 'press'],
            tag: 'skill',
            element: 'pyro',
            applies: true,
            durability: 50,
            icd: 'none',
            label: 'Passion Overload',
          })
          ctx.hit(16, {
            path: ['_marker', 'hitlag'],
            tag: 'other',
            element: 'physical',
            animationPause: 9,
            label: 'Passion Overload hitlag',
          })
          return withHitlag(
            {
              cooldown: {
                key: 'skill',
                frames: passionCd(300, inField),
                delay: 14,
              },
              frames: 42,
              framesInto: { dash: 22, jump: 23, swap: 41 },
            },
            { hitmarks: [16], hitlag: [9] }
          )
        }
        // A hold has no level in the rotation text: hE is Charge Level 1 (gcsim's skill[hold=1]),
        // two strikes on Bennett's clock, each 5.4 frames of hitlag plus the defense halt. Level 2
        // (it launches him outside the field) and C4's follow-up (a Normal Attack pressed during the
        // hold, gcsim's opt-in hold_c4) cannot be written: not modelled.
        for (const [i, t] of [45, 57].entries())
          ctx.atCharacter('Bennett', t, (c) => {
            c.hit(0, {
              path: ['skill', `hold1_${i + 1}`],
              tag: 'skill',
              element: 'pyro',
              applies: true,
              icd: 'none',
              label: `Passion Overload (Level 1, hit ${i + 1})`,
            })
            c.hit(0, {
              path: ['_marker', 'hitlag'],
              tag: 'other',
              element: 'physical',
              animationPause: 9,
              label: 'Passion Overload hitlag',
            })
          })
        return withHitlag(
          {
            cooldown: {
              key: 'skill',
              frames: passionCd(450, inField),
              delay: 43,
            },
            frames: 98,
            framesInto: { burst: 97, dash: 65, jump: 66, swap: 96 },
          },
          { hitmarks: [45, 57], hitlag: [9, 9] }
        )
      }
      case 'burst':
        ctx.hit(37, {
          path: ['burst', 'dmg'],
          tag: 'burst',
          element: 'pyro',
          applies: true,
          durability: 50,
          icd: 'none',
          label: 'Fantastic Voyage',
        })
        // The deployable ticks on world time; each tick grants the current member a
        // separate 126f buff whose expiry pauses with that recipient's hitlag.
        for (let delay = 34; delay <= 754; delay += 60)
          ctx.at(delay, (c) => {
            const ratio = c.hpRatio(c.onField) ?? 1
            if (ctx.constellation('Bennett') >= 1 || ratio > 0.7) {
              if (c.onField === 'Bennett')
                s.a4Until = c.characterFrame('Bennett') + 126
              c.buff('Bennett', ['Bennett', 'fieldRecipient'], 'on', 0, 126, {
                recipient: c.onField,
                hitlag: 'recipient',
              })
              if (ctx.constellation('Bennett') >= 6)
                c.infuse('pyro', 0, 126, c.onField)
            }
            // ("equal to or falls below 70%": game text; gcsim heals below 70% only)
            if (delay !== 34 && c.healthTracked && ratio <= 0.7)
              c.hit(0, {
                path: ['_heal', 'burst', 'regen'],
                tag: 'other',
                element: 'physical',
                label: 'Inspiration Field (Heal)',
              })
          })
        return {
          cooldown: { key: 'burst', frames: 900, delay: 34 },
          frames: 53,
          framesInto: { dash: 49, jump: 50, swap: 51 },
        }
      case 'plunge':
        // gcsim's low plunge (a plain 'P' is taken as low; the high plunge is not modelled)
        ctx.hit(36, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 67,
          framesInto: { normal: 45, skill: 46, burst: 46, dash: 36, swap: 53 },
        }
      case 'dash':
        // a Boy's dash (gcsim's template by body type)
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        return templateJump('boy', 'sword', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
}
