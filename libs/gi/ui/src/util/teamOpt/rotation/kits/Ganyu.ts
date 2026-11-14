import type { KitModel } from '../types'
import {
  annulusHitChance,
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/ganyu, main as of 2026-11-10. */

/** A normal attack's arrow travels 10f (gcsim's default `travel`) before it hits */
const TRAVEL = 10

/**
 * One hit per normal (N1..N6). The cancels are gcsim's: into a normal attack after the whole
 * animation, into the aimed shot (its `charged` kind) and skill/burst/dash/jump/swap at the hitmark.
 */
const ganyuNormals: NormalHit[] = [
  {
    hitmarks: [13 + TRAVEL],
    toNormal: 19,
    toCharged: 13,
    toAbil: 13,
    frames: 19,
  },
  {
    hitmarks: [14 + TRAVEL],
    toNormal: 27,
    toCharged: 14,
    toAbil: 14,
    frames: 27,
  },
  {
    hitmarks: [20 + TRAVEL],
    toNormal: 38,
    toCharged: 20,
    toAbil: 20,
    frames: 38,
  },
  {
    hitmarks: [26 + TRAVEL],
    toNormal: 37,
    toCharged: 26,
    toAbil: 26,
    frames: 37,
  },
  {
    hitmarks: [21 + TRAVEL],
    toNormal: 28,
    toCharged: 21,
    toAbil: 21,
    frames: 28,
  },
  {
    hitmarks: [22 + TRAVEL],
    toNormal: 59,
    toCharged: 22,
    toAbil: 22,
    frames: 59,
  },
]

interface GanyuState {
  burstMarkedUntil: number
  collateralCredit: number
  /** A1: a Frostflake Arrow fired before this frame gives the next ones +20% CRIT */
  a1Until: number
  /** C6: the next Fully-Charged Aimed Shot skips its charge, until this frame */
  c6Until: number
}

export const kit: KitModel = {
  characterKey: 'Ganyu',
  element: 'cryo',
  source: `${GCSIM}/ganyu`,
  // C2: Trail of the Qilin gains 1 additional charge
  charges: (cons) => ({ skill: cons >= 2 ? 2 : 1 }),
  init: (): GanyuState => ({
    burstMarkedUntil: -1,
    collateralCredit: 0,
    a1Until: -1,
    c6Until: -1,
  }),
  // C6: the Frostflake Arrow after Celestial Shower needs no charging (frames of its own)
  variant(ctx, s: GanyuState, action) {
    return action.kind === 'charged' && s.c6Until > ctx.now
      ? { key: 'c6', label: 'Frostflake Arrow (C6, no charging)' }
      : undefined
  },
  act(ctx, s: GanyuState, action, previous) {
    const c = ctx.constellation('Ganyu')
    switch (action.kind) {
      case 'normal':
        return normalString(
          ganyuNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged': {
        // The Fully-Charged Aimed Shot (gcsim's default hold: Frostflake Arrow + Bloom). The
        // arrow's hitmark is 103f, its damage 10f later; the bloom 18f after the arrow.
        // (The Lv1 and the unaimed shot have their own sheet nodes: a charged attack is the Lv2.)
        // C6: within 30 s after Ice Lotus, the charge is skipped (83f).
        const skip = s.c6Until > ctx.now ? 83 : 0
        s.c6Until = -1
        const snap = ctx.now + 103 - skip
        // A1: an arrow fired within 5 s of an earlier one gets +20% CRIT (the first does not)
        if (snap < s.a1Until)
          ctx.buff('Ganyu', ['Ganyu', 'A1'], 'on', 103 - skip, 29)
        s.a1Until = snap + 5 * 60
        ctx.hit(113 - skip, {
          path: ['charged', 'frostflake'],
          tag: 'charged',
          element: 'cryo',
          applies: true,
          icd: 'none',
          label: 'Frostflake Arrow',
        })
        ctx.hit(131 - skip, {
          path: ['charged', 'frostflakeBloom'],
          tag: 'charged',
          element: 'cryo',
          applies: true,
          icd: 'none',
          label: 'Frostflake Arrow Bloom',
        })
        // (C1's Cryo RES shred follows each arrow and bloom hit: see onHit)
        return {
          frames: 113 - skip,
          framesInto: { dash: 103 - skip, jump: 103 - skip },
        }
      }
      case 'skill': {
        // Ice Lotus: the flower at 13f, its explosion at 373f
        ctx.hit(13, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'cryo',
          applies: true,
          icd: 'none',
          label: 'Ice Lotus',
        })
        ctx.hit(373, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'cryo',
          applies: true,
          icd: 'none',
          label: 'Ice Lotus explosion',
        })
        if (c >= 6) s.c6Until = ctx.now + 30 * 60
        return {
          cooldown: { key: 'skill', frames: 10 * 60, delay: 10 },
          frames: 28,
          framesInto: { swap: 27 },
        }
      }
      case 'burst': {
        // Native targets this enemy at most once every 1.45 s. Other shards land uniformly
        // in the field's annulus; deterministic probability preserves real aura applications.
        const snapshot = { t: ctx.now, onField: ctx.onField }
        for (let i = 0; i < 900; i += 18)
          ctx.at(122 + i, (at) => {
            const targeted = at.now >= s.burstMarkedUntil
            if (targeted) s.burstMarkedUntil = at.now + 87
            else
              s.collateralCredit += annulusHitChance(
                at.target.radius,
                at.target.distance,
                0.5,
                9.5,
                2.5
              )
            const collateral = !targeted && s.collateralCredit >= 1
            if (collateral) s.collateralCredit--
            if (targeted || collateral)
              at.hit(8, {
                path: ['burst', 'dmg'],
                tag: 'burst',
                element: 'cryo',
                applies: true,
                icd: 'burst',
                label: 'Celestial Shower',
                statSnapshots: [
                  { stat: 'atk', path: ['total', 'atk'], ...snapshot },
                  {
                    stat: 'cryo_dmg_',
                    path: ['total', 'cryo_dmg_'],
                    ...snapshot,
                  },
                ],
              })
          })
        ctx.note(
          'Ganyu: single-target burst collateral accumulates the native annulus hit probability. Random multi-target shards are not validated.'
        )
        // A4: the active member in the area gets +20% Cryo DMG, refreshed by each tick (60f)
        ctx.buff('Ganyu', ['Ganyu', 'A4'], 'on', 122, 882 + 60)
        // C4: the enemies' stacks (+5% DMG each, up to 5) go up every 3 s, and last 3 s after the
        // last tick
        if (c >= 4)
          for (let k = 1; k <= 5; k++) {
            const start = 122 + 180 * (k - 1)
            const end = k < 5 ? 122 + 180 * k : 122 + 882 + 180
            ctx.buff('Ganyu', ['Ganyu', 'C4'], `${k}`, start, end - start)
          }
        return {
          cooldown: { key: 'burst', frames: 15 * 60 },
          frames: 125,
          framesInto: {
            normal: 124,
            charged: 124,
            skill: 124,
            swap: 122,
          },
        }
      }
      case 'dash':
        // Girl body: 20f, and 4f into a jump
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // Girl body: 34f after a dash, 31f otherwise
        return templateJump('girl', 'bow', previous, ctx)
      case 'plunge':
        // gcsim has no plunging attack for Ganyu
        ctx.note('Ganyu: plunging attacks are not modelled (gcsim has none).')
        return { frames: 30 }
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, _s: GanyuState, hit) {
    // C1: a Frostflake Arrow or its Bloom lowers the enemy's Cryo RES by 15% for 6 s upon hit (the
    // game text; gcsim's 300 frames are 5 s), from after the hit that applies it
    if (
      hit.characterKey !== 'Ganyu' ||
      hit.path[0] !== 'charged' ||
      ctx.constellation('Ganyu') < 1
    )
      return
    hit.states = [
      ...(hit.states ?? []),
      {
        owner: 'Ganyu',
        path: ['Ganyu', 'C1'],
        value: ctx.hasBuff('Ganyu', ['Ganyu', 'C1']) ? 'on' : '',
      },
    ]
    ctx.buff('Ganyu', ['Ganyu', 'C1'], 'on', 0, 360, { hitlag: 'enemy' })
  },
}
