import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/dahlia, main as of 2026-11-10. */

const dahliaNormals: NormalHit[] = [
  {
    hitmarks: [15],
    hitlag: [6],
    toNormal: 21,
    toCharged: 21,
    toAbil: 15,
    frames: 32,
  },
  {
    hitmarks: [13],
    hitlag: [6],
    toNormal: 21,
    toCharged: 21,
    toAbil: 13,
    frames: 34,
  },
  {
    hitmarks: [14, 15],
    hitlag: [8, 8],
    toNormal: 39,
    toCharged: 39,
    toAbil: 15,
    frames: 47,
  },
  {
    hitmarks: [21],
    hitlag: [9],
    toNormal: 71,
    toCharged: 71,
    toAbil: 21,
    frames: 71,
  },
]

/** Our sheet's node for each hit instance of a string step (N3 is two nodes: normal.2 and .3) */
const dahliaNodes = [['0'], ['1'], ['2', '3'], ['4']]

interface State {
  end: number
  speed: number
  poll: number
  cast: number
}
const favor = (c: SimContext, s: State) => c.characterFrame('Dahlia') < s.end
function updateSpeed(c: SimContext, s: State, recipient: CharacterKey) {
  const token = ++s.poll
  const tick = (at: SimContext) => {
    if (s.poll !== token || at.onField !== recipient || !favor(at, s)) return
    const hp = at.calculate('Dahlia', ['total', 'hp'])
    s.speed =
      Math.min((hp ?? 40000) * 0.000005, 0.2) +
      (at.constellation('Dahlia') >= 6 ? 0.1 : 0)
    at.atCharacter(recipient, 30, tick)
  }
  tick(c)
}

export const kit: KitModel = {
  characterKey: 'Dahlia',
  element: 'hydro',
  source: `${GCSIM}/dahlia`,
  init: (): State => ({ end: -1, speed: 0, poll: 0, cast: 0 }),
  onStart(c) {
    if (c.calculate('Dahlia', ['total', 'hp']) === undefined)
      c.note(
        'Dahlia: without stat evaluation, A4 assumes the 40,000 HP attack-speed cap.'
      )
  },
  onPartySwap(c, s: State, _from, to) {
    if (favor(c, s)) updateSpeed(c, s, to)
  },
  normalAttackSpeed: (c, s: State, actor, alreadyNormal) =>
    favor(c, s) && c.onField === actor && alreadyNormal ? s.speed : 0,
  act(ctx, s: State, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          dahliaNormals,
          action.count ?? 1,
          (i, d, j) =>
            ctx.hit(d, {
              path: ['normal', dahliaNodes[i][j]],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}${j ? ` (hit ${j + 1})` : ''}`,
            }),
          ctx
        )
      case 'charged':
        // two instances at the same frame
        for (let j = 0; j < 2; j++)
          ctx.hit(10, {
            path: ['charged', j ? 'dmg2' : 'dmg1'],
            tag: 'charged',
            element: 'physical',
            applies: true,
            icd: 'normal',
            label: `Charged Attack${j ? ' (hit 2)' : ''}`,
          })
        return {
          frames: 67,
          framesInto: {
            normal: 67,
            skill: 42,
            burst: 42,
            dash: 10,
            jump: 10,
            swap: 42,
          },
        }
      case 'skill': {
        const hold = !!action.hold
        ctx.hit(hold ? 28 : 27, {
          path: ['skill', 'skillDmg'],
          tag: 'skill',
          element: 'hydro',
          applies: true,
          label: hold ? 'Immersive Ordinance (hold)' : 'Immersive Ordinance',
        })
        const cooldown = { key: 'skill', frames: 540, delay: hold ? 21 : 23 }
        return hold
          ? {
              cooldown,
              frames: 55,
              framesInto: {
                normal: 35,
                burst: 35,
                skill: 37,
                dash: 33,
                jump: 32,
                swap: 33,
              },
            }
          : {
              cooldown,
              frames: 53,
              framesInto: {
                normal: 32,
                burst: 33,
                skill: 36,
                dash: 31,
                jump: 29,
                swap: 31,
              },
            }
      }
      case 'burst': {
        ctx.hit(30, {
          path: ['burst', 'skillDmg'],
          tag: 'burst',
          element: 'hydro',
          applies: true,
          durability: 50,
          label: 'Radiant Psalter',
        })
        // Favonian Favor (the team's ATK SPD from A4 and C6): 12 s from 31 frames in, +3 s at C4.
        // (Shields, Benison stacks and the C2 shield bonus do no damage: not modelled.)
        const cast = ++s.cast
        ctx.at(31, (c) => {
          const duration = 720 + (c.constellation('Dahlia') >= 4 ? 180 : 0)
          s.end = c.characterFrame('Dahlia') + duration
          c.state('Dahlia', ['Dahlia', 'burstActive'], 'on')
          updateSpeed(c, s, c.onField)
          c.atCharacter('Dahlia', duration, (at) => {
            if (cast === s.cast)
              at.state('Dahlia', ['Dahlia', 'burstActive'], '')
          })
        })
        return {
          cooldown: { key: 'burst', frames: 15 * 60 },
          frames: 55,
          framesInto: { normal: 53, skill: 52, dash: 51, jump: 51, swap: 52 },
        }
      }
      case 'dash':
        // Boy body: 21 frames, 2 into a jump (gcsim's template dash)
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        // gcsim's template jump: 31 frames, 34 after a dash (Boy body)
        return templateJump('boy', 'sword', previous, ctx)
      case 'plunge':
        // gcsim has no plunge frames for Dahlia (no plunge.go): not modelled
        ctx.note('Dahlia: plunge is not modelled (no plunge frames in gcsim)')
        return { frames: 30 }
      default:
        return { frames: 30 }
    }
  },
}
