import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/aloy, main as of 2026-11-10. */

/** gcsim's default travel time of Aloy's arrows: each lands this long after its hitmark */
const TRAVEL = 10

const aloyNormals: NormalHit[] = [
  {
    hitmarks: [11 + TRAVEL, 24 + TRAVEL],
    toNormal: 31,
    toCharged: 24,
    toAbil: 24,
    frames: 31,
  },
  {
    hitmarks: [16 + TRAVEL],
    toNormal: 28,
    toCharged: 16,
    toAbil: 16,
    frames: 28,
  },
  {
    hitmarks: [23 + TRAVEL],
    toNormal: 38,
    toCharged: 23,
    toAbil: 23,
    frames: 38,
  },
  {
    hitmarks: [30 + TRAVEL],
    toNormal: 61,
    toCharged: 30,
    toAbil: 30,
    frames: 61,
  },
]

/** The sheet's normal node: N1 has two (`0`, then `1`), N2–N4 one each */
const aloyNode = (i: number, j: number) => [
  'normal',
  i === 0 ? `${j}` : `${i + 1}`,
]

interface AloyState {
  /** Coil stacks (the 4th starts Rushing Ice, which resets them) */
  coils: number
  /** Next frame a coil can be gained (6-frame ICD) */
  coilReadyAt: number
  /** Rushing Ice ends (undefined: not in it) */
  rushEnd?: number
}

/** Settles the timed parts of the state up to frame `t` */
function aloySettle(s: AloyState, t: number) {
  if (s.rushEnd !== undefined && t >= s.rushEnd) s.rushEnd = undefined
}

/** A Freeze Bomb or Bomblet hit stacks a coil (6-frame ICD); the 4th starts Rushing Ice */
function aloyCoil(c: SimContext, s: AloyState) {
  aloySettle(s, c.now)
  if (c.now < s.coilReadyAt || s.rushEnd !== undefined) return
  s.coilReadyAt = c.now + 6
  s.coils++
  // A1: a Coil gives 10 s of ATK (Aloy 16%, the party 8%); each new Coil refreshes it
  c.buff('Aloy', ['Aloy', 'A1'], 'on', 0, 600)
  if (s.coils < 4) return
  s.coils = 0
  s.rushEnd = c.now + 600
  // A4: Rushing Ice's Cryo DMG +3.5% every second (10 steps), from when it starts
  for (let i = 0; i < 10; i++)
    c.buff('Aloy', ['Aloy', 'A4'], `${i + 1}`, 60 * i, 60)
}

export const kit: KitModel = {
  characterKey: 'Aloy',
  element: 'cryo',
  source: `${GCSIM}/aloy`,
  init: (): AloyState => ({ coils: 0, coilReadyAt: -1e9 }),
  act(ctx, s: AloyState, action, previous) {
    switch (action.kind) {
      case 'normal': {
        // Coil's bonus, or Rushing Ice's (Cryo), at each arrow's landing
        const at = (d: number) => {
          const t = ctx.now + d
          const rush = s.rushEnd !== undefined && t < s.rushEnd
          return {
            rush,
            state: rush ? 'rush' : s.coils > 0 ? `coil${s.coils}` : '',
          }
        }
        return normalString(
          aloyNormals,
          action.count ?? 1,
          (i, d, j) => {
            const { rush, state } = at(d)
            ctx.hit(d, {
              path: aloyNode(i, j),
              tag: 'normal',
              element: rush ? 'cryo' : 'physical',
              applies: true,
              icd: rush ? 'normal' : 'none',
              label: `N${i + 1}${j ? ' (2nd arrow)' : ''}`,
              states: [{ owner: 'Aloy', path: ['Aloy', 'coil'], value: state }],
            })
          },
          ctx
        )
      }
      case 'charged':
        // Aimed Shot, fully charged (gcsim's default hold): lands 86 + travel
        ctx.hit(96, {
          path: ['charged', 'aimedCharged'],
          tag: 'charged',
          element: 'cryo',
          applies: true,
          icd: 'none',
          label: 'Fully-Charged Aimed Shot',
        })
        return { frames: 96, framesInto: { dash: 86, jump: 86 } }
      case 'skill': {
        ctx.hit(25, {
          path: ['skill', 'freezeBombDmg'],
          tag: 'skill',
          element: 'cryo',
          applies: true,
          icd: 'none',
          // (gcsim: stats at the bomb's release, 20 frames in)
          snapshotDelay: 20,
          label: 'Freeze Bomb',
        })
        // "When a Freeze Bomb or Chillwater Bomblet hits an opponent, ... Aloy receives 1 Coil
        // stack" (the game text; gcsim stacks Coils from the Bomblets only)
        ctx.at(25, (c) => aloyCoil(c, s))
        // two Chillwater Bomblets (gcsim's default), 6 frames apart; each may stack a Coil
        for (let i = 0; i < 2; i++) {
          const d = 31 + 6 * i
          ctx.hit(d, {
            path: ['skill', 'chillWaterBomblets'],
            tag: 'skill',
            element: 'cryo',
            applies: true,
            icd: 'skill',
            // (gcsim: stats when the bomb lands, 25 frames in)
            snapshotDelay: 25,
            label: 'Chillwater Bomblet',
          })
          ctx.at(d, (c) => aloyCoil(c, s))
        }
        return {
          cooldown: { key: 'skill', frames: 1200, delay: 19 },
          frames: 66,
          // (a wait starts at the bomb's release, gcsim's CanQueueAfter)
          framesInto: { normal: 47, burst: 48, dash: 49, jump: 47, wait: 20 },
        }
      }
      case 'burst':
        ctx.hit(100, {
          path: ['burst', 'dmg'],
          tag: 'burst',
          element: 'cryo',
          applies: true,
          durability: 50,
          icd: 'burst',
          // (gcsim: stats at the cast)
          snapshotDelay: 0,
          label: 'Prophecies of Dawn',
        })
        return {
          cooldown: { key: 'burst', frames: 720 },
          frames: 117,
          framesInto: {
            normal: 101,
            charged: 101,
            skill: 101,
            dash: 101,
            jump: 100,
          },
        }
      case 'dash':
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // a jump right after a dash is longer (gcsim's JumpLength, girl body)
        return templateJump('girl', 'bow', previous, ctx)
      default:
        // gcsim has no plunge for Aloy: no damage
        return { frames: 30 }
    }
  },
  // (Coil is cleared 30 s after Aloy leaves combat: the party stays in combat here, so it is kept
  // while she is off the field; gcsim clears it 30 s after she leaves the field)
}
