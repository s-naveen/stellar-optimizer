import type { KitModel } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/jean, main as of 2026-11-10. */

const jeanNormals: NormalHit[] = [
  {
    hitmarks: [13],
    hitlag: [6],
    toNormal: 22,
    toCharged: 25,
    toAbil: 13,
    frames: 25,
  },
  {
    hitmarks: [6],
    hitlag: [6],
    toNormal: 14,
    toCharged: 20,
    toAbil: 6,
    frames: 20,
  },
  {
    hitmarks: [17],
    hitlag: [8],
    toNormal: 28,
    toCharged: 31,
    toAbil: 17,
    frames: 31,
  },
  {
    hitmarks: [37],
    hitlag: [8],
    toNormal: 44,
    toCharged: 49,
    toAbil: 37,
    frames: 49,
  },
  {
    hitmarks: [25],
    hitlag: [10],
    toNormal: 68,
    toCharged: 68,
    toAbil: 25,
    frames: 68,
  },
]

/** Gale Blade held for this long (frames) when the rotation says hE: gcsim's C1 needs 1 s */
const HOLD = 60

/** Particles reach the party 100 frames after the hit that makes them (gcsim's ParticleDelay) */
const PARTICLE_DELAY = 100
// Not modelled: A1 healing, Self Swirl, C6 (damage taken), and A4's Energy. C1's Gale Blade bonus
// is on for a held hE. C2: any particle picked up while she is on the field (gcsim's
// OnParticleReceived), hers included.
export const kit: KitModel = {
  characterKey: 'Jean',
  element: 'anemo',
  source: `${GCSIM}/jean`,
  onHit(ctx, _s, hit) {
    // C2: a particle picked up while Jean is on the field: the party's ATK SPD +15% for 15 s
    if (
      hit.path[0] !== '_particle' ||
      ctx.onField !== 'Jean' ||
      ctx.constellation('Jean') < 2
    )
      return
    ctx.buff('Jean', ['Jean', 'c2'], 'on', 0, 900, { hitlag: 'recipient' })
    for (const member of ctx.members)
      ctx.modifyAttackSpeed('JeanC2', 0.15, 900, member)
  },
  act(ctx, _s, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          jeanNormals,
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
        // (gcsim: needs a normal attack right before it; not checked here)
        ctx.hit(36, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'normal',
          label: 'Charged Attack',
        })
        return {
          frames: 57,
          framesInto: { burst: 56, dash: 36, jump: 36, swap: 39 },
        }
      case 'skill': {
        const hold = action.hold ? HOLD : 0
        const hitmark = 21 + hold
        // C1: a Gale Blade held for 1 s or more deals 40% more DMG (this hit only; on from the
        // cast, before the hit takes the cast's stats, as gcsim adds C1 to that snapshot)
        if (ctx.constellation('Jean') >= 1 && hold >= 60)
          ctx.buff('Jean', ['Jean', 'c1'], 'on', 0, hitmark + 1)
        ctx.hit(hitmark, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'anemo',
          applies: true,
          durability: 50,
          icd: 'none',
          // (gcsim: stats at the cast)
          snapshotDelay: 0,
          label: hold ? 'Gale Blade (held)' : 'Gale Blade',
        })
        // its particles: 2, and 1 more two times in three
        ctx.hit(hitmark + PARTICLE_DELAY, {
          path: ['_particle', 'anemo'],
          tag: 'other',
          element: 'anemo',
          weight: 2.67,
          label: 'Gale Blade (particles)',
        })
        return {
          cooldown: { key: 'skill', frames: 360, delay: hitmark - 2 },
          frames: 46 + hold,
          framesInto: {
            dash: 28 + hold,
            jump: 28 + hold,
            swap: 45 + hold,
          },
        }
      }
      case 'burst': {
        ctx.hit(40, {
          path: ['_heal', 'burst', 'regen'],
          tag: 'other',
          element: 'anemo',
          weight: ctx.members.length,
          label: 'Dandelion Breeze (heal)',
        })
        for (let at = 100; at <= 640; at += 60)
          ctx.hit(at, {
            path: ['_heal', 'burst', 'contRegen'],
            tag: 'other',
            element: 'anemo',
            label: 'Dandelion Field (heal)',
          })
        ctx.hit(55, {
          path: ['burst', 'dmg'],
          tag: 'burst',
          element: 'anemo',
          applies: true,
          durability: 50,
          icd: 'none',
          // (gcsim: stats at the cast)
          snapshotDelay: 0,
          label: 'Dandelion Breeze',
        })
        // gcsim's default: one enter at field activation, one exit when it expires (10 s)
        ctx.hit(40, {
          path: ['burst', 'enterExitDmg'],
          tag: 'burst',
          element: 'anemo',
          applies: true,
          durability: 50,
          icd: 'none',
          // (gcsim: stats at the cast)
          snapshotDelay: 0,
          label: 'Dandelion Breeze (enter)',
        })
        ctx.hit(640, {
          path: ['burst', 'enterExitDmg'],
          tag: 'burst',
          element: 'anemo',
          applies: true,
          durability: 50,
          icd: 'none',
          // (gcsim: stats at the cast)
          snapshotDelay: 0,
          label: 'Dandelion Breeze (exit)',
        })
        // C4: enemies in the field have Anemo RES -40%: refreshed by each field tick (every 1 s)
        // for 1.2 s, from just before activation to the last tick's 1.2 s
        if (ctx.constellation('Jean') >= 4)
          ctx.buff('Jean', ['Jean', 'c4'], 'on', 39, 673)
        return {
          cooldown: { key: 'burst', frames: 1200, delay: 38 },
          frames: 90,
          framesInto: { normal: 88, skill: 89, swap: 88 },
        }
      }
      case 'dash':
        return { frames: 22, framesInto: { jump: 3 } }
      case 'jump':
        // (gcsim's JumpLength: longer right after a dash)
        return templateJump('lady', 'sword', previous, ctx)
      default:
        // gcsim has no plunge for Jean: no damage
        return { frames: 30 }
    }
  },
}
