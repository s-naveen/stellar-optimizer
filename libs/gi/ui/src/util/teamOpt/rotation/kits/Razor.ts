import { HEXEREI_CHARACTERS } from '../gearEffects'
import type { KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/razor, main as of 2026-11-10. */

// Normal attack string: gcsim's InitNormalCancelSlice (the hitmark into abilities, the animation
// into normal and charged)
const razorNormals: NormalHit[] = [
  {
    hitmarks: [25],
    hitlag: [4],
    toNormal: 45,
    toCharged: 45,
    toAbil: 25,
    frames: 45,
  },
  {
    hitmarks: [16],
    hitlag: [4],
    toNormal: 33,
    toCharged: 33,
    toAbil: 16,
    frames: 33,
  },
  {
    hitmarks: [13],
    hitlag: [4],
    toNormal: 47,
    toCharged: 47,
    toAbil: 13,
    frames: 47,
  },
  {
    hitmarks: [38],
    hitlag: [4],
    toNormal: 116,
    toCharged: 116,
    toAbil: 38,
    frames: 116,
  },
]

interface RazorState {
  noted: boolean
  /** The Wolf Within (burst buff) runs over [wolfStart, wolfEnd) */
  wolfStart: number
  wolfEnd: number
  /** Electro Sigils, and the frame they expire (18 s after the last one was added) */
  sigils: number
  sigilEnd: number
  /** Hexerei: the Surge of Lightning's ICD (134 frames) */
  surgeIcd: number
  /** C6 Lupus Fulguris: its 10 s ICD */
  c6Icd: number
  /** The last frame a particle stand-in was counted (one per frame) */
  particleAt: number
}

const wolfAt = (s: RazorState, t: number) => t >= s.wolfStart && t < s.wolfEnd

/** The Hexerei buff of a sigil clear or Surge (CR +10%, CD +50%, 15 s): C6's crit, by the sheet */
const hexereiMod = (c: SimContext) =>
  c.buff('Razor', ['Razor', 'lockC6Sigil'], 'on', 0, 900)

/** Hexerei: Secret Rite needs 2 Hexerei members in the party */
const secretRite = (c: SimContext) =>
  c.members.filter((k) => HEXEREI_CHARACTERS.includes(k)).length >= 2

/**
 * C1: picking up a particle on the field gives +10% DMG for 8 s. The engine has no particles: a
 * party member's skill hit stands for one, received 100 frames later (gcsim's default particle
 * delay) by Razor if he is on the field then.
 */
function particle(c: SimContext, delay: number) {
  if (c.constellation('Razor') < 1) return
  c.at(delay, (c2) => {
    if (c2.onField === 'Razor')
      c2.buff('Razor', ['Razor', 'C1'], 'on', 0, 481, { hitlag: 'recipient' })
  })
}

/** Surge of Lightning on the 4th sigil (Hexerei: Secret Rite): 37 frames later, 134-frame ICD */
function surge(c: SimContext, s: RazorState) {
  if (!secretRite(c) || c.now < s.surgeIcd) return
  s.surgeIcd = c.now + 134
  hexereiMod(c)
  c.hit(37, {
    path: ['lockedPassive', 'dmg'],
    tag: 'other',
    element: 'electro',
    applies: true,
    icd: 'none',
    label: 'Surge of Lightning',
  })
}

/** Adds sigils (1 per Claw and Thunder, 3 at C6 with Hexerei); a 4th overflows into a Surge */
function addSigils(c: SimContext, s: RazorState, n: number) {
  if (c.now >= s.sigilEnd) s.sigils = 0
  s.sigils += n
  s.sigilEnd = c.now + 18 * 60
  if (s.sigils > 3) {
    s.sigils = 3
    surge(c, s)
  }
}

/** Clears the sigils (Claw and Thunder held, Lightning Fang +7 frames); their Energy is not modelled */
function clearSigils(c: SimContext, s: RazorState) {
  if (c.now >= s.sigilEnd) {
    s.sigils = 0
    return
  }
  if (s.sigils > 0) {
    s.sigils = 0
    hexereiMod(c)
    s.sigilEnd = c.now
  }
}

export const kit: KitModel = {
  characterKey: 'Razor',
  element: 'electro',
  source: `${GCSIM}/razor`,
  init: (): RazorState => ({
    noted: false,
    wolfStart: -1,
    wolfEnd: -1,
    sigils: 0,
    sigilEnd: -1,
    surgeIcd: -1e9,
    c6Icd: -1e9,
    particleAt: -1,
  }),
  onStart(ctx) {
    // Witch's Homework completed (gcsim's default): Razor is Hexerei (the Wolf Within's +70% ATK
    // and C6's upgrade need only that; the Surge needs a second Hexerei member)
    ctx.state('Razor', ['Razor', 'lockHomework'], 'on')
  },
  normalAttackSpeed: (ctx, s: RazorState, actor) =>
    actor === 'Razor' && wolfAt(s, ctx.now) ? 0.4 : 0,
  // With the Wolf Within (Lightning Fang) his tap and held E have frames of their own; his normal
  // attacks keep theirs (only faster)
  variant(ctx, s: RazorState, action) {
    if (action.kind !== 'skill' || !wolfAt(s, ctx.now)) return undefined
    return {
      key: 'lightningFang',
      label: action.hold ? 'Claw and Thunder (Hold)' : 'Claw and Thunder',
      mode: 'Lightning Fang',
    }
  },
  act(ctx, s: RazorState, action, previous) {
    const c = ctx.constellation('Razor')
    if (!s.noted) {
      s.noted = true
      ctx.note(
        "Razor: charged attack (no gcsim frame data), C2 (enemy below 30% HP), A4 and the Electro Sigil ER not modelled; C1's particles are stood in for by the party's skill hits; A1 assumed; plunge is the Low Plunge; Witch's Homework assumed complete"
      )
    }
    switch (action.kind) {
      case 'normal': {
        const wolf = wolfAt(s, ctx.now)
        return normalString(
          razorNormals,
          action.count ?? 1,
          (i, d, j) => {
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            })
            if (j > 0) return
            // The Wolf Within: a companion hit 1 frame after each normal attack's hit
            if (wolf)
              ctx.hit(d + 1, {
                path: ['burst', `companionDmg${i + 1}`],
                tag: 'burst',
                element: 'electro',
                applies: true,
                icd: 'burst',
                label: `The Wolf Within (N${i + 1})`,
              })
            // C6: Lupus Fulguris on the normal attack's hit, every 10 s; its sigil outside the Wolf Within
            if (c >= 6)
              ctx.at(d, (at) => {
                const frame = at.characterFrame('Razor')
                if (frame < s.c6Icd) return
                s.c6Icd = frame + 600
                at.hit(1, {
                  path: ['constellation6', 'dmg'],
                  tag: 'other',
                  element: 'electro',
                  applies: true,
                  icd: 'none',
                  label: 'Lupus Fulguris (C6)',
                })
                at.at(1, (c2) => {
                  if (!wolfAt(s, c2.now)) addSigils(c2, s, 3)
                })
              })
          },
          ctx
        )
      }
      case 'charged':
        // gcsim has no charged attack for Razor (noted above)
        return { frames: 30 }
      case 'skill': {
        const wolf = wolfAt(s, ctx.now)
        // Claw and Thunder's CD: A1 (-18%) assumed
        if (action.hold) {
          ctx.hit(55, {
            path: ['skill', 'hold'],
            tag: 'skill',
            element: 'electro',
            applies: true,
            icd: 'none',
            label: 'Claw and Thunder (hold)',
          })
          ctx.at(55, (c2) => clearSigils(c2, s))
          return {
            cooldown: {
              key: 'skill',
              frames: Math.floor(600 * 0.82),
              delay: 52,
            },
            frames: wolf ? 96 : 103,
            framesInto: wolf
              ? { dash: 53, jump: 52, swap: 88 }
              : { normal: 102, dash: 52, jump: 52, swap: 91 },
          }
        }
        // tap: the first enemy hit adds a sigil and, at C4, lowers their DEF for 7 s
        const hitAt = wolf ? 33 : 32
        ctx.hit(hitAt, {
          path: ['skill', 'press'],
          tag: 'skill',
          element: 'electro',
          applies: true,
          icd: 'none',
          label: 'Claw and Thunder (tap)',
        })
        ctx.at(hitAt, (c2) => addSigils(c2, s, c >= 6 ? 3 : 1))
        if (c >= 4) ctx.buff('Razor', ['Razor', 'C4'], 'on', hitAt, 420)
        // the slash's pause: 0.1 s at a 0.03 factor plus the defense halt (9.6, rounded up)
        ctx.hit(hitAt, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 10,
          label: 'Claw and Thunder hitlag',
        })
        return withHitlag(
          {
            cooldown: {
              key: 'skill',
              frames: Math.floor(360 * 0.82),
              delay: wolf ? 31 : 30,
            },
            frames: wolf ? 76 : 74,
            framesInto: wolf
              ? { swap: 75, dash: 32, jump: 32 }
              : { normal: 70, burst: 69, dash: 31, jump: 31 },
          },
          { hitmarks: [hitAt], hitlag: [10] }
        )
      }
      case 'burst': {
        ctx.hit(32, {
          path: ['burst', 'dmg'],
          tag: 'burst',
          element: 'electro',
          applies: true,
          durability: 50,
          icd: 'none',
          label: 'Lightning Fang',
        })
        // The Wolf Within: 15 s from 32 frames on
        s.wolfStart = ctx.now + 32
        s.wolfEnd = ctx.now + 32 + 900
        ctx.buff('Razor', ['Razor', 'TheWolfWithin'], 'on', 32, 900)
        ctx.at(7, (c2) => clearSigils(c2, s))
        // A1: Lightning Fang resets Claw and Thunder's CD (at its hitmark)
        ctx.at(32, (c2) => c2.resetCooldown('skill'))
        return {
          cooldown: { key: 'burst', frames: 1200 },
          frames: 74,
          // gcsim's CanQueueAfter: a wait can start at the hitmark
          framesInto: { normal: 73, dash: 58, jump: 57, swap: 63, wait: 32 },
        }
      }
      case 'plunge':
        // gcsim's Low Plunge (the rotation's plunge has no high/low choice; collision not used)
        ctx.hit(44, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 86,
          framesInto: { normal: 56, skill: 57, burst: 57, dash: 44, swap: 69 },
        }
      case 'dash':
        // Boy body: 21 frames, jump after 2
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        // Boy body: 31 frames (34 after a dash)
        return templateJump('boy', 'claymore', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, s: RazorState, hit) {
    if (hit.tag !== 'skill' || hit.path[0].startsWith('_')) return
    if (ctx.constellation('Razor') < 1 || hit.t === s.particleAt) return
    s.particleAt = hit.t
    particle(ctx, 100)
  },
  onSwapOut(ctx, s: RazorState) {
    // Lightning Fang's Wolf Within ends when Razor leaves the field
    s.wolfEnd = ctx.now
  },
}
