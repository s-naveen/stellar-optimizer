import type { KitModel } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/diona, main as of 2026-11-10. */

/**
 * N1..N5 from gcsim's attack.go: the arrow's travel (10 frames) is added to each hitmark. The
 * cancels (toCharged = the aimed shot's cancel, toAbil) come from the hitmark without travel.
 */
const dionaNormals: NormalHit[] = [
  { hitmarks: [29], toNormal: 30, toCharged: 19, toAbil: 19, frames: 30 },
  { hitmarks: [21], toNormal: 21, toCharged: 11, toAbil: 11, frames: 21 },
  { hitmarks: [31], toNormal: 44, toCharged: 21, toAbil: 21, frames: 44 },
  { hitmarks: [20], toNormal: 21, toCharged: 10, toAbil: 10, frames: 21 },
  { hitmarks: [48], toNormal: 73, toCharged: 38, toAbil: 38, frames: 73 },
]

interface DionaState {
  /** Signature Mix's field (C4's window): until (frame) */
  fieldUntil: number
  /**
   * Revelation: reaction-triggered Icy Paws until this frame of Diona's clock (20 s after E).
   * gcsim's statuses are active through their expiry frame, hence the +1 on these ends.
   */
  revelationUntil: number
  /** Revelation's 3.5 s ICD, on Diona's clock */
  revelationIcd: number
}

/** Revelation (Choice Treasures): the reactions that fire 3 Icy Paws */
const REVELATION_REACTIONS = [
  'superconduct',
  'stellarConduct',
  'cryoSwirl',
  'stellarSwirl',
]

export const kit: KitModel = {
  characterKey: 'Diona',
  element: 'cryo',
  source: `${GCSIM}/diona`,
  init: (): DionaState => ({
    fieldUntil: -1,
    revelationUntil: -1,
    revelationIcd: -1,
  }),
  onStart(ctx) {
    // Revelation is unlocked (gcsim's default): C6's Max HP and Stellar Glimmer need it
    ctx.state('Diona', ['Diona', 'lockRevelation'], 'on')
  },
  act(ctx, s: DionaState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          dionaNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'none',
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged': {
        // Fully-Charged Aimed Shot: 86 frames + 10 of travel; C4 is faster inside Signature Mix
        if (ctx.constellation('Diona') >= 4 && ctx.now < s.fieldUntil) {
          ctx.hit(60, {
            path: ['charged', 'aimedCharged'],
            tag: 'charged',
            element: 'cryo',
            applies: true,
            icd: 'charged',
            label: 'Fully-Charged Aimed Shot (C4)',
          })
          return {
            frames: 58,
            framesInto: { dash: 50, jump: 50 },
          }
        }
        ctx.hit(96, {
          path: ['charged', 'aimedCharged'],
          tag: 'charged',
          element: 'cryo',
          applies: true,
          icd: 'charged',
          label: 'Fully-Charged Aimed Shot',
        })
        return {
          frames: 94,
          framesInto: { dash: 86, jump: 86 },
        }
      }
      case 'skill': {
        // Icy Paws: 2 paws (tap) or 5 (hold), each landing 10 frames of travel after its release
        const hold = !!action.hold
        if (hold) {
          for (let i = 0; i < 5; i++)
            ctx.hit(34 + i, {
              path: ['skill', 'skillDmg'],
              tag: 'skill',
              element: 'cryo',
              applies: true,
              icd: 'skill',
              label: 'Icy Paw',
            })
          s.revelationUntil = ctx.characterFrame('Diona') + 1201
          return {
            cooldown: { key: 'skill', frames: 900, delay: 29 },
            frames: 49,
            framesInto: { normal: 36, burst: 37, dash: 31, jump: 31, swap: 29 },
          }
        }
        for (let i = 0; i < 2; i++)
          ctx.hit(10 + i, {
            path: ['skill', 'skillDmg'],
            tag: 'skill',
            element: 'cryo',
            applies: true,
            icd: 'skill',
            label: 'Icy Paw',
          })
        s.revelationUntil = ctx.characterFrame('Diona') + 1201
        return {
          cooldown: { key: 'skill', frames: 360, delay: 5 },
          frames: 34,
          framesInto: { normal: 33, burst: 33, dash: 11, jump: 11, swap: 16 },
        }
      }
      case 'burst': {
        // Signature Mix: the initial hit at 58 frames, then 6 field ticks every 120 frames from 178
        ctx.hit(58, {
          path: ['burst', 'skillDmg'],
          tag: 'burst',
          element: 'cryo',
          applies: true,
          icd: 'burst',
          label: 'Signature Mix',
        })
        for (let i = 0; i < 6; i++)
          ctx.hit(178 + 120 * i, {
            path: ['burst', 'fieldDmg'],
            tag: 'burst',
            element: 'cryo',
            applies: true,
            icd: 'burst',
            label: 'Signature Mix (field)',
          })
        // the field lasts 12.5 s from frame 58 (C4's window ends with it)
        s.fieldUntil = ctx.now + 808
        // C6: every 0.5 s in the field, the active character gets EM for 2 s (HP above 50% assumed)
        if (ctx.constellation('Diona') >= 6)
          for (let t = 30; t <= 750; t += 30)
            ctx.buff(
              'Diona',
              ['Diona', 'Constellation6'],
              'higher',
              58 + t,
              120
            )
        return {
          cooldown: { key: 'burst', frames: 1200, delay: 41 },
          frames: 64,
          framesInto: { dash: 43, jump: 44, swap: 41 },
        }
      }
      case 'dash':
        // gcsim's template for this body (Loli): 21 frames, 4 to the jump
        return { frames: 21, framesInto: { jump: 4 } }
      case 'jump':
        // gcsim's template: 29 frames, 37 right after a dash
        return templateJump('loli', 'bow', previous, ctx)
      case 'plunge':
        ctx.note('Diona: gcsim has no plunge, not modelled')
        return { frames: 30 }
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, s: DionaState, hit) {
    // C6's Stellar Glimmer follows the party's radiance (Polestar Field: Conduct; Stellar Swirl)
    if (ctx.constellation('Diona') >= 6)
      ctx.state(
        'Diona',
        ['Diona', 'lockStellarRadianceSc'],
        ctx.radiance === 'conduct' ? 'on' : ctx.radiance === 'swirl' ? 'ss' : ''
      )
    // Revelation: within 20 s of Icy Paws, a party member's Superconduct, Stellar-Conduct, Cryo
    // Swirl or Stellar Swirl fires 3 Icy Paws (5, 6, 7 frames later; 3.5 s ICD; no shield or
    // particles)
    if (
      hit.path[0] !== '_reaction' ||
      !REVELATION_REACTIONS.includes(hit.path[1])
    )
      return
    const frame = ctx.characterFrame('Diona')
    if (frame >= s.revelationUntil || frame < s.revelationIcd) return
    s.revelationIcd = frame + 211
    for (let i = 0; i < 3; i++)
      ctx.hit(5 + i, {
        characterKey: 'Diona',
        path: ['skill', 'skillDmg'],
        tag: 'skill',
        element: 'cryo',
        applies: true,
        icd: 'skill',
        label: 'Icy Paw (Revelation)',
      })
  },
}
