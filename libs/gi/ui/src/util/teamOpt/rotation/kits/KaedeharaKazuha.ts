import type { RotationAction } from '../parse'
import type { HitElement, KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/kazuha, main as of 2026-11-10. */

/** Five normal attack steps; the sheet's nodes per step and instance (step 3 has two instances, step 5 three) */
const kazuhaNormals: NormalHit[] = [
  {
    hitmarks: [13],
    hitlag: [6],
    toNormal: 21,
    toCharged: 21,
    toAbil: 13,
    frames: 21,
  },
  {
    hitmarks: [11],
    hitlag: [6],
    toNormal: 20,
    toCharged: 20,
    toAbil: 11,
    frames: 20,
  },
  {
    hitmarks: [16, 25],
    hitlag: [1, 7],
    toNormal: 33,
    toCharged: 31,
    toAbil: 25,
    frames: 33,
  },
  {
    hitmarks: [15],
    hitlag: [8],
    toNormal: 38,
    toCharged: 35,
    toAbil: 15,
    frames: 38,
  },
  {
    hitmarks: [15, 19, 27],
    hitlag: [4, 0, 4],
    toNormal: 72,
    toCharged: 72,
    toAbil: 27,
    frames: 72,
  },
]
const kazuhaNodes = [['0'], ['1'], ['2', '3'], ['4'], ['5', '5', '5']]

interface KazuhaState {
  /** The Skill cooldown's key: Kazuha Slash resets it at C1, so a new key is ready at once */
  skillEpoch: number
  /** The last action of this member (undefined after it swaps out) */
  last?: RotationAction
  skillAbsorb?: HitElement
  burstAbsorb?: HitElement
}

/** The previous action, if it was this member's own (undefined: a swap or another member's action came between) */
function ownPrevious(
  s: { last?: RotationAction },
  previous: RotationAction | undefined
): RotationAction | undefined {
  if (previous === undefined) return undefined
  // a wait is not a swap: look through it
  if (previous.kind === 'wait') return s.last
  return previous === s.last ? previous : undefined
}

/**
 * C6: an Anemo infusion (normal, charged and plunging attacks) and the EM-based DMG bonus for 5 s
 * from `delay` frames from now, on Kazuha's clock (gcsim: both hitlag-extended)
 */
function c6Infuse(ctx: SimContext) {
  return (delay: number) => {
    ctx.infuse('anemo', delay, 5 * 60, 'KaedeharaKazuha')
    ctx.buff(
      'KaedeharaKazuha',
      ['KaedeharaKazuha', 'c6'],
      'c6',
      delay,
      5 * 60,
      {
        hitlag: 'recipient',
        recipient: 'KaedeharaKazuha',
      }
    )
  }
}

export const kit: KitModel = {
  characterKey: 'KaedeharaKazuha',
  element: 'anemo',
  source: `${GCSIM}/kazuha`,
  init: (): KazuhaState => ({ skillEpoch: 0 }),
  act(ctx, s: KazuhaState, action, previous) {
    const own = ownPrevious(s, previous)
    s.last = action
    const c = ctx.constellation('KaedeharaKazuha')
    switch (action.kind) {
      case 'normal':
        return normalString(
          kazuhaNormals,
          action.count ?? 1,
          (i, d, j) =>
            ctx.hit(d, {
              path: ['normal', kazuhaNodes[i][j]],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged':
        for (const node of ['dmg1', 'dmg2'])
          ctx.hit(20, {
            path: ['charged', node],
            tag: 'charged',
            element: 'physical',
            applies: true,
            icd: 'normal',
            label: 'Charged Attack',
          })
        return {
          frames: 55,
          framesInto: { skill: 30, burst: 30, dash: 20, jump: 20, swap: 28 },
        }
      case 'skill': {
        const hold = !!action.hold
        s.skillAbsorb = undefined
        const check = (c2: SimContext, count: number) => {
          s.skillAbsorb = c2.absorb()
          if (!s.skillAbsorb && count > 1)
            c2.at(6, (c3) => check(c3, count - 1))
        }
        ctx.at(1, (c2) => check(c2, hold ? 5 : 1))
        if (hold) {
          // Chihayaburu (hold): 50 durability, 33 frames
          ctx.hit(33, {
            path: ['skill', 'hold'],
            tag: 'skill',
            element: 'anemo',
            applies: true,
            durability: 50,
            icd: 'none',
            // (gcsim: stats at the cast)
            snapshotDelay: 0,
            label: 'Chihayaburu (hold)',
          })
          if (c >= 6) c6Infuse(ctx)(33)
          return {
            cooldown: {
              key: `skill${s.skillEpoch}`,
              frames: c >= 1 ? 486 : 540,
              delay: 31,
            },
            frames: 175,
            framesInto: { plunge: 58 },
          }
        }
        ctx.hit(10, {
          path: ['skill', 'press'],
          tag: 'skill',
          element: 'anemo',
          applies: true,
          icd: 'none',
          // (gcsim: stats at the cast)
          snapshotDelay: 0,
          label: 'Chihayaburu',
        })
        if (c >= 6) c6Infuse(ctx)(10)
        return {
          cooldown: {
            key: `skill${s.skillEpoch}`,
            frames: c >= 1 ? 324 : 360,
            delay: 8,
          },
          frames: 77,
          framesInto: { plunge: 24 },
        }
      }
      case 'burst': {
        s.burstAbsorb = undefined
        const check = (c2: SimContext, count: number) => {
          s.burstAbsorb = c2.absorb()
          if (!s.burstAbsorb && count > 1)
            c2.at(18, (c3) => check(c3, count - 1))
        }
        ctx.at(81, (c2) => check(c2, 17))
        ctx.hit(82, {
          path: ['burst', 'dmg'],
          tag: 'burst',
          element: 'anemo',
          applies: true,
          durability: 50,
          icd: 'none',
          label: 'Kazuha Slash',
        })
        ctx.hit(82, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 3,
          label: 'Kazuha burst slash hitlag',
        })
        // Native starts the world-time tick chain from a character task inside slash hitlag.
        // Its initial three-frame pause therefore shifts every tick as well as the next action.
        ctx.atCharacter('KaedeharaKazuha', 83, (at) => {
          for (let i = 0; i < 5; i++)
            at.at(57 + 117 * i, (c2) => {
              if (s.burstAbsorb)
                c2.hit(0, {
                  path: ['burst', 'absorb'],
                  tag: 'burst',
                  element: s.burstAbsorb,
                  applies: true,
                  icd: 'none',
                  label: 'Kazuha Slash (Absorb DoT)',
                  states: [
                    {
                      owner: 'KaedeharaKazuha',
                      path: ['KaedeharaKazuha', 'burstAbsorption'],
                      value: s.burstAbsorb,
                    },
                  ],
                })
              c2.hit(0, {
                path: ['burst', 'dot'],
                tag: 'burst',
                element: 'anemo',
                applies: true,
                icd: 'none',
                label: 'Kazuha Slash (DoT)',
              })
            })
        })
        // C2: a field tick every 0.5 s from frame 81 (while the field lasts, to frame 608) gives Kazuha
        // and the active character +200 Elemental Mastery for 1 s: the ticks cover 81 to 651, one window
        if (c >= 2) {
          ctx.buff('KaedeharaKazuha', ['KaedeharaKazuha', 'c2'], 'c2', 81, 570)
          ctx.buff(
            'KaedeharaKazuha',
            ['KaedeharaKazuha', 'c2p'],
            'c2p',
            81,
            570
          )
        }
        // C6: the infusion from the Q's hitmark + 1
        if (c >= 6) c6Infuse(ctx)(83)
        // C1: resets the Skill cooldown
        if (c >= 1) s.skillEpoch++
        return withHitlag(
          {
            cooldown: { key: 'burst', frames: 900 },
            frames: 93,
            framesInto: { normal: 92, skill: 92, dash: 92, swap: 90 },
          },
          { hitmarks: [82], hitlag: [3] }
        )
      }
      case 'plunge':
        if (own?.kind === 'skill') {
          // Midare Ranzan after Chihayaburu (frame 36 press, 41 hold): Anemo, no collision
          const hold = !!own.hold
          if (s.skillAbsorb) {
            ctx.hit((hold ? 41 : 36) - 1, {
              path: ['passive1', 'absorb'],
              tag: 'plunge',
              element: s.skillAbsorb,
              applies: true,
              icd: 'none',
              label: 'Soumon Swordsmanship (A1)',
              poiseDamage: 20,
              states: [
                {
                  owner: 'KaedeharaKazuha',
                  path: ['KaedeharaKazuha', 'skillAbsorption'],
                  value: s.skillAbsorb,
                },
              ],
            })
            s.skillAbsorb = undefined
          }
          ctx.hit(hold ? 41 : 36, {
            path: ['skill', 'phigh'],
            tag: 'plunge',
            element: 'anemo',
            applies: true,
            icd: 'none',
            label: 'Midare Ranzan',
          })
          return hold
            ? {
                frames: 61,
                framesInto: {
                  skill: 60,
                  burst: 60,
                  dash: 48,
                  jump: 55,
                  swap: 54,
                },
              }
            : { frames: 55, framesInto: { dash: 43, jump: 50, swap: 50 } }
        }
        // no Chihayaburu before it: gcsim's low plunge (no collision)
        ctx.hit(46, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 73,
          framesInto: {
            normal: 52,
            skill: 52,
            burst: 51,
            dash: 46,
            jump: 69,
            swap: 53,
          },
        }
      case 'dash':
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        // the jump is longer after a dash
        return templateJump('boy', 'sword', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  cooldownKey: (s: KazuhaState, action) =>
    action.kind === 'skill'
      ? `skill${s.skillEpoch}`
      : action.kind === 'burst'
        ? 'burst'
        : undefined,
  onSwapOut(_ctx, s: KazuhaState) {
    s.last = undefined
  },
  onHit(ctx, _s, hit) {
    if (hit.characterKey !== 'KaedeharaKazuha' || hit.path[0] !== '_reaction')
      return
    // A4: a Swirl, or a Stellar Swirl (its marker carries the Cryo it absorbed)
    const element =
      hit.path[1] === 'stellarSwirl'
        ? ['pyro', 'hydro', 'electro', 'cryo'].includes(hit.element)
          ? hit.element
          : undefined
        : /^(pyro|hydro|electro|cryo)Swirl$/.exec(hit.path[1])?.[1]
    if (element)
      ctx.buff(
        'KaedeharaKazuha',
        ['KaedeharaKazuha', `swirl${element}`],
        element,
        0,
        480
      )
  },
}
