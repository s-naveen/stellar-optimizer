import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/barbara, main as of 2026-11-10. */

const barbaraNormals: NormalHit[] = [
  { hitmarks: [6], toNormal: 15, toCharged: 18, toAbil: 6, frames: 23 },
  { hitmarks: [11], toNormal: 21, toCharged: 24, toAbil: 11, frames: 28 },
  { hitmarks: [12], toNormal: 22, toCharged: 28, toAbil: 12, frames: 30 },
  { hitmarks: [32], toNormal: 60, toCharged: 60, toAbil: 32, frames: 60 },
]

/** Melody Loop: 15 s (+1 frame) from 3 frames after the skill (gcsim's core status) */
const LOOP = 15 * 60 + 1

interface BarbaraState {
  /** Her last action was a normal attack (gcsim's LastAction: waits keep it, a swap ends it) */
  lastWasAttack: boolean
  /** The last normal step's index (3: N4, the string wrapped) */
  lastNormalIdx: number
  /** That normal attack's animation ends (frame): its state lasts until then */
  normalAnimEnd: number
  /** Melody Loop's cast (a newer one replaces the ticks) and its end (frame) */
  skillSrc: number
  skillEnd: number
}

/** Melody Loop's heal on a Normal (×1) or Charged (×4) Attack hit: the party, while it lasts */
function loopHeal(c: SimContext, s: BarbaraState, times: number) {
  if (c.now >= s.skillEnd) return
  for (let k = 0; k < times; k++)
    c.hit(0, {
      path: ['_heal', 'skill', 'regen'],
      tag: 'other',
      element: 'hydro',
      healTargets: [...c.members],
      label: 'Melody Loop (Heal)',
    })
}

export const kit: KitModel = {
  characterKey: 'Barbara',
  element: 'hydro',
  source: `${GCSIM}/barbara`,
  init: (): BarbaraState => ({
    lastWasAttack: false,
    lastNormalIdx: -1,
    normalAnimEnd: -1,
    skillSrc: 0,
    skillEnd: -1,
  }),
  act(ctx, s: BarbaraState, action, previous) {
    const wasAttack = s.lastWasAttack
    s.lastWasAttack = action.kind === 'normal'
    switch (action.kind) {
      case 'normal': {
        const n = Math.min(action.count ?? 1, barbaraNormals.length)
        const r = normalString(
          barbaraNormals,
          n,
          (i, d) => {
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'hydro',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            })
            ctx.at(d, (c2) => loopHeal(c2, s, 1))
          },
          ctx
        )
        // N4 cancels into dash, jump and swap 2, 3 and 2 frames in (gcsim's overrides; a written
        // wait still starts at its hitmark)
        const last = r.normalStarts![r.normalStarts!.length - 1]
        s.lastNormalIdx = last.index
        if (last.index === 3)
          r.framesInto = {
            ...r.framesInto,
            dash: last.offset + 2,
            jump: last.offset + 3,
            swap: last.offset + 2,
            wait: last.offset + barbaraNormals[3].hitmarks[0],
          }
        s.normalAnimEnd = ctx.now + r.frames
        return r
      }
      case 'charged': {
        // gcsim: no Charged Attack when her last action was N4 (the string wrapped to N1)
        if (wasAttack && s.lastNormalIdx === 3)
          return {
            frames: 0,
            failed:
              'Barbara: a Charged Attack cannot follow a finished 4-hit normal string',
          }
        // gcsim: during a normal attack's animation the windup is 14 frames shorter
        const w = wasAttack && ctx.now < s.normalAnimEnd ? 14 : 0
        ctx.hit(55 - w, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'hydro',
          applies: true,
          label: 'Charged Attack',
        })
        ctx.at(55 - w, (c2) => loopHeal(c2, s, 4))
        return {
          frames: 89 - w,
          framesInto: {
            normal: 89 - w,
            charged: 88 - w,
            skill: 88 - w,
            burst: 87 - w,
            dash: 56 - w,
            jump: 56 - w,
            swap: 55 - w,
          },
        }
      }
      case 'skill': {
        // Let the Show Begin: two Droplets (hits at 42 and 78). Hold is the same as tap.
        ctx.hit(42, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'hydro',
          applies: true,
          icd: 'skill',
          label: 'Let the Show Begin (Droplet)',
        })
        ctx.hit(78, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'hydro',
          applies: true,
          icd: 'skill',
          label: 'Let the Show Begin (Droplet, 2nd)',
        })
        // Melody Loop (15 s from frame 3) is a conditional: its stamina cut (A1) is on for the team
        // (A4's extensions from particles are not modelled). From frame 3: every 1.5 s a 0-damage
        // Hydro tick that touches the enemy (the droplets' ICD; it freezes the enemy 7 frames),
        // and every 5 s a heal of the active character
        ctx.buff('Barbara', ['Barbara', 'skill'], 'on', 3, LOOP)
        const src = ++s.skillSrc
        ctx.at(3, (c2) => {
          s.skillEnd = c2.now + LOOP
          const melody = (c3: SimContext) => {
            if (src !== s.skillSrc || c3.now >= s.skillEnd) return
            c3.hit(0, {
              path: ['_marker', 'barbaraMelodyLoop'],
              tag: 'other',
              element: 'hydro',
              applies: true,
              icd: 'skill',
              label: 'Melody Loop (Hydro, no DMG)',
            })
            c3.hit(0, {
              path: ['_marker', 'hitlag'],
              tag: 'other',
              element: 'physical',
              animationPause: 0,
              enemyAnimationPause: 7,
              label: 'Melody Loop (enemy hitlag)',
            })
            c3.at(90, melody)
          }
          const regen = (c3: SimContext) => {
            if (src !== s.skillSrc || c3.now >= s.skillEnd) return
            c3.hit(0, {
              path: ['_heal', 'skill', 'cregen'],
              tag: 'other',
              element: 'hydro',
              healTargets: [c3.onField],
              label: 'Melody Loop (Regeneration)',
            })
            c3.at(300, regen)
          }
          regen(c2)
          melody(c2)
        })
        // C2: Hydro DMG +15% for the others, for the Melody Loop's duration
        const c2 = ctx.constellation('Barbara') >= 2
        if (c2) ctx.buff('Barbara', ['Barbara', 'c2'], 'on', 0, 15 * 60 + 1)
        return {
          cooldown: { key: 'skill', frames: c2 ? 1632 : 1920, delay: 3 },
          frames: 55,
          framesInto: {
            normal: 54,
            charged: 54,
            skill: 54,
            dash: 4,
            jump: 5,
            swap: 53,
          },
        }
      }
      case 'burst':
        // Shining Miracle is a heal only (the party, 77 frames in). The cooldown starts 1 frame in.
        ctx.hit(77, {
          path: ['_heal', 'burst', 'regen'],
          tag: 'other',
          element: 'hydro',
          healTargets: [...ctx.members],
          label: 'Shining Miracle (Heal)',
        })
        return {
          cooldown: { key: 'burst', frames: 20 * 60, delay: 1 },
          frames: 195,
          framesInto: {
            normal: 141,
            charged: 140,
            skill: 141,
            dash: 160,
            jump: 160,
          },
        }
      case 'plunge':
        // The rotation's P is the Low Plunge (High Plunge and the collision hit need a variant)
        ctx.hit(44, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'hydro',
          applies: true,
          label: 'Low Plunge',
        })
        return {
          frames: 66,
          framesInto: {
            normal: 57,
            charged: 46,
            skill: 44,
            burst: 44,
            dash: 44,
            swap: 48,
          },
        }
      case 'dash':
        return {
          frames: 21,
          framesInto: { skill: 2, burst: 1, charged: 20, swap: 20 },
        }
      case 'jump':
        // Barbara is a Girl: 31 frames, 34 after a dash
        return templateJump('girl', 'catalyst', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  // a swap is an action: her last one is no longer a normal attack
  onSwapOut(_ctx, s: BarbaraState) {
    s.lastWasAttack = false
  },
}
