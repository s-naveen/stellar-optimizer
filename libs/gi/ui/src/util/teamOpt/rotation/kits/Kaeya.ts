import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/kaeya, main as of 2026-11-10. */

/** N1..N5 from gcsim's attack.go (hitmarks, cancels) */
const kaeyaNormals: NormalHit[] = [
  {
    hitmarks: [14],
    hitlag: [6],
    toNormal: 21,
    toCharged: 30,
    toAbil: 14,
    frames: 30,
  },
  {
    hitmarks: [9],
    hitlag: [6],
    toNormal: 21,
    toCharged: 25,
    toAbil: 9,
    frames: 25,
  },
  {
    hitmarks: [14],
    hitlag: [8],
    toNormal: 39,
    toCharged: 47,
    toAbil: 14,
    frames: 47,
  },
  {
    hitmarks: [23],
    hitlag: [8],
    toNormal: 38,
    toCharged: 46,
    toAbil: 23,
    frames: 46,
  },
  {
    hitmarks: [30],
    hitlag: [10],
    toNormal: 64,
    toCharged: 64,
    toAbil: 30,
    frames: 64,
  },
]

/** Glacial Waltz's icicles last 480 frames + the 53-frame start + 1 (gcsim's status) */
const WALTZ_LIFE = 534

interface KaeyaState {
  /** The Glacial Waltz cast whose icicles are spinning, and until when (frame) */
  waltzSrc: number
  waltzUntil: number
}

export const kit: KitModel = {
  characterKey: 'Kaeya',
  element: 'cryo',
  source: `${GCSIM}/kaeya`,
  init: (): KaeyaState => ({ waltzSrc: -1, waltzUntil: -1 }),
  act(ctx, s: KaeyaState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          kaeyaNormals,
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
        // Charged Attack: two instances on the same frame (16)
        ctx.hit(16, {
          path: ['charged', 'dmg1'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'normal',
          label: 'Charged Attack 1',
        })
        ctx.hit(16, {
          path: ['charged', 'dmg2'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'normal',
          label: 'Charged Attack 2',
        })
        return {
          frames: 55,
          framesInto: { skill: 37, burst: 36, dash: 25, jump: 24, swap: 34 },
        }
      case 'skill':
        // Frostgnaw: 50 durability, 28 frames
        ctx.hit(28, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'cryo',
          durability: 50,
          applies: true,
          icd: 'none',
          // (gcsim: stats at the cast)
          snapshotDelay: 0,
          label: 'Frostgnaw',
        })
        return {
          cooldown: { key: 'skill', frames: 360, delay: 25 },
          frames: 53,
          framesInto: { burst: 52, dash: 25, jump: 26, swap: 49 },
        }
      case 'burst': {
        // Glacial Waltz: 3 icicles (4 at C6), each hitting every 120 frames from frame 53, while
        // the cast lasts. C2's extension on defeats and C6's 15 Energy are not modelled.
        const src = ctx.now
        // (gcsim: the icicles keep the stats of the cast)
        const snapshot = { t: ctx.now, onField: ctx.onField }
        s.waltzSrc = src
        s.waltzUntil = src + WALTZ_LIFE
        const icicles = ctx.constellation('Kaeya') >= 6 ? 4 : 3
        const offset = 120 / icicles
        const tick = (c: SimContext) => {
          if (s.waltzSrc !== src || c.now >= s.waltzUntil) return
          c.hit(0, {
            path: ['burst', 'dmg'],
            tag: 'burst',
            element: 'cryo',
            applies: true,
            icd: 'burst',
            label: 'Glacial Waltz',
            statSnapshots: [
              { stat: 'atk', path: ['total', 'atk'], ...snapshot },
              { stat: 'cryo_dmg_', path: ['total', 'cryo_dmg_'], ...snapshot },
            ],
          })
          c.at(120, tick)
        }
        for (let i = 0; i < icicles; i++) ctx.at(53 + offset * i, tick)
        return {
          cooldown: { key: 'burst', frames: 900, delay: 48 },
          frames: 78,
          framesInto: { normal: 77, dash: 62, jump: 61, swap: 77 },
        }
      }
      case 'plunge':
        // gcsim's low plunge (the rotation text does not say high or low)
        ctx.hit(45, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 74,
          framesInto: { normal: 55, skill: 55, burst: 55, dash: 45, swap: 64 },
        }
      case 'dash':
        // gcsim's template for this body (Male): 19 frames, 3 to the jump
        return { frames: 19, framesInto: { jump: 3 } }
      case 'jump':
        // gcsim's template: 28 frames, 37 right after a dash; a sword user's plunge after 5
        return {
          frames: previous?.kind === 'dash' ? 37 : 28,
          framesInto: { plunge: 5 },
        }
      default:
        return { frames: 30 }
    }
  },
  // C1: his Normal and Charged Attacks' CRIT Rate +15% against an enemy affected by Cryo (gcsim:
  // Cryo or Frozen), by the aura before the hit's own reaction
  onBeforeHit(ctx, _s: KaeyaState, hit) {
    if (
      hit.characterKey !== 'Kaeya' ||
      (hit.tag !== 'normal' && hit.tag !== 'charged') ||
      ctx.constellation('Kaeya') < 1
    )
      return
    hit.states = [
      ...(hit.states ?? []),
      {
        owner: 'Kaeya',
        path: ['Kaeya', 'CryoC1'],
        value: ctx.absorb(['cryo']) ? 'on' : '',
      },
    ]
  },
}
