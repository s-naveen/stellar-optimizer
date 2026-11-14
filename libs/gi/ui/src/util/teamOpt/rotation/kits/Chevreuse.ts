import type { ActionResult, KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/chevreuse, main as of 2026-11-10. */

const chevreuseNormals: NormalHit[] = [
  {
    hitmarks: [11],
    hitlag: [8],
    toNormal: 23,
    toCharged: 27,
    toAbil: 11,
    frames: 33,
  },
  {
    hitmarks: [12],
    hitlag: [8],
    toNormal: 26,
    toCharged: 28,
    toAbil: 12,
    frames: 33,
  },
  {
    hitmarks: [15, 25],
    hitlag: [0, 8],
    toNormal: 33,
    toCharged: 36,
    toAbil: 25,
    frames: 46,
  },
  {
    hitmarks: [33],
    hitlag: [10],
    toNormal: 64,
    toCharged: 67,
    toAbil: 33,
    frames: 67,
  },
]

/** The sheet's node for each hit of each normal attack (N3 has two hits) */
const normalNodes = [['0'], ['1'], ['2', '3'], ['4']]

interface ChevreuseState {
  /** Surging Blade's internal cooldown ends (frame) */
  bladeIcdEnd: number
  /** C2's internal cooldown ends (frame) */
  c2IcdEnd: number
  /** C4: a Hold E has no cooldown until this frame, for `c4Shots` more casts */
  c4Until: number
  c4Shots: number
  /** C6: the healing of E is running (a recast only refreshes it) */
  healChain: boolean
  healEnd: number
  /** C6: the team heal at the end of the healing is queued */
  teamHealQueued: boolean
  ball: boolean
}

/** C6: the Pyro/Electro DMG stack (8 s) from the healing */
const c6Stack = (ctx: SimContext) =>
  ctx.buff('Chevreuse', ['Chevreuse', 'c6AfterHealStacks'], '1', 0, 8 * 60, {
    recipient: ctx.onField,
  })

/**
 * C6: E's healing (every 2 s for 12 s) gives a stack to the active member, and one to each
 * member at its end. The sheet's stacks are team-wide, so the tick stacks count for the team.
 */
function startHealing(ctx: SimContext, s: ChevreuseState) {
  s.healEnd = ctx.now + 12 * 60 + 1
  if (s.healChain) return
  s.healChain = true
  const tick = (c: SimContext) => {
    if (c.now >= s.healEnd) {
      s.healChain = false
      return
    }
    c6Stack(c)
    c.at(2 * 60, tick)
  }
  ctx.at(2 * 60, tick)
  if (!s.teamHealQueued) {
    s.teamHealQueued = true
    ctx.at(12 * 60, (c) => {
      s.teamHealQueued = false
      for (const recipient of c.members)
        c.buff('Chevreuse', ['Chevreuse', 'c6AfterHealStacks'], '1', 0, 480, {
          recipient,
        })
    })
  }
}

export const kit: KitModel = {
  characterKey: 'Chevreuse',
  element: 'pyro',
  source: `${GCSIM}/chevreuse`,
  init: (): ChevreuseState => ({
    bladeIcdEnd: -1,
    c2IcdEnd: -1,
    c4Until: -1,
    c4Shots: 0,
    healChain: false,
    healEnd: -1,
    teamHealQueued: false,
    ball: false,
  }),
  act(ctx, s: ChevreuseState, action, previous) {
    const c = ctx.constellation('Chevreuse')
    switch (action.kind) {
      case 'normal':
        return normalString(
          chevreuseNormals,
          action.count ?? 1,
          (i, d, j) =>
            ctx.hit(d, {
              path: ['normal', normalNodes[i][j]],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}${j ? ` (hit ${j + 1})` : ''}`,
            }),
          ctx
        )
      case 'charged':
        ctx.hit(27, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'ExtraAttack',
          icdGroup: 'PoleExtraAttack',
          label: 'Charged Attack',
        })
        return {
          frames: 65,
          framesInto: {
            normal: 58,
            charged: 65,
            skill: 58,
            burst: 58,
            dash: 27,
            jump: 27,
            swap: 57,
          },
        }
      case 'skill': {
        const hold = !!action.hold
        const overcharged = hold && s.ball
        if (overcharged) s.ball = false
        // Hold at its shortest (gcsim hold=1): hitmark 19f, cooldown from 13f
        const hitmark = hold ? 19 : 25
        const cdDelay = hold ? 13 : 18
        ctx.hit(hitmark, {
          path: [
            'skill',
            overcharged ? 'ballDmg' : hold ? 'holdDmg' : 'pressDmg',
          ],
          tag: 'skill',
          element: 'pyro',
          applies: true,
          icd: 'none',
          label: hold
            ? 'Short-Range Rapid Interdiction Fire (hold)'
            : 'Short-Range Rapid Interdiction Fire',
        })
        if (overcharged)
          ctx.buff(
            'Chevreuse',
            ['Chevreuse', 'a4AfterBall'],
            'on',
            cdDelay,
            1800
          )
        // Surging Blade (Durability 0, 34f / 36f after the hit): on the first E hit of every 10 s
        if (ctx.now + hitmark >= s.bladeIcdEnd) {
          s.bladeIcdEnd = ctx.now + hitmark + 10 * 60
          ctx.hit(hitmark + (hold ? 36 : 34), {
            path: ['skill', 'bladeDmg'],
            tag: 'skill',
            element: 'pyro',
            applies: false,
            icd: 'none',
            label: 'Surging Blade',
          })
        }
        // C2: a Hold E hit sets off two chain explosions 0.6-1 s later (0.8 s used), every 10 s
        if (hold && c >= 2 && ctx.now + hitmark >= s.c2IcdEnd) {
          s.c2IcdEnd = ctx.now + hitmark + 10 * 60
          for (let b = 0; b < 2; b++)
            ctx.hit(hitmark + 48, {
              path: ['constellation2', 'dmg'],
              tag: 'skill',
              element: 'pyro',
              applies: true,
              icd: 'ElementalArt',
              label: 'Sniper Induced Explosion (C2)',
            })
        }
        // C6: the healing (from the E's cooldown delay) stacks Pyro/Electro DMG
        if (c >= 6) ctx.at(cdDelay, (c2) => startHealing(c2, s))
        // C4: after a Ring of Bursting Grenades, the Hold E has no cooldown (2 casts, 6 s)
        const noCooldown = hold && s.c4Until > ctx.now
        if (noCooldown) {
          s.c4Shots--
          if (s.c4Shots <= 0) s.c4Until = -1
        }
        const result: ActionResult = hold
          ? {
              frames: 26,
              framesInto: {
                normal: 25,
                charged: 26,
                skill: 26,
                burst: 26,
                dash: 21,
                jump: 23,
                swap: 23,
              },
            }
          : {
              frames: 31,
              framesInto: {
                normal: 31,
                charged: 31,
                skill: 31,
                burst: 31,
                dash: 23,
                jump: 25,
                swap: 24,
              },
            }
        if (!noCooldown)
          result.cooldown = { key: 'skill', frames: 15 * 60, delay: cdDelay }
        return result
      }
      case 'burst': {
        ctx.hit(59, {
          path: ['burst', 'grenadeDmg'],
          tag: 'burst',
          element: 'pyro',
          applies: true,
          durability: 50,
          icd: 'none',
          label: 'Explosive Grenade',
        })
        // 8 shells in 5 groups, exploding 24-60 frames after the grenade's hit
        const groups: [delay: number, count: number][] = [
          [24, 1],
          [33, 2],
          [42, 2],
          [51, 2],
          [60, 1],
        ]
        for (const [delay, count] of groups)
          for (let j = 0; j < count; j++)
            ctx.hit(59 + delay, {
              path: ['burst', 'shellDmg'],
              tag: 'burst',
              element: 'pyro',
              applies: true,
              icd: 'ChevreuseBurstMines',
              label: 'Secondary Explosive Shell',
            })
        if (c >= 4) {
          s.c4Until = ctx.now + 6 * 60
          s.c4Shots = 2
        }
        return {
          cooldown: { key: 'burst', frames: 15 * 60 },
          frames: 61,
          framesInto: {
            normal: 57,
            charged: 61,
            skill: 59,
            burst: 61,
            dash: 57,
            jump: 57,
            swap: 56,
          },
        }
      }
      case 'dash':
        // Girl body: 20f, and 4f into a jump
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // Girl body: 34f after a dash, 31f otherwise
        return templateJump('girl', 'polearm', previous, ctx)
      case 'plunge':
        // gcsim has no plunging attack for Chevreuse
        ctx.note(
          'Chevreuse: plunging attacks are not modelled (gcsim has none).'
        )
        return { frames: 30 }
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, s: ChevreuseState, hit) {
    if (hit.path.join('.') !== '_reaction.overloaded') return
    s.ball = true
    ctx.buff('Chevreuse', ['Chevreuse', 'a1AfterOverload'], 'on', 1, 360)
  },
}
