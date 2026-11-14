import type { HitElement, KitModel } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/sayu, main as of 2026-11-10. */

const sayuNormals: NormalHit[] = [
  {
    hitmarks: [23],
    hitlag: [10],
    toNormal: 36,
    toCharged: 36,
    toAbil: 23,
    frames: 36,
  },
  {
    hitmarks: [29],
    hitlag: [10],
    toNormal: 48,
    toCharged: 48,
    toAbil: 29,
    frames: 48,
  },
  {
    hitmarks: [14, 26],
    hitlag: [0, 9],
    toNormal: 52,
    toCharged: 52,
    toAbil: 26,
    frames: 52,
  },
  {
    hitmarks: [35],
    hitlag: [9],
    toNormal: 71,
    toCharged: 71,
    toAbil: 35,
    frames: 71,
  },
]

/** Elements Fuufuu Windwheel can absorb from the enemy */
const absorbEles: HitElement[] = ['pyro', 'hydro', 'electro', 'cryo']

/** The kicks pause Sayu for 0.02 s (2 frames; no defense halt) */
const KICK_HITLAG = 2
const kickHitlag = (ctx: Parameters<KitModel['act']>[0], at: number) =>
  ctx.hit(at, {
    path: ['_marker', 'hitlag'],
    tag: 'other',
    element: 'physical',
    animationPause: KICK_HITLAG,
    label: 'Fuufuu Whirlwind hitlag',
  })

export const kit: KitModel = {
  characterKey: 'Sayu',
  element: 'anemo',
  source: `${GCSIM}/sayu`,
  act(ctx, _s, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          sayuNormals,
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
      case 'skill': {
        if (action.hold) {
          // Short Hold E (the rotation's hold: a long hold's duration is not in the text):
          // a DoT tick at 18, the absorb check at 30, the Whirlwind kick at 48
          ctx.hit(18, {
            path: ['skill', 'wheelDmg'],
            tag: 'skill',
            element: 'anemo',
            applies: true,
            durability: 25,
            icd: 'skill',
            snapshotDelay: 0,
            label: 'Fuufuu Windwheel (DoT)',
          })
          // C2: +3.3% per 0.5 s rolled (one tick here) on its kicks, the absorbed one included
          if (ctx.constellation('Sayu') >= 2)
            ctx.buff('Sayu', ['Sayu', 'c2SkillStack'], '1', 18, 32)
          ctx.hit(48, {
            path: ['skill', 'kickHoldDmg'],
            tag: 'skill',
            element: 'anemo',
            applies: true,
            durability: 25,
            icd: 'none',
            snapshotDelay: 0,
            label: 'Fuufuu Whirlwind (Kick, short hold)',
          })
          kickHitlag(ctx, 48)
          // the absorb check at 30 (Pyro > Hydro > Electro > Cryo): the kick then also deals
          // the absorbed element 1 frame after it
          ctx.at(30, (c) => {
            const ele = c.absorb(absorbEles)
            if (!ele || !absorbEles.includes(ele)) return
            c.hit(19, {
              path: ['skill', 'eleKickDmg'],
              tag: 'skill',
              element: ele,
              applies: true,
              durability: 25,
              icd: 'none',
              label: 'Fuufuu Whirlwind Elemental (absorbed kick)',
              states: [
                {
                  owner: 'Sayu',
                  path: ['Sayu', 'skillAbsorption'],
                  value: ele,
                },
              ],
            })
          })
          // (the absorbed DoT ticks come after the absorb, i.e. none in a short hold)
          return withHitlag(
            {
              cooldown: { key: 'skill', frames: 372, delay: 30 },
              frames: 89,
              framesInto: { swap: 87 },
            },
            { hitmarks: [48], hitlag: [KICK_HITLAG] }
          )
        }
        // Tap E: a DoT tick at 7, the Whirlwind kick at 25 (C2's +3.3% on it is the sheet's)
        ctx.hit(7, {
          path: ['skill', 'wheelDmg'],
          tag: 'skill',
          element: 'anemo',
          applies: true,
          durability: 25,
          icd: 'skill',
          snapshotDelay: 0,
          label: 'Fuufuu Windwheel (DoT)',
        })
        ctx.hit(25, {
          path: ['skill', 'kickPressDmg'],
          tag: 'skill',
          element: 'anemo',
          applies: true,
          durability: 25,
          icd: 'none',
          snapshotDelay: 0,
          label: 'Fuufuu Whirlwind (Kick, press)',
        })
        kickHitlag(ctx, 25)
        return withHitlag(
          {
            cooldown: { key: 'skill', frames: 360, delay: 14 },
            frames: 45,
            framesInto: { normal: 44, burst: 43, dash: 44, swap: 42 },
          },
          { hitmarks: [25], hitlag: [KICK_HITLAG] }
        )
      }
      case 'burst': {
        // Mujina Flurry's initial hit at 12 frames (2 frames of hitlag on Sayu)
        ctx.hit(12, {
          path: ['burst', 'pressDmg'],
          tag: 'burst',
          element: 'anemo',
          applies: true,
          icd: 'none',
          snapshotDelay: 0,
          label: 'Yoohoo Art: Mujina Flurry',
        })
        kickHitlag(ctx, 12)
        // Muji-Muji Daruma: 6 ticks, 90 frames apart from 145 (a character task, so after the
        // hitlag), on the cast's snapshot. Each one attacks an enemy in the area (assumed: the
        // active member is above 70% HP, so it does not heal instead; C1 does both)
        const cast = ctx.now
        const onField = ctx.onField
        ctx.atCharacter('Sayu', 20, (c) => {
          for (let i = 145 - 20; i < 145 + 540 - 20; i += 90)
            c.hit(i, {
              path: ['burst', 'darumaDmg'],
              tag: 'burst',
              element: 'anemo',
              applies: true,
              durability: 25,
              icd: 'burst',
              statSnapshots: (
                [
                  'atk',
                  'eleMas',
                  'critRate_',
                  'critDMG_',
                  'all_dmg_',
                  'anemo_dmg_',
                  'burst_dmg_',
                ] as const
              ).map((stat) => ({
                stat,
                path: ['total', stat],
                t: cast,
                onField,
              })),
              label: 'Muji-Muji Daruma',
            })
        })
        return withHitlag(
          {
            cooldown: { key: 'burst', frames: 1200 },
            frames: 65,
            framesInto: { dash: 64, swap: 64 },
          },
          { hitmarks: [12], hitlag: [KICK_HITLAG] }
        )
      }
      case 'charged':
        // gcsim has no charged attack for Sayu (charge is listed in its config, not implemented)
        ctx.note(
          'Sayu: the charged attack is not in gcsim (not modelled: no damage, default frames).'
        )
        return { frames: 30 }
      case 'plunge':
        // gcsim has no plunge for Sayu
        ctx.note(
          'Sayu: the plunge is not in gcsim (not modelled: no damage, default frames).'
        )
        return { frames: 30 }
      case 'dash':
        // Loli body: a 21-frame dash, which can jump after 4 frames
        return { frames: 21, framesInto: { jump: 4 } }
      case 'jump':
        // Loli body: 29 frames, 37 after a dash
        return templateJump('loli', 'claymore', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
}
