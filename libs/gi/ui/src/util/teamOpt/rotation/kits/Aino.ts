import { annulusHitChance } from '../geometry'
import type { KitModel } from '../types'
import { KQMSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from KQM-git/kqmsim (AGPLv3), commit 7bdf45f, internal/characters/aino. */

const ainoNormals: NormalHit[] = [
  {
    hitmarks: [23],
    hitlag: [10],
    toNormal: 32,
    toCharged: 48,
    toAbil: 23,
    frames: 48,
  },
  {
    hitmarks: [20],
    hitlag: [10],
    toNormal: 43,
    toCharged: 75,
    toAbil: 20,
    frames: 75,
  },
  {
    hitmarks: [35, 43],
    hitlag: [0, 9],
    toNormal: 62,
    toCharged: 93,
    toAbil: 43,
    frames: 93,
  },
]

interface AinoState {
  targetReady: number
  randomCredit: number
  /** Cool Your Jets Ducky is up (C2) from `burstFrom` to `burstEnd` */
  burstFrom: number
  burstEnd: number
  /** C2's internal cooldown (5 s) ends at this frame */
  c2IcdEnd: number
}

export const kit: KitModel = {
  characterKey: 'Aino',
  moonsign: 1,
  element: 'hydro',
  source: `${KQMSIM}/aino`,
  init: (): AinoState => ({
    burstFrom: -1e9,
    burstEnd: -1e9,
    c2IcdEnd: -1e9,
    targetReady: -1,
    randomCredit: 0.5,
  }),
  act(ctx, s: AinoState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          ainoNormals,
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
      case 'plunge':
        // gcsim has no charged or plunging attack for Aino (no frame data): not modelled
        ctx.note(
          `Aino: ${action.kind === 'charged' ? 'charged' : 'plunging'} attack has no gcsim frame data; not modelled`
        )
        return { frames: 30 }
      case 'skill': {
        // gcsim does not implement the hold: a hold is modelled as the tap
        if (action.hold)
          ctx.note('Aino: hold skill is not in gcsim; modelled as the tap')
        // Musecatcher: stage 1 on the target (frame 15), stage 2 around Aino (frame 33)
        ctx.hit(15, {
          path: ['skill', 'dmg1'],
          tag: 'skill',
          element: 'hydro',
          applies: true,
          icd: 'skill',
          label: 'Musecatcher (stage 1)',
        })
        ctx.hit(33, {
          path: ['skill', 'dmg2'],
          tag: 'skill',
          element: 'hydro',
          applies: true,
          icd: 'skill',
          label: 'Musecatcher (stage 2)',
        })
        // C1: +EM for the party for 15 s after a skill or burst
        if (ctx.constellation('Aino') >= 1)
          ctx.buff('Aino', ['Aino', 'c1AfterSkillOrBurst'], 'on', 0, 15 * 60)
        return {
          cooldown: { key: 'skill', frames: 10 * 60, delay: 13 },
          frames: 52,
          framesInto: { normal: 50, burst: 50, dash: 39, jump: 38, swap: 49 },
        }
      }
      case 'burst': {
        // Cool Your Jets Ducky: Water Balls from frame 123 for 14.2 s, one every 1.5 s, each
        // landing 10 frames after its tick. A1 (with a 2-moonsign party): one every 0.7 s with its
        // own ICD group (assumed unlocked: the sim does not know ascension).
        const a1 = ctx.moonsign >= 2
        if (a1) ctx.note('Aino: A1 (faster Water Balls) assumed unlocked')
        const chance = annulusHitChance(
          1.5,
          9,
          ctx.target.radius + (a1 ? 4 : 1),
          ctx.target.distance
        )
        if (a1)
          ctx.note(
            'Aino: untargeted Water Balls use expected hit frequency for the target’s size and distance; reaction timing is approximate.'
          )
        for (let i = 0; i < 14.2 * 60; i += a1 ? 42 : 90)
          ctx.at(123 + i, (c) => {
            if (
              c.now >= s.targetReady &&
              c.target.distance <= 10 + c.target.radius
            )
              s.targetReady = c.now + 48
            else {
              s.randomCredit += chance
              if (s.randomCredit < 1) return
              s.randomCredit--
            }
            c.hit(10, {
              path: ['burst', 'ballDmg'],
              tag: 'burst',
              element: 'hydro',
              applies: true,
              icd: a1 ? 'AinoBurstMoonHit' : 'burst',
              icdGroup: a1 ? 'AinoBurstMoonHit' : 'default',
              label: 'Water Ball',
            })
          })
        s.burstFrom = ctx.now + 123
        s.burstEnd = ctx.now + 123 + 14 * 60
        // C1 (+EM) and C6 (Lunar DMG for the active member) for 15 s after the burst
        if (ctx.constellation('Aino') >= 1)
          ctx.buff('Aino', ['Aino', 'c1AfterSkillOrBurst'], 'on', 0, 15 * 60)
        if (ctx.constellation('Aino') >= 6)
          ctx.buff('Aino', ['Aino', 'c6AfterBurst'], 'on', 0, 15 * 60)
        return {
          cooldown: { key: 'burst', frames: 13.5 * 60 },
          frames: 60,
          framesInto: {
            normal: 55,
            charged: 55,
            skill: 55,
            dash: 56,
            jump: 56,
            swap: 54,
          },
        }
      }
      case 'dash':
        // template dash (Loli body)
        return { frames: 21, framesInto: { jump: 4 } }
      case 'jump':
        // template jump (Loli body): 37 frames after a dash, else 29
        return templateJump('loli', 'claymore', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, s: AinoState, hit) {
    // C2: while Cool Your Jets Ducky is up, a hit by the member on the field (not Aino) triggers a
    // Hydro hit 10 frames later, once per 5 s
    if (ctx.constellation('Aino') < 2 || hit.path[0].startsWith('_')) return
    if (hit.characterKey !== hit.onField || hit.onField === 'Aino') return
    if (hit.t < s.burstFrom || hit.t >= s.burstEnd || hit.t < s.c2IcdEnd) return
    s.c2IcdEnd = hit.t + 5 * 60
    ctx.hit(10, {
      characterKey: 'Aino',
      path: ['constellation2', 'dmg'],
      tag: 'burst',
      element: 'hydro',
      applies: true,
      icd: 'none',
      label: 'Water Ball (C2)',
    })
  },
}
