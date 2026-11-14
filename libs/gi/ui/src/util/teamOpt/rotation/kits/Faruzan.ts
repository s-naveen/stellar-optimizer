import type { KitModel, SimContext, SimHit } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/faruzan, main as of 2026-11-10. */

/** Arrows: the damage lands 10 frames (the arrow's travel) after each hitmark */
const faruzanNormals: NormalHit[] = [
  { hitmarks: [24], toNormal: 26, toCharged: 14, toAbil: 14, frames: 26 },
  { hitmarks: [20], toNormal: 21, toCharged: 10, toAbil: 10, frames: 21 },
  { hitmarks: [34], toNormal: 39, toCharged: 24, toAbil: 24, frames: 39 },
  { hitmarks: [39], toNormal: 86, toCharged: 29, toAbil: 29, frames: 86 },
]

interface FaruzanState {
  /** Prayerful Wind's Gift (the burst's Anemo buff, which C6 rides on): from / until */
  giftFrom: number
  giftEnd: number
  /** Manifest Gale ends (undefined: not in it) */
  galeEnd?: number
  /** Hurricane Arrows left in the Manifest Gale */
  hurricanes: number
  /** C6: the next Pressurized Collapse can trigger from this frame */
  c6Ready: number
  /** A4: the next Hurricane Guard can trigger from this frame */
  a4Ready: number
}

/** A4's Hurricane Guard: these attacks' Anemo DMG */
const A4_TAGS = new Set(['normal', 'charged', 'plunge', 'skill', 'burst'])

/**
 * Perfidious Wind's Bale (Anemo RES -30%, 4 s) from a burst or vortex hit (A1: the vortices too):
 * from after that hit (gcsim's attack callback)
 */
function shred(ctx: SimContext, hit: SimHit) {
  hit.states = [
    ...(hit.states ?? []),
    {
      owner: 'Faruzan',
      path: ['Faruzan', 'burstHit'],
      value: ctx.hasBuff('Faruzan', ['Faruzan', 'burstHit']) ? 'on' : '',
    },
  ]
  ctx.buff('Faruzan', ['Faruzan', 'burstHit'], 'on', 0, 240, {
    hitlag: 'enemy',
  })
}

export const kit: KitModel = {
  characterKey: 'Faruzan',
  element: 'anemo',
  source: `${GCSIM}/faruzan`,
  init: (): FaruzanState => ({
    giftFrom: -1,
    giftEnd: -1,
    hurricanes: 0,
    c6Ready: -1,
    a4Ready: -1,
  }),
  // In Manifest Gale her charged attack is the Hurricane Arrow (gcsim's own aimedEFrames)
  variant(ctx, s: FaruzanState, action) {
    return action.kind === 'charged' &&
      s.galeEnd !== undefined &&
      ctx.now < s.galeEnd &&
      s.hurricanes > 0
      ? { key: 'gale', label: 'Hurricane Arrow', mode: 'Manifest Gale' }
      : undefined
  },
  act(ctx, s: FaruzanState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          faruzanNormals,
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
        // The rotation's CA is the Fully-Charged Aimed Shot (gcsim's physical Aimed Shot, hold 0, is
        // not a rotation action here). In the Manifest Gale it is a Hurricane Arrow (also Anemo,
        // Charged Attack DMG) that creates a Pressurized Collapse when it hits.
        const gale =
          s.galeEnd !== undefined && ctx.now < s.galeEnd && s.hurricanes > 0
        if (gale) {
          s.hurricanes--
          if (s.hurricanes <= 0) s.galeEnd = undefined
          // A1 (charge time -60% in the gale): assumed, the sim has no ascension input
          ctx.note(
            'Faruzan: A1 assumed (the Hurricane Arrow charges 60% faster)'
          )
          ctx.hit(59, {
            path: ['charged', 'aimedCharged'],
            tag: 'charged',
            element: 'anemo',
            applies: true,
            label: 'Hurricane Arrow (Fully-Charged Aimed Shot)',
          })
          // the vortex is 33 frames after the arrow hits (Pressurized Collapse), with the stats of
          // that moment
          ctx.hit(59 + 33, {
            path: ['skill', 'vortexDmg'],
            tag: 'skill',
            element: 'anemo',
            applies: true,
            snapshotDelay: 59,
            label: 'Pressurized Collapse',
          })
          return {
            frames: 60,
            framesInto: {
              normal: 60,
              charged: 60,
              skill: 60,
              burst: 60,
              dash: 49,
              jump: 49,
              swap: 60,
            },
          }
        }
        ctx.hit(96, {
          path: ['charged', 'aimedCharged'],
          tag: 'charged',
          element: 'anemo',
          applies: true,
          label: 'Fully-Charged Aimed Shot',
        })
        return {
          frames: 96,
          framesInto: {
            normal: 96,
            charged: 96,
            skill: 96,
            burst: 96,
            dash: 86,
            jump: 86,
            swap: 96,
          },
        }
      }
      case 'skill': {
        // Wind Realm of Nasamjnin: AoE Anemo at frame 14; Manifest Gale from frame 12, 18 s, with
        // 1 Hurricane Arrow (2 with C1)
        ctx.hit(14, {
          path: ['skill', 'skillDmg'],
          tag: 'skill',
          element: 'anemo',
          applies: true,
          label: 'Wind Realm of Nasamjnin',
        })
        s.hurricanes = ctx.constellation('Faruzan') >= 1 ? 2 : 1
        s.galeEnd = ctx.now + 12 + 18 * 60
        return {
          cooldown: { key: 'skill', frames: 360, delay: 12 },
          frames: 35,
          framesInto: {
            normal: 35,
            charged: 35,
            skill: 34,
            burst: 34,
            dash: 28,
            jump: 27,
            swap: 33,
          },
        }
      }
      case 'burst': {
        ctx.hit(54, {
          path: ['burst', 'dmg'],
          tag: 'burst',
          element: 'anemo',
          applies: true,
          label: "The Wind's Secret Ways",
        })
        // Dazzling Polyhedron from frame 43 for 745 frames (+360 with C2). Its Prayerful Wind's Gift
        // (240 frames, refreshed every 239) runs the whole time, and C6's Anemo CRIT DMG with it.
        const dur = 745 + (ctx.constellation('Faruzan') >= 2 ? 360 : 0)
        ctx.buff('Faruzan', ['Faruzan', 'burstBenefit'], 'on', 43, dur + 240)
        if (ctx.constellation('Faruzan') >= 6)
          ctx.buff('Faruzan', ['Faruzan', 'c6Crit'], 'on', 43, dur + 240)
        s.giftFrom = ctx.now + 43
        s.giftEnd = ctx.now + 43 + dur + 240
        // Anemo RES shred (240 frames): the burst's hit (see onHit), then each Whirlwind Pulse (every
        // 120 frames from frame 180) that reaches the enemy: the pulses take turns at three spots
        // (gcsim: 5.19 to either side 10.5 ahead, and 1.5 ahead), each reaching 6 around it
        const spots = [
          [5.19, 10.5],
          [-5.19, 10.5],
          [0, 1.5],
        ]
        let k = 0
        for (let i = 137; i <= dur; i += 120, k++) {
          const [x, y] = spots[k % 3]
          if (Math.hypot(x, y - ctx.target.distance) <= 6)
            ctx.buff('Faruzan', ['Faruzan', 'burstHit'], 'on', 43 + i, 240, {
              hitlag: 'enemy',
            })
        }
        return {
          cooldown: { key: 'burst', frames: 20 * 60 },
          frames: 71,
          framesInto: {
            normal: 61,
            charged: 61,
            skill: 61,
            dash: 61,
            jump: 63,
            swap: 60,
          },
        }
      }
      case 'plunge':
        // gcsim has no plunge for Faruzan
        ctx.note('Faruzan: plunge is not in gcsim, not modelled')
        return { frames: 30 }
      case 'dash':
        // the template dash: 20 frames, jump after 4
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // Faruzan is a Girl: 31 frames, 34 after a dash
        return templateJump('girl', 'bow', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onBeforeHit(ctx, s: FaruzanState, hit) {
    if (hit.path[0].startsWith('_')) return
    // A4 (Hurricane Guard): a member under Prayerful Wind's Benefit dealing Anemo DMG with these
    // attacks gets 32% of Faruzan's Base ATK on that hit, once every 0.8 s (gcsim's status: still
    // active on its expiry frame)
    if (
      hit.element === 'anemo' &&
      A4_TAGS.has(hit.tag) &&
      ctx.now >= s.giftFrom &&
      ctx.now < s.giftEnd &&
      ctx.now >= s.a4Ready
    ) {
      s.a4Ready = ctx.now + 49
      hit.states = [
        ...(hit.states ?? []),
        { owner: 'Faruzan', path: ['Faruzan', 'a4Active'], value: 'on' },
      ]
    }
  },
  onHit(ctx, s: FaruzanState, hit) {
    if (hit.path[0].startsWith('_')) return
    if (
      hit.characterKey === 'Faruzan' &&
      (hit.tag === 'burst' || hit.path[1] === 'vortexDmg')
    )
      shred(ctx, hit)
    // C6: when the active member's damage lands during Prayerful Wind's Gift, a Pressurized
    // Collapse on the enemy (3 s ICD: gcsim's status, still active on its expiry frame)
    if (ctx.constellation('Faruzan') < 6) return
    if (hit.onField !== hit.characterKey) return
    if (hit.t < s.giftFrom || hit.t >= s.giftEnd || hit.t < s.c6Ready) return
    s.c6Ready = hit.t + 181
    ctx.hit(33, {
      characterKey: 'Faruzan',
      path: ['skill', 'vortexDmg'],
      tag: 'skill',
      element: 'anemo',
      applies: true,
      snapshotDelay: 0,
      label: 'Pressurized Collapse (C6)',
    })
  },
}
