import type { KitModel } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/tighnari, main as of 2026-11-10. */

/**
 * N1..N4 from gcsim's attack.go: the arrow's travel (10 frames) is added to each hitmark. The
 * cancels come from the hitmark without travel (the aimed shot's cancel is the hitmark).
 */
const tighnariNormals: NormalHit[] = [
  { hitmarks: [24], toNormal: 26, toCharged: 14, toAbil: 14, frames: 26 },
  { hitmarks: [22], toNormal: 23, toCharged: 12, toAbil: 12, frames: 23 },
  { hitmarks: [23, 35], toNormal: 37, toCharged: 25, toAbil: 25, frames: 37 },
  { hitmarks: [38], toNormal: 68, toCharged: 28, toAbil: 28, frames: 68 },
]
/** Our sheet's normal node for each (string step, instance): N3 is one node for both hits */
const tighnariNodes = [[0], [1], [2, 2], [3]]

/** Vijnana Suffusion lasts 720 frames from 13 frames into the skill, with 3 Wreath Arrows */
const SUFFUSION_LIFE = 720

interface TighnariState {
  /** Vijnana Suffusion: until (frame) */
  suffusionUntil: number
  /** Wreath Arrows left */
  arrows: number
  /** The frame of his last Tanglevine Shaft hit (C4: its reactions) */
  burstHit: number
}

/** C4: the reactions of Tanglevine Shaft that raise its EM buff */
const C4_REACTIONS = ['burning', 'bloom', 'lunarBloom', 'quicken', 'spread']

export const kit: KitModel = {
  characterKey: 'Tighnari',
  element: 'dendro',
  source: `${GCSIM}/tighnari`,
  init: (): TighnariState => ({ suffusionUntil: -1, arrows: 0, burstHit: -1 }),
  act(ctx, s: TighnariState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          tighnariNormals,
          action.count ?? 1,
          (i, d, j) =>
            ctx.hit(d, {
              path: ['normal', `${tighnariNodes[i][j]}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'none',
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged': {
        const c = ctx.constellation('Tighnari')
        if (ctx.now < s.suffusionUntil && s.arrows > 0) {
          // Fully-Charged Aimed Shot as the Wreath Arrow: its 142-frame skip (C6 adds 54, to 175)
          const skip = Math.min(175, 142 + (c >= 6 ? 54 : 0))
          s.arrows--
          if (s.arrows === 0) s.suffusionUntil = -1
          const wreath = 175 + 10 - skip
          ctx.hit(wreath, {
            path: ['charged', 'wreath'],
            tag: 'charged',
            element: 'dendro',
            applies: true,
            icd: 'none',
            label: 'Wreath Arrow',
          })
          // the Clusterbloom Arrows: 4 hits, 35 frames of travel after the wreath
          for (let k = 0; k < 4; k++)
            ctx.hit(wreath + 35, {
              path: ['charged', 'cluster'],
              tag: 'charged',
              element: 'dendro',
              applies: true,
              icd: 'Tighnari',
              label: 'Clusterbloom Arrow',
            })
          if (c >= 6)
            ctx.hit(wreath + 35, {
              path: ['constellation6', 'cluster'],
              tag: 'charged',
              element: 'dendro',
              applies: true,
              icd: 'none',
              label: 'Karma Adjudged (C6)',
            })
          // A1: EM +50 for 4 s, from 1 frame after the wreath's cast point (the sheet gates A1)
          ctx.buff(
            'Tighnari',
            ['Tighnari', 'p1AfterWreath'],
            'on',
            175 - skip + 1,
            240
          )
          return {
            frames: 183 - skip,
            framesInto: { dash: 175 - skip, jump: 175 - skip },
          }
        }
        ctx.hit(96, {
          path: ['charged', 'aimedCharged'],
          tag: 'charged',
          element: 'dendro',
          applies: true,
          icd: 'none',
          label: 'Fully-Charged Aimed Shot',
        })
        return {
          frames: 94,
          framesInto: { dash: 86, jump: 86 },
        }
      }
      case 'skill': {
        // Vijnana-Phala Mine: the hit at 20 frames (the field's C2 window from 20 frames)
        ctx.hit(20, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'dendro',
          applies: true,
          icd: 'none',
          label: 'Vijnana-Phala Mine',
        })
        // Vijnana Suffusion and its 3 Wreath Arrows start 13 frames into the skill
        s.suffusionUntil = ctx.now + 13 + SUFFUSION_LIFE
        s.arrows = 3
        // C2: +20% Dendro DMG while an opponent is in the field, and for 6 s after (from after the
        // mine's own hit: gcsim's character task runs after that frame's attack)
        if (ctx.constellation('Tighnari') >= 2)
          ctx.buff('Tighnari', ['Tighnari', 'c2EnemyField'], 'on', 21, 809)
        return {
          cooldown: { key: 'skill', frames: 720, delay: 13 },
          frames: 30,
          framesInto: {
            normal: 20,
            charged: 20,
            burst: 22,
            dash: 23,
            jump: 23,
            swap: 21,
          },
        }
      }
      case 'burst': {
        // Tanglevine Shaft: 6 hits (112..128) and 6 secondary hits (147..175)
        for (const t of [112, 117, 120, 121, 126, 128])
          ctx.hit(t, {
            path: ['burst', 'primaryDmg'],
            tag: 'burst',
            element: 'dendro',
            applies: true,
            icd: 'burst',
            label: 'Tanglevine Shaft',
          })
        for (const t of [147, 153, 160, 161, 171, 175])
          ctx.hit(t, {
            path: ['burst', 'secondaryDmg'],
            tag: 'burst',
            element: 'dendro',
            applies: true,
            icd: 'burst',
            label: 'Secondary Tanglevine Shaft',
          })
        // C4: the party gets EM for 8 s when the burst is cast (gcsim: while he is on the field);
        // a reaction by a Tanglevine Shaft raises it and restarts the 8 s (see onHit)
        if (ctx.constellation('Tighnari') >= 4 && ctx.onField === 'Tighnari')
          ctx.buff('Tighnari', ['Tighnari', 'c4'], 'after', 0, 480, {
            hitlag: 'recipient',
          })
        return {
          cooldown: { key: 'burst', frames: 720 },
          frames: 118,
          framesInto: {
            normal: 114,
            charged: 114,
            skill: 117,
            dash: 117,
            swap: 115,
          },
        }
      }
      case 'dash':
        // gcsim's template for this body (Boy): 21 frames, 2 to the jump
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        // gcsim's template: 31 frames, 34 right after a dash
        return templateJump('boy', 'bow', previous, ctx)
      case 'plunge':
        ctx.note('Tighnari: gcsim has no plunge, not modelled')
        return { frames: 30 }
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, s: TighnariState, hit) {
    if (hit.characterKey !== 'Tighnari' || ctx.constellation('Tighnari') < 4)
      return
    if (hit.tag === 'burst' && !hit.path[0].startsWith('_')) {
      s.burstHit = ctx.now
      return
    }
    // (a reaction's marker lands on its hit's frame, after it)
    if (
      hit.path[0] === '_reaction' &&
      C4_REACTIONS.includes(hit.path[1]) &&
      ctx.now === s.burstHit
    )
      ctx.buff('Tighnari', ['Tighnari', 'c4'], 'react', 0, 480, {
        hitlag: 'recipient',
      })
  },
}
