import type { HitElement, KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/lynette, main as of 2026-11-10. */

/** Normal attack string (gcsim attack.go) */
const lynetteNormals: NormalHit[] = [
  {
    hitmarks: [17],
    hitlag: [6],
    toNormal: 24,
    toCharged: 25,
    toAbil: 17,
    frames: 30,
  },
  {
    hitmarks: [13],
    hitlag: [6],
    toNormal: 16,
    toCharged: 25,
    toAbil: 13,
    frames: 27,
  },
  {
    hitmarks: [23, 31],
    hitlag: [8, 0],
    toNormal: 35,
    toCharged: 47,
    toAbil: 31,
    frames: 47,
  },
  { hitmarks: [29], toNormal: 60, toCharged: 68, toAbil: 29, frames: 68 },
]
/** Our sheet's node for each hit: N3's two hits are two nodes (3.1 and 3.2) */
const lynetteNodes = [['0'], ['1'], ['2', '3'], ['4']]

type Hit = Parameters<SimContext['hit']>[1]

/** Enigma Thrust (tap at 28, hold at its end) and Surging Blade (the aligned attack: no element application) */
const thrust: Hit = {
  path: ['skill', 'thrustDmg'],
  tag: 'skill',
  element: 'anemo',
  applies: true,
  durability: 25,
  icd: 'none',
  label: 'Enigma Thrust',
}
const surging: Hit = {
  path: ['skill', 'bladeDmg'],
  tag: 'skill',
  element: 'anemo',
  applies: false,
  icd: 'none',
  label: 'Surging Blade',
}

/** C6's infusion and Anemo DMG Bonus: 6 s */
const C6_DURATION = 360

/** The Bogglecat Box lasts 754 frames from its appearance (14 frames after the burst) */
const BOX_DURATION = 754
/** Vivid Shots every 134 frames from the absorb, each 15 frames after it fires */
const VIVID_INTERVAL = 134
const VIVID_TRAVEL = 15
/** Elements the box absorbs */
const ABSORBABLE: HitElement[] = ['cryo', 'pyro', 'hydro', 'electro']

interface LynetteState {
  /** The Bogglecat Box is up from boxStart to boxEnd (frames) */
  boxStart: number
  boxEnd: number
  /** It has absorbed its element (it does once, then it is gone) */
  absorbed: boolean
  /** C6's Anemo infusion lasts from infuseFrom to infuseTo */
  infuseFrom: number
  infuseTo: number
  /** Surging Blade's ICD: the next one from this frame */
  bladeReady: number
}

/**
 * Elemental Conversion: the box takes the element (A4: Lynette's burst DMG +15%) and fires Vivid
 * Shots of it every 134 frames (two at C2), 15 frames of travel, while it lasts. (gcsim keeps both
 * for a whole box duration after the conversion; the game text ends them with the box)
 */
function convert(ctx: SimContext, s: LynetteState, ele: HitElement) {
  s.absorbed = true
  const left = s.boxEnd - ctx.now
  ctx.buff('Lynette', ['Lynette', 'burstAbsorb'], ele, 0, left)
  const shots = ctx.constellation('Lynette') >= 2 ? 2 : 1
  for (let t = VIVID_INTERVAL; t <= left; t += VIVID_INTERVAL)
    for (let j = 0; j < shots; j++)
      ctx.hit(t + VIVID_TRAVEL, {
        characterKey: 'Lynette',
        path: ['burst', 'shotDmg'],
        tag: 'burst',
        element: ele,
        applies: true,
        durability: 25,
        icd: 'ElementalBurstAnemo',
        label: 'Vivid Shot',
        // (its element, even if it lands just after the box is gone)
        states: [
          { owner: 'Lynette', path: ['Lynette', 'burstAbsorb'], value: ele },
        ],
      })
}

export const kit: KitModel = {
  characterKey: 'Lynette',
  element: 'anemo',
  source: `${GCSIM}/lynette`,
  init: (): LynetteState => ({
    boxStart: -1,
    boxEnd: -1,
    absorbed: false,
    infuseFrom: -1,
    infuseTo: -1,
    bladeReady: -1,
  }),
  act(ctx, s: LynetteState, action, previous) {
    const c = ctx.constellation('Lynette')
    /** Her attacks are Anemo while C6's infusion is on, else physical */
    const infused = (t: number): HitElement =>
      t >= s.infuseFrom && t < s.infuseTo ? 'anemo' : 'physical'
    switch (action.kind) {
      case 'normal':
        return normalString(
          lynetteNormals,
          action.count ?? 1,
          (i, d, j) =>
            ctx.hit(d, {
              path: ['normal', lynetteNodes[i][j]],
              tag: 'normal',
              element: infused(ctx.now + d),
              applies: true,
              icd: 'normal',
              label: `N${i + 1}${lynetteNodes[i].length > 1 ? ` (hit ${j + 1})` : ''}`,
            }),
          ctx
        )
      case 'charged':
        ctx.hit(12, {
          path: ['charged', 'dmg1'],
          tag: 'charged',
          element: infused(ctx.now + 12),
          applies: true,
          icd: 'normal',
          label: 'Charged Attack',
        })
        ctx.hit(13, {
          path: ['charged', 'dmg2'],
          tag: 'charged',
          element: infused(ctx.now + 13),
          applies: true,
          icd: 'normal',
          label: 'Charged Attack (2nd hit)',
        })
        return {
          frames: 51,
          framesInto: {
            normal: 42,
            skill: 31,
            burst: 32,
            dash: 13,
            jump: 13,
            swap: 13,
          },
        }
      case 'skill': {
        // Enigma Thrust pauses Lynette for the defense halt (4 frames). Tap: the thrust at 28;
        // Hold (gcsim's hold=1, the shortest Pilfering Shadow: 35 frames): the thrust at its
        // end. Surging Blade 30 / 28 frames after it if its 10 s ICD is up (checked at the
        // thrust). C6: Anemo infusion and +20% Anemo DMG for 6 s from just before the thrust.
        const d = action.hold ? 35 : 0
        const thrustAt = d + (action.hold ? 16 : 28)
        const bladeAt = d + (action.hold ? 44 : 58)
        const c6At = d + (action.hold ? 5 : 17)
        ctx.hit(thrustAt, thrust)
        ctx.hit(thrustAt, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 4,
          label: 'Enigma Thrust hitlag',
        })
        if (ctx.now + thrustAt >= s.bladeReady) {
          ctx.hit(bladeAt, surging)
          s.bladeReady = ctx.now + thrustAt + 600
        }
        if (c >= 6) {
          // (gcsim: 6.4 s; the game text says 6 s)
          s.infuseFrom = ctx.now + c6At
          s.infuseTo = ctx.now + c6At + C6_DURATION
          ctx.buff(
            'Lynette',
            ['Lynette', 'c6AfterThrust'],
            'on',
            c6At,
            C6_DURATION
          )
        }
        return withHitlag(
          action.hold
            ? {
                cooldown: { key: 'skill', frames: 720, delay: d + 14 },
                frames: d + 41,
                framesInto: {
                  normal: d + 29,
                  skill: d + 29,
                  burst: d + 29,
                  dash: d + 28,
                  jump: d + 31,
                  swap: d + 27,
                },
              }
            : {
                cooldown: { key: 'skill', frames: 720, delay: 26 },
                frames: 58,
                framesInto: {
                  normal: 43,
                  skill: 44,
                  burst: 45,
                  dash: 44,
                  jump: 43,
                  swap: 42,
                },
              },
          { hitmarks: [thrustAt], hitlag: [4] }
        )
      }
      case 'burst': {
        ctx.hit(18, {
          path: ['burst', 'dmg'],
          tag: 'burst',
          element: 'anemo',
          applies: true,
          durability: 25,
          icd: 'burst',
          label: 'Magic Trick: Astonishing Shift',
        })
        // Bogglecat Box: its ticks from frame 136, every 59 frames while it lasts
        for (let t = 136; t <= 14 + BOX_DURATION; t += 59)
          ctx.hit(t, {
            path: ['burst', 'boxDmg'],
            tag: 'burst',
            element: 'anemo',
            applies: true,
            durability: 25,
            icd: 'burst',
            label: 'Bogglecat Box',
          })
        s.boxStart = ctx.now + 14
        s.boxEnd = ctx.now + 14 + BOX_DURATION
        s.absorbed = false
        // Elemental Conversion: the box checks every 0.3 s for an aura it touches (Cryo > Pyro >
        // Hydro > Electro, gcsim's AbsorbCheck), once per box
        const boxEnd = s.boxEnd
        const check = (c2: SimContext) => {
          if (s.boxEnd !== boxEnd || s.absorbed || c2.now >= boxEnd) return
          const ele = c2.absorb(ABSORBABLE)
          if (ele && ABSORBABLE.includes(ele)) convert(c2, s, ele)
          else c2.at(18, check)
        }
        ctx.at(14 + 18, check)
        // A1: the party's ATK +8-20% for 10 s
        ctx.buff('Lynette', ['Lynette', 'a1AfterBurst'], 'on', 0, 600)
        return {
          cooldown: { key: 'burst', frames: 1080 },
          frames: 56,
          framesInto: { normal: 55, dash: 46, jump: 44, swap: 43 },
        }
      }
      case 'dash':
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        return templateJump('girl', 'sword', previous, ctx)
      case 'plunge':
        // gcsim's low plunge (gcsim itself allows it only in Xianyun's airborne state)
        ctx.hit(45, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: infused(ctx.now + 45),
          applies: true,
          durability: 25,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 73,
          framesInto: {
            normal: 58,
            skill: 58,
            burst: 58,
            dash: 45,
            swap: 59,
          },
        }
      default:
        return { frames: 30 }
    }
  },
  // C4: two charges of Enigmatic Feint
  charges: (cons) => ({ skill: cons >= 4 ? 2 : 1 }),
}
